package firmwareupdate

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/testenv"
)

func TestRescueMarkerRoundTripsAndClears(t *testing.T) {
	home := t.TempDir()
	testenv.Home(t, home)
	now := time.Now()
	want := RescueMarker{Port: "COM4", Board: "esp8266-smalltv-st7789", Firmware: "1.0.0", TargetFirmware: "1.0.9", ImagePath: "/x/fw.bin", ImageSHA256: "abc", WriteStartedAt: now}
	if _, ok := LoadRescueMarker(home, now); ok {
		t.Fatal("marker found before any was saved")
	}
	if err := SaveRescueMarker(home, want); err != nil {
		t.Fatal(err)
	}
	got, ok := LoadRescueMarker(home, now.Add(time.Hour))
	if !ok || got.Port != want.Port || got.TargetFirmware != "1.0.9" || got.ImagePath != "/x/fw.bin" || got.Board != want.Board {
		t.Fatalf("loaded %+v ok=%v", got, ok)
	}
	if err := ClearRescueMarker(home); err != nil {
		t.Fatal(err)
	}
	if _, ok := LoadRescueMarker(home, now); ok {
		t.Fatal("marker survived clearing")
	}
	if err := ClearRescueMarker(home); err != nil {
		t.Fatalf("clearing twice: %v", err)
	}
}

// Issue #842: an overlapping rescue may replace the flagged marker it inspected
// with a chip-bearing one; clearing the inspected marker must keep that one.
func TestClearRescueMarkerIfUnchangedKeepsAMarkerReplacedAfterInspection(t *testing.T) {
	home := t.TempDir()
	testenv.Home(t, home)
	now := time.Now()
	flagged := RescueMarker{Port: "COM4", TargetFirmware: "1.0.9", ImagePath: "/x", ChipNotRead: true, WriteStartedAt: now}
	if err := SaveRescueMarker(home, flagged); err != nil {
		t.Fatal(err)
	}
	inspected, ok := LoadRescueMarker(home, now)
	if !ok {
		t.Fatal("flagged marker not loaded")
	}
	replaced := inspected
	replaced.ChipNotRead, replaced.ChipMAC = false, "0000aabb11223344"
	if err := SaveRescueMarker(home, replaced); err != nil {
		t.Fatal(err)
	}
	if err := ClearRescueMarkerIfUnchanged(home, inspected); err != nil {
		t.Fatal(err)
	}
	got, ok := LoadRescueMarker(home, now.Add(time.Minute))
	if !ok || got.ChipMAC != replaced.ChipMAC {
		t.Fatalf("the chip marker written after inspection was removed: %+v ok=%v", got, ok)
	}
	if err := SaveRescueMarker(home, flagged); err != nil {
		t.Fatal(err)
	}
	if err := ClearRescueMarkerIfUnchanged(home, flagged); err != nil {
		t.Fatal(err)
	}
	if _, ok := LoadRescueMarker(home, now.Add(time.Minute)); ok {
		t.Fatal("an unchanged flagged marker must be cleared")
	}
}

// A separate updater reaches recordChip after the cleaner's final read, before
// its remove. The save must wait for the delete, then leave its chip marker.
func TestClearRescueMarkerIfUnchangedKeepsConcurrentChipWrite(t *testing.T) {
	const childHomeEnv = "VIBETV_TEST_RESCUE_MARKER_HOME"
	const chip = "0000aabb11223344"
	if home := os.Getenv(childHomeEnv); home != "" {
		marker, ok := LoadRescueMarker(home, time.Now())
		if !ok {
			t.Fatal("child could not load flagged marker")
		}
		marker.ChipNotRead, marker.ChipMAC = false, chip
		fmt.Println("saving chip marker")
		if err := SaveRescueMarker(home, marker); err != nil {
			t.Fatal(err)
		}
		return
	}
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" && runtime.GOOS != "windows" {
		t.Skip("process locks are only supported on desktop platforms")
	}
	home := t.TempDir()
	testenv.Home(t, home)
	flagged := RescueMarker{Port: "COM4", TargetFirmware: "1.0.9", ImagePath: "/x", ChipNotRead: true, WriteStartedAt: time.Now()}
	if err := SaveRescueMarker(home, flagged); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestClearRescueMarkerIfUnchangedKeepsConcurrentChipWrite$")
	cmd.Env = append(os.Environ(), childHomeEnv+"="+home)
	cmd.Stderr = os.Stderr
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	finished := false
	err = clearRescueMarkerIfUnchanged(home, flagged, func() {
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		scanner := bufio.NewScanner(stdout)
		if !scanner.Scan() || scanner.Text() != "saving chip marker" {
			_ = cmd.Wait()
			t.Fatal("child did not reach the chip save")
		}
		go func() { done <- cmd.Wait() }()
		select {
		case err := <-done:
			finished = true
			if err != nil {
				t.Fatal(err)
			}
		case <-time.After(250 * time.Millisecond):
			// The shared file lock keeps the save waiting until removal ends.
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	if !finished {
		if err := <-done; err != nil {
			t.Fatalf("chip save did not finish after clearing: %v", err)
		}
	}
	got, ok := LoadRescueMarker(home, time.Now())
	if !ok || got.ChipMAC != chip || got.ChipNotRead || !got.WriteStartedAt.Equal(flagged.WriteStartedAt) {
		t.Fatalf("the concurrent chip marker was removed: %+v ok=%v", got, ok)
	}
}

func TestRescueMarkerIgnoresStaleAndBrokenFiles(t *testing.T) {
	home := t.TempDir()
	testenv.Home(t, home)
	now := time.Now()
	if err := SaveRescueMarker(home, RescueMarker{Port: "COM4", TargetFirmware: "1.0.9", ImagePath: "/x", WriteStartedAt: now.Add(-RescueMarkerMaxAge - time.Minute)}); err != nil {
		t.Fatal(err)
	}
	if _, ok := LoadRescueMarker(home, now); ok {
		t.Fatal("a marker older than RescueMarkerMaxAge must not authorize a flash")
	}
	if err := SaveRescueMarker(home, RescueMarker{TargetFirmware: "1.0.9", ImagePath: "/x", WriteStartedAt: now}); err != nil {
		t.Fatal(err)
	}
	if _, ok := LoadRescueMarker(home, now); ok {
		t.Fatal("a marker without a port must not authorize a flash")
	}
	if err := os.WriteFile(RescueMarkerPath(home), []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, ok := LoadRescueMarker(home, now); ok {
		t.Fatal("a broken marker must not authorize a flash")
	}
}

func TestRescueMarkerFailedSaveLeavesThePreviousMarkerIntact(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("directory permissions do not block file creation on Windows")
	}
	home := t.TempDir()
	testenv.Home(t, home)
	now := time.Now()
	first := RescueMarker{Port: "COM4", TargetFirmware: "1.0.9", ImagePath: "/x/fw.bin", ImageSHA256: "abc", WriteStartedAt: now}
	if err := SaveRescueMarker(home, first); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Dir(RescueMarkerPath(home))
	if err := os.Chmod(dir, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o755) })
	if err := SaveRescueMarker(home, RescueMarker{Port: "COM9", TargetFirmware: "2.0.0", ImagePath: "/y", WriteStartedAt: now}); err == nil {
		t.Skip("directory is still writable (running as root?)")
	}
	got, ok := LoadRescueMarker(home, now)
	if !ok || got.Port != "COM4" || got.TargetFirmware != "1.0.9" {
		t.Fatalf("a failed save must keep the previous marker: %+v ok=%v", got, ok)
	}
}

// ChipDeviceID must give the deviceId the firmware reports (ESP.getChipId), the
// same as esptool's chip_id: (MAC0 >> 24) | ((MAC1 & 0xFFFFFF) << 8).
func TestChipDeviceIDMatchesTheFirmwaresChipID(t *testing.T) {
	// MAC1 0x0000f729, MAC0 0xda123456 -> 0xda | 0xf729<<8 = 0xf729da = 16198106,
	// the deviceId of the Mac bench VibeTV.
	if got, ok := ChipDeviceID("0000f729da123456"); !ok || got != "16198106" {
		t.Fatalf("ChipDeviceID = %q, %v; want 16198106", got, ok)
	}
	for _, bad := range []string{"", "f729da", "zzzzzzzzzzzzzzzz"} {
		if _, ok := ChipDeviceID(bad); ok {
			t.Fatalf("ChipDeviceID(%q) must not be ok", bad)
		}
	}
}
