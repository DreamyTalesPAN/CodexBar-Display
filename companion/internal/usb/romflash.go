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

// FlashESP8266AppImage writes an ESP8266 app image at offset 0 through the ROM
// loader on path and resets the chip into it. Settings, themes, and WiFi
// credentials live above the sketch area and are not touched.
func FlashESP8266AppImage(ctx context.Context, path string, image []byte) error {
	if len(image) == 0 || image[0] != 0xe9 || len(image) > romMaxAppImageSize {
		return errors.New("firmware is not an ESP8266 app image")
	}
	port, err := serialOpener{openFn: serialOpen}.Open(path, openMode())
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
	loader := &romLoader{port: port, sleep: time.Sleep}
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
	port    SerialPort
	sleep   func(time.Duration)
	pending []byte
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
	return errors.New("VibeTV did not enter the ESP8266 ROM loader")
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
	_ = l.port.SetDTR(false)
	_ = l.port.SetRTS(true)
	l.sleep(100 * time.Millisecond)
	_ = l.port.SetRTS(false)
}

func (l *romLoader) flash(ctx context.Context, image []byte) error {
	blocks := (len(image) + romFlashBlockSize - 1) / romFlashBlockSize
	eraseTimeout := max(romCommandTimeout, romEraseTimeoutPerMB*time.Duration(len(image))/(1<<20))
	begin := romWords(romEraseSize(0, len(image)), uint32(blocks), romFlashBlockSize, 0)
	if err := l.command(romCmdFlashBegin, begin, 0, eraseTimeout); err != nil {
		return fmt.Errorf("erase flash: %w", err)
	}
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
	}
	return nil
}

// command sends one request and waits for its reply. Replies to other
// commands, such as the extra sync answers, are skipped.
func (l *romLoader) command(op byte, data []byte, checksum uint32, timeout time.Duration) error {
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
			return err
		}
		frame = frame[n:]
	}
	deadline := time.Now().Add(timeout)
	for {
		frame, err := l.readFrame(deadline)
		if err != nil {
			return err
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
			return fmt.Errorf("%w 0x%02x (error 0x%02x)", errROMRejected, op, frame[8+size-1])
		}
		return nil
	}
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
