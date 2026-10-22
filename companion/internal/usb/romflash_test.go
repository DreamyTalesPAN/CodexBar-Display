package usb

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"go.bug.st/serial"
)

// fakeROM answers like the ESP8266 ROM loader and records what it was sent.
type fakeROM struct {
	toHost       bytes.Buffer
	fromHost     []byte
	lines        []string
	ignoredSyncs int
	rejectBlock  int
	rejections   int
	silentBlock  int
	silences     int
	begin        []byte
	written      map[uint32][]byte
	registers    map[uint32]uint32
	// onBegin runs when FLASH_BEGIN arrives, for a chip that changes after an erase.
	onBegin func()
}

func newFakeROM() *fakeROM {
	return &fakeROM{rejectBlock: -1, silentBlock: -1, written: map[uint32][]byte{}, registers: map[uint32]uint32{
		romEfuseMAC0: 0x11223344,
		romEfuseMAC1: 0x0000aabb,
	}}
}

func (f *fakeROM) Read(p []byte) (int, error) {
	if f.toHost.Len() == 0 {
		return 0, nil
	}
	return f.toHost.Read(p)
}

func (f *fakeROM) Write(p []byte) (int, error) {
	// Accept at most 300 bytes per call, like a preempted serial write.
	if len(p) > 300 {
		p = p[:300]
	}
	f.fromHost = append(f.fromHost, p...)
	for {
		start := bytes.IndexByte(f.fromHost, 0xc0)
		if start < 0 {
			return len(p), nil
		}
		end := bytes.IndexByte(f.fromHost[start+1:], 0xc0)
		if end < 0 {
			return len(p), nil
		}
		raw := f.fromHost[start+1 : start+1+end]
		f.fromHost = f.fromHost[start+2+end:]
		packet := bytes.ReplaceAll(bytes.ReplaceAll(raw, []byte{0xdb, 0xdc}, []byte{0xc0}), []byte{0xdb, 0xdd}, []byte{0xdb})
		f.handle(packet)
	}
}

func (f *fakeROM) handle(packet []byte) {
	op := packet[1]
	checksum := binary.LittleEndian.Uint32(packet[4:])
	data := packet[8:]
	status := byte(0)
	switch op {
	case romCmdSync:
		if f.ignoredSyncs > 0 {
			f.ignoredSyncs--
			// Boot noise at another baud rate, no reply.
			f.toHost.Write([]byte{0x72, 0x6c, 0x00, 0x8c})
			return
		}
		for range 3 {
			f.reply(op, 0)
		}
		return
	case romCmdFlashBegin:
		f.begin = append([]byte(nil), data...)
		if f.onBegin != nil {
			f.onBegin()
		}
	case romCmdReadReg:
		addr := binary.LittleEndian.Uint32(data)
		value, known := f.registers[addr]
		if !known {
			f.replyValue(op, 0, 1)
			return
		}
		f.replyValue(op, value, 0)
		return
	case romCmdFlashData:
		seq := binary.LittleEndian.Uint32(data[4:])
		block := data[16:]
		if int(seq) == f.silentBlock && f.silences > 0 {
			// The block is written, but its reply never arrives in time.
			f.silences--
			f.written[seq] = append([]byte(nil), block...)
			return
		}
		if int(seq) == f.rejectBlock && f.rejections > 0 {
			f.rejections--
			status = 1
		} else if romChecksum(block) != checksum {
			status = 1
		} else {
			f.written[seq] = append([]byte(nil), block...)
		}
	}
	f.reply(op, status)
}

func (f *fakeROM) reply(op, status byte) {
	f.replyValue(op, 0, status)
}

func (f *fakeROM) replyValue(op byte, value uint32, status byte) {
	f.toHost.Write(slipEncode([]byte{0x01, op, 0x02, 0x00, byte(value), byte(value >> 8), byte(value >> 16), byte(value >> 24), status, 0x05}))
}

// Before the erase, a chip that is not the expected one must stop the write.
func TestROMLoaderRefusesAnotherChipBeforeErasing(t *testing.T) {
	rom := newFakeROM()
	loader := &romLoader{port: rom, sleep: func(time.Duration) {}, expectChip: "0000aabb11223355"}
	err := loader.flash(context.Background(), testAppImage(2*romFlashBlockSize))
	if !errors.Is(err, ErrBeforeErase) {
		t.Fatalf("flash error = %v, want ErrBeforeErase", err)
	}
	if rom.begin != nil || len(rom.written) != 0 {
		t.Fatal("erased or wrote a different chip")
	}
}

// The identity read before the erase is handed to the caller, and a matching
// expectation lets the write go on.
func TestROMLoaderReportsTheChipIdentityBeforeTheErase(t *testing.T) {
	rom := newFakeROM()
	var seen string
	loader := &romLoader{port: rom, sleep: func(time.Duration) {}, expectChip: "0000aabb11223344", onChipIdentified: func(chip string) error {
		seen = chip
		return nil
	}}
	if err := loader.flash(context.Background(), testAppImage(2*romFlashBlockSize)); err != nil {
		t.Fatalf("flash: %v", err)
	}
	if seen != "0000aabb11223344" {
		t.Fatalf("identity = %q", seen)
	}
	if rom.begin == nil {
		t.Fatal("no erase for the matching chip")
	}
}

// Codex on #840: a cancel during the chip check must not let FLASH_BEGIN go out.
func TestROMLoaderDoesNotEraseAfterACancelDuringTheChipCheck(t *testing.T) {
	rom := newFakeROM()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	loader := &romLoader{port: rom, sleep: func(time.Duration) {}, onChipIdentified: func(string) error {
		cancel()
		return nil
	}}
	err := loader.flash(ctx, testAppImage(2*romFlashBlockSize))
	if !errors.Is(err, ErrBeforeErase) {
		t.Fatalf("flash error = %v, want ErrBeforeErase after the cancel", err)
	}
	if rom.begin != nil {
		t.Fatal("FLASH_BEGIN went out after the cancel")
	}
}

func TestROMLoaderStopsWhenTheChipIdentityIsRefused(t *testing.T) {
	rom := newFakeROM()
	loader := &romLoader{port: rom, sleep: func(time.Duration) {}, onChipIdentified: func(string) error {
		return errors.New("marker not saved")
	}}
	err := loader.flash(context.Background(), testAppImage(2*romFlashBlockSize))
	if !errors.Is(err, ErrBeforeErase) {
		t.Fatalf("flash error = %v, want ErrBeforeErase", err)
	}
	if rom.begin != nil {
		t.Fatal("erased after the identity was refused")
	}
}

func (f *fakeROM) Close() error                       { return nil }
func (f *fakeROM) SetReadTimeout(time.Duration) error { return nil }
func (f *fakeROM) SetMode(*serial.Mode) error         { return nil }

func (f *fakeROM) ResetInputBuffer() error { return nil }
func (f *fakeROM) SetDTR(v bool) error     { f.lines = append(f.lines, lineState("DTR", v)); return nil }
func (f *fakeROM) SetRTS(v bool) error     { f.lines = append(f.lines, lineState("RTS", v)); return nil }

func lineState(name string, v bool) string {
	if v {
		return name + "=1"
	}
	return name + "=0"
}

func testAppImage(size int) []byte {
	image := make([]byte, size)
	for i := range image {
		image[i] = byte(i*7 + 3)
	}
	image[0] = 0xe9
	image[5] = 0xc0
	image[6] = 0xdb
	return image
}

func TestROMLoaderWritesAppImageAndBootsIt(t *testing.T) {
	rom := newFakeROM()
	rom.ignoredSyncs = romSyncAttempts + 1
	loader := &romLoader{port: rom, sleep: func(time.Duration) {}}
	image := testAppImage(2*romFlashBlockSize + 100)

	if err := loader.connect(context.Background()); err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := loader.flash(context.Background(), image); err != nil {
		t.Fatalf("flash: %v", err)
	}
	loader.hardReset()

	if got, want := rom.begin, romWords(romEraseSize(0, len(image)), 3, romFlashBlockSize, 0); !bytes.Equal(got, want) {
		t.Fatalf("FLASH_BEGIN = %x, want %x", got, want)
	}
	var flashed []byte
	for seq := range uint32(3) {
		flashed = append(flashed, rom.written[seq]...)
	}
	padded := append(append([]byte(nil), image...), bytes.Repeat([]byte{0xff}, 3*romFlashBlockSize-len(image))...)
	if !bytes.Equal(flashed, padded) {
		t.Fatal("flashed bytes differ from the padded image")
	}
	// Two loader entries (the first got no sync), then a hard reset that
	// leaves IO0 high so the new app boots.
	lines := strings.Join(rom.lines, " ")
	entry := "DTR=0 RTS=1 DTR=1 RTS=0 DTR=0"
	if strings.Count(lines, entry) != 2 || !strings.HasSuffix(lines, "DTR=0 RTS=1 RTS=0") {
		t.Fatalf("control lines = %q", lines)
	}
}

func TestROMLoaderReportsProgressInTenPercentSteps(t *testing.T) {
	var reported []int
	loader := &romLoader{port: newFakeROM(), sleep: func(time.Duration) {}, progress: func(percent int) {
		reported = append(reported, percent)
	}}
	if err := loader.flash(context.Background(), testAppImage(25*romFlashBlockSize)); err != nil {
		t.Fatal(err)
	}
	want := []int{10, 20, 30, 40, 50, 60, 70, 80, 90, 100}
	if fmt.Sprint(reported) != fmt.Sprint(want) {
		t.Fatalf("progress = %v, want %v", reported, want)
	}
}

func TestROMLoaderRetriesARejectedBlockThenFails(t *testing.T) {
	rom := newFakeROM()
	rom.rejectBlock, rom.rejections = 1, romWriteBlockAttempts-1
	loader := &romLoader{port: rom, sleep: func(time.Duration) {}}
	if err := loader.flash(context.Background(), testAppImage(3*romFlashBlockSize)); err != nil {
		t.Fatalf("flash with recoverable rejections: %v", err)
	}

	rom = newFakeROM()
	rom.rejectBlock, rom.rejections = 1, romWriteBlockAttempts
	loader = &romLoader{port: rom, sleep: func(time.Duration) {}}
	err := loader.flash(context.Background(), testAppImage(3*romFlashBlockSize))
	if err == nil || !strings.Contains(err.Error(), "write flash block 2 of 3") {
		t.Fatalf("flash error = %v, want block 2 failure", err)
	}
	if _, ok := rom.written[2]; ok {
		t.Fatal("wrote past the failed block")
	}
}

func TestROMLoaderStartsTheWholeWriteAgainAfterAFailedBlock(t *testing.T) {
	rom := newFakeROM()
	rom.rejectBlock, rom.rejections = 1, romWriteBlockAttempts
	loader := &romLoader{port: rom, sleep: func(time.Duration) {}}
	image := testAppImage(3 * romFlashBlockSize)
	if err := loader.flashAndBoot(context.Background(), image); err != nil {
		t.Fatalf("second attempt should succeed: %v", err)
	}
	if !bytes.Equal(rom.written[1], image[romFlashBlockSize:2*romFlashBlockSize]) {
		t.Fatal("block 2 was not written on the second attempt")
	}
	if !strings.HasSuffix(strings.Join(rom.lines, " "), "DTR=0 RTS=1 RTS=0") {
		t.Fatalf("no boot after the successful attempt: %v", rom.lines)
	}
}

func TestROMLoaderRestartsTheWholeWriteAfterABlockTimeout(t *testing.T) {
	rom := newFakeROM()
	rom.silentBlock, rom.silences = 1, 1
	loader := &romLoader{port: rom, sleep: func(time.Duration) {}}
	if err := loader.flash(context.Background(), testAppImage(3*romFlashBlockSize)); !errors.Is(err, errROMResponseTimeout) {
		t.Fatalf("a block timeout must end this write, got %v", err)
	}
	if _, ok := rom.written[2]; ok {
		t.Fatal("wrote the next block after an unanswered one")
	}

	rom = newFakeROM()
	rom.silentBlock, rom.silences = 1, 1
	loader = &romLoader{port: rom, sleep: func(time.Duration) {}}
	if err := loader.flashAndBoot(context.Background(), testAppImage(3*romFlashBlockSize)); err != nil {
		t.Fatalf("a fresh loader entry should finish the write: %v", err)
	}
	if strings.Count(strings.Join(rom.lines, " "), "DTR=0 RTS=1 DTR=1 RTS=0 DTR=0") != 2 {
		t.Fatalf("the write must restart from a fresh loader entry: %v", rom.lines)
	}
}

func TestROMLoaderGivesUpWhenTheLoaderNeverAnswers(t *testing.T) {
	rom := newFakeROM()
	rom.ignoredSyncs = romConnectAttempts * romSyncAttempts
	loader := &romLoader{port: rom, sleep: func(time.Duration) {}}
	if err := loader.connect(context.Background()); err == nil {
		t.Fatal("connect succeeded without a sync reply")
	}
}

func TestROMEraseSizeMatchesEsptool(t *testing.T) {
	for _, tc := range []struct{ offset, size int }{{0, 480000}, {0, 20000}, {0, 65536}, {0x10000, 131072}} {
		// esptool ESP8266ROM.get_erase_size, transcribed.
		sectors := (tc.size + 4095) / 4096
		head := 16 - (tc.offset/4096)%16
		if sectors < head {
			head = sectors
		}
		want := (sectors - head) * 4096
		if sectors < 2*head {
			want = (sectors + 1) / 2 * 4096
		}
		if got := romEraseSize(tc.offset, tc.size); int(got) != want {
			t.Fatalf("romEraseSize(%#x, %d) = %d, want %d", tc.offset, tc.size, got, want)
		}
	}
	if got := romEraseSize(0, 480000); got != 417792 {
		t.Fatalf("romEraseSize(0, 480000) = %d, want 417792", got)
	}
}

func TestFlashESP8266AppImageRejectsWhatIsNotAnAppImage(t *testing.T) {
	for _, image := range [][]byte{nil, {0x1f, 0x8b, 0x08}, append([]byte{0xe9}, make([]byte, romMaxAppImageSize)...)} {
		if err := FlashESP8266AppImage(context.Background(), "/dev/null-vibetv", image, nil); err == nil ||
			!strings.Contains(err.Error(), "not an ESP8266 app image") {
			t.Fatalf("FlashESP8266AppImage(%d bytes) = %v", len(image), err)
		}
	}
}

func TestFlashESP8266AppImageOpensTheROMLoaderAtItsFasterBaudRate(t *testing.T) {
	var opened *serial.Mode
	restore := serialOpen
	serialOpen = func(_ string, mode *serial.Mode) (serial.Port, error) {
		opened = mode
		return nil, errors.New("no port in this test")
	}
	t.Cleanup(func() { serialOpen = restore })

	if err := FlashESP8266AppImage(context.Background(), "/dev/null-vibetv", testAppImage(romFlashBlockSize), nil); err == nil {
		t.Fatal("flash without a port succeeded")
	}
	if opened == nil || opened.BaudRate != romBaudRate {
		t.Fatalf("opened with %+v, want baud %d", opened, romBaudRate)
	}
}

func TestFlashESP8266AppImageWithOptionsOpensTheROMLoaderAtTheRequestedBaudRate(t *testing.T) {
	var opened *serial.Mode
	restore := serialOpen
	serialOpen = func(_ string, mode *serial.Mode) (serial.Port, error) {
		opened = mode
		return nil, errors.New("no port in this test")
	}
	t.Cleanup(func() { serialOpen = restore })

	opts := ROMFlashOptions{BaudRate: ROMFallbackBaudRate}
	if err := FlashESP8266AppImageWithOptions(context.Background(), "/dev/null-vibetv", testAppImage(romFlashBlockSize), opts); err == nil {
		t.Fatal("flash without a port succeeded")
	}
	if opened == nil || opened.BaudRate != ROMFallbackBaudRate {
		t.Fatalf("opened with %+v, want baud %d", opened, ROMFallbackBaudRate)
	}
}

func TestFlashESP8266AppImageWithOptionsRefusesANonImageWithAKnownError(t *testing.T) {
	err := FlashESP8266AppImageWithOptions(context.Background(), "/dev/null-vibetv", []byte{0x1f, 0x8b}, ROMFlashOptions{})
	if !errors.Is(err, ErrNotESP8266AppImage) {
		t.Fatalf("got %v, want ErrNotESP8266AppImage", err)
	}
}

// Issue #818: the caller must learn that the old firmware is gone, but only
// once the loader accepted the erase, never for a loader that did not answer.
func TestROMLoaderReportsWhenTheWriteStarted(t *testing.T) {
	rom := newFakeROM()
	started := 0
	loader := &romLoader{port: rom, sleep: func(time.Duration) {}, onWriteStarted: func() { started++ }}
	if err := loader.flashAndBoot(context.Background(), testAppImage(2*romFlashBlockSize)); err != nil {
		t.Fatalf("flash: %v", err)
	}
	if started != 1 {
		t.Fatalf("write started reported %d times, want 1", started)
	}

	rom = newFakeROM()
	rom.ignoredSyncs = romConnectAttempts * romSyncAttempts
	started = 0
	loader = &romLoader{port: rom, sleep: func(time.Duration) {}, onWriteStarted: func() { started++ }}
	silent, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	if err := loader.flashAndBoot(silent, testAppImage(2*romFlashBlockSize)); err == nil {
		t.Fatal("flash succeeded without a loader")
	}
	if started != 0 {
		t.Fatalf("write started reported %d times for a loader that never answered", started)
	}

	// A write that began and then failed still reports it, once per attempt.
	rom = newFakeROM()
	rom.rejectBlock, rom.rejections = 0, 1000
	started = 0
	loader = &romLoader{port: rom, sleep: func(time.Duration) {}, onWriteStarted: func() { started++ }}
	if err := loader.flashAndBoot(context.Background(), testAppImage(2*romFlashBlockSize)); err == nil {
		t.Fatal("flash succeeded with every block rejected")
	}
	if started != romFlashAttempts {
		t.Fatalf("write started reported %d times, want %d", started, romFlashAttempts)
	}
}

// After an earlier FLASH_BEGIN the erase may already have happened, so a chip
// that reads differently afterwards must not count as an untouched VibeTV.
func TestROMLoaderDoesNotTreatAChipChangeAfterAnEraseAsUntouched(t *testing.T) {
	rom := newFakeROM()
	rom.rejectBlock, rom.rejections = 1, romWriteBlockAttempts
	rom.onBegin = func() { rom.registers[romEfuseMAC0] = 0x99 }
	loader := &romLoader{port: rom, sleep: func(time.Duration) {}, onChipIdentified: func(string) error { return nil }}
	err := loader.flashAndBoot(context.Background(), testAppImage(3*romFlashBlockSize))
	if err == nil || errors.Is(err, ErrBeforeErase) || !strings.Contains(err.Error(), "may have erased") {
		t.Fatalf("flash error = %v, want a failure after the erase", err)
	}
}
