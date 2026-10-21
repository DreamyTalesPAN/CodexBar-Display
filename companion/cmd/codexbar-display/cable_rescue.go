package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/firmwareupdate"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
)

// flashCableRescueWithRetry writes the image through the ROM loader. A write
// that fails is tried once more on the same port at a lower baud rate: the
// loader stays reachable after a failed write (issue #818), and a CH340 on
// Windows that timed out at the default rate finished at the slower one.
// From the moment the loader erases the old firmware, marker records that the
// VibeTV can only be reached through its ROM loader until a write is verified.
func flashCableRescueWithRetry(ctx context.Context, home string, marker firmwareupdate.RescueMarker, image []byte, resumed bool) error {
	attempts := []struct {
		baud int
		name string
	}{
		{0, "at the standard baud rate"},
		{usb.ROMFallbackBaudRate, fmt.Sprintf("at %d baud", usb.ROMFallbackBaudRate)},
	}
	// The marker is the only way back to a VibeTV whose old firmware the loader
	// has erased, so it must be on disk before the first write may start
	// (Codex review on #819). Without it nothing is flashed.
	// One marker is the only record of a half-written VibeTV. While one for
	// another port is pending (its VibeTV may just be unplugged), a second
	// rescue would overwrite it, so it waits (Codex review on #819).
	// While a marker is pending, only its own resume may write. A fresh rescue
	// would overwrite it, whether its VibeTV sits on another port or on the
	// same port name reused by a different VibeTV (Codex review on #819).
	if pending, ok := firmwareupdate.LoadRescueMarker(home, time.Now()); ok && !resumed {
		return fmt.Errorf("the VibeTV on %s is left half-written; connect it by Cable and update it first", pending.Port)
	}
	marker.WriteStartedAt = time.Now()
	if !resumed {
		// The ports listed before the first write tell a VibeTV that was
		// replugged into another socket apart from the ports already there.
		if ports, listErr := listCablePortsFn(); listErr == nil {
			marker.Ports = ports
		}
	}
	// A resume on a port the VibeTV seems to have moved to keeps the marker on
	// disk as it was until the ROM loader confirms the recorded chip there: the
	// new port may be an unrelated silent adapter, and rebinding the marker to
	// it would hide the real VibeTV's return to its first socket (Codex on #840).
	saved, onDisk := firmwareupdate.LoadRescueMarker(home, time.Now())
	moved := resumed && onDisk && !strings.EqualFold(strings.TrimSpace(saved.Port), strings.TrimSpace(marker.Port))
	if !moved {
		if saveErr := firmwareupdate.SaveRescueMarker(home, marker); saveErr != nil {
			return fmt.Errorf("save the rescue marker before writing: %w", saveErr)
		}
	}
	// The chip is saved into the marker before the erase. Every later attempt
	// writes only that chip: a resumed rescue starts with the chip it recorded.
	recordChip := func(chip string) error {
		marker.ChipMAC = chip
		return firmwareupdate.SaveRescueMarker(home, marker)
	}
	started := false
	// Only a failure known to come before any flash command proves the old
	// firmware is untouched; a lost FLASH_BEGIN reply may already have erased.
	untouched := true
	var err error
	for i, attempt := range attempts {
		fmt.Printf("Cable rescue write %d/%d %s\n", i+1, len(attempts), attempt.name)
		err = flashCableRescueFn(ctx, marker.Port, image, usb.ROMFlashOptions{
			BaudRate: attempt.baud,
			Progress: func(percent int) {
				fmt.Printf("Writing firmware: %d%%\n", percent)
			},
			// The marker saved above stays as it is: rewriting it after the
			// erase could only damage the one thing that leads back here.
			OnWriteStarted:   func() { started = true },
			ExpectChip:       marker.ChipMAC,
			OnChipIdentified: recordChip,
		})
		if err == nil {
			return nil
		}
		fmt.Printf("Cable rescue write %d/%d failed: %v\n", i+1, len(attempts), err)
		// Only a port that would not open, a refused image, and a chip check
		// that stopped before the erase prove that no flash command went out.
		// A loader that "never synced" may hide an
		// earlier inner attempt whose FLASH_BEGIN reply was lost (Codex on
		// #819), so that marker stays; a VibeTV that still answers clears it
		// on the next attempt (stale-marker check).
		if !errors.Is(err, usb.ErrNotESP8266AppImage) && !errors.Is(err, usb.ErrBeforeErase) && errcode.Of(err) != errcode.TransportSerialOpen {
			untouched = false
		}
		if ctx.Err() != nil || errors.Is(err, usb.ErrNotESP8266AppImage) || i == len(attempts)-1 {
			break
		}
		select {
		case <-ctx.Done():
		case <-time.After(cableRescueRetryPause):
		}
		// A cancel during the pause ends the retries like a cancelled write: the
		// cleanup below still runs, so a chipless marker does not block every
		// later rescue (Codex on #840).
		if ctx.Err() != nil {
			break
		}
	}
	// Without a recorded chip identity the write never reached the chip check,
	// so no FLASH_BEGIN went out and nothing was erased (Codex on #840).
	if err != nil && !started && (untouched || marker.ChipMAC == "") && !resumed {
		// Nothing reached the flash and the VibeTV was not half-written
		// before: its old firmware still answers its own hello, so no marker
		// may authorize a write without one. A resumed rescue keeps its marker:
		// that VibeTV was erased before this run began.
		if clearErr := firmwareupdate.ClearRescueMarker(home); clearErr != nil {
			fmt.Printf("warning: clearing the unused rescue marker failed: %v\n", clearErr)
		}
	}
	return err
}

// resumableRescueMarker returns the marker of a rescue write that failed after
// the erase, but only while its port is still present and its image is intact.
// Only then may the ROM loader on that port be written without a legacy hello.
// rescueImageMatchesMarker reports whether image is exactly the one the marker
// recorded. A resume writes only those bytes (Codex review on #819).
func rescueImageMatchesMarker(image []byte, marker firmwareupdate.RescueMarker) bool {
	sum := sha256.Sum256(image)
	return strings.EqualFold(hex.EncodeToString(sum[:]), strings.TrimSpace(marker.ImageSHA256))
}

func resumableRescueMarker(home string) (firmwareupdate.RescueMarker, bool) {
	marker, ok := firmwareupdate.LoadRescueMarker(home, time.Now())
	if !ok {
		return firmwareupdate.RescueMarker{}, false
	}
	ports, err := listCablePortsFn()
	if err != nil {
		fmt.Printf("Cable rescue: marked port %s is not present, nothing to resume\n", marker.Port)
		return firmwareupdate.RescueMarker{}, false
	}
	if !portListed(ports, marker.Port) {
		// Replugged into another USB socket: only one new port, silent and
		// not the marked one, may be resumed. Anything else stays unwritten.
		moved, found := firmwareupdate.MovedRescuePort(marker, usb.WithoutTTYAliases(ports), readCableFirmwareHelloFn)
		if !found {
			fmt.Printf("Cable rescue: marked port %s is not present, nothing to resume\n", marker.Port)
			return firmwareupdate.RescueMarker{}, false
		}
		fmt.Printf("Cable rescue: the VibeTV left half-written moved from %s to %s; resuming there\n", marker.Port, moved)
		marker.Port = moved
		// The ports listed now are the new baseline. The port it left is gone
		// from this list, so a later return to that socket counts as a replug.
		marker.Ports = ports
	}
	// A write that succeeded but was not verified leaves a marker although the
	// VibeTV may boot and answer normally later. Only an answer that matches the
	// recorded rescue (same board, the old or the target firmware) proves that;
	// then the marker is stale. Any other answer is another VibeTV on a reused
	// port name: the marker stays for the half-written one, and this port is not
	// written either (Codex review on #819). This runs before the image checks:
	// a healthy VibeTV clears its stale marker even when the cached image is gone.
	if hello, helloErr := readCableFirmwareHelloFn(marker.Port); helloErr == nil &&
		(strings.TrimSpace(hello.DeviceID) != "" || strings.TrimSpace(hello.Firmware) != "") {
		fw := strings.TrimSpace(hello.Firmware)
		sameBoard := strings.EqualFold(strings.TrimSpace(hello.Board), strings.TrimSpace(marker.Board))
		// Board and firmware alone also fit another VibeTV that got the marked
		// port name. A hello with a deviceId must come from the marked chip
		// (Codex on #840); pre-Cable firmware sends none, so it keeps the old rule.
		sameChip := true
		if id := strings.TrimSpace(hello.DeviceID); id != "" {
			if want, ok := firmwareupdate.ChipDeviceID(marker.ChipMAC); ok {
				sameChip = id == want
			}
		}
		if sameBoard && sameChip && (fw == strings.TrimSpace(marker.TargetFirmware) || fw == strings.TrimSpace(marker.Firmware)) {
			fmt.Printf("Cable rescue: the VibeTV on %s answers again (firmware %s); its marker is stale\n", marker.Port, fw)
			if clearErr := firmwareupdate.ClearRescueMarker(home); clearErr != nil {
				fmt.Printf("warning: clearing the stale rescue marker failed: %v\n", clearErr)
			}
		} else {
			fmt.Printf("Cable rescue: another VibeTV answers on %s (board %s, firmware %s); keeping the marker for the half-written one and writing nothing there\n", marker.Port, strings.TrimSpace(hello.Board), fw)
		}
		return firmwareupdate.RescueMarker{}, false
	}
	if _, statErr := os.Stat(marker.ImagePath); statErr != nil {
		fmt.Printf("Cable rescue: marked image is gone, nothing to resume: %v\n", statErr)
		return firmwareupdate.RescueMarker{}, false
	}
	if marker.ChipMAC == "" {
		// Without the recorded chip a resume could erase a different VibeTV on
		// a reused port, so such a marker is not resumed.
		fmt.Printf("Cable rescue: port %s holds a half-written VibeTV, but its marker records no chip; nothing to resume\n", marker.Port)
		return firmwareupdate.RescueMarker{}, false
	}
	if sum, sumErr := sha256File(marker.ImagePath); sumErr != nil || !strings.EqualFold(sum, marker.ImageSHA256) {
		fmt.Printf("Cable rescue: marked image does not match its checksum, nothing to resume\n")
		return firmwareupdate.RescueMarker{}, false
	}
	fmt.Printf("Cable rescue: no VibeTV said hello, but port %s holds one left half-written; resuming through its ROM loader\n", marker.Port)
	return marker, true
}

func portListed(ports []string, port string) bool {
	for _, listed := range ports {
		if strings.EqualFold(strings.TrimSpace(listed), strings.TrimSpace(port)) {
			return true
		}
	}
	return false
}
