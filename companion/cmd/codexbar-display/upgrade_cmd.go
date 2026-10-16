package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/buildinfo"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/service"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/setup"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/versioning"
)

func runUpgrade(args []string) (retErr error) {
	fs := flag.NewFlagSet("upgrade", flag.ContinueOnError)
	port := fs.String("port", "", "required explicit serial recovery port")
	firmwareEnv := fs.String("firmware-env", setup.DefaultFirmwareEnvironment(), "PlatformIO environment to flash")
	targetFirmwareVersion := fs.String("target-firmware-version", "", "target firmware semver/release version (default: latest firmware manifest)")
	repo := fs.String("repo", defaultReleaseRepo, "GitHub repository for release firmware assets")
	skipVersionGuard := fs.Bool("skip-version-guard", false, "skip companion/firmware compatibility guard")
	if err := fs.Parse(args); err != nil {
		return err
	}
	ctx := context.Background()

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

	// Auto-discovery needs exclusive ownership, then the busy check and
	// firmware uploader need that handle released again.
	resolvedPort, err := resolveSerialPortFn(strings.TrimSpace(*port))
	closeDefaultSenderFn()
	if err != nil {
		return &commandError{Op: "resolve-port", Code: errcode.UpgradeResolvePort, Err: err}
	}

	if err := ensureSerialPortNotBusyFn(resolvedPort); err != nil {
		return &commandError{
			Op:   "preflight-port-busy",
			Code: errcode.UpgradePortBusy,
			Err:  err,
			Hint: fmt.Sprintf("stop daemons/monitors using %s and retry", resolvedPort),
		}
	}

	releaseRepo, err := normalizeReleaseRepo(*repo)
	if err != nil {
		return &commandError{
			Op:   "resolve-release-repo",
			Code: errcode.UpgradeFlashFirmware,
			Err:  err,
			Hint: "pass --repo owner/name",
		}
	}

	targetVersion := strings.TrimSpace(*targetFirmwareVersion)
	targetVersionExplicit := targetVersion != ""
	releaseTag := ""
	if !targetVersionExplicit {
		latestTag, latestVersion, err := fetchLatestReleaseVersion(ctx, releaseRepo)
		if err != nil {
			return &commandError{
				Op:   "resolve-target-firmware-version",
				Code: errcode.UpgradeFlashFirmware,
				Err:  err,
				Hint: "check network access or pass --target-firmware-version for a known release",
			}
		}
		releaseTag = latestTag
		fmt.Printf("latest release: %s\n", latestVersion)
	} else {
		targetVersion = normalizeReleaseVersion(targetVersion)
		releaseTag = "v" + targetVersion
	}

	companionVersion := buildinfo.NormalizedVersion()

	hello, helloErr := readDeviceHelloFn(resolvedPort)
	closeDefaultSenderFn()
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

	fmt.Printf("upgrade: port=%s firmware_env=%s target_firmware=%s release=%s repo=%s\n", resolvedPort, selectedEnv, targetVersion, releaseTag, releaseRepo)
	imagePath, manifestPath, artifact, err := downloadReleaseFirmware(ctx, home, releaseRepo, releaseTag, targetVersion, selectedEnv)
	if err != nil {
		return &commandError{
			Op:   "download-release-firmware",
			Code: errcode.UpgradeFlashFirmware,
			Err:  err,
			Hint: "verify the GitHub release contains firmware artifacts and checksums, then retry upgrade",
		}
	}
	targetVersion = normalizeReleaseVersion(artifact.FirmwareVersion)
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
	fmt.Printf("release firmware: %s manifest=%s sha256=%s\n", imagePath, manifestPath, artifact.SHA256)
	if helloErr == nil {
		detectedBoard := strings.TrimSpace(strings.ToLower(hello.Board))
		expectedBoard := strings.TrimSpace(strings.ToLower(artifact.Board))
		if detectedBoard != "" && expectedBoard != "" && detectedBoard != expectedBoard {
			return &commandError{
				Op:   "hardware-guard",
				Code: errcode.UpgradeVersionGuard,
				Err: fmt.Errorf(
					"device board %q is incompatible with release firmware board %q",
					detectedBoard,
					expectedBoard,
				),
				Hint: "choose a matching --firmware-env for the connected VibeTV hardware",
			}
		}
	}
	if err := flashReleaseFirmwareImageFn(ctx, resolvedPort, artifact, imagePath); err != nil {
		return &commandError{
			Op:   "flash-release-firmware",
			Code: errcode.UpgradeFlashFirmware,
			Err:  err,
			Hint: fmt.Sprintf("ensure no process holds %s, install PlatformIO CLI if missing, then rerun upgrade", resolvedPort),
		}
	}
	fmt.Println("firmware flash: ok")

	postHello, postHelloErr := readDeviceHelloFn(resolvedPort)
	closeDefaultSenderFn()
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

type firmwareFlashSpec struct {
	Chip    string
	Baud    string
	Address string
}

var releaseFirmwareFlashSpecs = map[string]firmwareFlashSpec{
	"esp8266_smalltv_st7789": {
		Chip:    "esp8266",
		Baud:    "460800",
		Address: "0x000000",
	},
}

func flashReleaseFirmwareImage(ctx context.Context, port string, artifact releaseFirmwareArtifact, imagePath string) error {
	env := strings.TrimSpace(artifact.FirmwareEnv)
	spec, ok := releaseFirmwareFlashSpecs[env]
	if !ok {
		return fmt.Errorf("release firmware flashing is not implemented for env %q", env)
	}
	if strings.TrimSpace(port) == "" {
		return errors.New("serial port is empty")
	}
	if _, err := exec.LookPath("pio"); err != nil {
		return fmt.Errorf("PlatformIO CLI not found: %w", err)
	}

	args := []string{
		"pkg", "exec",
		"--package", "platformio/tool-esptoolpy",
		"--",
		"esptool.py",
		"--chip", spec.Chip,
		"--port", port,
		"--baud", spec.Baud,
		"write_flash",
		"--flash_size", "detect",
		spec.Address,
		imagePath,
	}
	output, err := exec.CommandContext(ctx, "pio", args...).CombinedOutput()
	if err != nil {
		trimmed := strings.TrimSpace(string(output))
		if trimmed != "" {
			return fmt.Errorf("%w: %s", err, trimmed)
		}
		return err
	}
	return nil
}

func ensureSerialPortNotBusy(port string) error {
	if strings.TrimSpace(port) == "" {
		return errors.New("serial port is empty")
	}
	if _, err := exec.LookPath("lsof"); err != nil {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "lsof", port).CombinedOutput()
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
	label := runtimepaths.DisplayStreamLaunchAgentLabel()
	_ = service.New(label, "", label != runtimepaths.LegacyDisplayStreamLaunchAgentLabel).Stop(context.Background(), false)
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

	restartHint := "restart background service with `codexbar-display service start`"
	if runtime.GOOS != "windows" {
		restartHint = "restart launch agent manually with `launchctl bootout/bootstrap/kickstart`"
	}
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
