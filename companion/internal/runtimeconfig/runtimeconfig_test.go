package runtimeconfig

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestLoadMigratesActiveDeviceIntoKnownDevices(t *testing.T) {
	home := t.TempDir()
	path := ConfigPath(home)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`{
  "deviceTarget": " 192.168.1.20 ",
  "deviceToken": " saved-token ",
  "deviceId": " device-a "
}`), 0o600); err != nil {
		t.Fatal(err)
	}

	cfg, err := Load(home)
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.KnownDevices) != 1 {
		t.Fatalf("expected one migrated device, got %+v", cfg.KnownDevices)
	}
	device := cfg.KnownDevices[0]
	if device.DeviceID != "device-a" || device.Target != "192.168.1.20" || device.DeviceToken != "saved-token" {
		t.Fatalf("unexpected migrated device: %+v", device)
	}
}

func TestSetActiveDeviceKeepsPreviousDeviceKnown(t *testing.T) {
	cfg := Config{
		DeviceID:     "device-a",
		DeviceTarget: "192.168.1.20",
		DeviceToken:  "token-a",
	}
	cfg.Normalize()
	cfg.SetActiveDevice(KnownDevice{
		DeviceID:    "device-b",
		Target:      "192.168.2.30",
		DeviceToken: "token-b",
	})
	cfg.Normalize()

	if cfg.DeviceID != "device-b" || cfg.DeviceTarget != "192.168.2.30" || cfg.DeviceToken != "token-b" {
		t.Fatalf("unexpected active device: %+v", cfg)
	}
	if len(cfg.KnownDevices) != 2 {
		t.Fatalf("expected two known devices, got %+v", cfg.KnownDevices)
	}
	if previous, ok := cfg.KnownDevice("device-a"); !ok || previous.DeviceToken != "token-a" {
		t.Fatalf("previous device was not preserved: %+v", cfg.KnownDevices)
	}
}

func TestClearDevicesRemovesActiveAndKnownProfiles(t *testing.T) {
	cfg := Config{
		DeviceID:     "device-a",
		DeviceTarget: "192.168.1.20",
		DeviceToken:  "token-a",
		KnownDevices: []KnownDevice{{DeviceID: "device-b", Target: "192.168.2.30", DeviceToken: "token-b"}},
	}
	cfg.ClearDevices()

	if cfg.DeviceID != "" || cfg.DeviceTarget != "" || cfg.DeviceToken != "" || len(cfg.KnownDevices) != 0 {
		t.Fatalf("expected a complete device reset, got %+v", cfg)
	}
}

func TestRecoverPendingDeviceSelectionRestoresLastCommittedConfig(t *testing.T) {
	home := t.TempDir()
	previous := Config{
		Theme:        "mini",
		DeviceID:     "device-a",
		DeviceTarget: "http://192.0.2.1",
		DeviceToken:  "token-a",
	}
	previous.Normalize()
	if err := Save(home, previous); err != nil {
		t.Fatal(err)
	}
	if err := BeginDeviceSelection(home, previous); err != nil {
		t.Fatal(err)
	}
	staged := previous
	staged.SetActiveDevice(KnownDevice{
		DeviceID:    "device-b",
		Target:      "http://192.0.2.2",
		DeviceToken: "token-b",
	})
	if err := Save(home, staged); err != nil {
		t.Fatal(err)
	}

	recovered, err := RecoverPendingDeviceSelection(home)
	if err != nil {
		t.Fatal(err)
	}
	if !recovered {
		t.Fatal("expected pending device selection recovery")
	}
	got, err := Load(home)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, previous) {
		t.Fatalf("unexpected recovered config: got=%+v want=%+v", got, previous)
	}
	if _, err := os.Stat(deviceSelectionJournalPath(home)); !os.IsNotExist(err) {
		t.Fatalf("selection journal still exists after recovery: %v", err)
	}
}

func TestCommittedDeviceSelectionDoesNotRollBack(t *testing.T) {
	home := t.TempDir()
	previous := Config{DeviceID: "device-a", DeviceTarget: "http://192.0.2.1", DeviceToken: "token-a"}
	previous.Normalize()
	if err := BeginDeviceSelection(home, previous); err != nil {
		t.Fatal(err)
	}
	selected := previous
	selected.SetActiveDevice(KnownDevice{DeviceID: "device-b", Target: "http://192.0.2.2", DeviceToken: "token-b"})
	if err := Save(home, selected); err != nil {
		t.Fatal(err)
	}
	if err := CommitDeviceSelection(home); err != nil {
		t.Fatal(err)
	}

	recovered, err := RecoverPendingDeviceSelection(home)
	if err != nil {
		t.Fatal(err)
	}
	if recovered {
		t.Fatal("committed selection must not be recovered")
	}
	got, err := Load(home)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, selected) {
		t.Fatalf("committed config changed: got=%+v want=%+v", got, selected)
	}
}
