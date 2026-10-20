package firmwareupdate

import (
	"os"
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

func TestRescueMarkerIgnoresStaleAndBrokenFiles(t *testing.T) {
	home := t.TempDir()
	testenv.Home(t, home)
	now := time.Now()
	if err := SaveRescueMarker(home, RescueMarker{Port: "COM4", TargetFirmware: "1.0.9", ImagePath: "/x", WriteStartedAt: now.Add(-RescueMarkerMaxAge - time.Minute)}); err != nil {
		t.Fatal(err)
	}
	if _, ok := LoadRescueMarker(home, now); ok {
		t.Fatal("a marker older than a day must not authorize a flash")
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
