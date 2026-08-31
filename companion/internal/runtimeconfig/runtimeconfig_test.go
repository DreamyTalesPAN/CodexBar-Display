package runtimeconfig

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestConnectionModeNormalizationKeepsOnlyCustomerChoices(t *testing.T) {
	for input, want := range map[string]string{
		" Cable ": "cable",
		"WIFI":    "wifi",
		"":        "",
		"serial":  "",
		"auto":    "",
	} {
		if got := NormalizeConnectionMode(input); got != want {
			t.Fatalf("NormalizeConnectionMode(%q)=%q, expected %q", input, got, want)
		}
	}

	cfg := Config{ConnectionMode: " CABLE "}
	cfg.Normalize()
	if cfg.ConnectionMode != "cable" {
		t.Fatalf("unexpected normalized config mode %q", cfg.ConnectionMode)
	}
}

func TestActiveTransportFollowsRuntimeDeviceSelection(t *testing.T) {
	tests := []struct {
		cfg  Config
		want string
	}{
		{cfg: Config{}, want: "usb"},
		{cfg: Config{ConnectionMode: "cable", DeviceTarget: "http://192.0.2.10"}, want: "usb"},
		{cfg: Config{ConnectionMode: "wifi"}, want: "wifi"},
		{cfg: Config{DeviceTarget: "http://192.0.2.10"}, want: "wifi"},
	}
	for _, tt := range tests {
		if got := ActiveTransport(tt.cfg); got != tt.want {
			t.Fatalf("ActiveTransport(%+v)=%q, expected %q", tt.cfg, got, tt.want)
		}
	}
}

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

func TestPermissionMigrationCacheRunsSuccessfulMigrationOnceAcrossConcurrentLoads(t *testing.T) {
	var calls atomic.Int32
	started := make(chan struct{})
	release := make(chan struct{})
	cache := permissionMigrationCache{
		migrate: func(_, _, _ string) error {
			if calls.Add(1) == 1 {
				close(started)
				<-release
			}
			return nil
		},
	}

	const workers = 24
	errorsByWorker := make(chan error, workers)
	var workersReady sync.WaitGroup
	workersReady.Add(workers)
	for i := 0; i < workers; i++ {
		go func() {
			workersReady.Done()
			errorsByWorker <- cache.ensure("/tmp/home", "/tmp/config-home/config.json", "/tmp/config-home")
		}()
	}
	workersReady.Wait()
	<-started
	close(release)
	for i := 0; i < workers; i++ {
		if err := <-errorsByWorker; err != nil {
			t.Fatalf("concurrent migration failed: %v", err)
		}
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("successful migration calls=%d want=1", got)
	}
	if err := cache.ensure("/tmp/home", "/tmp/config-home/config.json", "/tmp/config-home"); err != nil {
		t.Fatal(err)
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("cached migration calls=%d want=1", got)
	}
}

func TestPermissionMigrationCacheRetriesAfterFailure(t *testing.T) {
	var calls atomic.Int32
	wantErr := errors.New("chmod failed")
	cache := permissionMigrationCache{
		migrate: func(_, _, _ string) error {
			if calls.Add(1) == 1 {
				return wantErr
			}
			return nil
		},
	}

	if err := cache.ensure("/tmp/home", "/tmp/retry-config-home/config.json", "/tmp/retry-config-home"); !errors.Is(err, wantErr) {
		t.Fatalf("first migration error=%v want=%v", err, wantErr)
	}
	if err := cache.ensure("/tmp/home", "/tmp/retry-config-home/config.json", "/tmp/retry-config-home"); err != nil {
		t.Fatalf("retry migration failed: %v", err)
	}
	if err := cache.ensure("/tmp/home", "/tmp/retry-config-home/config.json", "/tmp/retry-config-home"); err != nil {
		t.Fatalf("cached migration failed: %v", err)
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("migration calls=%d want=2", got)
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
		DeviceID:              "device-a",
		DeviceTarget:          "192.168.1.20",
		DeviceToken:           "token-a",
		CableAutoBindDisabled: true,
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
	if cfg.CableAutoBindDisabled {
		t.Fatal("selecting a device must re-enable Cable binding")
	}
	if cfg.ConnectionModeChoiceRequired {
		t.Fatal("selecting a device must record the explicit connection choice")
	}
}

func TestProviderDisplayNormalizeAndSetupMigration(t *testing.T) {
	cfg := Config{ProviderDisplay: &ProviderDisplayConfig{
		Mode:        " Automatic ",
		ProviderIDs: []string{" Codex ", "codex", " CLAUDE ", ""},
	}}
	cfg.Normalize()

	if cfg.ProviderDisplay.Mode != "automatic" || !reflect.DeepEqual(cfg.ProviderDisplay.ProviderIDs, []string{"codex", "claude"}) {
		t.Fatalf("unexpected provider display normalization: %+v", cfg.ProviderDisplay)
	}
	if cfg.ProviderSelectionSetupIsComplete() {
		t.Fatal("new configuration must require provider setup")
	}

	cfg.SetActiveDevice(KnownDevice{DeviceID: "device-a", Target: "192.168.1.20"})
	if cfg.ProviderSelectionSetupIsComplete() {
		t.Fatal("first device selection must keep provider setup open")
	}
	cfg.SetProviderSelectionSetupComplete(true)
	if !cfg.ProviderSelectionSetupIsComplete() {
		t.Fatal("explicit completion was not preserved")
	}

	legacy := Config{DeviceID: "existing-device"}
	if !legacy.ProviderSelectionSetupIsComplete() {
		t.Fatal("legacy connected installation should remain complete")
	}
}

func TestResetDeviceBindingPreservesAuthenticationProfiles(t *testing.T) {
	cfg := Config{
		DeviceID:         "device-a",
		DeviceTarget:     "192.168.1.20",
		DeviceToken:      "token-a",
		DeviceTransports: []string{"usb"},
		KnownDevices:     []KnownDevice{{DeviceID: "device-b", Target: "192.168.2.30", DeviceToken: "token-b"}},
	}
	cfg.ResetDeviceBinding()

	if cfg.DeviceID != "" || cfg.DeviceTarget != "" || cfg.DeviceToken != "" {
		t.Fatalf("expected the active device binding to be reset, got %+v", cfg)
	}
	if len(cfg.KnownDevices) != 2 {
		t.Fatalf("expected both authentication profiles to remain, got %+v", cfg.KnownDevices)
	}
	if active, ok := cfg.KnownDevice("device-a"); !ok || active.DeviceToken != "token-a" {
		t.Fatalf("active authentication profile was lost: %+v", cfg.KnownDevices)
	}
	if other, ok := cfg.KnownDevice("device-b"); !ok || other.DeviceToken != "token-b" {
		t.Fatalf("known authentication profile was lost: %+v", cfg.KnownDevices)
	}
	if !cfg.CableAutoBindDisabled {
		t.Fatal("device reset must prevent automatic Cable rebinding")
	}
	if !cfg.ConnectionModeChoiceRequired {
		t.Fatal("device reset must require a new connection choice")
	}
	if len(cfg.DeviceTransports) != 0 {
		t.Fatalf("device reset retained transport support without its device identity: %+v", cfg.DeviceTransports)
	}
}

func TestResetDeviceBindingClearsFailedWiFiTransitionTarget(t *testing.T) {
	cfg := Config{
		DeviceID:              "device-a",
		DeviceTarget:          "192.168.1.20",
		DeviceToken:           "token-a",
		CableAutoBindDisabled: true,
	}
	cfg.Normalize()
	cfg.ResetDeviceBinding()

	known, ok := cfg.KnownDevice("device-a")
	if !ok || known.Target != "" || known.DeviceToken != "token-a" {
		t.Fatalf("failed WiFi transition retained stale target or lost authentication: %+v", cfg.KnownDevices)
	}
}

func TestWithConfigLockSerializesReadModifyWrite(t *testing.T) {
	home := t.TempDir()
	if err := Save(home, Config{Theme: "mini"}); err != nil {
		t.Fatal(err)
	}
	firstLoaded := make(chan struct{})
	releaseFirst := make(chan struct{})
	firstDone := make(chan error, 1)
	go func() {
		firstDone <- WithConfigLock(home, func() error {
			cfg, err := Load(home)
			if err != nil {
				return err
			}
			close(firstLoaded)
			<-releaseFirst
			cfg.DeviceID = "worker-device"
			return Save(home, cfg)
		})
	}()
	<-firstLoaded
	resetDone := make(chan error, 1)
	go func() {
		resetDone <- WithConfigLock(home, func() error {
			cfg, err := Load(home)
			if err != nil {
				return err
			}
			cfg.ResetDeviceBinding()
			return Save(home, cfg)
		})
	}()
	select {
	case err := <-resetDone:
		t.Fatalf("reset bypassed active config transaction: %v", err)
	case <-time.After(20 * time.Millisecond):
	}
	close(releaseFirst)
	if err := <-firstDone; err != nil {
		t.Fatal(err)
	}
	if err := <-resetDone; err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(home)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DeviceID != "" || !cfg.CableAutoBindDisabled || !cfg.ConnectionModeChoiceRequired {
		t.Fatalf("serialized reset was overwritten by stale worker state: %+v", cfg)
	}
}

func TestWiFiTransitionPendingDistinguishesResetAndLegacyWiFi(t *testing.T) {
	pending := Config{
		DeviceID:              "device-a",
		DeviceTarget:          "http://192.168.178.72",
		CableAutoBindDisabled: true,
	}
	if !pending.WiFiTransitionPending() {
		t.Fatal("expected transitional Cable-to-WiFi config")
	}
	pending.ConnectionModeChoiceRequired = true
	if pending.WiFiTransitionPending() {
		t.Fatal("explicit setup reset must not be a pending WiFi transition")
	}
	pending = Config{DeviceID: "legacy", DeviceTarget: "http://192.168.178.72"}
	if pending.WiFiTransitionPending() {
		t.Fatal("legacy WiFi config must not be a pending transition")
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

// A VibeTV paired before device ids were recorded leaves a target and a token
// and no id. Reading that as "never set up" sent a customer who had been using
// VibeTV for months back through onboarding on the update that added the flag.
func TestLegacyPairedTargetWithoutDeviceIDStaysSetUp(t *testing.T) {
	legacy := Config{
		DeviceTarget: "http://192.168.178.73",
		DeviceToken:  "token",
	}
	if !legacy.ProviderSelectionSetupIsComplete() {
		t.Fatal("a paired legacy install was treated as never set up")
	}

	// Pinning it to a stable identity must not write the loss into the config.
	pinned := legacy
	pinned.SetActiveDevice(KnownDevice{
		DeviceID:    "9517433",
		Target:      "http://192.168.178.73",
		DeviceToken: "token",
	})
	if pinned.ProviderSelectionSetupComplete != nil &&
		!*pinned.ProviderSelectionSetupComplete {
		t.Fatal("pinning a legacy install persisted an incomplete setup")
	}
	if !pinned.ProviderSelectionSetupIsComplete() {
		t.Fatal("a pinned legacy install was treated as never set up")
	}
}

// A config with nothing paired is a new customer, and they do belong in setup.
func TestFreshConfigStillRequiresSetup(t *testing.T) {
	fresh := Config{}
	if fresh.ProviderSelectionSetupIsComplete() {
		t.Fatal("a fresh config skipped setup")
	}

	fresh.SetActiveDevice(KnownDevice{DeviceID: "9517433", Target: "http://x"})
	if fresh.ProviderSelectionSetupComplete == nil ||
		*fresh.ProviderSelectionSetupComplete {
		t.Fatal("a new install must be stamped as not yet complete")
	}
}

// Discovery writes a target before pairing has produced a token or an id, so a
// setup abandoned after the search leaves exactly the shape a legacy install
// leaves minus its token. Counting it as finished carried the customer past the
// provider and display steps on the next launch -- or, with no provider able to
// render usage, held them on the device step, because nothing was left that
// could ask for a provider.
func TestADiscoveredTargetWithoutPairingIsNotASetUpInstall(t *testing.T) {
	discovered := Config{DeviceTarget: "http://192.168.178.73"}
	if discovered.ProviderSelectionSetupIsComplete() {
		t.Fatal("an abandoned discovery was treated as a finished setup")
	}
	if discovered.ProviderDisplayPredatesSetup() {
		t.Fatal("an abandoned discovery was excused the display choice")
	}

	// And pinning it records that it is not finished, rather than preserving
	// an inference that was never true.
	pinned := discovered
	pinned.SetActiveDevice(KnownDevice{
		DeviceID:    "9517433",
		Target:      "http://192.168.178.73",
		DeviceToken: "token",
	})
	if pinned.ProviderSelectionSetupIsComplete() {
		t.Fatal("pinning an unpaired discovery marked setup complete")
	}
}
