package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

func TestReleaseStateRoundTrip(t *testing.T) {
	home := t.TempDir()
	state := releaseState{
		SchemaVersion: releaseStateSchemaVersion,
		LastKnownGood: lastKnownGoodState{
			CompanionBinary:  "/tmp/codexbar-display-lkg",
			CompanionVersion: "1.0.0",
			FirmwareImage:    "/tmp/firmware.bin",
			FirmwareManifest: "/tmp/firmware.bin.manifest",
			FirmwareEnv:      "esp8266_smalltv_st7789",
		},
	}

	if err := saveReleaseState(home, state); err != nil {
		t.Fatalf("save release state: %v", err)
	}

	loaded, err := loadReleaseState(home)
	if err != nil {
		t.Fatalf("load release state: %v", err)
	}
	if loaded.SchemaVersion != releaseStateSchemaVersion {
		t.Fatalf("unexpected schema version %d", loaded.SchemaVersion)
	}
	if loaded.LastKnownGood.CompanionVersion != "1.0.0" {
		t.Fatalf("unexpected companion version %q", loaded.LastKnownGood.CompanionVersion)
	}
	if loaded.LastKnownGood.FirmwareEnv != "esp8266_smalltv_st7789" {
		t.Fatalf("unexpected firmware env %q", loaded.LastKnownGood.FirmwareEnv)
	}
}

func TestSnapshotInstalledCompanionBinaryMissingInstall(t *testing.T) {
	home := t.TempDir()
	path, version, err := snapshotInstalledCompanionBinary(home)
	if err != nil {
		t.Fatalf("snapshot companion binary: %v", err)
	}
	if path != "" || version != "" {
		t.Fatalf("expected empty snapshot for missing install, got path=%q version=%q", path, version)
	}
}

func TestCopyRegularFileAtomic(t *testing.T) {
	tmp := t.TempDir()
	source := filepath.Join(tmp, "source.txt")
	target := filepath.Join(tmp, "nested", "target.txt")

	if err := os.WriteFile(source, []byte("hello\n"), 0o644); err != nil {
		t.Fatalf("write source: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		t.Fatalf("mkdir target dir: %v", err)
	}

	if err := copyRegularFileAtomic(source, target, 0o644); err != nil {
		t.Fatalf("copy file: %v", err)
	}

	data, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read target: %v", err)
	}
	if string(data) != "hello\n" {
		t.Fatalf("unexpected target content %q", string(data))
	}
}

func TestSanitizePathToken(t *testing.T) {
	if got := sanitizePathToken("v1.0.0+meta/alpha"); got != "v1.0.0_meta_alpha" {
		t.Fatalf("unexpected sanitized token %q", got)
	}
}

func TestRefreshLastKnownGoodFirmwareUpdatesPrepopulatedState(t *testing.T) {
	scratch := t.TempDir()
	home := filepath.Join(scratch, "home")
	if err := os.MkdirAll(home, 0o755); err != nil {
		t.Fatalf("mkdir home: %v", err)
	}
	t.Setenv("HOME", home)

	oldWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	if err := os.Chdir(scratch); err != nil {
		t.Fatalf("chdir scratch: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(oldWD)
	})

	backupDir := filepath.Join(scratch, "backups")
	if err := os.MkdirAll(backupDir, 0o755); err != nil {
		t.Fatalf("mkdir backup dir: %v", err)
	}

	olderImage := filepath.Join(backupDir, "weather_backup_old.bin")
	newerImage := filepath.Join(backupDir, "weather_backup_new.bin")
	for _, image := range []string{olderImage, newerImage} {
		if err := os.WriteFile(image, []byte("firmware"), 0o644); err != nil {
			t.Fatalf("write image %s: %v", image, err)
		}
		if err := os.WriteFile(image+".manifest", []byte("{}"), 0o644); err != nil {
			t.Fatalf("write manifest for %s: %v", image, err)
		}
	}

	now := time.Now()
	if err := os.Chtimes(olderImage, now.Add(-2*time.Hour), now.Add(-2*time.Hour)); err != nil {
		t.Fatalf("set older mtime: %v", err)
	}
	if err := os.Chtimes(newerImage, now.Add(-1*time.Hour), now.Add(-1*time.Hour)); err != nil {
		t.Fatalf("set newer mtime: %v", err)
	}

	state := releaseState{
		LastKnownGood: lastKnownGoodState{
			FirmwareImage:    filepath.Join(scratch, "stale.bin"),
			FirmwareManifest: filepath.Join(scratch, "stale.bin.manifest"),
		},
	}

	refreshLastKnownGoodFirmware(&state, []string{backupDir})

	if state.LastKnownGood.FirmwareImage != newerImage {
		t.Fatalf("expected refreshed image %q, got %q", newerImage, state.LastKnownGood.FirmwareImage)
	}
	if state.LastKnownGood.FirmwareManifest != newerImage+".manifest" {
		t.Fatalf(
			"expected refreshed manifest %q, got %q",
			newerImage+".manifest",
			state.LastKnownGood.FirmwareManifest,
		)
	}
}

func TestRefreshLastKnownGoodFirmwareKeepsStateWhenNoValidBackupFound(t *testing.T) {
	scratch := t.TempDir()
	home := filepath.Join(scratch, "home")
	if err := os.MkdirAll(home, 0o755); err != nil {
		t.Fatalf("mkdir home: %v", err)
	}
	t.Setenv("HOME", home)

	oldWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	if err := os.Chdir(scratch); err != nil {
		t.Fatalf("chdir scratch: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(oldWD)
	})

	backupDir := filepath.Join(scratch, "backups")
	if err := os.MkdirAll(backupDir, 0o755); err != nil {
		t.Fatalf("mkdir backup dir: %v", err)
	}
	invalidImage := filepath.Join(backupDir, "weather_backup_invalid.bin")
	if err := os.WriteFile(invalidImage, []byte("firmware"), 0o644); err != nil {
		t.Fatalf("write invalid image: %v", err)
	}

	const (
		existingImage    = "/tmp/existing.bin"
		existingManifest = "/tmp/existing.bin.manifest"
	)
	state := releaseState{
		LastKnownGood: lastKnownGoodState{
			FirmwareImage:    existingImage,
			FirmwareManifest: existingManifest,
		},
	}

	refreshLastKnownGoodFirmware(&state, []string{backupDir})

	if state.LastKnownGood.FirmwareImage != existingImage {
		t.Fatalf("expected image to stay %q, got %q", existingImage, state.LastKnownGood.FirmwareImage)
	}
	if state.LastKnownGood.FirmwareManifest != existingManifest {
		t.Fatalf("expected manifest to stay %q, got %q", existingManifest, state.LastKnownGood.FirmwareManifest)
	}
}

func TestResolveRollbackFirmwareInputsUsesStateImageAndManifest(t *testing.T) {
	tmp := t.TempDir()
	imagePath := filepath.Join(tmp, "known-good.bin")
	manifestPath := imagePath + ".manifest"
	if err := os.WriteFile(imagePath, []byte("firmware"), 0o644); err != nil {
		t.Fatalf("write image: %v", err)
	}
	if err := os.WriteFile(manifestPath, []byte("{}"), 0o644); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	state := releaseState{
		LastKnownGood: lastKnownGoodState{
			FirmwareImage:    imagePath,
			FirmwareManifest: manifestPath,
		},
	}

	gotImage, gotManifest, stale := resolveRollbackFirmwareInputs("", "", state)
	if stale {
		t.Fatal("expected stale=false for existing state image")
	}
	if gotImage != imagePath {
		t.Fatalf("unexpected image %q", gotImage)
	}
	if gotManifest != manifestPath {
		t.Fatalf("unexpected manifest %q", gotManifest)
	}
}

func TestResolveRollbackFirmwareInputsFallbackWhenStateImageMissing(t *testing.T) {
	tmp := t.TempDir()
	staleImage := filepath.Join(tmp, "missing.bin")
	staleManifest := staleImage + ".manifest"

	state := releaseState{
		LastKnownGood: lastKnownGoodState{
			FirmwareImage:    staleImage,
			FirmwareManifest: staleManifest,
		},
	}

	gotImage, gotManifest, stale := resolveRollbackFirmwareInputs("", "", state)
	if !stale {
		t.Fatal("expected stale=true for missing state image")
	}
	if gotImage != "" {
		t.Fatalf("expected empty image for fallback, got %q", gotImage)
	}
	if gotManifest != "" {
		t.Fatalf("expected empty manifest for fallback, got %q", gotManifest)
	}
}

func TestResolveRollbackFirmwareInputsKeepsExplicitImageAndManifest(t *testing.T) {
	state := releaseState{
		LastKnownGood: lastKnownGoodState{
			FirmwareImage:    "/tmp/state-image.bin",
			FirmwareManifest: "/tmp/state-image.bin.manifest",
		},
	}

	gotImage, gotManifest, stale := resolveRollbackFirmwareInputs(" /tmp/requested.bin ", " /tmp/requested.manifest ", state)
	if stale {
		t.Fatal("expected stale=false for explicit image input")
	}
	if gotImage != "/tmp/requested.bin" {
		t.Fatalf("unexpected explicit image %q", gotImage)
	}
	if gotManifest != "/tmp/requested.manifest" {
		t.Fatalf("unexpected explicit manifest %q", gotManifest)
	}
}

func TestSelectReleaseFirmwareArtifact(t *testing.T) {
	manifest := releaseFirmwareManifest{
		Artifacts: []releaseFirmwareArtifact{
			{
				FirmwareEnv:     "lilygo_t_display_s3",
				FirmwareVersion: "1.0.3",
				Asset:           "lilygo.bin",
				SHA256:          strings.Repeat("a", 64),
			},
			{
				FirmwareEnv:     "esp8266_smalltv_st7789",
				FirmwareVersion: "1.0.3",
				Asset:           "mini.bin",
				SHA256:          strings.Repeat("b", 64),
			},
		},
	}

	artifact, err := selectReleaseFirmwareArtifact(manifest, "esp8266_smalltv_st7789", "v1.0.3")
	if err != nil {
		t.Fatalf("select artifact: %v", err)
	}
	if artifact.Asset != "mini.bin" {
		t.Fatalf("unexpected asset %q", artifact.Asset)
	}
}

func TestDownloadReleaseFirmwareVerifiesManifestAndChecksum(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
	})

	home := t.TempDir()
	imageBody := "firmware image"
	imageSHA := sha256String(imageBody)
	manifestBody := `{
  "schemaVersion": 1,
  "release": "v1.0.3",
  "protocolVersion": 1,
  "artifacts": [
    {
      "firmwareEnv": "esp8266_smalltv_st7789",
      "board": "esp8266-smalltv-st7789",
      "firmwareVersion": "1.0.3",
      "asset": "codexbar-display-firmware-esp8266_smalltv_st7789-v1.0.3.bin",
      "sha256": "` + imageSHA + `"
    }
  ]
}`

	releaseHTTPClient = fakeReleaseHTTPClient{
		responses: map[string]string{
			"https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.0.3/firmware-manifest-v1.0.3.json":                               manifestBody,
			"https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.0.3/codexbar-display-firmware-esp8266_smalltv_st7789-v1.0.3.bin": imageBody,
		},
	}

	imagePath, manifestPath, artifact, err := downloadReleaseFirmware(
		context.Background(),
		home,
		"DreamyTalesPAN/CodexBar-Display",
		"v1.0.3",
		"1.0.3",
		"esp8266_smalltv_st7789",
	)
	if err != nil {
		t.Fatalf("download release firmware: %v", err)
	}
	if artifact.Asset != "codexbar-display-firmware-esp8266_smalltv_st7789-v1.0.3.bin" {
		t.Fatalf("unexpected artifact asset %q", artifact.Asset)
	}
	if data, err := os.ReadFile(imagePath); err != nil || string(data) != imageBody {
		t.Fatalf("unexpected image data data=%q err=%v", string(data), err)
	}
	if data, err := os.ReadFile(manifestPath); err != nil || !strings.Contains(string(data), `"release": "v1.0.3"`) {
		t.Fatalf("unexpected manifest data data=%q err=%v", string(data), err)
	}
}

func TestRunUpgradeDownloadsAndFlashesReleaseFirmware(t *testing.T) {
	previousResolve := resolveSerialPortFn
	previousEnsureBusy := ensureSerialPortNotBusyFn
	previousStop := upgradeStopLaunchAgentFn
	previousRestart := upgradeRestartLaunchAgentFn
	previousLoadState := loadReleaseStateFn
	previousSaveState := saveReleaseStateFn
	previousSnapshot := snapshotInstalledCompanionBinaryFn
	previousReadHello := readDeviceHelloFn
	previousCloseDefaultSender := closeDefaultSenderFn
	previousHTTPClient := releaseHTTPClient
	previousFlash := flashReleaseFirmwareImageFn
	t.Cleanup(func() {
		resolveSerialPortFn = previousResolve
		ensureSerialPortNotBusyFn = previousEnsureBusy
		upgradeStopLaunchAgentFn = previousStop
		upgradeRestartLaunchAgentFn = previousRestart
		loadReleaseStateFn = previousLoadState
		saveReleaseStateFn = previousSaveState
		snapshotInstalledCompanionBinaryFn = previousSnapshot
		readDeviceHelloFn = previousReadHello
		closeDefaultSenderFn = previousCloseDefaultSender
		releaseHTTPClient = previousHTTPClient
		flashReleaseFirmwareImageFn = previousFlash
	})

	home := t.TempDir()
	t.Setenv("HOME", home)
	imageBody := "firmware image"
	imageSHA := sha256String(imageBody)
	manifestBody := `{
  "schemaVersion": 1,
  "release": "v1.0.3",
  "protocolVersion": 1,
  "artifacts": [
    {
      "firmwareEnv": "esp8266_smalltv_st7789",
      "board": "esp8266-smalltv-st7789",
      "firmwareVersion": "1.0.3",
      "asset": "codexbar-display-firmware-esp8266_smalltv_st7789-v1.0.3.bin",
      "sha256": "` + imageSHA + `"
    }
  ]
}`

	releaseHTTPClient = fakeReleaseHTTPClient{
		responses: map[string]string{
			"https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.0.3/firmware-manifest-v1.0.3.json":                               manifestBody,
			"https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.0.3/codexbar-display-firmware-esp8266_smalltv_st7789-v1.0.3.bin": imageBody,
		},
	}
	resolveSerialPortFn = func(port string) (string, error) {
		return strings.TrimSpace(port), nil
	}
	ensureSerialPortNotBusyFn = func(string) error { return nil }
	upgradeStopLaunchAgentFn = func() {}
	upgradeRestartLaunchAgentFn = func(string) error { return nil }
	loadReleaseStateFn = func(string) (releaseState, error) { return releaseState{}, nil }
	saveCalls := 0
	saveReleaseStateFn = func(string, releaseState) error {
		saveCalls++
		return nil
	}
	snapshotInstalledCompanionBinaryFn = func(string) (string, string, error) {
		return "", "", nil
	}
	readDeviceHelloFn = func(string) (protocol.DeviceHello, error) {
		return protocol.DeviceHello{}, errors.New("no hello")
	}
	closeCalls := 0
	closeDefaultSenderFn = func() {
		closeCalls++
	}
	flashed := false
	flashReleaseFirmwareImageFn = func(_ context.Context, port string, artifact releaseFirmwareArtifact, imagePath string) error {
		flashed = true
		if port != "/dev/cu.usbserial-110" {
			t.Fatalf("unexpected port %q", port)
		}
		if artifact.FirmwareEnv != "esp8266_smalltv_st7789" {
			t.Fatalf("unexpected firmware env %q", artifact.FirmwareEnv)
		}
		if data, err := os.ReadFile(imagePath); err != nil || string(data) != imageBody {
			t.Fatalf("unexpected flashed image data=%q err=%v", string(data), err)
		}
		return nil
	}

	err := runUpgrade([]string{
		"--port", "/dev/cu.usbserial-110",
		"--target-firmware-version", "1.0.3",
		"--skip-version-guard",
	})
	if err != nil {
		t.Fatalf("runUpgrade failed: %v", err)
	}
	if !flashed {
		t.Fatal("expected flash function to be called")
	}
	if closeCalls != 2 {
		t.Fatalf("expected sender close after pre/post hello reads, got %d", closeCalls)
	}
	if saveCalls != 2 {
		t.Fatalf("expected release state save twice, got %d", saveCalls)
	}
}

func TestBeginUpgradeLaunchAgentRecoveryRestartsOnErrorPath(t *testing.T) {
	previousStop := upgradeStopLaunchAgentFn
	previousRestart := upgradeRestartLaunchAgentFn
	t.Cleanup(func() {
		upgradeStopLaunchAgentFn = previousStop
		upgradeRestartLaunchAgentFn = previousRestart
	})

	stopCalls := 0
	restartCalls := 0
	upgradeStopLaunchAgentFn = func() {
		stopCalls++
	}
	upgradeRestartLaunchAgentFn = func(home string) error {
		restartCalls++
		if home != "/tmp/home" {
			t.Fatalf("unexpected home path %q", home)
		}
		return nil
	}

	runErr := &commandError{
		Op:   "flash-and-install",
		Code: errcode.UpgradeFlashFirmware,
		Err:  errors.New("flash failed"),
		Hint: "retry flash",
	}
	var retErr error = runErr
	cleanup := beginUpgradeLaunchAgentRecovery("/tmp/home", &retErr)
	if stopCalls != 1 {
		t.Fatalf("expected launch agent stop once, got %d", stopCalls)
	}

	cleanup()

	if restartCalls != 1 {
		t.Fatalf("expected launch agent restart once, got %d", restartCalls)
	}
	if errcode.Of(retErr) != errcode.UpgradeFlashFirmware {
		t.Fatalf("expected flash firmware error code, got %s", errcode.Of(retErr))
	}
}

func TestWrapUpgradeLaunchAgentRecoveryErrorReturnsRecoveryErrorOnRestartFailure(t *testing.T) {
	previousRestart := upgradeRestartLaunchAgentFn
	t.Cleanup(func() {
		upgradeRestartLaunchAgentFn = previousRestart
	})
	upgradeRestartLaunchAgentFn = func(home string) error {
		if home != "/tmp/home" {
			t.Fatalf("unexpected home path %q", home)
		}
		return errors.New("kickstart failed")
	}

	err := wrapUpgradeLaunchAgentRecoveryError(nil, "/tmp/home")
	if errcode.Of(err) != errcode.UpgradeLaunchAgent {
		t.Fatalf("expected launch agent recovery code, got %s", errcode.Of(err))
	}
	if recovery := errcode.Recovery(err); !strings.Contains(recovery, "launchctl") {
		t.Fatalf("expected recovery hint to mention launchctl, got %q", recovery)
	}
}

func TestWrapUpgradeLaunchAgentRecoveryErrorAppendsHint(t *testing.T) {
	previousRestart := upgradeRestartLaunchAgentFn
	t.Cleanup(func() {
		upgradeRestartLaunchAgentFn = previousRestart
	})
	upgradeRestartLaunchAgentFn = func(string) error {
		return errors.New("bootstrap failed")
	}

	original := &commandError{
		Op:   "flash-and-install",
		Code: errcode.UpgradeFlashFirmware,
		Err:  errors.New("flash failed"),
		Hint: "retry flash",
	}
	err := wrapUpgradeLaunchAgentRecoveryError(original, "/tmp/home")
	if errcode.Of(err) != errcode.UpgradeFlashFirmware {
		t.Fatalf("expected original error code to be preserved, got %s", errcode.Of(err))
	}
	recovery := errcode.Recovery(err)
	if !strings.Contains(recovery, "retry flash") {
		t.Fatalf("expected original hint in recovery, got %q", recovery)
	}
	if !strings.Contains(recovery, "restart launch agent manually") {
		t.Fatalf("expected launch agent hint in recovery, got %q", recovery)
	}
}

func TestRunRollbackFirmwareOnlyRestartsLaunchAgent(t *testing.T) {
	previousResolve := resolveSerialPortFn
	previousLoadState := loadReleaseStateFn
	previousRunRestore := runRestoreKnownGoodCommandFn
	previousRestart := rollbackRestartLaunchAgentFn
	t.Cleanup(func() {
		resolveSerialPortFn = previousResolve
		loadReleaseStateFn = previousLoadState
		runRestoreKnownGoodCommandFn = previousRunRestore
		rollbackRestartLaunchAgentFn = previousRestart
	})

	t.Setenv("HOME", t.TempDir())

	restoreCalls := 0
	restartCalls := 0
	resolveSerialPortFn = func(port string) (string, error) {
		return strings.TrimSpace(port), nil
	}
	loadReleaseStateFn = func(string) (releaseState, error) {
		return releaseState{
			LastKnownGood: lastKnownGoodState{
				FirmwareImage:    "/tmp/missing.bin",
				FirmwareManifest: "/tmp/missing.bin.manifest",
			},
		}, nil
	}
	runRestoreKnownGoodCommandFn = func(args []string) error {
		restoreCalls++
		if !containsArg(args, "--port", "/dev/cu.usbserial-110") {
			t.Fatalf("expected --port argument in restore call, got %v", args)
		}
		return nil
	}
	rollbackRestartLaunchAgentFn = func(home string) error {
		restartCalls++
		if strings.TrimSpace(home) == "" {
			t.Fatal("expected non-empty home for restart call")
		}
		return nil
	}

	if err := runRollback([]string{"--skip-companion", "--port", "/dev/cu.usbserial-110"}); err != nil {
		t.Fatalf("runRollback failed: %v", err)
	}
	if restoreCalls != 1 {
		t.Fatalf("expected restore invocation once, got %d", restoreCalls)
	}
	if restartCalls != 1 {
		t.Fatalf("expected launchagent restart once, got %d", restartCalls)
	}
}

func TestRunRollbackReturnsLaunchAgentErrorCodeWhenRestartFails(t *testing.T) {
	previousResolve := resolveSerialPortFn
	previousLoadState := loadReleaseStateFn
	previousRunRestore := runRestoreKnownGoodCommandFn
	previousRestart := rollbackRestartLaunchAgentFn
	t.Cleanup(func() {
		resolveSerialPortFn = previousResolve
		loadReleaseStateFn = previousLoadState
		runRestoreKnownGoodCommandFn = previousRunRestore
		rollbackRestartLaunchAgentFn = previousRestart
	})

	t.Setenv("HOME", t.TempDir())

	resolveSerialPortFn = func(port string) (string, error) {
		return strings.TrimSpace(port), nil
	}
	loadReleaseStateFn = func(string) (releaseState, error) {
		return releaseState{}, nil
	}
	runRestoreKnownGoodCommandFn = func([]string) error {
		return nil
	}
	rollbackRestartLaunchAgentFn = func(string) error {
		return errors.New("launchctl kickstart failed")
	}

	err := runRollback([]string{"--skip-companion", "--port", "/dev/cu.usbserial-110"})
	if err == nil {
		t.Fatal("expected rollback restart error")
	}
	if got := errcode.Of(err); got != errcode.RollbackLaunchAgent {
		t.Fatalf("expected rollback launchagent code, got %s", got)
	}
}

func TestRunUpgradePreflightPortBusyReturnsUpgradePortBusyCode(t *testing.T) {
	previousResolve := resolveSerialPortFn
	previousEnsureBusy := ensureSerialPortNotBusyFn
	previousStop := upgradeStopLaunchAgentFn
	previousRestart := upgradeRestartLaunchAgentFn
	t.Cleanup(func() {
		resolveSerialPortFn = previousResolve
		ensureSerialPortNotBusyFn = previousEnsureBusy
		upgradeStopLaunchAgentFn = previousStop
		upgradeRestartLaunchAgentFn = previousRestart
	})

	t.Setenv("HOME", t.TempDir())

	resolveSerialPortFn = func(port string) (string, error) {
		return strings.TrimSpace(port), nil
	}
	ensureSerialPortNotBusyFn = func(string) error {
		return errors.New("serial port busy")
	}
	upgradeStopLaunchAgentFn = func() {}
	upgradeRestartLaunchAgentFn = func(string) error { return nil }

	err := runUpgrade([]string{"--port", "/dev/cu.usbserial-110"})
	if err == nil {
		t.Fatal("expected preflight busy error")
	}
	if got := errcode.Of(err); got != errcode.UpgradePortBusy {
		t.Fatalf("expected upgrade/port-busy code, got %s", got)
	}
}

func TestReleaseWrapperScriptsCallExpectedCommands(t *testing.T) {
	root := repoRoot(t)
	upgradeWrapper := filepath.Join(root, "scripts", "upgrade-with-preflight.sh")
	rollbackWrapper := filepath.Join(root, "scripts", "rollback-last-known-good.sh")

	upgradeData, err := os.ReadFile(upgradeWrapper)
	if err != nil {
		t.Fatalf("read upgrade wrapper: %v", err)
	}
	rollbackData, err := os.ReadFile(rollbackWrapper)
	if err != nil {
		t.Fatalf("read rollback wrapper: %v", err)
	}

	if !strings.Contains(string(upgradeData), " upgrade ") {
		t.Fatalf("expected upgrade wrapper to invoke upgrade command")
	}
	if !strings.Contains(string(rollbackData), " rollback ") {
		t.Fatalf("expected rollback wrapper to invoke rollback command")
	}
}

func containsArg(args []string, flag, value string) bool {
	for i := 0; i < len(args)-1; i++ {
		if args[i] == flag && args[i+1] == value {
			return true
		}
	}
	return false
}

func repoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "companion", "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatalf("repository root not found from %s", dir)
		}
		dir = parent
	}
}

type fakeReleaseHTTPClient struct {
	responses map[string]string
}

func (f fakeReleaseHTTPClient) Do(req *http.Request) (*http.Response, error) {
	body, ok := f.responses[req.URL.String()]
	if !ok {
		return &http.Response{
			StatusCode: http.StatusNotFound,
			Status:     "404 Not Found",
			Body:       io.NopCloser(strings.NewReader("not found")),
			Header:     make(http.Header),
		}, nil
	}
	return &http.Response{
		StatusCode: http.StatusOK,
		Status:     "200 OK",
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     make(http.Header),
	}, nil
}

func sha256String(text string) string {
	sum := sha256.Sum256([]byte(text))
	return hex.EncodeToString(sum[:])
}
