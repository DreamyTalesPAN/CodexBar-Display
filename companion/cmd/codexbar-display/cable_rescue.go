package main

import (
	"context"
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
	marker.WriteStartedAt = time.Now()
	if saveErr := firmwareupdate.SaveRescueMarker(home, marker); saveErr != nil {
		return fmt.Errorf("save the rescue marker before writing: %w", saveErr)
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
			OnWriteStarted: func() { started = true },
		})
		if err == nil {
			return nil
		}
		fmt.Printf("Cable rescue write %d/%d failed: %v\n", i+1, len(attempts), err)
		// The port that would not open, the loader that never synced and the
		// refused image all failed before any flash command.
		if !errors.Is(err, usb.ErrROMLoaderNotEntered) && !errors.Is(err, usb.ErrNotESP8266AppImage) &&
			errcode.Of(err) != errcode.TransportSerialOpen {
			untouched = false
		}
		if ctx.Err() != nil || errors.Is(err, usb.ErrNotESP8266AppImage) || i == len(attempts)-1 {
			break
		}
		select {
		case <-ctx.Done():
			return err
		case <-time.After(cableRescueRetryPause):
		}
	}
	if err != nil && !started && untouched && !resumed {
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
func resumableRescueMarker(home string) (firmwareupdate.RescueMarker, bool) {
	marker, ok := firmwareupdate.LoadRescueMarker(home, time.Now())
	if !ok {
		return firmwareupdate.RescueMarker{}, false
	}
	ports, err := listCablePortsFn()
	if err != nil || !portListed(ports, marker.Port) {
		fmt.Printf("Cable rescue: marked port %s is not present, nothing to resume\n", marker.Port)
		return firmwareupdate.RescueMarker{}, false
	}
	if _, statErr := os.Stat(marker.ImagePath); statErr != nil {
		fmt.Printf("Cable rescue: marked image is gone, nothing to resume: %v\n", statErr)
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
