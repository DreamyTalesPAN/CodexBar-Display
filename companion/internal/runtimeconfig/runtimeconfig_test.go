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

func TestSaveRestrictsConfigAndDirectoryPermissions(t *testing.T) {
	home := t.TempDir()
	if err := Save(home, Config{DeviceID: "device-a", DeviceToken: "secret-token"}); err != nil {
		t.Fatal(err)
	}

	assertPermissions(t, ConfigPath(home), privateConfigFileMode)
	assertPermissions(t, filepath.Dir(ConfigPath(home)), privateConfigDirMode)
}

func TestLoadMigratesExistingConfigPermissions(t *testing.T) {
	home := t.TempDir()
	path := ConfigPath(home)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`{"deviceToken":"secret-token"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := Load(home); err != nil {
		t.Fatal(err)
	}

	assertPermissions(t, path, privateConfigFileMode)
	assertPermissions(t, filepath.Dir(path), privateConfigDirMode)
}

func TestRestrictPermissionsMigratesJournalAndRecognizedBackups(t *testing.T) {
	home := t.TempDir()
	dir := filepath.Dir(ConfigPath(home))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	paths := []string{
		deviceSelectionJournalPath(home),
		filepath.Join(dir, "config.before-upgrade.json"),
		filepath.Join(dir, "config.backup-20260721.json"),
		filepath.Join(dir, "config.json.backup-old"),
	}
	for _, path := range paths {
		if err := os.WriteFile(path, []byte(`{"deviceToken":"secret-token"}`), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(path, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := RestrictPermissions(home); err != nil {
		t.Fatal(err)
	}
	assertPermissions(t, dir, privateConfigDirMode)
	for _, path := range paths {
		assertPermissions(t, path, privateConfigFileMode)
	}
}

func TestLoadRestrictsPermissionsBeforeReportingInvalidConfig(t *testing.T) {
	home := t.TempDir()
	path := ConfigPath(home)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`{"deviceToken":`), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(home); err == nil {
		t.Fatal("expected invalid config to fail")
	}
	assertPermissions(t, path, privateConfigFileMode)
	assertPermissions(t, filepath.Dir(path), privateConfigDirMode)
}

func assertPermissions(t *testing.T, path string, want os.FileMode) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != want {
		t.Fatalf("unexpected permissions for %s: got=%#o want=%#o", path, got, want)
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
