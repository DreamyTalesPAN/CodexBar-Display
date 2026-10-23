package usb

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
)

// The ESP8266 ROM serial loader, reduced to what the Cable rescue needs:
// enter the loader, erase and write the app image at 0x0, then boot it.
// Protocol: https://docs.espressif.com/projects/esptool/en/latest/esp8266/advanced-topics/serial-protocol.html
// The ROM loader works whatever firmware is installed, so it reaches devices
// whose firmware predates the Cable identity and transfer contract.
const (
	romCmdFlashBegin = 0x02
	romCmdFlashData  = 0x03
	romCmdSync       = 0x08
	romCmdReadReg    = 0x0a

	// The chip identity is the eFuse MAC of the ESP8266 (esptool ESP_OTP_MAC0 and MAC1).
	romEfuseMAC0 = 0x3ff00050
	romEfuseMAC1 = 0x3ff00054

	// The ROM loader detects the baud rate from the first sync. Measured on a
	// VibeTV (CH340): 230400 halves the write to about 27 seconds and connects
	// at once; 460800 barely writes faster, because each block's flash write
	// then dominates, and needs many connect attempts; 921600 never syncs.
	romBaudRate = 230400
	// ROMFallbackBaudRate is the slower rate for the second try of a rescue
	// write: a CH340 on Windows timed out at 230400 (issue #818), and the ROM
	// loader detects whatever rate the first sync arrives at.
	ROMFallbackBaudRate = 115200

	romFlashBlockSize  = 0x400
	romFlashSectorSize = 0x1000
	// eagle.flash.4m2m.ld: the sketch lives below 0x100000.
	romMaxAppImageSize = 0x100000

	romCommandTimeout     = 3 * time.Second
	romSyncTimeout        = 100 * time.Millisecond
	romEraseTimeoutPerMB  = 30 * time.Second
	romConnectAttempts    = 7
	romSyncAttempts       = 5
	romWriteBlockAttempts = 3
	romFlashAttempts      = 3
)

var romSyncPayload = append([]byte{0x07, 0x07, 0x12, 0x20}, bytes.Repeat([]byte{0x55}, 32)...)

var (
	errROMResponseTimeout = errors.New("ROM loader response timeout")
	// errROMRejected is a reply the loader sent for the request itself, so
	// repeating that request keeps requests and replies paired.
	errROMRejected = errors.New("ROM loader rejected command")
)

// ErrNotESP8266AppImage is returned before the port is opened when the bytes
// are not an ESP8266 app image, so nothing is written for them.
var ErrNotESP8266AppImage = errors.New("firmware is not an ESP8266 app image")

// ErrBeforeErase is returned when a write stopped before FLASH_BEGIN: nothing
// was erased, so the old firmware still answers and no retry is needed.
var ErrBeforeErase = errors.New("stopped before the flash erase")

// ErrROMLoaderNotEntered: no sync reply, so nothing was sent that could erase
// or write the flash.
var ErrROMLoaderNotEntered = errors.New("VibeTV did not enter the ESP8266 ROM loader")

// ROMFlashOptions tunes one ROM loader write.
type ROMFlashOptions struct {
	// BaudRate is the serial rate for the loader; zero means the default.
	BaudRate int
	// Progress, when set, receives the written share in steps of ten percent.
	Progress func(percent int)
	// OnWriteStarted, when set, is called each time the loader accepts the
	// flash begin command: from then on the old firmware is gone and the
	// device may be left without bootable firmware.
	OnWriteStarted func()
	// ExpectChip, when set, is the chip identity the loader must show before
	// anything is erased. Another chip, or an unreadable one, stops the write.
	ExpectChip string
	// OnChipIdentified, when set, receives the chip identity read before the
	// erase. An error stops the write before anything is erased.
	OnChipIdentified func(chip string) error
}

// FlashESP8266AppImageWithOptions writes an ESP8266 app image at offset 0
// through the ROM loader on path and resets the chip into it. Settings, themes,
// and WiFi credentials live above the sketch area and are not touched. opts
// chooses the baud rate and hooks the moment the old firmware is erased.
func FlashESP8266AppImageWithOptions(ctx context.Context, path string, image []byte, opts ROMFlashOptions) error {
	if len(image) == 0 || image[0] != 0xe9 || len(image) > romMaxAppImageSize {
		return ErrNotESP8266AppImage
	}
	mode := openMode()
	mode.BaudRate = romBaudRate
	if opts.BaudRate > 0 {
		mode.BaudRate = opts.BaudRate
	}
	port, err := serialOpener{openFn: serialOpen}.Open(path, mode)
	if err != nil {
		return wrapTransportError(
			errcode.TransportSerialOpen,
			"rescue-open",
			path,
			"Quit other apps that use the VibeTV cable, then retry.",
			err,
		)
	}
	defer func() { _ = closePortBestEffort(port, path, closeTimeout) }()
	loader := &romLoader{port: port, sleep: time.Sleep, progress: opts.Progress, onWriteStarted: opts.OnWriteStarted, expectChip: opts.ExpectChip, onChipIdentified: opts.OnChipIdentified}
	return loader.flashAndBoot(ctx, image)
}

// flashAndBoot retries the whole write from a fresh loader entry. After a
// failed write the device has no bootable firmware and no longer says hello,
// so this job is the last one that knows it is the rescued VibeTV.
func (l *romLoader) flashAndBoot(ctx context.Context, image []byte) error {
	var err error
	for range romFlashAttempts {
		if err = l.connect(ctx); err == nil {
			if err = l.flash(ctx, image); err == nil {
				l.hardReset()
				return nil
			}
		}
		if ctx.Err() != nil {
			return err
		}
	}
	return err
}

type romLoader struct {
	port     SerialPort
	sleep    func(time.Duration)
	progress func(percent int)
	// onWriteStarted runs once the loader accepted flash begin.
	onWriteStarted func()
	// expectChip and onChipIdentified guard the erase, see checkChip.
	expectChip       string
	onChipIdentified func(chip string) error
	pending          []byte
	// beginSent is set before FLASH_BEGIN goes out: from then on an erase may
	// have happened even when its reply was lost.
	beginSent bool
}

func (l *romLoader) connect(ctx context.Context) error {
	if err := l.port.SetReadTimeout(20 * time.Millisecond); err != nil {
		return err
	}
	for attempt := 0; attempt < romConnectAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		// Some USB bridges need longer before IO0 is sampled; esptool
		// alternates the same two delays.
		l.enterLoader(time.Duration(50+500*(attempt%2)) * time.Millisecond)
		_ = l.port.ResetInputBuffer()
		l.pending = nil
		for range romSyncAttempts {
			if err := l.command(romCmdSync, romSyncPayload, 0, romSyncTimeout); err == nil {
				// The ROM answers one sync with several replies.
				_, _ = l.readFrame(time.Now().Add(romSyncTimeout))
				l.pending = nil
				_ = l.port.ResetInputBuffer()
				return nil
			}
		}
	}
	return ErrROMLoaderNotEntered
}

// enterLoader drives the usual DTR/RTS auto-reset circuit: RTS holds EN low,
// DTR holds IO0 low while EN is released, so the chip boots the ROM loader.
func (l *romLoader) enterLoader(delay time.Duration) {
	_ = l.port.SetDTR(false)
	_ = l.port.SetRTS(true)
	l.sleep(100 * time.Millisecond)
	_ = l.port.SetDTR(true)
	_ = l.port.SetRTS(false)
	l.sleep(delay)
	_ = l.port.SetDTR(false)
}

func (l *romLoader) hardReset() {
	resetBoard(l.port, l.sleep)
}

func (l *romLoader) flash(ctx context.Context, image []byte) error {
	if err := l.checkChip(); err != nil {
		return err
	}
	// A cancel that arrived while the chip identity was being read must stop
	// the write here: after FLASH_BEGIN an intact VibeTV would be erased with
	// nothing written back (Codex on #840).
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("%w: %v", ErrBeforeErase, err)
	}
	blocks := (len(image) + romFlashBlockSize - 1) / romFlashBlockSize
	eraseTimeout := max(romCommandTimeout, romEraseTimeoutPerMB*time.Duration(len(image))/(1<<20))
	begin := romWords(romEraseSize(0, len(image)), uint32(blocks), romFlashBlockSize, 0)
	l.beginSent = true
	if err := l.command(romCmdFlashBegin, begin, 0, eraseTimeout); err != nil {
		return fmt.Errorf("erase flash: %w", err)
	}
	if l.onWriteStarted != nil {
		l.onWriteStarted()
	}
	reported := 0
	for seq := range blocks {
		if err := ctx.Err(); err != nil {
			return err
		}
		block := bytes.Repeat([]byte{0xff}, romFlashBlockSize)
		copy(block, image[seq*romFlashBlockSize:])
		data := append(romWords(romFlashBlockSize, uint32(seq), 0, 0), block...)
		// Only an explicit rejection is retried in place. After a timeout a
		// late reply could be taken for the next block's, so the whole write
		// restarts from a fresh loader entry instead.
		var err error
		for range romWriteBlockAttempts {
			err = l.command(romCmdFlashData, data, romChecksum(block), romCommandTimeout)
			if !errors.Is(err, errROMRejected) {
				break
			}
		}
		if err != nil {
			return fmt.Errorf("write flash block %d of %d: %w", seq+1, blocks, err)
		}
		if step := (seq + 1) * 10 / blocks; l.progress != nil && step > reported {
			reported = step
			l.progress(step * 10)
		}
	}
	return nil
}

func (l *romLoader) command(op byte, data []byte, checksum uint32, timeout time.Duration) error {
	_, err := l.exchange(op, data, checksum, timeout)
	return err
}

// exchange sends one request and returns its reply frame. Replies to other
// commands, such as the extra sync answers, are skipped.
func (l *romLoader) exchange(op byte, data []byte, checksum uint32, timeout time.Duration) ([]byte, error) {
	packet := make([]byte, 8, 8+len(data))
	packet[1] = op
	binary.LittleEndian.PutUint16(packet[2:], uint16(len(data)))
	binary.LittleEndian.PutUint32(packet[4:], checksum)
	packet = append(packet, data...)
	// A blocking serial write can still return early when the Go runtime
	// preempts it. Half a packet desynchronizes the ROM loader for good.
	for frame := slipEncode(packet); len(frame) > 0; {
		n, err := l.port.Write(frame)
		if err != nil {
			return nil, err
		}
		frame = frame[n:]
	}
	deadline := time.Now().Add(timeout)
	for {
		frame, err := l.readFrame(deadline)
		if err != nil {
			return nil, err
		}
		if len(frame) < 8 || frame[0] != 0x01 || frame[1] != op {
			continue
		}
		size := int(binary.LittleEndian.Uint16(frame[2:]))
		if size < 2 || len(frame) < 8+size {
			continue
		}
		// ESP8266 ROM replies end with two status bytes: status, error.
		if status := frame[8+size-2]; status != 0 {
			return nil, fmt.Errorf("%w 0x%02x (error 0x%02x)", errROMRejected, op, frame[8+size-1])
		}
		return frame, nil
	}
}

// readRegister returns the 32-bit register at addr as the ROM loader reads it.
func (l *romLoader) readRegister(addr uint32) (uint32, error) {
	frame, err := l.exchange(romCmdReadReg, romWords(addr), 0, romCommandTimeout)
	if err != nil {
		return 0, err
	}
	return binary.LittleEndian.Uint32(frame[4:8]), nil
}

// checkChip reads the chip identity before an erase. A different chip, an
// unreadable one, or an identity the caller refuses stops the write. Once a
// chip is identified, every later attempt of this write must show that chip.
func (l *romLoader) checkChip() error {
	if l.expectChip == "" && l.onChipIdentified == nil {
		return nil
	}
	mac0, err := l.readRegister(romEfuseMAC0)
	if err != nil {
		return l.chipCheckError(fmt.Errorf("read chip identity: %w", err))
	}
	mac1, err := l.readRegister(romEfuseMAC1)
	if err != nil {
		return l.chipCheckError(fmt.Errorf("read chip identity: %w", err))
	}
	chip := fmt.Sprintf("%08x%08x", mac1, mac0)
	if l.expectChip != "" && chip != l.expectChip {
		return l.chipCheckError(fmt.Errorf("the chip is %s, expected %s", chip, l.expectChip))
	}
	if l.onChipIdentified != nil {
		if err := l.onChipIdentified(chip); err != nil {
			return l.chipCheckError(err)
		}
	}
	l.expectChip = chip
	return nil
}

// chipCheckError marks a stop before the erase. Only a loader that has not
// sent FLASH_BEGIN can say the erase did not happen: an earlier attempt of the
// same write may have erased the chip already.
func (l *romLoader) chipCheckError(err error) error {
	if l.beginSent {
		return fmt.Errorf("chip check after an earlier flash begin, which may have erased: %w", err)
	}
	return fmt.Errorf("%w: %v", ErrBeforeErase, err)
}

func (l *romLoader) readFrame(deadline time.Time) ([]byte, error) {
	var frame []byte
	inFrame, escaped := false, false
	chunk := make([]byte, 256)
	for {
		for len(l.pending) > 0 {
			b := l.pending[0]
			l.pending = l.pending[1:]
			switch {
			case b == 0xc0:
				if inFrame && len(frame) > 0 {
					return frame, nil
				}
				inFrame, frame = true, frame[:0]
			case !inFrame:
			case escaped:
				escaped = false
				switch b {
				case 0xdc:
					frame = append(frame, 0xc0)
				case 0xdd:
					frame = append(frame, 0xdb)
				default:
					inFrame = false
				}
			case b == 0xdb:
				escaped = true
			default:
				frame = append(frame, b)
			}
		}
		if !time.Now().Before(deadline) {
			return nil, errROMResponseTimeout
		}
		n, err := l.port.Read(chunk)
		if err != nil {
			return nil, err
		}
		l.pending = append(l.pending, chunk[:n]...)
	}
}

func slipEncode(packet []byte) []byte {
	out := make([]byte, 0, len(packet)+2)
	out = append(out, 0xc0)
	for _, b := range packet {
		switch b {
		case 0xc0:
			out = append(out, 0xdb, 0xdc)
		case 0xdb:
			out = append(out, 0xdb, 0xdd)
		default:
			out = append(out, b)
		}
	}
	return append(out, 0xc0)
}

func romChecksum(data []byte) uint32 {
	sum := byte(0xef)
	for _, b := range data {
		sum ^= b
	}
	return uint32(sum)
}

// romEraseSize works around the ESP8266 ROM FLASH_BEGIN bug that erases
// roughly twice the requested size (esptool ESP8266ROM.get_erase_size).
func romEraseSize(offset, size int) uint32 {
	const sectorsPerBlock = 16
	sectors := (size + romFlashSectorSize - 1) / romFlashSectorSize
	head := sectorsPerBlock - (offset/romFlashSectorSize)%sectorsPerBlock
	head = min(head, sectors)
	if sectors < 2*head {
		return uint32((sectors + 1) / 2 * romFlashSectorSize)
	}
	return uint32((sectors - head) * romFlashSectorSize)
}

func romWords(words ...uint32) []byte {
	out := make([]byte, 4*len(words))
	for i, word := range words {
		binary.LittleEndian.PutUint32(out[4*i:], word)
	}
	return out
}
