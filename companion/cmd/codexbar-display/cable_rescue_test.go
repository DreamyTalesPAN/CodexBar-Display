package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/firmwareupdate"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
)

const rescueTestBoard = "esp8266-smalltv-st7789"

const rescueTestChip = "0000aabb11223344"

// rescueTestChipDeviceID is the deviceId firmware on rescueTestChip reports
// (ESP.getChipId: 0x11 | 0xaabb<<8).
const rescueTestChipDeviceID = "11189009"

func legacyRescueDevice() (usb.CableDevice, error) {
	return usb.CableDevice{Port: "/dev/mock-legacy", Hello: protocol.DeviceHello{Board: rescueTestBoard, Firmware: "1.0.0"}}, nil
}

func rescueArgs(manifestURL string) []string {
	return []string{"--target", "cable-rescue://vibetv", "--manifest-url", manifestURL, "--skip-launchagent-pause"}
}

// writeRescueMarkerFixture leaves what a failed rescue write leaves behind: a
// marker for port and the image it was writing.
func writeRescueMarkerFixture(t *testing.T, port string, age time.Duration) firmwareupdate.RescueMarker {
	t.Helper()
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	imagePath := filepath.Join(t.TempDir(), "firmware.bin")
	if err := os.WriteFile(imagePath, []byte("cable firmware"), 0o644); err != nil {
		t.Fatal(err)
	}
	marker := firmwareupdate.RescueMarker{
		Port:           port,
		Board:          rescueTestBoard,
		Firmware:       "1.0.0",
		TargetFirmware: "1.0.1",
		ImagePath:      imagePath,
		ImageSHA256:    sha256String("cable firmware"),
		ChipMAC:        rescueTestChip,
		WriteStartedAt: time.Now().Add(-age),
	}
	if err := firmwareupdate.SaveRescueMarker(home, marker); err != nil {
		t.Fatal(err)
	}
	return marker
}

func rescueMarkerPresent(t *testing.T) bool {
	t.Helper()
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	_, ok := firmwareupdate.LoadRescueMarker(home, time.Now())
	return ok
}

// Codex on #840: a first write that fails before the chip is read leaves a
// marker without ChipMAC. A cancel during the pause before the second attempt
// must still clear it, or it blocks every later rescue until it expires.
func TestCableRescueCancelledInThePauseClearsAChiplessMarker(t *testing.T) {
	prepareCableFirmwareUpdateTest(t)
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	prevPause := cableRescueRetryPause
	cableRescueRetryPause = 5 * time.Second
	t.Cleanup(func() { cableRescueRetryPause = prevPause })
	listCablePortsFn = func() ([]string, error) { return []string{"COM4"}, nil }
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	writes := 0
	flashCableRescueFn = func(context.Context, string, []byte, usb.ROMFlashOptions) error {
		writes++
		// Fails before the chip check: no OnChipIdentified, no OnWriteStarted.
		go func() { time.Sleep(50 * time.Millisecond); cancel() }()
		return errors.New("ROM loader never synced")
	}
	marker := firmwareupdate.RescueMarker{Port: "COM4", Board: rescueTestBoard, Firmware: "1.0.0", TargetFirmware: "1.0.1",
		ImagePath: filepath.Join(t.TempDir(), "firmware.bin")}
	if err := flashCableRescueWithRetry(ctx, home, marker, []byte("cable firmware"), false); err == nil {
		t.Fatal("the failed write must report its error")
	}
	if writes != 1 {
		t.Fatalf("writes=%d, want 1: the cancel ends the retries", writes)
	}
	if rescueMarkerPresent(t) {
		t.Fatal("a chipless marker must be cleared after a cancel in the pause")
	}
}

// Issue #842: a marker saved before the chip was read is cleared by a replug,
// because its VibeTV was never written.
func TestResumableRescueMarkerClearsAFlaggedChiplessMarkerOnReplug(t *testing.T) {
	prepareCableFirmwareUpdateTest(t)
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	marker := writeRescueMarkerFixture(t, "COM4", time.Hour)
	marker.ChipMAC, marker.ChipNotRead, marker.Ports = "", true, []string{"COM4"}
	if err := firmwareupdate.SaveRescueMarker(home, marker); err != nil {
		t.Fatal(err)
	}
	listCablePortsFn = func() ([]string, error) { return []string{"COM9"}, nil }
	readCableFirmwareHelloFn = func(string) (protocol.DeviceHello, error) {
		return protocol.DeviceHello{}, errors.New("no hello")
	}
	if _, ok := resumableRescueMarker(home); ok {
		t.Fatal("a flagged marker without a chip must not be resumed")
	}
	if rescueMarkerPresent(t) {
		t.Fatal("a marker saved before the chip was read must be cleared on replug")
	}
}

// Issue #842: a marker without the flag may come from a #819 or #840 build,
// where a failed write could have erased the VibeTV, so it is kept.
func TestResumableRescueMarkerKeepsALegacyChiplessMarker(t *testing.T) {
	prepareCableFirmwareUpdateTest(t)
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	marker := writeRescueMarkerFixture(t, "COM4", time.Hour)
	marker.ChipMAC, marker.Ports = "", []string{"COM4"}
	if err := firmwareupdate.SaveRescueMarker(home, marker); err != nil {
		t.Fatal(err)
	}
	listCablePortsFn = func() ([]string, error) { return []string{"COM9"}, nil }
	readCableFirmwareHelloFn = func(string) (protocol.DeviceHello, error) {
		return protocol.DeviceHello{}, errors.New("no hello")
	}
	if _, ok := resumableRescueMarker(home); ok {
		t.Fatal("a legacy chipless marker must not be resumed")
	}
	if !rescueMarkerPresent(t) {
		t.Fatal("a legacy chipless marker may hold a half-written VibeTV and must be kept")
	}
}

// Issue #842: the rescue saves the flagged marker before the first write and
// replaces it with the chip identity once the chip is read.
func TestCableRescueMarkerIsFlaggedUntilTheChipIsRead(t *testing.T) {
	prepareCableFirmwareUpdateTest(t)
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	listCablePortsFn = func() ([]string, error) { return []string{"COM4"}, nil }
	var beforeChip firmwareupdate.RescueMarker
	flashCableRescueFn = func(_ context.Context, _ string, _ []byte, opts usb.ROMFlashOptions) error {
		beforeChip, _ = firmwareupdate.LoadRescueMarker(home, time.Now())
		return opts.OnChipIdentified(rescueTestChip)
	}
	marker := firmwareupdate.RescueMarker{Port: "COM4", Board: rescueTestBoard, Firmware: "1.0.0", TargetFirmware: "1.0.1",
		ImagePath: filepath.Join(t.TempDir(), "firmware.bin")}
	if err := flashCableRescueWithRetry(context.Background(), home, marker, []byte("cable firmware"), false); err != nil {
		t.Fatalf("rescue write: %v", err)
	}
	if !beforeChip.ChipNotRead || beforeChip.ChipMAC != "" {
		t.Fatalf("marker before the chip read = %+v, want flagged without a chip", beforeChip)
	}
	after, ok := firmwareupdate.LoadRescueMarker(home, time.Now())
	if !ok || after.ChipNotRead || after.ChipMAC != rescueTestChip {
		t.Fatalf("marker after the chip read = %+v ok=%v, want the chip and no flag", after, ok)
	}
}

// Codex on #840: a resume on a port the VibeTV seems to have moved to keeps the
// marker on its first port until the ROM loader confirms the recorded chip.
// An unrelated silent adapter on the new port must not take the marker over.
func TestCableRescueMovedPortIsSavedOnlyAfterTheChipMatches(t *testing.T) {
	prepareCableFirmwareUpdateTest(t)
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	prevPause := cableRescueRetryPause
	cableRescueRetryPause = time.Millisecond
	t.Cleanup(func() { cableRescueRetryPause = prevPause })
	original := firmwareupdate.RescueMarker{
		Port: "COM4", Ports: []string{"COM1", "COM4"}, Board: rescueTestBoard, Firmware: "1.0.0", TargetFirmware: "1.0.1",
		ImagePath: filepath.Join(t.TempDir(), "firmware.bin"), ChipMAC: rescueTestChip, WriteStartedAt: time.Now().Add(-time.Hour),
	}
	if err := firmwareupdate.SaveRescueMarker(home, original); err != nil {
		t.Fatal(err)
	}
	moved := original
	moved.Port, moved.Ports = "COM9", []string{"COM1", "COM9"}
	portOnDisk := func() string {
		saved, ok := firmwareupdate.LoadRescueMarker(home, time.Now())
		if !ok {
			t.Fatal("the marker must stay")
		}
		return saved.Port
	}

	// Another chip answers the loader on COM9: stopped before the erase.
	flashCableRescueFn = func(_ context.Context, port string, _ []byte, opts usb.ROMFlashOptions) error {
		if port != "COM9" || opts.ExpectChip != rescueTestChip {
			t.Fatalf("write on %q expecting %q", port, opts.ExpectChip)
		}
		return fmt.Errorf("%w: the chip is 00000000deadbeef, expected %s", usb.ErrBeforeErase, rescueTestChip)
	}
	if err := flashCableRescueWithRetry(context.Background(), home, moved, []byte("cable firmware"), true); err == nil {
		t.Fatal("a chip mismatch must fail the resume")
	}
	if got := portOnDisk(); got != "COM4" {
		t.Fatalf("marker port = %q after a chip mismatch on the new port, want COM4", got)
	}

	// The recorded chip answers on COM9: from then on the marker follows it.
	var portWhenWriting string
	flashCableRescueFn = func(_ context.Context, _ string, _ []byte, opts usb.ROMFlashOptions) error {
		if err := opts.OnChipIdentified(rescueTestChip); err != nil {
			return err
		}
		portWhenWriting = portOnDisk()
		opts.OnWriteStarted()
		return nil
	}
	if err := flashCableRescueWithRetry(context.Background(), home, moved, []byte("cable firmware"), true); err != nil {
		t.Fatalf("resume on the confirmed chip: %v", err)
	}
	if portWhenWriting != "COM9" {
		t.Fatalf("marker port = %q once the chip matched, want COM9", portWhenWriting)
	}
}

// #840 bench, 21.10.2026: macOS lists the VibeTV as /dev/cu.X and /dev/tty.X.
// After a replug both new names are "new", so the moved VibeTV counted as two
// candidates and the rescue gave up. The tty alias of a listed cu port is the
// same device.
func TestResumableRescueMarkerFindsAMovedMacPortListedTwice(t *testing.T) {
	prepareCableFirmwareUpdateTest(t)
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	marker := writeRescueMarkerFixture(t, "/dev/cu.usbserial-11230", time.Hour)
	marker.Ports = []string{"/dev/cu.Bluetooth-Incoming-Port", "/dev/cu.usbserial-11230", "/dev/tty.Bluetooth-Incoming-Port", "/dev/tty.usbserial-11230"}
	if err := firmwareupdate.SaveRescueMarker(home, marker); err != nil {
		t.Fatal(err)
	}
	listCablePortsFn = func() ([]string, error) {
		return []string{"/dev/cu.Bluetooth-Incoming-Port", "/dev/cu.usbserial-11240", "/dev/tty.Bluetooth-Incoming-Port", "/dev/tty.usbserial-11240"}, nil
	}
	probed := map[string]int{}
	readCableFirmwareHelloFn = func(port string) (protocol.DeviceHello, error) {
		probed[port]++
		return protocol.DeviceHello{}, errors.New("half-written: no hello")
	}
	resumed, ok := resumableRescueMarker(home)
	if !ok || resumed.Port != "/dev/cu.usbserial-11240" {
		t.Fatalf("resume = %q, %v; want the moved VibeTV on /dev/cu.usbserial-11240 (probed %v)", resumed.Port, ok, probed)
	}
	if probed["/dev/tty.usbserial-11240"] != 0 {
		t.Fatalf("the tty alias must not be probed as a second VibeTV: %v", probed)
	}
}

func TestRunInstallUpdateCableRescueRetriesAFailedWriteAtALowerBaudRate(t *testing.T) {
	_, manifestURL, firmwareVersion := prepareCableFirmwareUpdateTest(t)
	pinCableRescue(t)
	readCableFirmwareHelloFn = func(string) (protocol.DeviceHello, error) {
		return protocol.DeviceHello{DeviceID: "device-cable", Board: rescueTestBoard, Firmware: *firmwareVersion}, nil
	}
	findLegacyCableVibeTVFn = legacyRescueDevice
	var bauds []int
	var ports []string
	flashCableRescueFn = func(_ context.Context, port string, _ []byte, opts usb.ROMFlashOptions) error {
		bauds, ports = append(bauds, opts.BaudRate), append(ports, port)
		opts.OnWriteStarted()
		if len(bauds) == 1 {
			return errors.New("write flash block 342 of 473: ROM loader response timeout")
		}
		*firmwareVersion = "1.0.1"
		return nil
	}

	output, err := captureStdout(t, func() error { return runInstallUpdate(rescueArgs(manifestURL)) })
	if err != nil {
		t.Fatalf("rescue should succeed on the second write: %v\n%s", err, output)
	}
	if len(bauds) != 2 || bauds[0] != 0 || bauds[1] != usb.ROMFallbackBaudRate || ports[0] != "/dev/mock-legacy" || ports[1] != "/dev/mock-legacy" {
		t.Fatalf("writes at bauds %v on ports %v, want the default then %d on the same port", bauds, ports, usb.ROMFallbackBaudRate)
	}
	for _, want := range []string{
		"Cable rescue write 1/2 at the standard baud rate",
		"Cable rescue write 1/2 failed: write flash block 342 of 473",
		"Cable rescue write 2/2 at 115200 baud",
		"Done: firmware 1.0.1 installed",
	} {
		if !strings.Contains(output, want) {
			t.Fatalf("missing %q in the updater output:\n%s", want, output)
		}
	}
	if rescueMarkerPresent(t) {
		t.Fatal("the marker must be cleared after a verified update")
	}
}

func TestRunInstallUpdateCableRescueLeavesAMarkerWhenTheWriteFailedAfterTheErase(t *testing.T) {
	_, manifestURL, _ := prepareCableFirmwareUpdateTest(t)
	pinCableRescue(t)
	findLegacyCableVibeTVFn = legacyRescueDevice
	writes := 0
	flashCableRescueFn = func(_ context.Context, _ string, _ []byte, opts usb.ROMFlashOptions) error {
		writes++
		opts.OnWriteStarted()
		return errors.New("write flash block 342 of 473: ROM loader response timeout")
	}

	output, err := captureStdout(t, func() error { return runInstallUpdate(rescueArgs(manifestURL)) })
	if err == nil || writes != 2 {
		t.Fatalf("expected two failed writes, got err=%v writes=%d\n%s", err, writes, output)
	}
	home, _ := os.UserHomeDir()
	marker, ok := firmwareupdate.LoadRescueMarker(home, time.Now())
	if !ok || marker.Port != "/dev/mock-legacy" || marker.TargetFirmware != "1.0.1" ||
		marker.Board != rescueTestBoard || marker.Firmware != "1.0.0" ||
		marker.ImageSHA256 != sha256String("cable firmware") || !strings.HasSuffix(marker.ImagePath, "firmware.bin") ||
		time.Since(marker.WriteStartedAt) > time.Minute {
		t.Fatalf("marker after the failed rescue: %+v ok=%v", marker, ok)
	}
	var cmdErr *commandError
	if !errors.As(err, &cmdErr) || !strings.Contains(cmdErr.Hint, "rescues it automatically") || strings.Contains(cmdErr.Hint, "retry once") {
		t.Fatalf("hint after a half-written rescue: %+v", cmdErr)
	}
}

// "Never entered the loader" can hide an earlier inner attempt whose
// FLASH_BEGIN reply was lost, so the marker stays (Codex on #819). A VibeTV
// that still answers clears it on the next attempt.
func TestRunInstallUpdateCableRescueKeepsTheMarkerWhenTheLoaderNeverAnswered(t *testing.T) {
	_, manifestURL, _ := prepareCableFirmwareUpdateTest(t)
	pinCableRescue(t)
	findLegacyCableVibeTVFn = legacyRescueDevice
	flashCableRescueFn = func(_ context.Context, _ string, _ []byte, opts usb.ROMFlashOptions) error {
		// An earlier inner attempt identified the chip before its FLASH_BEGIN reply was lost.
		_ = opts.OnChipIdentified(rescueTestChip)
		return usb.ErrROMLoaderNotEntered
	}

	output, err := captureStdout(t, func() error { return runInstallUpdate(rescueArgs(manifestURL)) })
	if err == nil {
		t.Fatalf("expected the rescue to fail\n%s", output)
	}
	if !rescueMarkerPresent(t) {
		t.Fatal("a loader that never answered may hide an erase; the marker must stay")
	}
}

// Without a chip identity the loader never got past the chip check, so no
// FLASH_BEGIN went out and the marker is cleared (Codex on #840).
func TestRunInstallUpdateCableRescueClearsTheMarkerWhenNoChipWasIdentified(t *testing.T) {
	_, manifestURL, _ := prepareCableFirmwareUpdateTest(t)
	pinCableRescue(t)
	findLegacyCableVibeTVFn = legacyRescueDevice
	flashCableRescueFn = func(context.Context, string, []byte, usb.ROMFlashOptions) error {
		return usb.ErrROMLoaderNotEntered
	}

	output, err := captureStdout(t, func() error { return runInstallUpdate(rescueArgs(manifestURL)) })
	if err == nil || rescueMarkerPresent(t) {
		t.Fatalf("err=%v marker=%v\n%s", err, rescueMarkerPresent(t), output)
	}
}

func TestRunInstallUpdateCableRescueClearsTheMarkerForARefusedImage(t *testing.T) {
	_, manifestURL, _ := prepareCableFirmwareUpdateTest(t)
	pinCableRescue(t)
	findLegacyCableVibeTVFn = legacyRescueDevice
	flashCableRescueFn = func(context.Context, string, []byte, usb.ROMFlashOptions) error {
		return usb.ErrNotESP8266AppImage
	}
	output, err := captureStdout(t, func() error { return runInstallUpdate(rescueArgs(manifestURL)) })
	if err == nil || rescueMarkerPresent(t) {
		t.Fatalf("a refused image sent nothing; the marker must go: err=%v marker=%v\n%s", err, rescueMarkerPresent(t), output)
	}
}

func TestRunInstallUpdateCableRescueWritesNothingWhenTheMarkerCannotBeSaved(t *testing.T) {
	_, manifestURL, _ := prepareCableFirmwareUpdateTest(t)
	pinCableRescue(t)
	findLegacyCableVibeTVFn = legacyRescueDevice
	home, _ := os.UserHomeDir()
	// A directory where the marker file belongs makes saving it fail.
	if err := os.MkdirAll(firmwareupdate.RescueMarkerPath(home), 0o755); err != nil {
		t.Fatal(err)
	}
	writes := 0
	flashCableRescueFn = func(context.Context, string, []byte, usb.ROMFlashOptions) error {
		writes++
		return nil
	}

	output, err := captureStdout(t, func() error { return runInstallUpdate(rescueArgs(manifestURL)) })
	if err == nil || writes != 0 {
		t.Fatalf("without a saved marker nothing may be written, got err=%v writes=%d\n%s", err, writes, output)
	}
	if !strings.Contains(err.Error(), "rescue marker") {
		t.Fatalf("the error should name the marker: %v", err)
	}
}

// A failure that may have reached the flash (a lost FLASH_BEGIN reply) or a
// resumed rescue of an already erased VibeTV keeps the marker (Codex on #819).
func TestRunInstallUpdateCableRescueKeepsTheMarkerWhenTheFailureMayHaveErased(t *testing.T) {
	t.Run("timeout before the erase was acknowledged", func(t *testing.T) {
		_, manifestURL, _ := prepareCableFirmwareUpdateTest(t)
		pinCableRescue(t)
		findLegacyCableVibeTVFn = legacyRescueDevice
		flashCableRescueFn = func(_ context.Context, _ string, _ []byte, opts usb.ROMFlashOptions) error {
			// The chip was identified before FLASH_BEGIN; its reply then timed out.
			_ = opts.OnChipIdentified(rescueTestChip)
			return errors.New("flash begin: ROM loader response timeout")
		}
		output, err := captureStdout(t, func() error { return runInstallUpdate(rescueArgs(manifestURL)) })
		if err == nil || !rescueMarkerPresent(t) {
			t.Fatalf("err=%v marker=%v\n%s", err, rescueMarkerPresent(t), output)
		}
	})
	t.Run("resumed rescue that never reached the loader", func(t *testing.T) {
		_, manifestURL, _ := prepareCableFirmwareUpdateTest(t)
		pinCableRescue(t)
		writeRescueMarkerFixture(t, "COM4", time.Hour)
		listCablePortsFn = func() ([]string, error) { return []string{"COM4"}, nil }
		findLegacyCableVibeTVFn = func() (usb.CableDevice, error) {
			return usb.CableDevice{}, errors.New("no VibeTV with pre-Cable firmware answered hello")
		}
		readCableFirmwareHelloFn = func(string) (protocol.DeviceHello, error) {
			return protocol.DeviceHello{}, errors.New("boot loop: no hello")
		}
		flashCableRescueFn = func(context.Context, string, []byte, usb.ROMFlashOptions) error {
			return usb.ErrROMLoaderNotEntered
		}
		output, err := captureStdout(t, func() error { return runInstallUpdate(rescueArgs(manifestURL)) })
		if err == nil || !rescueMarkerPresent(t) {
			t.Fatalf("a resumed rescue must keep its marker: err=%v marker=%v\n%s", err, rescueMarkerPresent(t), output)
		}
	})
}

// A resumed rescue hands the chip its marker recorded to the loader, so the
// loader refuses to erase any other chip (issue #839).
func TestRunInstallUpdateCableRescueResumesOnlyTheChipItErased(t *testing.T) {
	_, manifestURL, _ := prepareCableFirmwareUpdateTest(t)
	pinCableRescue(t)
	writeRescueMarkerFixture(t, "COM4", time.Hour)
	listCablePortsFn = func() ([]string, error) { return []string{"COM4"}, nil }
	findLegacyCableVibeTVFn = func() (usb.CableDevice, error) {
		return usb.CableDevice{}, errors.New("no VibeTV with pre-Cable firmware answered hello")
	}
	readCableFirmwareHelloFn = func(string) (protocol.DeviceHello, error) {
		return protocol.DeviceHello{}, errors.New("boot loop: no hello")
	}
	var expected string
	flashCableRescueFn = func(_ context.Context, _ string, _ []byte, opts usb.ROMFlashOptions) error {
		expected = opts.ExpectChip
		return usb.ErrBeforeErase
	}
	_, _ = captureStdout(t, func() error { return runInstallUpdate(rescueArgs(manifestURL)) })
	if expected != rescueTestChip {
		t.Fatalf("resumed write expects chip %q, want %q", expected, rescueTestChip)
	}
}

// A marker without a recorded chip cannot prove which VibeTV it belongs to, so
// nothing is written for it.
func TestRunInstallUpdateCableRescueWritesNothingForAMarkerWithoutAChip(t *testing.T) {
	_, manifestURL, _ := prepareCableFirmwareUpdateTest(t)
	pinCableRescue(t)
	marker := writeRescueMarkerFixture(t, "COM4", time.Hour)
	marker.ChipMAC = ""
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	if err := firmwareupdate.SaveRescueMarker(home, marker); err != nil {
		t.Fatal(err)
	}
	listCablePortsFn = func() ([]string, error) { return []string{"COM4"}, nil }
	findLegacyCableVibeTVFn = func() (usb.CableDevice, error) {
		return usb.CableDevice{}, errors.New("no VibeTV with pre-Cable firmware answered hello")
	}
	readCableFirmwareHelloFn = func(string) (protocol.DeviceHello, error) {
		return protocol.DeviceHello{}, errors.New("boot loop: no hello")
	}
	flashed := false
	flashCableRescueFn = func(context.Context, string, []byte, usb.ROMFlashOptions) error {
		flashed = true
		return nil
	}
	output, err := captureStdout(t, func() error { return runInstallUpdate(rescueArgs(manifestURL)) })
	if flashed || err == nil || !rescueMarkerPresent(t) {
		t.Fatalf("flashed=%v err=%v marker=%v\n%s", flashed, err, rescueMarkerPresent(t), output)
	}
}

type serialOpenTestError struct{}

func (serialOpenTestError) Error() string           { return "open-port path=/dev/mock-legacy: Serial port busy" }
func (serialOpenTestError) ErrorCode() errcode.Code { return errcode.TransportSerialOpen }

// A port that would not open never received a flash command: the fresh marker
// goes again (Codex on #819).
func TestRunInstallUpdateCableRescueClearsTheMarkerWhenThePortNeverOpened(t *testing.T) {
	_, manifestURL, _ := prepareCableFirmwareUpdateTest(t)
	pinCableRescue(t)
	findLegacyCableVibeTVFn = legacyRescueDevice
	flashCableRescueFn = func(context.Context, string, []byte, usb.ROMFlashOptions) error {
		return serialOpenTestError{}
	}
	output, err := captureStdout(t, func() error { return runInstallUpdate(rescueArgs(manifestURL)) })
	if err == nil || rescueMarkerPresent(t) {
		t.Fatalf("err=%v marker=%v\n%s", err, rescueMarkerPresent(t), output)
	}
}

// A pending marker for a half-written VibeTV wins over another pre-Cable
// VibeTV that still answers (Codex on #819).
func TestRunInstallUpdateCableRescuePrefersThePendingMarkerOverAnotherLegacyVibeTV(t *testing.T) {
	_, manifestURL, firmwareVersion := prepareCableFirmwareUpdateTest(t)
	pinCableRescue(t)
	marker := writeRescueMarkerFixture(t, "COM4", time.Hour)
	listCablePortsFn = func() ([]string, error) { return []string{"COM4", "/dev/mock-legacy"}, nil }
	findLegacyCableVibeTVFn = legacyRescueDevice
	var flashedPort string
	readCableFirmwareHelloFn = func(port string) (protocol.DeviceHello, error) {
		if flashedPort == "" {
			return protocol.DeviceHello{}, errors.New("boot loop: no hello")
		}
		return protocol.DeviceHello{DeviceID: "device-cable", Board: rescueTestBoard, Firmware: *firmwareVersion}, nil
	}
	flashCableRescueFn = func(_ context.Context, port string, _ []byte, opts usb.ROMFlashOptions) error {
		flashedPort = port
		opts.OnWriteStarted()
		*firmwareVersion = "1.0.1"
		return nil
	}
	output, err := captureStdout(t, func() error { return runInstallUpdate(rescueArgs(manifestURL)) })
	if err != nil || flashedPort != marker.Port {
		t.Fatalf("flashed %q, want the marked %q: err=%v\n%s", flashedPort, marker.Port, err, output)
	}
}

// A pending marker whose VibeTV is unplugged right now is not overwritten by
// the rescue of another pre-Cable VibeTV (Codex on #819).
func TestRunInstallUpdateCableRescueWaitsWhileAnotherVibeTVIsLeftHalfWritten(t *testing.T) {
	_, manifestURL, _ := prepareCableFirmwareUpdateTest(t)
	pinCableRescue(t)
	marker := writeRescueMarkerFixture(t, "COM4", time.Hour)
	listCablePortsFn = func() ([]string, error) { return []string{"/dev/mock-legacy"}, nil }
	findLegacyCableVibeTVFn = legacyRescueDevice
	flashCableRescueFn = func(context.Context, string, []byte, usb.ROMFlashOptions) error {
		t.Fatal("flashed another VibeTV while one is left half-written")
		return nil
	}
	output, err := captureStdout(t, func() error { return runInstallUpdate(rescueArgs(manifestURL)) })
	if err == nil || !strings.Contains(err.Error(), "left half-written") {
		t.Fatalf("expected the rescue to wait for COM4: err=%v\n%s", err, output)
	}
	home, _ := os.UserHomeDir()
	if kept, ok := firmwareupdate.LoadRescueMarker(home, time.Now()); !ok || kept.Port != marker.Port {
		t.Fatalf("the pending marker must stay: %+v ok=%v", kept, ok)
	}
}

// A write that succeeded but was not verified can leave a marker for a VibeTV
// that answers normally later; that marker is stale and must not redirect the
// rescue of another VibeTV (Codex on #819).
func TestRunInstallUpdateCableRescueClearsAStaleMarkerWhoseVibeTVAnswers(t *testing.T) {
	_, manifestURL, firmwareVersion := prepareCableFirmwareUpdateTest(t)
	pinCableRescue(t)
	writeRescueMarkerFixture(t, "COM4", time.Hour)
	listCablePortsFn = func() ([]string, error) { return []string{"COM4", "/dev/mock-legacy"}, nil }
	findLegacyCableVibeTVFn = legacyRescueDevice
	var flashedPort string
	readCableFirmwareHelloFn = func(port string) (protocol.DeviceHello, error) {
		if port == "COM4" {
			return protocol.DeviceHello{DeviceID: rescueTestChipDeviceID, Board: rescueTestBoard, Firmware: "1.0.1"}, nil
		}
		return protocol.DeviceHello{DeviceID: "device-cable", Board: rescueTestBoard, Firmware: *firmwareVersion}, nil
	}
	flashCableRescueFn = func(_ context.Context, port string, _ []byte, opts usb.ROMFlashOptions) error {
		flashedPort = port
		opts.OnWriteStarted()
		*firmwareVersion = "1.0.1"
		return nil
	}
	output, err := captureStdout(t, func() error { return runInstallUpdate(rescueArgs(manifestURL)) })
	if flashedPort != "/dev/mock-legacy" {
		t.Fatalf("flashed %q, want the legacy VibeTV, not the healthy marked one: err=%v\n%s", flashedPort, err, output)
	}
	if !strings.Contains(output, "marker is stale") {
		t.Fatalf("the stale marker was not reported:\n%s", output)
	}
}

// Codex on #840: another VibeTV with the same board and firmware that got the
// marked port name is not the marked chip. Its hello must not clear the only
// record of the half-written one, and its port is not written.
func TestRunInstallUpdateCableRescueKeepsTheMarkerForAnotherChipOnItsPort(t *testing.T) {
	_, manifestURL, _ := prepareCableFirmwareUpdateTest(t)
	pinCableRescue(t)
	writeRescueMarkerFixture(t, "COM4", time.Hour)
	listCablePortsFn = func() ([]string, error) { return []string{"COM4"}, nil }
	findLegacyCableVibeTVFn = func() (usb.CableDevice, error) {
		return usb.CableDevice{}, errors.New("no VibeTV with pre-Cable firmware answered hello")
	}
	readCableFirmwareHelloFn = func(string) (protocol.DeviceHello, error) {
		return protocol.DeviceHello{DeviceID: "16198106", Board: rescueTestBoard, Firmware: "1.0.1"}, nil
	}
	flashCableRescueFn = func(context.Context, string, []byte, usb.ROMFlashOptions) error {
		t.Fatal("another VibeTV on the marked port must not be written")
		return nil
	}
	output, _ := captureStdout(t, func() error { return runInstallUpdate(rescueArgs(manifestURL)) })
	if strings.Contains(output, "marker is stale") {
		t.Fatalf("another chip must not make the marker stale:\n%s", output)
	}
	if !rescueMarkerPresent(t) {
		t.Fatal("the marker of the half-written VibeTV must stay")
	}
}

// A stale marker whose cached image was deleted is still cleared once its
// VibeTV answers, so it cannot block every later rescue (Codex on #819).
func TestRunInstallUpdateCableRescueClearsAStaleMarkerWhoseImageIsGone(t *testing.T) {
	_, manifestURL, firmwareVersion := prepareCableFirmwareUpdateTest(t)
	pinCableRescue(t)
	marker := writeRescueMarkerFixture(t, "COM4", time.Hour)
	if err := os.Remove(marker.ImagePath); err != nil {
		t.Fatal(err)
	}
	listCablePortsFn = func() ([]string, error) { return []string{"COM4", "/dev/mock-legacy"}, nil }
	findLegacyCableVibeTVFn = legacyRescueDevice
	readCableFirmwareHelloFn = func(port string) (protocol.DeviceHello, error) {
		if port == "COM4" {
			return protocol.DeviceHello{DeviceID: rescueTestChipDeviceID, Board: rescueTestBoard, Firmware: "1.0.1"}, nil
		}
		return protocol.DeviceHello{DeviceID: "device-cable", Board: rescueTestBoard, Firmware: *firmwareVersion}, nil
	}
	flashCableRescueFn = func(_ context.Context, _ string, _ []byte, opts usb.ROMFlashOptions) error {
		opts.OnWriteStarted()
		*firmwareVersion = "1.0.1"
		return nil
	}
	output, _ := captureStdout(t, func() error { return runInstallUpdate(rescueArgs(manifestURL)) })
	if !strings.Contains(output, "marker is stale") {
		t.Fatalf("the stale marker was not reported:\n%s", output)
	}
	home, _ := os.UserHomeDir()
	if kept, ok := firmwareupdate.LoadRescueMarker(home, time.Now()); ok {
		t.Fatalf("the stale marker must be cleared: %+v", kept)
	}
}

// Another VibeTV on a reused port name neither clears the marker nor gets
// written (Codex on #819).
func TestRunInstallUpdateCableRescueKeepsTheMarkerWhenAnotherVibeTVAnswersOnItsPort(t *testing.T) {
	_, manifestURL, _ := prepareCableFirmwareUpdateTest(t)
	pinCableRescue(t)
	writeRescueMarkerFixture(t, "COM4", time.Hour)
	listCablePortsFn = func() ([]string, error) { return []string{"COM4"}, nil }
	findLegacyCableVibeTVFn = func() (usb.CableDevice, error) {
		return usb.CableDevice{}, errors.New("no VibeTV with pre-Cable firmware answered hello")
	}
	readCableFirmwareHelloFn = func(string) (protocol.DeviceHello, error) {
		return protocol.DeviceHello{DeviceID: "other", Board: "esp32-lilygo-t-display-s3", Firmware: "2.0.0"}, nil
	}
	flashCableRescueFn = func(context.Context, string, []byte, usb.ROMFlashOptions) error {
		t.Fatal("wrote to another VibeTV on the marked port")
		return nil
	}
	output, err := captureStdout(t, func() error { return runInstallUpdate(rescueArgs(manifestURL)) })
	if err == nil || !rescueMarkerPresent(t) || !strings.Contains(output, "another VibeTV answers") {
		t.Fatalf("expected no write and the marker kept: err=%v marker=%v\n%s", err, rescueMarkerPresent(t), output)
	}
}

// A different pre-Cable VibeTV found by the legacy probe on the marked port
// name is not written, and the marker stays (Codex on #819).
func TestRunInstallUpdateCableRescueRefusesAnotherLegacyVibeTVOnTheMarkedPort(t *testing.T) {
	_, manifestURL, _ := prepareCableFirmwareUpdateTest(t)
	pinCableRescue(t)
	writeRescueMarkerFixture(t, "/dev/mock-legacy", time.Hour)
	listCablePortsFn = func() ([]string, error) { return []string{"/dev/mock-legacy"}, nil }
	findLegacyCableVibeTVFn = func() (usb.CableDevice, error) {
		return usb.CableDevice{Port: "/dev/mock-legacy", Hello: protocol.DeviceHello{Board: rescueTestBoard, Firmware: "0.9.0"}}, nil
	}
	readCableFirmwareHelloFn = func(string) (protocol.DeviceHello, error) {
		return protocol.DeviceHello{Board: rescueTestBoard, Firmware: "0.9.0"}, nil
	}
	flashCableRescueFn = func(context.Context, string, []byte, usb.ROMFlashOptions) error {
		t.Fatal("wrote to a different VibeTV on the marked port")
		return nil
	}
	output, err := captureStdout(t, func() error { return runInstallUpdate(rescueArgs(manifestURL)) })
	if err == nil || !rescueMarkerPresent(t) {
		t.Fatalf("expected a refusal with the marker kept: err=%v marker=%v\n%s", err, rescueMarkerPresent(t), output)
	}
}

func TestRunInstallUpdateCableRescueFlashesTheMarkedPortWhenNoHelloComes(t *testing.T) {
	_, manifestURL, firmwareVersion := prepareCableFirmwareUpdateTest(t)
	pinCableRescue(t)
	marker := writeRescueMarkerFixture(t, "COM4", time.Hour)
	listCablePortsFn = func() ([]string, error) { return []string{"COM1", "com4"}, nil }
	probes := 0
	findLegacyCableVibeTVFn = func() (usb.CableDevice, error) {
		probes++
		return usb.CableDevice{}, errors.New("no VibeTV with pre-Cable firmware answered hello")
	}
	resolveCableFirmwarePortFn = func(string, string) (string, error) {
		t.Fatal("verification must stay on the marked port")
		return "", nil
	}
	var flashedPort, flashedImage string
	readCableFirmwareHelloFn = func(port string) (protocol.DeviceHello, error) {
		if port != "COM4" {
			t.Fatalf("verification read %q, want the marked port", port)
		}
		if flashedPort == "" {
			return protocol.DeviceHello{}, errors.New("boot loop: no hello")
		}
		return protocol.DeviceHello{DeviceID: "device-cable", Board: rescueTestBoard, Firmware: *firmwareVersion}, nil
	}
	flashCableRescueFn = func(_ context.Context, port string, image []byte, opts usb.ROMFlashOptions) error {
		flashedPort, flashedImage = port, string(image)
		opts.OnWriteStarted()
		*firmwareVersion = "1.0.1"
		return nil
	}

	output, err := captureStdout(t, func() error { return runInstallUpdate(rescueArgs(manifestURL)) })
	if err != nil {
		t.Fatalf("rescue through the marked port failed: %v\n%s", err, output)
	}
	if probes != 3 || flashedPort != marker.Port || flashedImage != "cable firmware" {
		t.Fatalf("probes=%d flashed %q with %q", probes, flashedPort, flashedImage)
	}
	if !strings.Contains(output, "left half-written") || !strings.Contains(output, "Done: firmware 1.0.1 installed") {
		t.Fatalf("resume was not logged or not verified:\n%s", output)
	}
	if rescueMarkerPresent(t) {
		t.Fatal("the marker must be cleared after the verified update")
	}
}

// Codex review on #819: the cached image is checked when the marker is picked
// and read again for the write. Only the bytes the marker recorded may be written.
func TestRescueImageMatchesMarkerOnlyForTheRecordedBytes(t *testing.T) {
	marker := firmwareupdate.RescueMarker{ImageSHA256: sha256String("cable firmware")}
	if !rescueImageMatchesMarker([]byte("cable firmware"), marker) {
		t.Fatal("the recorded bytes must match")
	}
	if rescueImageMatchesMarker([]byte("changed firmware"), marker) {
		t.Fatal("changed bytes must not match")
	}
	if rescueImageMatchesMarker([]byte("cable firmware"), firmwareupdate.RescueMarker{}) {
		t.Fatal("a marker without a checksum must not match")
	}
}

// The safety rule of the rescue: no flash without a legacy hello, unless a
// fresh marker names a port that is still there and its image is intact.
func TestRunInstallUpdateCableRescueWritesNothingWithoutAUsableMarker(t *testing.T) {
	for name, setup := range map[string]func(t *testing.T){
		"no marker": func(t *testing.T) {},
		"port gone": func(t *testing.T) {
			writeRescueMarkerFixture(t, "COM4", time.Hour)
			listCablePortsFn = func() ([]string, error) { return []string{"COM1", "COM5"}, nil }
		},
		"marker too old": func(t *testing.T) {
			writeRescueMarkerFixture(t, "COM4", firmwareupdate.RescueMarkerMaxAge+time.Hour)
			listCablePortsFn = func() ([]string, error) { return []string{"COM4"}, nil }
		},
		"image changed": func(t *testing.T) {
			marker := writeRescueMarkerFixture(t, "COM4", time.Hour)
			if err := os.WriteFile(marker.ImagePath, []byte("something else"), 0o644); err != nil {
				t.Fatal(err)
			}
			listCablePortsFn = func() ([]string, error) { return []string{"COM4"}, nil }
			// The half-written VibeTV on the marked port stays silent.
			readCableFirmwareHelloFn = func(string) (protocol.DeviceHello, error) {
				return protocol.DeviceHello{}, errors.New("no hello")
			}
		},
		"image gone": func(t *testing.T) {
			marker := writeRescueMarkerFixture(t, "COM4", time.Hour)
			if err := os.Remove(marker.ImagePath); err != nil {
				t.Fatal(err)
			}
			listCablePortsFn = func() ([]string, error) { return []string{"COM4"}, nil }
			// The half-written VibeTV on the marked port stays silent.
			readCableFirmwareHelloFn = func(string) (protocol.DeviceHello, error) {
				return protocol.DeviceHello{}, errors.New("no hello")
			}
		},
	} {
		t.Run(name, func(t *testing.T) {
			_, manifestURL, _ := prepareCableFirmwareUpdateTest(t)
			pinCableRescue(t)
			setup(t)
			findLegacyCableVibeTVFn = func() (usb.CableDevice, error) {
				return usb.CableDevice{}, errors.New("no VibeTV with pre-Cable firmware answered hello")
			}
			flashCableRescueFn = func(context.Context, string, []byte, usb.ROMFlashOptions) error {
				t.Fatal("flashed a port without a legacy hello and without a usable marker")
				return nil
			}
			_, err := captureStdout(t, func() error { return runInstallUpdate(rescueArgs(manifestURL)) })
			if err == nil || !strings.Contains(err.Error(), "pre-Cable firmware") {
				t.Fatalf("expected the rescue refusal, got %v", err)
			}
		})
	}
}
