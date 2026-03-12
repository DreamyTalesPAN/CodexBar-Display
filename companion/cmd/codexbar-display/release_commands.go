package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/buildinfo"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/setup"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/versioning"
)

const (
	releaseStateSchemaVersion = 1
	releaseStateFileName      = "release-state.json"
	protocolVersionV1         = 1
)

var (
	upgradeStopLaunchAgentFn           = stopLaunchAgentBestEffort
	upgradeRestartLaunchAgentFn        = restartLaunchAgent
	rollbackRestartLaunchAgentFn       = restartLaunchAgent
	resolveSerialPortFn                = usb.ResolvePort
	readDeviceHelloFn                  = usb.ReadDeviceHello
	ensureSerialPortNotBusyFn          = ensureSerialPortNotBusy
	setupRunFn                         = setup.Run
	loadReleaseStateFn                 = loadReleaseState
	saveReleaseStateFn                 = saveReleaseState
	snapshotInstalledCompanionBinaryFn = snapshotInstalledCompanionBinary
	runRestoreKnownGoodCommandFn       = runRestoreKnownGood
)

type commandError struct {
	Op   string
	Code errcode.Code
	Err  error
	Hint string
}

func (e *commandError) Error() string {
	if e == nil {
		return ""
	}
	if strings.TrimSpace(e.Op) == "" {
		return e.Err.Error()
	}
	return fmt.Sprintf("%s: %v", e.Op, e.Err)
}

func (e *commandError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

func (e *commandError) ErrorCode() errcode.Code {
	if e == nil {
		return ""
	}
	return e.Code
}

func (e *commandError) RecoveryAction() string {
	if e == nil {
		return ""
	}
	if strings.TrimSpace(e.Hint) != "" {
		return strings.TrimSpace(e.Hint)
	}
	return errcode.DefaultRecovery(e.Code)
}

type releaseState struct {
	SchemaVersion int                 `json:"schemaVersion"`
	UpdatedAtUTC  string              `json:"updatedAtUtc,omitempty"`
	LastKnownGood lastKnownGoodState  `json:"lastKnownGood,omitempty"`
	LastUpgrade   lastUpgradeSnapshot `json:"lastUpgrade,omitempty"`
}

type lastKnownGoodState struct {
	CompanionBinary  string `json:"companionBinary,omitempty"`
	CompanionVersion string `json:"companionVersion,omitempty"`
	FirmwareImage    string `json:"firmwareImage,omitempty"`
	FirmwareManifest string `json:"firmwareManifest,omitempty"`
	FirmwareEnv      string `json:"firmwareEnv,omitempty"`
	CapturedAtUTC    string `json:"capturedAtUtc,omitempty"`
}

type lastUpgradeSnapshot struct {
	CompanionVersion string `json:"companionVersion,omitempty"`
	FirmwareVersion  string `json:"firmwareVersion,omitempty"`
	FirmwareEnv      string `json:"firmwareEnv,omitempty"`
	Port             string `json:"port,omitempty"`
	DeviceBoard      string `json:"deviceBoard,omitempty"`
	UpgradedAtUTC    string `json:"upgradedAtUtc,omitempty"`
}

func runVersion(args []string) error {
	fs := flag.NewFlagSet("version", flag.ContinueOnError)
	short := fs.Bool("short", false, "print version only")
	jsonOut := fs.Bool("json", false, "print detailed JSON")
	if err := fs.Parse(args); err != nil {
		return err
	}

	version := buildinfo.NormalizedVersion()
	if *short {
		fmt.Println(version)
		return nil
	}

	if *jsonOut {
		payload := struct {
			Version       string                         `json:"version"`
			Commit        string                         `json:"commit"`
			Date          string                         `json:"date"`
			Compatibility []versioning.CompatibilityRule `json:"compatibility"`
		}{
			Version:       version,
			Commit:        strings.TrimSpace(buildinfo.Commit),
			Date:          strings.TrimSpace(buildinfo.Date),
			Compatibility: versioning.DefaultCompatibilityMatrix(),
		}
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(payload)
	}

	fmt.Printf("codexbar-display companion %s\n", version)
	if strings.TrimSpace(buildinfo.Commit) != "" {
		fmt.Printf("commit: %s\n", strings.TrimSpace(buildinfo.Commit))
	}
	if strings.TrimSpace(buildinfo.Date) != "" {
		fmt.Printf("date: %s\n", strings.TrimSpace(buildinfo.Date))
	}
	fmt.Println("compatibility:")
	for _, rule := range versioning.DefaultCompatibilityMatrix() {
		fmt.Printf("  - %s: companion %s..%s firmware %s..%s protocol=%d\n",
			rule.Name,
			rule.CompanionMin,
			rule.CompanionMaxExclusive,
			rule.FirmwareMin,
			rule.FirmwareMaxExclusive,
			rule.ProtocolVersion,
		)
	}
	return nil
}

func runUpgrade(args []string) (retErr error) {
	fs := flag.NewFlagSet("upgrade", flag.ContinueOnError)
	port := fs.String("port", "", "serial port (auto-detect when empty)")
	firmwareEnv := fs.String("firmware-env", setup.DefaultFirmwareEnvironment(), "PlatformIO environment to flash")
	targetFirmwareVersion := fs.String("target-firmware-version", "", "target firmware semver for version guard (default from compatibility matrix)")
	skipVersionGuard := fs.Bool("skip-version-guard", false, "skip companion/firmware compatibility guard")
	if err := fs.Parse(args); err != nil {
		return err
	}

	selectedEnv := strings.TrimSpace(*firmwareEnv)
	if selectedEnv == "" {
		selectedEnv = setup.DefaultFirmwareEnvironment()
	}
	resolvedEnv, ok := setup.ResolveFirmwareEnvironment(selectedEnv)
	if !ok {
		return &commandError{
			Op:   "resolve-firmware-env",
			Code: errcode.UpgradeVersionGuard,
			Err: fmt.Errorf(
				"unsupported firmware env %q (supported: esp8266_smalltv_st7789, lilygo_t_display_s3)",
				selectedEnv,
			),
		}
	}
	selectedEnv = resolvedEnv

	resolvedPort, err := resolveSerialPortFn(strings.TrimSpace(*port))
	if err != nil {
		return &commandError{
			Op:   "resolve-port",
			Code: errcode.UpgradeResolvePort,
			Err:  err,
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return &commandError{
			Op:   "resolve-home",
			Code: errcode.UpgradeStateWrite,
			Err:  err,
		}
	}
	cleanupUpgradeLaunchAgent := beginUpgradeLaunchAgentRecovery(home, &retErr)
	defer cleanupUpgradeLaunchAgent()

	if err := ensureSerialPortNotBusyFn(resolvedPort); err != nil {
		return &commandError{
			Op:   "preflight-port-busy",
			Code: errcode.UpgradePortBusy,
			Err:  err,
			Hint: fmt.Sprintf("stop daemons/monitors using %s and retry", resolvedPort),
		}
	}

	targetVersion := strings.TrimSpace(*targetFirmwareVersion)
	if targetVersion == "" {
		mapped, ok := versioning.FirmwareVersionForEnvironment(selectedEnv)
		if !ok {
			return &commandError{
				Op:   "resolve-target-firmware-version",
				Code: errcode.UpgradeVersionGuard,
				Err: fmt.Errorf(
					"no compatibility matrix entry for firmware env %q; pass --target-firmware-version",
					selectedEnv,
				),
			}
		}
		targetVersion = mapped
	}

	companionVersion := buildinfo.NormalizedVersion()
	if !*skipVersionGuard {
		compatible, rule, err := versioning.IsCompatible(companionVersion, targetVersion, protocolVersionV1)
		if err != nil {
			return &commandError{
				Op:   "version-guard-parse",
				Code: errcode.UpgradeVersionGuard,
				Err:  err,
			}
		}
		if !compatible {
			return &commandError{
				Op:   "version-guard",
				Code: errcode.UpgradeVersionGuard,
				Err: fmt.Errorf(
					"companion %s is incompatible with target firmware %s (env=%s)",
					companionVersion,
					targetVersion,
					selectedEnv,
				),
				Hint: "pick a compatible firmware target/version or install matching companion version",
			}
		}
		fmt.Printf("version guard: ok (rule=%s companion=%s firmware=%s protocol=%d)\n", rule, companionVersion, targetVersion, protocolVersionV1)
	} else {
		fmt.Println("version guard: skipped (--skip-version-guard)")
	}

	hello, helloErr := readDeviceHelloFn(resolvedPort)
	if helloErr == nil {
		fmt.Printf("device hello: board=%s firmware=%s protocol=%d\n", hello.Board, hello.Firmware, hello.ProtocolVersion)
	} else {
		fmt.Printf("device hello: unavailable (%v)\n", helloErr)
	}

	state, err := loadReleaseStateFn(home)
	if err != nil {
		return &commandError{
			Op:   "load-release-state",
			Code: errcode.UpgradeStateWrite,
			Err:  err,
		}
	}

	snapshotPath, snapshotVersion, err := snapshotInstalledCompanionBinaryFn(home)
	if err != nil {
		return &commandError{
			Op:   "snapshot-companion",
			Code: errcode.UpgradeSnapshotCompanion,
			Err:  err,
		}
	}
	if snapshotPath != "" {
		fmt.Printf("last-known-good companion snapshot: %s\n", snapshotPath)
		state.LastKnownGood.CompanionBinary = snapshotPath
		state.LastKnownGood.CompanionVersion = snapshotVersion
	}

	refreshLastKnownGoodFirmware(&state, nil)
	state.LastKnownGood.FirmwareEnv = selectedEnv
	state.LastKnownGood.CapturedAtUTC = time.Now().UTC().Format(time.RFC3339)
	state.UpdatedAtUTC = state.LastKnownGood.CapturedAtUTC
	if err := saveReleaseStateFn(home, state); err != nil {
		return &commandError{
			Op:   "save-release-state",
			Code: errcode.UpgradeStateWrite,
			Err:  err,
		}
	}

	fmt.Printf("upgrade: port=%s firmware_env=%s target_firmware=%s\n", resolvedPort, selectedEnv, targetVersion)
	if err := setupRunFn(context.Background(), setup.Options{
		Port:        resolvedPort,
		AssumeYes:   true,
		SkipFlash:   false,
		FirmwareEnv: selectedEnv,
	}); err != nil {
		return &commandError{
			Op:   "flash-and-install",
			Code: errcode.UpgradeFlashFirmware,
			Err:  err,
		}
	}

	postHello, postHelloErr := readDeviceHelloFn(resolvedPort)
	if postHelloErr == nil {
		fmt.Printf("post-upgrade hello: board=%s firmware=%s protocol=%d\n", postHello.Board, postHello.Firmware, postHello.ProtocolVersion)
		if !*skipVersionGuard && strings.TrimSpace(postHello.Firmware) != "" {
			compatible, rule, compatErr := versioning.IsCompatible(companionVersion, postHello.Firmware, postHello.ProtocolVersion)
			switch {
			case compatErr != nil:
				fmt.Printf("post-upgrade version guard: warning (unable to parse device firmware version %q: %v)\n", postHello.Firmware, compatErr)
			case !compatible:
				return &commandError{
					Op:   "post-upgrade-version-guard",
					Code: errcode.UpgradeVersionGuard,
					Err: fmt.Errorf(
						"device firmware %s (protocol=%d) is incompatible with companion %s",
						postHello.Firmware,
						postHello.ProtocolVersion,
						companionVersion,
					),
					Hint: "rollback with `codexbar-display rollback` or flash a compatible firmware image",
				}
			default:
				fmt.Printf("post-upgrade version guard: ok (rule=%s)\n", rule)
			}
		}
	}

	state.LastUpgrade = lastUpgradeSnapshot{
		CompanionVersion: companionVersion,
		FirmwareVersion:  targetVersion,
		FirmwareEnv:      selectedEnv,
		Port:             resolvedPort,
		UpgradedAtUTC:    time.Now().UTC().Format(time.RFC3339),
	}
	if postHelloErr == nil {
		state.LastUpgrade.DeviceBoard = postHello.Board
	}
	state.UpdatedAtUTC = state.LastUpgrade.UpgradedAtUTC
	if err := saveReleaseStateFn(home, state); err != nil {
		return &commandError{
			Op:   "save-release-state",
			Code: errcode.UpgradeStateWrite,
			Err:  err,
		}
	}

	fmt.Println("upgrade complete")
	fmt.Println("rollback path ready: `codexbar-display rollback`")
	return nil
}

func runRollback(args []string) error {
	fs := flag.NewFlagSet("rollback", flag.ContinueOnError)
	port := fs.String("port", "", "serial port for firmware rollback (auto-detect when empty)")
	image := fs.String("image", "", "firmware image path (default from last-known-good state)")
	manifest := fs.String("manifest", "", "manifest path (default from last-known-good state)")
	scriptPath := fs.String("script-path", "", "path to esp8266-restore.sh (auto-detect when empty)")
	skipVerify := fs.Bool("skip-verify", false, "skip restore manifest/device verification")
	skipCompanion := fs.Bool("skip-companion", false, "skip companion binary rollback")
	skipFirmware := fs.Bool("skip-firmware", false, "skip firmware rollback")
	var backupDirs stringListFlag
	fs.Var(&backupDirs, "backup-dir", "backup directory to search for fallback rollback image (repeatable)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *skipCompanion && *skipFirmware {
		return errors.New("rollback requested with --skip-companion and --skip-firmware; nothing to do")
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return &commandError{Op: "resolve-home", Code: errcode.RollbackStateLoad, Err: err}
	}

	state, err := loadReleaseStateFn(home)
	if err != nil {
		return &commandError{Op: "load-release-state", Code: errcode.RollbackStateLoad, Err: err}
	}

	if !*skipCompanion {
		source := strings.TrimSpace(state.LastKnownGood.CompanionBinary)
		if source == "" {
			return &commandError{
				Op:   "rollback-companion",
				Code: errcode.RollbackMissingKnownGood,
				Err:  errors.New("no last-known-good companion snapshot in release state"),
			}
		}
		if !fileExists(source) {
			return &commandError{
				Op:   "rollback-companion",
				Code: errcode.RollbackCompanionRestore,
				Err:  fmt.Errorf("known-good companion snapshot missing: %s", source),
			}
		}

		supportDir, err := runtimeSupportDir()
		if err != nil {
			return &commandError{Op: "rollback-companion", Code: errcode.RollbackCompanionRestore, Err: err}
		}
		targetDir := filepath.Join(supportDir, "bin")
		if err := os.MkdirAll(targetDir, 0o755); err != nil {
			return &commandError{Op: "rollback-companion", Code: errcode.RollbackCompanionRestore, Err: err}
		}
		target := filepath.Join(targetDir, "codexbar-display")
		if err := copyRegularFileAtomic(source, target, 0o755); err != nil {
			return &commandError{Op: "rollback-companion", Code: errcode.RollbackCompanionRestore, Err: err}
		}
		fmt.Printf("rollback companion: restored %s -> %s\n", source, target)
	}

	if !*skipFirmware {
		imagePath, manifestPath, staleStateImage := resolveRollbackFirmwareInputs(
			strings.TrimSpace(*image),
			strings.TrimSpace(*manifest),
			state,
		)
		if staleStateImage {
			fmt.Printf(
				"rollback firmware: known-good state image missing (%s); falling back to backup discovery\n",
				strings.TrimSpace(state.LastKnownGood.FirmwareImage),
			)
		}

		restoreArgs := make([]string, 0, 16)
		if strings.TrimSpace(*port) != "" {
			restoreArgs = append(restoreArgs, "--port", strings.TrimSpace(*port))
		}
		if imagePath != "" {
			restoreArgs = append(restoreArgs, "--image", imagePath)
		}
		if manifestPath != "" {
			restoreArgs = append(restoreArgs, "--manifest", manifestPath)
		}
		if strings.TrimSpace(*scriptPath) != "" {
			restoreArgs = append(restoreArgs, "--script-path", strings.TrimSpace(*scriptPath))
		}
		for _, dir := range backupDirs {
			restoreArgs = append(restoreArgs, "--backup-dir", strings.TrimSpace(dir))
		}
		if *skipVerify {
			restoreArgs = append(restoreArgs, "--skip-verify")
		}

		if err := runRestoreKnownGoodCommandFn(restoreArgs); err != nil {
			return &commandError{Op: "rollback-firmware", Code: errcode.RollbackFirmwareRestore, Err: err}
		}
	}

	if !*skipCompanion || !*skipFirmware {
		if err := rollbackRestartLaunchAgentFn(home); err != nil {
			return &commandError{Op: "restart-launchagent", Code: errcode.RollbackLaunchAgent, Err: err}
		}
	}

	fmt.Println("rollback complete")
	return nil
}

func refreshLastKnownGoodFirmware(state *releaseState, extraBackupDirs []string) {
	if state == nil {
		return
	}

	backupSearchDirs, backupErr := resolveBackupSearchDirs(extraBackupDirs)
	if backupErr != nil {
		return
	}

	latestBackup, imageErr := resolveRestoreImage("", backupSearchDirs)
	if imageErr != nil {
		return
	}

	manifestPath, manifestErr := resolveRestoreManifestPath(latestBackup, "", false)
	if manifestErr != nil {
		return
	}

	state.LastKnownGood.FirmwareImage = latestBackup
	state.LastKnownGood.FirmwareManifest = manifestPath
}

func resolveRollbackFirmwareInputs(requestedImage, requestedManifest string, state releaseState) (imagePath, manifestPath string, staleStateImage bool) {
	imagePath = strings.TrimSpace(requestedImage)
	manifestPath = strings.TrimSpace(requestedManifest)
	if imagePath != "" {
		return imagePath, manifestPath, false
	}

	stateImage := strings.TrimSpace(state.LastKnownGood.FirmwareImage)
	if stateImage == "" {
		return "", manifestPath, false
	}
	if !fileExists(stateImage) {
		return "", manifestPath, true
	}

	imagePath = stateImage
	if manifestPath == "" {
		manifestPath = strings.TrimSpace(state.LastKnownGood.FirmwareManifest)
	}
	return imagePath, manifestPath, false
}

func ensureSerialPortNotBusy(port string) error {
	if strings.TrimSpace(port) == "" {
		return errors.New("serial port is empty")
	}
	if _, err := exec.LookPath("lsof"); err != nil {
		return nil
	}

	out, err := exec.Command("lsof", port).CombinedOutput()
	trimmed := strings.TrimSpace(string(out))
	if err == nil {
		if trimmed == "" {
			return nil
		}
		return fmt.Errorf("serial port is busy: %s\n%s", port, trimmed)
	}

	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) && exitErr.ExitCode() == 1 {
		return nil
	}
	if trimmed != "" {
		return fmt.Errorf("unable to check serial port holders (%v): %s", err, trimmed)
	}
	return fmt.Errorf("unable to check serial port holders: %w", err)
}

func stopLaunchAgentBestEffort() {
	service := fmt.Sprintf("gui/%d/com.codexbar-display.daemon", os.Getuid())
	_, _ = exec.Command("launchctl", "bootout", service).CombinedOutput()
}

func beginUpgradeLaunchAgentRecovery(home string, retErr *error) func() {
	upgradeStopLaunchAgentFn()
	return func() {
		if retErr == nil {
			return
		}
		*retErr = wrapUpgradeLaunchAgentRecoveryError(*retErr, home)
	}
}

func wrapUpgradeLaunchAgentRecoveryError(existingErr error, home string) error {
	restartErr := upgradeRestartLaunchAgentFn(home)
	if restartErr == nil {
		return existingErr
	}

	const restartHint = "restart launch agent manually with `launchctl bootout/bootstrap/kickstart`"
	hintWithDetails := fmt.Sprintf("%s (restart failure: %v)", restartHint, restartErr)
	if existingErr == nil {
		return &commandError{
			Op:   "restart-launchagent",
			Code: errcode.UpgradeLaunchAgent,
			Err:  restartErr,
			Hint: hintWithDetails,
		}
	}

	var cmdErr *commandError
	if errors.As(existingErr, &cmdErr) {
		cmdErr.Hint = appendRecoveryHint(cmdErr.Hint, hintWithDetails)
		return cmdErr
	}

	return &commandError{
		Op:   "upgrade",
		Code: errcode.UpgradeLaunchAgent,
		Err:  fmt.Errorf("%w; launch agent recovery failed: %v", existingErr, restartErr),
		Hint: hintWithDetails,
	}
}

func appendRecoveryHint(existing, extra string) string {
	existing = strings.TrimSpace(existing)
	extra = strings.TrimSpace(extra)
	switch {
	case existing == "":
		return extra
	case extra == "":
		return existing
	default:
		return existing + "; " + extra
	}
}

func releaseStatePath(home string) string {
	return filepath.Join(home, "Library", "Application Support", "codexbar-display", releaseStateFileName)
}

func loadReleaseState(home string) (releaseState, error) {
	path := releaseStatePath(home)
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return releaseState{SchemaVersion: releaseStateSchemaVersion}, nil
		}
		return releaseState{}, err
	}
	if len(data) == 0 {
		return releaseState{SchemaVersion: releaseStateSchemaVersion}, nil
	}

	var state releaseState
	if err := json.Unmarshal(data, &state); err != nil {
		return releaseState{}, fmt.Errorf("parse %s: %w", path, err)
	}
	if state.SchemaVersion == 0 {
		state.SchemaVersion = releaseStateSchemaVersion
	}
	return state, nil
}

func saveReleaseState(home string, state releaseState) error {
	path := releaseStatePath(home)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if state.SchemaVersion == 0 {
		state.SchemaVersion = releaseStateSchemaVersion
	}
	if strings.TrimSpace(state.UpdatedAtUTC) == "" {
		state.UpdatedAtUTC = time.Now().UTC().Format(time.RFC3339)
	}

	payload, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	payload = append(payload, '\n')

	tmpPath := fmt.Sprintf("%s.tmp-%d", path, time.Now().UnixNano())
	if err := os.WriteFile(tmpPath, payload, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	return os.Chmod(path, 0o644)
}

func snapshotInstalledCompanionBinary(home string) (string, string, error) {
	supportDir := filepath.Join(home, "Library", "Application Support", "codexbar-display")
	installed := filepath.Join(supportDir, "bin", "codexbar-display")
	if !fileExists(installed) {
		return "", "", nil
	}

	installedVersion := detectBinaryVersion(installed)
	timestamp := time.Now().UTC().Format("20060102T150405Z")
	snapshotDir := filepath.Join(supportDir, "releases", "companion-lkg", timestamp+"-"+sanitizePathToken(installedVersion))
	if err := os.MkdirAll(snapshotDir, 0o755); err != nil {
		return "", "", err
	}

	snapshotPath := filepath.Join(snapshotDir, "codexbar-display")
	if err := copyRegularFileAtomic(installed, snapshotPath, 0o755); err != nil {
		return "", "", err
	}
	return snapshotPath, installedVersion, nil
}

func sanitizePathToken(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "unknown"
	}
	var b strings.Builder
	for _, r := range raw {
		switch {
		case r >= 'a' && r <= 'z':
			b.WriteRune(r)
		case r >= 'A' && r <= 'Z':
			b.WriteRune(r)
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '.', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	if b.Len() == 0 {
		return "unknown"
	}
	return b.String()
}

func detectBinaryVersion(binPath string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, binPath, "version", "--short")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "unknown"
	}
	trimmed := strings.TrimSpace(string(out))
	if trimmed == "" {
		return "unknown"
	}
	return trimmed
}

func copyRegularFileAtomic(sourcePath, targetPath string, mode os.FileMode) error {
	source, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer source.Close()

	tmpPath := fmt.Sprintf("%s.tmp-%d", targetPath, time.Now().UnixNano())
	target, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}

	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tmpPath)
		}
	}()

	if _, err := io.Copy(target, source); err != nil {
		_ = target.Close()
		return err
	}
	if err := target.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpPath, mode); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, targetPath); err != nil {
		return err
	}
	cleanup = false
	return nil
}

func restartLaunchAgent(home string) error {
	plist := filepath.Join(home, "Library", "LaunchAgents", "com.codexbar-display.daemon.plist")
	if !fileExists(plist) {
		return nil
	}

	domain := fmt.Sprintf("gui/%d", os.Getuid())
	service := domain + "/com.codexbar-display.daemon"
	_, _ = exec.Command("launchctl", "bootout", service).CombinedOutput()

	bootstrapOut, bootstrapErr := exec.Command("launchctl", "bootstrap", domain, plist).CombinedOutput()
	if bootstrapErr != nil {
		trimmed := strings.TrimSpace(string(bootstrapOut))
		if !strings.Contains(trimmed, "already") {
			return fmt.Errorf("bootstrap launchagent: %w (%s)", bootstrapErr, trimmed)
		}
	}

	kickOut, kickErr := exec.Command("launchctl", "kickstart", "-k", service).CombinedOutput()
	if kickErr != nil {
		return fmt.Errorf("kickstart launchagent: %w (%s)", kickErr, strings.TrimSpace(string(kickOut)))
	}
	return nil
}
