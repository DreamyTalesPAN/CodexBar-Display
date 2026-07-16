package main

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/buildinfo"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/firmwareupdate"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/setup"
	transportlayer "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/transport"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/versioning"
)

const (
	releaseStateSchemaVersion = 1
	releaseStateFileName      = "release-state.json"
	protocolVersionV1         = 1
	defaultReleaseRepo        = "DreamyTalesPAN/CodexBar-Display"
	githubAPIBaseURL          = "https://api.github.com"
	githubDownloadBaseURL     = "https://github.com"
	vibeTVFirmwareManifestURL = "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/firmware-manifest.json"
	otaUploadBytesPerSecond   = 32 * 1024
	otaRawWriteChunkBytes     = 64
	otaRawWritePause          = 10 * time.Millisecond
	otaRawWriteBufferBytes    = 2 * 1024
	otaRawAckBlockBytes       = 1024
	otaRawAckTimeout          = 30 * time.Second
	otaRawHeaderPause         = 250 * time.Millisecond
)

var (
	errFirmwareUploadRestartRequired                   = errors.New("VibeTV must restart before another firmware upload")
	errFirmwareUploadMayHaveWritten                    = errors.New("firmware upload may have written data")
	upgradeStopLaunchAgentFn                           = stopLaunchAgentBestEffort
	upgradeRestartLaunchAgentFn                        = restartLaunchAgent
	rollbackRestartLaunchAgentFn                       = restartLaunchAgent
	resolveSerialPortFn                                = usb.ResolvePort
	readDeviceHelloFn                                  = usb.ReadDeviceHello
	closeDefaultSenderFn                               = usb.CloseDefaultSender
	ensureSerialPortNotBusyFn                          = ensureSerialPortNotBusy
	loadReleaseStateFn                                 = loadReleaseState
	saveReleaseStateFn                                 = saveReleaseState
	snapshotInstalledCompanionBinaryFn                 = snapshotInstalledCompanionBinary
	runRestoreKnownGoodCommandFn                       = runRestoreKnownGood
	releaseHTTPClient                  releaseHTTPDoer = &http.Client{Timeout: 5 * time.Minute}
	discoverWiFiDeviceFn                               = transportlayer.DiscoverWiFiDevice
	flashReleaseFirmwareImageFn                        = flashReleaseFirmwareImage
	uploadFirmwareOTAFn                                = uploadFirmwareOTA
	firmwareRawDialContextFn                           = dialFirmwareRawConnection
	firmwareHTTPVerifyPollInterval                     = 2 * time.Second
	firmwareUpdateRediscoveryAfter                     = 10 * time.Second
	firmwareUpdateRediscoveryInterval                  = 5 * time.Second
	firmwareInterruptedVerifyTimeout                   = 20 * time.Second
)

type firmwareUpdateEvent = firmwareupdate.Event

func emitFirmwareUpdateEvent(event firmwareUpdateEvent) {
	payload, err := json.Marshal(event)
	if err != nil {
		return
	}
	fmt.Printf("%s%s\n", firmwareupdate.EventPrefix, payload)
}

const launchAgentLabel = "com.codexbar-display.daemon.plist"

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

func runInstallUpdate(args []string) (retErr error) {
	fs := flag.NewFlagSet("install-update", flag.ContinueOnError)
	target := fs.String("target", setup.DefaultWiFiTarget(), "VibeTV URL, for example http://192.168.1.42")
	manifestURL := fs.String("manifest-url", vibeTVFirmwareManifestURL, "firmware manifest URL")
	force := fs.Bool("force", false, "install even when the device already reports the latest firmware")
	confirmLiveUpdate := fs.Bool("confirm-live-update", false, "allow installing from the default live Shopify firmware manifest")
	skipLaunchAgentPause := fs.Bool("skip-launchagent-pause", false, "internal: keep the Mac App running while updating firmware")
	verbose := fs.Bool("verbose", false, "show manifest, asset, and local firmware file details")
	if err := fs.Parse(args); err != nil {
		return err
	}
	manifestURLExplicit := flagWasSet(fs, "manifest-url")
	if !manifestURLExplicit && !*confirmLiveUpdate {
		return &commandError{
			Op:   "confirm-live-update",
			Code: errcode.UpgradeFlashFirmware,
			Err:  errors.New("refusing to install from the live firmware manifest without --confirm-live-update"),
			Hint: "for PR or hardware tests, pass an explicit --manifest-url for the test manifest; for production live updates, rerun with --confirm-live-update",
		}
	}

	ctx := context.Background()
	home, err := os.UserHomeDir()
	if err != nil {
		return &commandError{Op: "resolve-home", Code: errcode.UpgradeStateWrite, Err: err}
	}
	base, err := normalizeHTTPBaseURL(*target)
	if err != nil {
		return &commandError{Op: "resolve-target", Code: errcode.UpgradeFlashFirmware, Err: err}
	}

	hello, err := fetchDeviceHelloHTTP(ctx, base)
	if err != nil {
		return &commandError{
			Op:   "device-hello",
			Code: errcode.UpgradeFlashFirmware,
			Err:  err,
			Hint: "open http://<device-ip>/health or pass --target http://<device-ip>",
		}
	}
	caps := protocol.CapabilitiesFromHello(hello)
	deviceID := strings.TrimSpace(hello.DeviceID)
	emitFirmwareUpdateEvent(firmwareUpdateEvent{
		Stage:         "validating_artifact",
		Phase:         "installing",
		Target:        base,
		DeviceID:      deviceID,
		HelloVerified: true,
	})
	fmt.Println("Checking device...")
	fmt.Printf("Device: %s firmware %s\n", caps.Board, caps.Firmware)

	fmt.Println("Checking firmware...")
	manifest, err := fetchReleaseFirmwareManifestURL(ctx, strings.TrimSpace(*manifestURL))
	if err != nil {
		return &commandError{Op: "fetch-firmware-manifest", Code: errcode.UpgradeFlashFirmware, Err: err}
	}
	artifact, err := selectLatestFirmwareArtifactForBoard(manifest, caps.Board)
	if err != nil {
		return &commandError{Op: "select-firmware", Code: errcode.UpgradeVersionGuard, Err: err}
	}
	targetVersion := normalizeReleaseVersion(artifact.FirmwareVersion)

	current, currentErr := versioning.ParseSemVer(caps.Firmware)
	next, nextErr := versioning.ParseSemVer(targetVersion)
	if currentErr != nil {
		return &commandError{Op: "parse-current-firmware", Code: errcode.UpgradeVersionGuard, Err: currentErr}
	}
	if nextErr != nil {
		return &commandError{Op: "parse-target-firmware", Code: errcode.UpgradeVersionGuard, Err: nextErr}
	}
	if current.Compare(next) >= 0 && !*force {
		fmt.Printf("Firmware: already current (%s)\n", caps.Firmware)
		emitFirmwareUpdateEvent(firmwareUpdateEvent{
			Stage:             "verifying_health",
			Phase:             "complete",
			Outcome:           "already_current",
			Firmware:          caps.Firmware,
			Target:            base,
			DeviceID:          deviceID,
			ArtifactValidated: true,
			HelloVerified:     true,
		})
		return nil
	}
	fmt.Printf("Updating firmware: %s -> %s\n", caps.Firmware, targetVersion)
	if *verbose {
		fmt.Printf("Firmware manifest: %s\n", strings.TrimSpace(*manifestURL))
		fmt.Printf("Firmware asset: %s\n", strings.TrimSpace(artifact.Asset))
	}

	imagePath, err := downloadManifestFirmwareArtifact(ctx, home, manifest, artifact)
	if err != nil {
		return &commandError{
			Op:   "download-firmware",
			Code: errcode.UpgradeFlashFirmware,
			Err:  err,
			Hint: "check network access and the manifest firmwareUrl/sha256 fields",
		}
	}
	if *verbose {
		fmt.Printf("Firmware downloaded: %s sha256=%s\n", imagePath, strings.TrimSpace(artifact.SHA256))
	}
	emitFirmwareUpdateEvent(firmwareUpdateEvent{
		Stage:             "uploading",
		Phase:             "installing",
		Firmware:          targetVersion,
		Target:            base,
		DeviceID:          deviceID,
		ArtifactValidated: true,
		HelloVerified:     true,
	})

	deviceToken, err := ensureFirmwareUpdateDeviceToken(ctx, home, base, false)
	if err != nil {
		return &commandError{
			Op:   "pair-device",
			Code: errcode.UpgradeFlashFirmware,
			Err:  err,
			Hint: "keep VibeTV powered and on the same WiFi, then retry",
		}
	}

	if !*skipLaunchAgentPause {
		fmt.Println("Pausing Mac App during firmware update...")
		cleanupLaunchAgent := beginUpgradeLaunchAgentRecovery(home, &retErr)
		defer cleanupLaunchAgent()
	}

	fmt.Println("Uploading firmware...")
	uploadErr := uploadFirmwareOTAFn(ctx, base, imagePath, deviceToken)
	uploadErr = recoverInterruptedFirmwareUpload(
		ctx,
		base,
		targetVersion,
		deviceID,
		uploadErr,
	)
	if uploadErr != nil {
		if firmwareOTAAuthError(uploadErr) {
			refreshedToken, pairErr := ensureFirmwareUpdateDeviceToken(ctx, home, base, true)
			if pairErr == nil {
				uploadErr = uploadFirmwareOTAFn(ctx, base, imagePath, refreshedToken)
				uploadErr = recoverInterruptedFirmwareUpload(
					ctx,
					base,
					targetVersion,
					deviceID,
					uploadErr,
				)
			} else {
				uploadErr = fmt.Errorf("%w; repair pairing failed: %v", uploadErr, pairErr)
			}
		}
		if uploadErr != nil {
			hint := "keep VibeTV powered and on the same WiFi, then retry"
			if errors.Is(uploadErr, errFirmwareUploadRestartRequired) {
				hint = "disconnect VibeTV from power for 10 seconds, reconnect it, wait until the picture returns, then retry once"
				emitFirmwareUpdateEvent(firmwareUpdateEvent{
					Stage:       "uploading",
					RetryPolicy: "power_cycle",
					Firmware:    targetVersion,
					Target:      base,
					DeviceID:    deviceID,
				})
			}
			return &commandError{
				Op:   "ota-upload",
				Code: errcode.UpgradeFlashFirmware,
				Err:  uploadErr,
				Hint: hint,
			}
		}
	}
	emitFirmwareUpdateEvent(firmwareUpdateEvent{
		Stage:             "rebooting",
		Phase:             "installing",
		Firmware:          targetVersion,
		Target:            base,
		DeviceID:          deviceID,
		ArtifactValidated: true,
		UploadAccepted:    true,
		HelloVerified:     true,
	})
	fmt.Println("Restarting VibeTV...")

	verifiedBase, err := waitForHTTPFirmwareVersionWithDiscovery(ctx, home, base, targetVersion, deviceID, 120*time.Second)
	if err != nil {
		return &commandError{
			Op:   "post-update-verify",
			Code: errcode.UpgradeFlashFirmware,
			Err:  err,
			Hint: "wait one minute, then open http://<device-ip>/health",
		}
	}
	verifiedHello, helloErr := fetchDeviceHelloHTTP(ctx, verifiedBase)
	if helloErr != nil || !strings.EqualFold(strings.TrimSpace(verifiedHello.DeviceID), deviceID) {
		return &commandError{
			Op:   "post-update-device-identity",
			Code: errcode.UpgradeFlashFirmware,
			Err:  fmt.Errorf("updated VibeTV identity changed: expected=%q got=%q: %v", deviceID, strings.TrimSpace(verifiedHello.DeviceID), helloErr),
			Hint: "do not retry the flash; verify the saved VibeTV device identity",
		}
	}
	emitFirmwareUpdateEvent(firmwareUpdateEvent{
		Stage:             "verifying_health",
		Phase:             "installing",
		Firmware:          targetVersion,
		Target:            verifiedBase,
		DeviceID:          deviceID,
		ArtifactValidated: true,
		UploadAccepted:    true,
		HelloVerified:     true,
	})
	if verifiedBase != base {
		base = verifiedBase
		if _, err := ensureFirmwareUpdateDeviceToken(ctx, home, base, false); err != nil {
			fmt.Printf("warning: firmware updated, but saving the rediscovered VibeTV address failed: %v\n", err)
		}
	}
	fmt.Printf("Done: firmware %s installed\n", targetVersion)
	return nil
}

func ensureFirmwareUpdateDeviceToken(ctx context.Context, home, base string, forcePair bool) (string, error) {
	cfg, err := runtimeconfig.Load(home)
	if err != nil {
		return "", err
	}

	changed := false
	if shouldStoreFirmwareUpdateTarget(cfg.DeviceTarget, base) {
		cfg.DeviceTarget = strings.TrimSpace(base)
		changed = true
	}

	token := strings.TrimSpace(cfg.DeviceToken)
	if token == "" || forcePair {
		token, err = pairFirmwareUpdateDevice(ctx, base)
		if err != nil {
			return "", err
		}
		cfg.DeviceToken = token
		changed = true
	}

	if changed {
		if err := runtimeconfig.Save(home, cfg); err != nil {
			return "", err
		}
	}
	return token, nil
}

func shouldStoreFirmwareUpdateTarget(current, next string) bool {
	next = strings.TrimSpace(next)
	if next == "" || strings.TrimSpace(current) == next {
		return false
	}
	return true
}

func waitForHTTPFirmwareVersionWithDiscovery(ctx context.Context, home, base, version, deviceID string, timeout time.Duration) (string, error) {
	deadline := time.Now().Add(timeout)
	firstTimeout := timeout
	if firmwareUpdateRediscoveryAfter > 0 && firmwareUpdateRediscoveryAfter < timeout {
		firstTimeout = firmwareUpdateRediscoveryAfter
	}
	err := waitForHTTPFirmwareVersion(ctx, base, version, firstTimeout)
	if err == nil {
		return base, nil
	}

	var lastDiscoveryErr error
	for time.Now().Before(deadline) {
		discovered, discoverErr := discoverInstallUpdateTarget(ctx, home, base, deviceID)
		if discoverErr == nil && strings.TrimSpace(discovered) != "" {
			remaining := time.Until(deadline)
			verifyFor := 30 * time.Second
			if remaining < verifyFor {
				verifyFor = remaining
			}
			if verifyFor > 0 {
				if verifyErr := waitForHTTPFirmwareVersion(ctx, discovered, version, verifyFor); verifyErr == nil {
					if strings.TrimRight(discovered, "/") != strings.TrimRight(base, "/") {
						fmt.Printf("Using rediscovered VibeTV address: %s\n", discovered)
					}
					return discovered, nil
				} else {
					lastDiscoveryErr = verifyErr
				}
			}
		} else if discoverErr != nil {
			lastDiscoveryErr = discoverErr
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(firmwareUpdateRediscoveryInterval):
		}
	}
	if lastDiscoveryErr != nil {
		return "", fmt.Errorf("%w; rediscovery failed: %v", err, lastDiscoveryErr)
	}
	return "", err
}

func discoverInstallUpdateTarget(ctx context.Context, home, base, deviceID string) (string, error) {
	candidates := []string{base, setup.DefaultWiFiTarget()}
	if cfg, err := runtimeconfig.Load(home); err == nil {
		candidates = append(candidates, cfg.DeviceTarget)
	}
	result, err := discoverWiFiDeviceFn(ctx, transportlayer.WiFiDiscoveryOptions{
		Candidates:         candidates,
		IncludeNetworkScan: true,
		Timeout:            8 * time.Second,
		ExpectedDeviceID:   strings.TrimSpace(deviceID),
	})
	if err != nil {
		return "", err
	}
	target, err := normalizeHTTPBaseURL(result.Target)
	if err != nil {
		return "", err
	}
	return target, nil
}

func pairFirmwareUpdateDevice(ctx context.Context, base string) (string, error) {
	form := url.Values{}
	form.Set("api", "1")
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		strings.TrimRight(base, "/")+"/api/pair",
		strings.NewReader(form.Encode()),
	)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", "codexbar-display-update")
	resp, err := releaseHTTPClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return "", fmt.Errorf("POST /api/pair returned %s body=%q", resp.Status, strings.TrimSpace(string(body)))
	}

	var payload struct {
		OK    bool   `json:"ok"`
		Token string `json:"token"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&payload); err != nil {
		return "", err
	}
	token := strings.TrimSpace(payload.Token)
	if !payload.OK || token == "" {
		return "", errors.New("pairing response did not include token")
	}
	return token, nil
}

func firmwareOTAAuthError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "401") ||
		strings.Contains(msg, "unauthorized") ||
		strings.Contains(msg, "pairing token required")
}

type releaseHTTPDoer interface {
	Do(*http.Request) (*http.Response, error)
}

type rateLimitedReader struct {
	r              io.Reader
	bytesPerSecond int64
	started        time.Time
	sent           int64
}

func newRateLimitedReader(r io.Reader, bytesPerSecond int64) io.Reader {
	if bytesPerSecond <= 0 {
		return r
	}
	return &rateLimitedReader{
		r:              r,
		bytesPerSecond: bytesPerSecond,
		started:        time.Now(),
	}
}

func (r *rateLimitedReader) Read(p []byte) (int, error) {
	if len(p) > 4096 {
		p = p[:4096]
	}
	n, err := r.r.Read(p)
	if n > 0 {
		r.sent += int64(n)
		expectedElapsed := time.Duration(r.sent) * time.Second / time.Duration(r.bytesPerSecond)
		if sleep := time.Until(r.started.Add(expectedElapsed)); sleep > 0 {
			time.Sleep(sleep)
		}
	}
	return n, err
}

type releaseFirmwareManifest struct {
	SchemaVersion   int                       `json:"schemaVersion"`
	Release         string                    `json:"release"`
	ProtocolVersion int                       `json:"protocolVersion"`
	Artifacts       []releaseFirmwareArtifact `json:"artifacts"`
}

type releaseFirmwareArtifact struct {
	FirmwareEnv     string `json:"firmwareEnv"`
	Board           string `json:"board"`
	FirmwareVersion string `json:"firmwareVersion"`
	Severity        string `json:"severity"`
	Message         string `json:"message"`
	Asset           string `json:"asset"`
	FirmwareURL     string `json:"firmwareUrl"`
	FilesystemURL   string `json:"filesystemUrl"`
	SHA256          string `json:"sha256"`
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

func normalizeReleaseRepo(raw string) (string, error) {
	repo := strings.TrimSpace(raw)
	repo = strings.TrimPrefix(repo, "https://github.com/")
	repo = strings.TrimSuffix(repo, ".git")
	repo = strings.Trim(repo, "/")
	parts := strings.Split(repo, "/")
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
		return "", fmt.Errorf("invalid repository %q", raw)
	}
	return parts[0] + "/" + parts[1], nil
}

func normalizeReleaseVersion(raw string) string {
	version := strings.TrimSpace(raw)
	version = strings.TrimPrefix(version, "v")
	return version
}

func fetchLatestReleaseVersion(ctx context.Context, repo string) (tag, version string, err error) {
	endpoint := fmt.Sprintf("%s/repos/%s/releases/latest", githubAPIBaseURL, repo)
	var payload struct {
		TagName string `json:"tag_name"`
	}
	if err := fetchJSON(ctx, endpoint, &payload); err != nil {
		return "", "", err
	}
	tag = strings.TrimSpace(payload.TagName)
	if tag == "" {
		return "", "", fmt.Errorf("latest release response for %s did not include tag_name", repo)
	}
	return tag, normalizeReleaseVersion(tag), nil
}

func downloadReleaseFirmware(ctx context.Context, home, repo, releaseTag, version, firmwareEnv string) (imagePath, manifestPath string, artifact releaseFirmwareArtifact, err error) {
	version = normalizeReleaseVersion(version)
	releaseTag = strings.TrimSpace(releaseTag)
	if version == "" && releaseTag == "" {
		return "", "", releaseFirmwareArtifact{}, errors.New("release tag or firmware version cannot be empty")
	}
	if releaseTag == "" {
		releaseTag = "v" + version
	}

	releaseDir := filepath.Join(
		home,
		"Library",
		"Application Support",
		"codexbar-display",
		"releases",
		"firmware",
		sanitizePathToken(releaseTag),
	)
	if err := os.MkdirAll(releaseDir, 0o755); err != nil {
		return "", "", releaseFirmwareArtifact{}, err
	}

	manifestAsset := "firmware-manifest.json"
	if version != "" {
		manifestAsset = fmt.Sprintf("firmware-manifest-v%s.json", version)
	}
	manifestPath = filepath.Join(releaseDir, manifestAsset)
	manifestURL := githubReleaseAssetURL(repo, releaseTag, manifestAsset)
	if err := downloadURLToFile(ctx, manifestURL, manifestPath, 0o644); err != nil {
		return "", "", releaseFirmwareArtifact{}, fmt.Errorf("download manifest: %w", err)
	}

	var manifest releaseFirmwareManifest
	manifestData, err := os.ReadFile(manifestPath)
	if err != nil {
		return "", "", releaseFirmwareArtifact{}, err
	}
	if err := json.Unmarshal(manifestData, &manifest); err != nil {
		return "", "", releaseFirmwareArtifact{}, fmt.Errorf("parse firmware manifest: %w", err)
	}

	artifact, err = selectReleaseFirmwareArtifact(manifest, firmwareEnv, version)
	if err != nil {
		return "", "", releaseFirmwareArtifact{}, err
	}

	imagePath = filepath.Join(releaseDir, artifact.Asset)
	imageURL := strings.TrimSpace(artifact.FirmwareURL)
	if imageURL == "" {
		imageURL = githubReleaseAssetURL(repo, releaseTag, artifact.Asset)
	}
	if err := downloadURLToFile(ctx, imageURL, imagePath, 0o644); err != nil {
		return "", "", releaseFirmwareArtifact{}, fmt.Errorf("download firmware image: %w", err)
	}

	actualSHA, err := sha256File(imagePath)
	if err != nil {
		return "", "", releaseFirmwareArtifact{}, err
	}
	expectedSHA := strings.ToLower(strings.TrimSpace(artifact.SHA256))
	if expectedSHA == "" {
		return "", "", releaseFirmwareArtifact{}, fmt.Errorf("manifest artifact %q has empty sha256", artifact.Asset)
	}
	if actualSHA != expectedSHA {
		return "", "", releaseFirmwareArtifact{}, fmt.Errorf("sha256 mismatch for %s: expected %s actual %s", artifact.Asset, expectedSHA, actualSHA)
	}
	if strings.HasSuffix(strings.ToLower(imagePath), ".gz") {
		rawImagePath := strings.TrimSuffix(imagePath, filepath.Ext(imagePath))
		if err := gunzipFile(imagePath, rawImagePath, 0o644); err != nil {
			return "", "", releaseFirmwareArtifact{}, fmt.Errorf("decompress firmware image: %w", err)
		}
		imagePath = rawImagePath
	}

	return imagePath, manifestPath, artifact, nil
}

func githubReleaseAssetURL(repo, releaseTag, asset string) string {
	return fmt.Sprintf(
		"%s/%s/releases/download/%s/%s",
		githubDownloadBaseURL,
		repo,
		url.PathEscape(strings.TrimSpace(releaseTag)),
		url.PathEscape(strings.TrimSpace(asset)),
	)
}

func selectReleaseFirmwareArtifact(manifest releaseFirmwareManifest, firmwareEnv, version string) (releaseFirmwareArtifact, error) {
	firmwareEnv = strings.TrimSpace(firmwareEnv)
	version = normalizeReleaseVersion(version)
	for _, artifact := range manifest.Artifacts {
		if strings.TrimSpace(artifact.FirmwareEnv) != firmwareEnv {
			continue
		}
		if version != "" && normalizeReleaseVersion(artifact.FirmwareVersion) != version {
			return releaseFirmwareArtifact{}, fmt.Errorf(
				"manifest artifact for %s has firmware version %q, expected %q",
				firmwareEnv,
				artifact.FirmwareVersion,
				version,
			)
		}
		if strings.TrimSpace(artifact.Asset) == "" {
			return releaseFirmwareArtifact{}, fmt.Errorf("manifest artifact for %s has empty asset", firmwareEnv)
		}
		if strings.TrimSpace(artifact.SHA256) == "" {
			return releaseFirmwareArtifact{}, fmt.Errorf("manifest artifact for %s has empty sha256", firmwareEnv)
		}
		return artifact, nil
	}
	return releaseFirmwareArtifact{}, fmt.Errorf("no firmware artifact for env %q in release manifest", firmwareEnv)
}

func selectLatestFirmwareArtifactForBoard(manifest releaseFirmwareManifest, board string) (releaseFirmwareArtifact, error) {
	board = strings.TrimSpace(strings.ToLower(board))
	if board == "" {
		return releaseFirmwareArtifact{}, errors.New("device board is empty")
	}

	var selected releaseFirmwareArtifact
	var selectedVersion *versioning.SemVer
	for _, artifact := range manifest.Artifacts {
		if strings.TrimSpace(strings.ToLower(artifact.Board)) != board {
			continue
		}
		parsed, err := versioning.ParseSemVer(artifact.FirmwareVersion)
		if err != nil {
			continue
		}
		if selectedVersion == nil || parsed.Compare(*selectedVersion) > 0 {
			candidate := parsed
			selectedVersion = &candidate
			selected = artifact
		}
	}
	if selectedVersion == nil {
		return releaseFirmwareArtifact{}, fmt.Errorf("no firmware artifact for board %q", board)
	}
	if strings.TrimSpace(selected.SHA256) == "" {
		return releaseFirmwareArtifact{}, fmt.Errorf("manifest artifact for board %q has empty sha256", board)
	}
	return selected, nil
}

func fetchReleaseFirmwareManifestURL(ctx context.Context, manifestURL string) (releaseFirmwareManifest, error) {
	manifestURL = strings.TrimSpace(manifestURL)
	if manifestURL == "" {
		return releaseFirmwareManifest{}, errors.New("manifest URL cannot be empty")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, manifestURL, nil)
	if err != nil {
		return releaseFirmwareManifest{}, err
	}
	req.Header.Set("User-Agent", "codexbar-display-update")
	resp, err := releaseHTTPClient.Do(req)
	if err != nil {
		return releaseFirmwareManifest{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return releaseFirmwareManifest{}, fmt.Errorf("GET %s returned %s body=%q", manifestURL, resp.Status, strings.TrimSpace(string(body)))
	}
	var manifest releaseFirmwareManifest
	if err := json.NewDecoder(io.LimitReader(resp.Body, 128*1024)).Decode(&manifest); err != nil {
		return releaseFirmwareManifest{}, err
	}
	return manifest, nil
}

func downloadManifestFirmwareArtifact(ctx context.Context, home string, manifest releaseFirmwareManifest, artifact releaseFirmwareArtifact) (string, error) {
	firmwareURL := strings.TrimSpace(artifact.FirmwareURL)
	if firmwareURL == "" && strings.HasPrefix(strings.TrimSpace(artifact.Asset), "http") {
		firmwareURL = strings.TrimSpace(artifact.Asset)
	}
	if firmwareURL == "" && strings.TrimSpace(manifest.Release) != "" && strings.TrimSpace(artifact.Asset) != "" {
		firmwareURL = githubReleaseAssetURL(defaultReleaseRepo, manifest.Release, artifact.Asset)
	}
	if firmwareURL == "" {
		return "", errors.New("manifest artifact has no firmwareUrl or downloadable asset")
	}

	version := normalizeReleaseVersion(artifact.FirmwareVersion)
	releaseDir := filepath.Join(
		home,
		"Library",
		"Application Support",
		"codexbar-display",
		"updates",
		"firmware",
		sanitizePathToken(version),
	)
	assetName := strings.TrimSpace(artifact.Asset)
	if assetName == "" {
		assetName = "firmware-" + sanitizePathToken(version) + ".bin"
	}
	imagePath := filepath.Join(releaseDir, filepath.Base(assetName))
	if err := downloadURLToFile(ctx, firmwareURL, imagePath, 0o644); err != nil {
		return "", err
	}

	actualSHA, err := sha256File(imagePath)
	if err != nil {
		return "", err
	}
	expectedSHA := strings.ToLower(strings.TrimSpace(artifact.SHA256))
	if expectedSHA == "" {
		return "", errors.New("manifest artifact has empty sha256")
	}
	if actualSHA != expectedSHA {
		return "", fmt.Errorf("sha256 mismatch for %s: expected %s actual %s", assetName, expectedSHA, actualSHA)
	}
	if strings.HasSuffix(strings.ToLower(imagePath), ".gz") {
		rawImagePath := strings.TrimSuffix(imagePath, filepath.Ext(imagePath))
		if err := gunzipFile(imagePath, rawImagePath, 0o644); err != nil {
			return "", fmt.Errorf("decompress firmware image: %w", err)
		}
		imagePath = rawImagePath
	}
	return imagePath, nil
}

func fetchJSON(ctx context.Context, endpoint string, target any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "codexbar-display-upgrade")

	resp, err := releaseHTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("GET %s returned %s", endpoint, resp.Status)
	}
	return json.NewDecoder(resp.Body).Decode(target)
}

func downloadURLToFile(ctx context.Context, endpoint, path string, mode os.FileMode) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "codexbar-display-upgrade")

	resp, err := releaseHTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("GET %s returned %s", endpoint, resp.Status)
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmpPath := fmt.Sprintf("%s.tmp-%d", path, time.Now().UnixNano())
	out, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}

	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tmpPath)
		}
	}()

	if _, err := io.Copy(out, resp.Body); err != nil {
		_ = out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpPath, mode); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return err
	}
	cleanup = false
	return nil
}

func gunzipFile(srcPath, dstPath string, mode os.FileMode) error {
	in, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer in.Close()

	gz, err := gzip.NewReader(in)
	if err != nil {
		return err
	}
	defer gz.Close()

	if err := os.MkdirAll(filepath.Dir(dstPath), 0o755); err != nil {
		return err
	}
	tmpPath := fmt.Sprintf("%s.tmp-%d", dstPath, time.Now().UnixNano())
	out, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}

	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tmpPath)
		}
	}()

	if _, err := io.Copy(out, gz); err != nil {
		_ = out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpPath, mode); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, dstPath); err != nil {
		return err
	}
	cleanup = false
	return nil
}

func sha256File(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()

	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func normalizeHTTPBaseURL(raw string) (string, error) {
	target := strings.TrimSpace(raw)
	if target == "" {
		return "", errors.New("target is required, for example http://192.168.1.42")
	}
	if !strings.Contains(target, "://") {
		target = "http://" + target
	}
	parsed, err := url.Parse(target)
	if err != nil {
		return "", err
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("unsupported target scheme %q", parsed.Scheme)
	}
	if strings.TrimSpace(parsed.Host) == "" {
		return "", errors.New("target host is required")
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

func fetchDeviceHelloHTTP(ctx context.Context, base string) (protocol.DeviceHello, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(base, "/")+"/hello", nil)
	if err != nil {
		return protocol.DeviceHello{}, err
	}
	req.Header.Set("User-Agent", "codexbar-display-update")
	resp, err := releaseHTTPClient.Do(req)
	if err != nil {
		return protocol.DeviceHello{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return protocol.DeviceHello{}, fmt.Errorf("GET /hello returned %s body=%q", resp.Status, strings.TrimSpace(string(body)))
	}
	var hello protocol.DeviceHello
	if err := json.NewDecoder(resp.Body).Decode(&hello); err != nil {
		return protocol.DeviceHello{}, err
	}
	return hello.Normalize(), nil
}

func uploadFirmwareOTA(ctx context.Context, base, imagePath, token string) error {
	if err := uploadFirmwareOTARaw(ctx, base, imagePath, token); err == nil {
		return nil
	} else if !rawFirmwareUploadUnavailable(err) {
		return err
	}
	return uploadFirmwareOTAMultipart(ctx, base, imagePath, token)
}

func uploadFirmwareOTAMultipart(ctx context.Context, base, imagePath, token string) error {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("firmware", filepath.Base(imagePath))
	if err != nil {
		return err
	}
	file, err := os.Open(imagePath)
	if err != nil {
		return err
	}
	if _, err := io.Copy(part, file); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}

	reqBody := newRateLimitedReader(bytes.NewReader(body.Bytes()), otaUploadBytesPerSecond)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(base, "/")+"/update/firmware", reqBody)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("User-Agent", "codexbar-display-update")
	applyFirmwareUpdateToken(req, token)
	req.ContentLength = int64(body.Len())
	resp, err := releaseHTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", errFirmwareUploadMayHaveWritten, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		err := fmt.Errorf("POST /update/firmware returned %s body=%q", resp.Status, strings.TrimSpace(string(body)))
		if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
			return err
		}
		return fmt.Errorf("%w: %v", errFirmwareUploadMayHaveWritten, err)
	}
	return nil
}

func recoverInterruptedFirmwareUpload(
	ctx context.Context,
	base string,
	targetVersion string,
	expectedDeviceID string,
	uploadErr error,
) error {
	if uploadErr == nil || !firmwareUploadConnectionInterrupted(uploadErr) {
		return uploadErr
	}
	if err := waitForHTTPFirmwareVersion(ctx, base, targetVersion, firmwareInterruptedVerifyTimeout); err == nil {
		return nil
	}
	hello, helloErr := fetchDeviceHelloHTTP(ctx, base)
	if helloErr != nil {
		return fmt.Errorf("%w; could not verify VibeTV after interrupted upload: %v", uploadErr, helloErr)
	}
	if expectedDeviceID = strings.TrimSpace(expectedDeviceID); expectedDeviceID != "" &&
		!strings.EqualFold(strings.TrimSpace(hello.DeviceID), expectedDeviceID) {
		return fmt.Errorf("%w; VibeTV identity changed after interrupted upload: expected=%q got=%q", uploadErr, expectedDeviceID, strings.TrimSpace(hello.DeviceID))
	}
	if normalizeReleaseVersion(hello.Firmware) == normalizeReleaseVersion(targetVersion) {
		return nil
	}

	// Firmware 1.0.36 does not reset the ESP8266 Update object after a partial
	// RAW upload. A second upload in the same boot can therefore fail with
	// "Update failed: No Error" or operate on stale updater state. Never switch
	// transports or retry automatically after bytes may have reached the device.
	return fmt.Errorf(
		"%w: interrupted upload left firmware %s installed on device %s: %v",
		errFirmwareUploadRestartRequired,
		strings.TrimSpace(hello.Firmware),
		strings.TrimSpace(hello.DeviceID),
		uploadErr,
	)
}

func firmwareUploadConnectionInterrupted(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, errFirmwareUploadMayHaveWritten) || errors.Is(err, io.EOF) {
		return true
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "use of closed network connection") ||
		strings.Contains(message, "connection reset by peer") ||
		strings.Contains(message, "broken pipe") ||
		strings.Contains(message, "unexpected eof") ||
		strings.Contains(message, "timed out waiting for vibetv to acknowledge firmware data") ||
		strings.Contains(message, "i/o timeout") ||
		strings.Contains(message, "operation timed out") ||
		strings.Contains(message, "update failed: no error")
}

func uploadFirmwareOTARaw(ctx context.Context, base, imagePath, token string) error {
	endpoint, err := rawFirmwareEndpoint(base)
	if err != nil {
		return err
	}
	file, err := os.Open(imagePath)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, file)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("User-Agent", "codexbar-display-update")
	applyFirmwareUpdateToken(req, token)
	req.ContentLength = info.Size()
	req.Close = true
	if strings.ContainsAny(strings.TrimSpace(token), "\r\n") {
		return errors.New("firmware update token contains an invalid newline")
	}

	parsedEndpoint, err := url.Parse(endpoint)
	if err != nil {
		return err
	}
	if parsedEndpoint.Scheme != "http" {
		return fmt.Errorf("raw firmware upload requires http, got %q", parsedEndpoint.Scheme)
	}
	address := parsedEndpoint.Host
	if _, _, err := net.SplitHostPort(address); err != nil {
		address = net.JoinHostPort(parsedEndpoint.Hostname(), "8081")
	}
	conn, err := firmwareRawDialContextFn(ctx, "tcp", address)
	if err != nil {
		return err
	}
	defer conn.Close()
	if tcpConn, ok := conn.(*net.TCPConn); ok {
		_ = tcpConn.SetNoDelay(true)
	}
	deadline := time.Now().Add(5 * time.Minute)
	if ctxDeadline, ok := ctx.Deadline(); ok && ctxDeadline.Before(deadline) {
		deadline = ctxDeadline
	}
	_ = conn.SetDeadline(deadline)

	waitForAck := func() error {
		return waitForFirmwareRawAck(ctx, conn, otaRawAckTimeout)
	}
	header := fmt.Sprintf(
		"POST %s HTTP/1.1\r\nHost: %s\r\nContent-Type: application/octet-stream\r\nContent-Length: %d\r\nUser-Agent: codexbar-display-update\r\nConnection: close\r\n",
		parsedEndpoint.RequestURI(),
		parsedEndpoint.Host,
		info.Size(),
	)
	if normalizedToken := strings.TrimSpace(token); normalizedToken != "" {
		header += "X-VibeTV-Token: " + normalizedToken + "\r\n"
	}
	header += "\r\n"
	if err := writeAll(conn, []byte(header)); err != nil {
		return err
	}
	if err := waitForAck(); err != nil {
		return fmt.Errorf("%w: %v", errFirmwareUploadMayHaveWritten, err)
	}
	time.Sleep(otaRawHeaderPause)
	bodyWriter := &rawFirmwareBodyWriter{destination: conn, waitForAck: waitForAck}
	if _, err := io.Copy(bodyWriter, file); err != nil {
		return fmt.Errorf("%w: %v", errFirmwareUploadMayHaveWritten, err)
	}
	if err := waitForAck(); err != nil {
		return fmt.Errorf("%w: %v", errFirmwareUploadMayHaveWritten, err)
	}
	resp, err := http.ReadResponse(bufio.NewReader(conn), req)
	if err != nil {
		return fmt.Errorf("%w: %v", errFirmwareUploadMayHaveWritten, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		err := fmt.Errorf("POST /update/firmware.raw returned %s body=%q", resp.Status, strings.TrimSpace(string(body)))
		if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
			return err
		}
		return fmt.Errorf("%w: %v", errFirmwareUploadMayHaveWritten, err)
	}
	return nil
}

// rawFirmwareBodyWriter deliberately writes the firmware body in tiny TCP
// writes. ESP8266 firmware 1.0.36 can stop draining its receive queue when a
// desktop sender fills the TCP window with normal multi-kilobyte writes. Small
// paced writes avoid exhausting that queue.
type rawFirmwareBodyWriter struct {
	destination   io.Writer
	waitForAck    func() error
	bytesSinceAck int
}

func (w *rawFirmwareBodyWriter) Write(p []byte) (int, error) {
	originalLength := len(p)
	for len(p) > 0 {
		chunkSize := otaRawWriteChunkBytes
		if len(p) < chunkSize {
			chunkSize = len(p)
		}
		if remainingInBlock := otaRawAckBlockBytes - w.bytesSinceAck; chunkSize > remainingInBlock {
			chunkSize = remainingInBlock
		}
		if err := writeAll(w.destination, p[:chunkSize]); err != nil {
			return originalLength - len(p), err
		}
		w.bytesSinceAck += chunkSize
		p = p[chunkSize:]
		time.Sleep(otaRawWritePause)
		if w.bytesSinceAck == otaRawAckBlockBytes {
			if w.waitForAck != nil {
				if err := w.waitForAck(); err != nil {
					return originalLength - len(p), err
				}
			}
			w.bytesSinceAck = 0
		}
	}
	return originalLength, nil
}

func writeAll(w io.Writer, p []byte) error {
	for len(p) > 0 {
		written, err := w.Write(p)
		if err != nil {
			return err
		}
		if written <= 0 {
			return io.ErrShortWrite
		}
		p = p[written:]
	}
	return nil
}

func applyFirmwareUpdateToken(req *http.Request, token string) {
	token = strings.TrimSpace(token)
	if token != "" {
		req.Header.Set("X-VibeTV-Token", token)
	}
}

func rawFirmwareEndpoint(base string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(base))
	if err != nil {
		return "", err
	}
	host := parsed.Hostname()
	if host == "" {
		return "", fmt.Errorf("target host is required")
	}
	parsed.Host = host + ":8081"
	parsed.Path = "/update/firmware.raw"
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

func rawFirmwareUploadUnavailable(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "connection refused") ||
		strings.Contains(msg, "no route to host") ||
		strings.Contains(msg, "404")
}

func waitForHTTPFirmwareVersion(ctx context.Context, base, version string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	var lastErr error
	for time.Now().Before(deadline) {
		if err := ctx.Err(); err != nil {
			return err
		}
		hello, err := fetchDeviceHelloHTTP(ctx, base)
		if err == nil && normalizeReleaseVersion(hello.Firmware) == normalizeReleaseVersion(version) {
			return nil
		}
		if err != nil {
			lastErr = err
		} else {
			lastErr = fmt.Errorf("device reported firmware %q, want %q", hello.Firmware, version)
		}
		sleep := firmwareHTTPVerifyPollInterval
		if sleep <= 0 {
			sleep = 2 * time.Second
		}
		if remaining := time.Until(deadline); remaining < sleep {
			sleep = remaining
		}
		if sleep > 0 {
			timer := time.NewTimer(sleep)
			select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
			}
		}
	}
	if lastErr != nil {
		return fmt.Errorf("timed out waiting for firmware %s: %w", version, lastErr)
	}
	return fmt.Errorf("timed out waiting for firmware %s", version)
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
	domain := fmt.Sprintf("gui/%d", os.Getuid())
	label := runtimepaths.DisplayStreamLaunchAgentLabel()
	service := domain + "/" + label
	if label != runtimepaths.LegacyDisplayStreamLaunchAgentLabel {
		// Bundled Control Center runtimes are registered through SMAppService (or
		// the preview app) and must remain registered. Suspend the writer process
		// while its child updater owns the VibeTV connection.
		_, _ = exec.Command("launchctl", "kill", "SIGSTOP", service).CombinedOutput()
		return
	}
	bootoutLaunchAgentBestEffort(domain, service, "")
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
	label := runtimepaths.DisplayStreamLaunchAgentLabel()
	if label != runtimepaths.LegacyDisplayStreamLaunchAgentLabel {
		domain := fmt.Sprintf("gui/%d", os.Getuid())
		service := domain + "/" + label
		resumeOut, resumeErr := exec.Command("launchctl", "kill", "SIGCONT", service).CombinedOutput()
		if resumeErr == nil {
			return nil
		}
		kickOut, kickErr := exec.Command("launchctl", "kickstart", "-k", service).CombinedOutput()
		if kickErr != nil {
			return fmt.Errorf("resume runtime: %w (%s); kickstart: %v (%s)", resumeErr, strings.TrimSpace(string(resumeOut)), kickErr, strings.TrimSpace(string(kickOut)))
		}
		return nil
	}

	plist := filepath.Join(home, "Library", "LaunchAgents", launchAgentLabel)
	if !fileExists(plist) {
		return nil
	}

	domain := fmt.Sprintf("gui/%d", os.Getuid())
	service := domain + "/" + strings.TrimSuffix(launchAgentLabel, ".plist")
	bootoutLaunchAgentBestEffort(domain, service, plist)
	_, _ = exec.Command("launchctl", "enable", service).CombinedOutput()

	if err := bootstrapLaunchAgentWithRetry(domain, service, plist, 3, 300*time.Millisecond); err != nil {
		return err
	}

	kickOut, kickErr := exec.Command("launchctl", "kickstart", "-k", service).CombinedOutput()
	if kickErr != nil {
		return fmt.Errorf("kickstart launchagent: %w (%s)", kickErr, strings.TrimSpace(string(kickOut)))
	}
	return nil
}

func bootstrapLaunchAgentWithRetry(domain, service, plist string, attempts int, delay time.Duration) error {
	if attempts <= 0 {
		attempts = 1
	}

	var lastOut []byte
	var lastErr error
	for attempt := 1; attempt <= attempts; attempt++ {
		out, err := exec.Command("launchctl", "bootstrap", domain, plist).CombinedOutput()
		if err == nil {
			return nil
		}
		lastOut = out
		lastErr = err

		if launchAgentLoaded(service) {
			return nil
		}

		if attempt < attempts {
			bootoutLaunchAgentBestEffort(domain, service, plist)
			time.Sleep(delay)
		}
	}

	return fmt.Errorf("bootstrap launchagent: %w (%s)", lastErr, strings.TrimSpace(string(lastOut)))
}

func launchAgentLoaded(service string) bool {
	return exec.Command("launchctl", "print", service).Run() == nil
}

func bootoutLaunchAgentBestEffort(domain, service, plist string) {
	_, _ = exec.Command("launchctl", "bootout", service).CombinedOutput()
	if strings.TrimSpace(plist) != "" {
		_, _ = exec.Command("launchctl", "bootout", domain, plist).CombinedOutput()
	}
}

func startLaunchAgent(home string) error {
	plist := filepath.Join(home, "Library", "LaunchAgents", launchAgentLabel)
	if !fileExists(plist) {
		return fmt.Errorf("launchagent plist not found: %s", plist)
	}
	return restartLaunchAgent(home)
}

func stopLaunchAgent(disable bool) error {
	domain := fmt.Sprintf("gui/%d", os.Getuid())
	service := domain + "/" + strings.TrimSuffix(launchAgentLabel, ".plist")

	bootoutOut, bootoutErr := exec.Command("launchctl", "bootout", service).CombinedOutput()
	if bootoutErr != nil {
		trimmed := strings.TrimSpace(string(bootoutOut))
		if trimmed != "" &&
			!strings.Contains(strings.ToLower(trimmed), "could not find service") &&
			!strings.Contains(strings.ToLower(trimmed), "service is disabled") {
			return fmt.Errorf("bootout launchagent: %w (%s)", bootoutErr, trimmed)
		}
	}
	if disable {
		disableOut, disableErr := exec.Command("launchctl", "disable", service).CombinedOutput()
		if disableErr != nil {
			trimmed := strings.TrimSpace(string(disableOut))
			if trimmed != "" && !strings.Contains(strings.ToLower(trimmed), "already disabled") {
				return fmt.Errorf("disable launchagent: %w (%s)", disableErr, trimmed)
			}
		}
	}
	return nil
}

type launchAgentStatus struct {
	Enabled bool
	State   string
	PID     string
}

func queryLaunchAgentStatus() (launchAgentStatus, error) {
	domain := fmt.Sprintf("gui/%d", os.Getuid())
	serviceName := strings.TrimSuffix(launchAgentLabel, ".plist")
	service := domain + "/" + serviceName

	status := launchAgentStatus{
		Enabled: true,
		State:   "not-loaded",
	}

	disabledOut, disabledErr := exec.Command("launchctl", "print-disabled", domain).CombinedOutput()
	if disabledErr == nil {
		if strings.Contains(string(disabledOut), fmt.Sprintf("\"%s\" => disabled", serviceName)) {
			status.Enabled = false
		}
	}

	printOut, printErr := exec.Command("launchctl", "print", service).CombinedOutput()
	trimmed := strings.TrimSpace(string(printOut))
	if printErr != nil {
		lower := strings.ToLower(trimmed)
		if strings.Contains(lower, "could not find service") || strings.Contains(lower, "not found") || trimmed == "" {
			return status, nil
		}
		return launchAgentStatus{}, fmt.Errorf("inspect launchagent: %w (%s)", printErr, trimmed)
	}

	state, pid := parseLaunchctlServiceStatus(trimmed)
	if state != "" {
		status.State = state
	}
	status.PID = pid
	return status, nil
}

func parseLaunchctlServiceStatus(output string) (state, pid string) {
	lines := strings.Split(output, "\n")
	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if strings.HasPrefix(line, "state =") {
			state = strings.TrimSpace(strings.TrimPrefix(line, "state ="))
		}
		if strings.HasPrefix(line, "pid =") {
			candidate := strings.TrimSpace(strings.TrimPrefix(line, "pid ="))
			if _, err := strconv.Atoi(candidate); err == nil {
				pid = candidate
			}
		}
	}
	return state, pid
}
