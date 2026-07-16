package runtimeconfig

import (
	"os"
	"path/filepath"
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
