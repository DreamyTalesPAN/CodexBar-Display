package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/firmwareupdate"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/setup"
	transportlayer "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/transport"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/versioning"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/writerlock"
)

// otherRuntimeWriterAlive reports whether a local VibeTV runtime answers on
// its Companion API port. A reachable /v1/runtime-health means a runtime is
// running and polling the device; an unreachable endpoint means no runtime and
// the update proceeds silently.
//
// Measured on esp8266-smalltv-st7789 firmware 1.0.39 (2026-08-07): a correctly
// paced RAW OTA upload still failed 0/1 while the Mac App runtime kept polling
// port 80. Concurrent device traffic during the upload is fatal, so the direct
// CLI path must quiesce every writer before the first firmware byte.
func otherRuntimeWriterAlive() bool {
	origins := []string{firmwareUpdateRuntimeHealthOrigin}
	// A daemon started with --api-fallback (the native app does) can serve from
	// a fallback port when the default one is occupied; it publishes that origin
	// in the runtime endpoint file, so a writer there must block the OTA too.
	if home, err := os.UserHomeDir(); err == nil {
		if data, err := os.ReadFile(runtimeEndpointPath(home)); err == nil {
			var endpoint runtimeEndpoint
			if json.Unmarshal(data, &endpoint) == nil {
				if origin := strings.TrimSpace(endpoint.Origin); origin != "" && origin != firmwareUpdateRuntimeHealthOrigin {
					origins = append(origins, origin)
				}
			}
		}
	}
	client := &http.Client{Timeout: firmwareUpdateRuntimeHealthTimeout}
	for _, origin := range origins {
		resp, err := client.Get(strings.TrimRight(origin, "/") + "/v1/runtime-health")
		if err != nil {
			continue
		}
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
		_ = resp.Body.Close()
		if readErr != nil {
			return true
		}
		// The gate cares about device writers, not runtimes. A standalone
		// `codexbar-display api` server answers runtime-health without owning
		// a display stream and declares displayWriter=false; only an explicit
		// false is a non-writer — anything unparseable or older stays a
		// writer, conservatively.
		var health struct {
			DisplayWriter *bool `json:"displayWriter"`
		}
		if json.Unmarshal(body, &health) == nil && health.DisplayWriter != nil && !*health.DisplayWriter {
			continue
		}
		return true
	}
	return false
}

type firmwareUpdateEvent = firmwareupdate.Event

func emitFirmwareUpdateEvent(event firmwareUpdateEvent) {
	payload, err := json.Marshal(event)
	if err != nil {
		return
	}
	fmt.Printf("%s%s\n", firmwareupdate.EventPrefix, payload)
}

func runInstallUpdate(args []string) (retErr error) {
	fs := flag.NewFlagSet("install-update", flag.ContinueOnError)
	target := fs.String("target", setup.DefaultWiFiTarget(), "VibeTV URL, for example http://192.168.1.42")
	manifestURL := fs.String("manifest-url", vibeTVFirmwareManifestURL, "firmware manifest URL")
	force := fs.Bool("force", false, "install even when the device already reports the latest firmware")
	confirmLiveUpdate := fs.Bool("confirm-live-update", false, "allow installing from the default live firmware manifest (GitHub release)")
	skipLaunchAgentPause := fs.Bool("skip-launchagent-pause", false, "internal: keep the Mac App running while updating firmware")
	stoppedAllWriters := fs.Bool("i-stopped-all-writers", false, "update even though another VibeTV runtime is running (you stopped every device writer yourself)")
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
	// Concurrent device traffic during any firmware transfer is fatal. This
	// gate must run before the first WiFi or Cable device request.
	if !*stoppedAllWriters && os.Getenv(firmwareUpdateParentPausedEnvVar) != "1" && otherRuntimeWriterAlive() {
		return &commandError{
			Op:   "quiesce-device-writers",
			Code: errcode.UpgradeFlashFirmware,
			Err:  errors.New("another VibeTV runtime is running and polling the device; stop it first or pass --i-stopped-all-writers"),
			Hint: "quit the VibeTV Mac App (or stop the companion daemon), then retry; pass --i-stopped-all-writers only after every device writer is stopped",
		}
	}
	normalizedTarget := strings.TrimRight(strings.TrimSpace(*target), "/")
	rescueMode := strings.EqualFold(normalizedTarget, cableRescueTarget)
	cableMode := rescueMode || strings.EqualFold(normalizedTarget, "cable://vibetv")
	base := "cable://vibetv"
	var cablePort string
	var deviceToken string
	var hello protocol.DeviceHello
	var marker firmwareupdate.RescueMarker
	recovering := false
	if rescueMode {
		// Own the sole rescue marker before discovery or abandoned-marker
		// cleanup, through flashing, verification and final cleanup. A second
		// updater must fail before it can mistake this live attempt for a stale
		// one; locking individual marker writes/removes leaves that gap open.
		lock, err := writerlock.AcquireAt(firmwareupdate.RescueMarkerPath(home) + ".lock")
		if err != nil {
			return err
		}
		defer lock.Release()
		// Firmware from before the Cable identity contract has neither a
		// deviceId nor Cable transfer. The ROM loader rewrites it anyway.
		var device usb.CableDevice
		// The parent released the port a moment ago; a reset from that
		// handover can swallow the boot hello. Issue #536: on a Mac under
		// heavy load two probes both found nothing, so there are three, and
		// each one that fails is printed for firmware-update.log.
		const probes = 3
		for probe := 1; probe <= probes; probe++ {
			if device, err = findLegacyCableVibeTVFn(); err == nil {
				break
			}
			fmt.Printf("Cable rescue probe %d/%d failed: %v\n", probe, probes, err)
		}
		// Issue #818: a rescue write that failed after the erase leaves a
		// VibeTV that boot-loops and never says hello. Its marker is the proof
		// that the ROM loader on that port may be written again. It also wins
		// over another pre-Cable VibeTV that does answer: rescuing that one
		// first would overwrite and later clear the only record of this one.
		if resumed, ok := resumableRescueMarker(home); ok &&
			(err != nil || !strings.EqualFold(strings.TrimSpace(device.Port), strings.TrimSpace(resumed.Port))) {
			if err == nil {
				fmt.Printf("Cable rescue: the VibeTV on %s is left half-written; rescuing it before the one on %s\n", resumed.Port, device.Port)
			}
			marker, recovering, err = resumed, true, nil
			device = usb.CableDevice{Port: marker.Port, Hello: protocol.DeviceHello{Board: marker.Board, Firmware: marker.Firmware}}
		}
		if err != nil {
			return &commandError{Op: "cable-rescue-device", Code: errcode.UpgradeFlashFirmware, Err: err}
		}
		cablePort, hello = device.Port, device.Hello
	} else if cableMode {
		cfg, loadErr := runtimeconfig.Load(home)
		if loadErr != nil {
			return &commandError{Op: "load-cable-config", Code: errcode.UpgradeFlashFirmware, Err: loadErr}
		}
		if runtimeconfig.NormalizeConnectionMode(cfg.ConnectionMode) != "cable" ||
			strings.TrimSpace(cfg.DeviceID) == "" || strings.TrimSpace(cfg.DeviceToken) == "" {
			return &commandError{Op: "cable-preflight", Code: errcode.UpgradeFlashFirmware, Err: errors.New("paired Cable VibeTV is required")}
		}
		cablePort, err = resolveCableFirmwarePortFn("", cfg.DeviceID)
		if err == nil {
			hello, err = readCableFirmwareHelloFn(cablePort)
		}
		if err == nil && !strings.EqualFold(strings.TrimSpace(hello.DeviceID), strings.TrimSpace(cfg.DeviceID)) {
			err = fmt.Errorf("cable VibeTV identity changed from %s to %s", strings.TrimSpace(cfg.DeviceID), strings.TrimSpace(hello.DeviceID))
		}
		if err != nil {
			return &commandError{Op: "cable-device-hello", Code: errcode.UpgradeFlashFirmware, Err: err}
		}
		deviceToken = strings.TrimSpace(cfg.DeviceToken)
	} else {
		base, err = normalizeHTTPBaseURL(*target)
		if err != nil {
			return &commandError{Op: "resolve-target", Code: errcode.UpgradeFlashFirmware, Err: err}
		}
		hello, err = fetchDeviceHelloHTTP(ctx, base)
		if err != nil {
			return &commandError{
				Op:   "device-hello",
				Code: errcode.UpgradeFlashFirmware,
				Err:  err,
				Hint: "open http://<device-ip>/health or pass --target http://<device-ip>",
			}
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

	var targetVersion, imagePath string
	var artifact releaseFirmwareArtifact
	if recovering {
		// The image was checked when it was downloaded for the write that
		// failed; resuming does not need the network.
		targetVersion, imagePath = marker.TargetFirmware, marker.ImagePath
		fmt.Printf("Resuming firmware write: %s\n", targetVersion)
	} else {
		fmt.Println("Checking firmware...")
		manifest, err := fetchReleaseFirmwareManifestURL(ctx, strings.TrimSpace(*manifestURL))
		if err != nil {
			return &commandError{Op: "fetch-firmware-manifest", Code: errcode.UpgradeFlashFirmware, Err: err}
		}
		artifact, err = selectLatestFirmwareArtifactForBoard(manifest, caps.Board)
		if err != nil {
			return &commandError{Op: "select-firmware", Code: errcode.UpgradeVersionGuard, Err: err}
		}
		targetVersion = normalizeReleaseVersion(artifact.FirmwareVersion)

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
				ObservedFirmware:  caps.Firmware,
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

		imagePath, err = downloadManifestFirmwareArtifact(ctx, home, manifest, artifact)
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

	if !cableMode {
		deviceToken, err = ensureFirmwareUpdateDeviceToken(ctx, home, base, deviceID)
		if err != nil {
			return &commandError{
				Op:   "device-auth-preflight",
				Code: errcode.UpgradeFlashFirmware,
				Err:  err,
				Hint: "keep VibeTV powered and on the same WiFi, then retry",
			}
		}
	}

	if !*skipLaunchAgentPause {
		fmt.Println("Pausing Mac App during firmware update...")
		cleanupLaunchAgent := beginUpgradeLaunchAgentRecovery(home, &retErr)
		defer cleanupLaunchAgent()
	}

	fmt.Println("Uploading firmware...")
	var uploadErr error
	uploadInterrupted := false
	if rescueMode {
		var image []byte
		image, uploadErr = os.ReadFile(imagePath)
		if uploadErr == nil {
			marker.Port, marker.TargetFirmware, marker.ImagePath = cablePort, targetVersion, imagePath
			if !recovering {
				marker.Board, marker.Firmware = caps.Board, caps.Firmware
				// From the bytes that will be written: a second read could fail
				// and leave a marker no resume can ever match.
				sum := sha256.Sum256(image)
				marker.ImageSHA256 = hex.EncodeToString(sum[:])
			} else if !rescueImageMatchesMarker(image, marker) {
				// The cached image was checked when the marker was picked, but
				// it can change before this read. Only the bytes the marker
				// names may be written; the marker stays for the next attempt
				// (Codex review on #819).
				uploadErr = fmt.Errorf("the cached firmware image changed since the failed write; nothing was written")
			}
			if uploadErr == nil {
				uploadErr = flashCableRescueWithRetry(ctx, home, marker, image, recovering)
			}
		}
	} else if cableMode {
		// The release's gzip image is about 30% smaller, and the ESP8266
		// updater stores it as is and unpacks it on the next boot, so it goes
		// over the Cable unchanged. Only when this run downloaded and checked
		// the .gz: the version folder can still hold one from an earlier
		// manifest. The unpacked image stays for the rescue path and WiFi.
		cableImagePath := imagePath
		if strings.HasSuffix(strings.ToLower(strings.TrimSpace(artifact.Asset)), ".gz") {
			cableImagePath += ".gz"
		}
		var image []byte
		image, uploadErr = os.ReadFile(cableImagePath)
		if uploadErr == nil {
			// The same line the rescue path prints, which the Companion already
			// turns into the percentage the setup log and Updates screen show.
			lastPercent := -1
			uploadErr = transferCableFirmwareFn(ctx, cablePort, deviceID, deviceToken, image, usb.TransferOptions{
				Fast: hello.HasFeature(protocol.FeatureCableTransferV2),
				Progress: func(sent, total int) {
					if percent := sent * 100 / total; percent != lastPercent {
						lastPercent = percent
						fmt.Printf("Writing firmware: %d%%\n", percent)
					}
				},
			})
		}
		uploadInterrupted = errors.Is(uploadErr, usb.ErrCableTransferInterrupted)
	} else {
		uploadErr = uploadFirmwareOTAFn(ctx, base, imagePath, deviceToken, caps.Firmware)
		uploadInterrupted = firmwareUploadConnectionInterrupted(uploadErr)
		uploadErr = recoverInterruptedFirmwareUpload(
			ctx,
			base,
			targetVersion,
			deviceID,
			uploadErr,
		)
	}
	if uploadErr != nil {
		if uploadInterrupted && !cableMode {
			restoreStoredThemeAfterAbortedUpload(ctx, base, deviceToken)
		}
		hint := "keep VibeTV powered and on the same WiFi, then retry"
		if cableMode {
			hint = "reconnect VibeTV with a data-capable Cable, wait for it to start, then retry once"
			if _, halfWritten := firmwareupdate.LoadRescueMarker(home, time.Now()); rescueMode && halfWritten {
				hint = "VibeTV was left half-written; keep it connected by Cable and update again, the next attempt rescues it automatically"
			}
			if uploadInterrupted {
				emitFirmwareUpdateEvent(firmwareUpdateEvent{
					Stage:       "uploading",
					Phase:       "attention",
					Outcome:     "interrupted",
					RetryPolicy: "reconnect_cable",
					Firmware:    targetVersion,
					Target:      base,
					DeviceID:    deviceID,
				})
			}
		}
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
		if errors.Is(uploadErr, errFirmwareUpdateCableOnly) {
			hint = "connect VibeTV to this Mac with the USB cable, switch to USB-C in Settings, then update again"
			emitFirmwareUpdateEvent(firmwareUpdateEvent{
				Stage:       "uploading",
				RetryPolicy: "cable_required",
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

	verifiedBase := base
	var verifiedHello protocol.DeviceHello
	var helloErr error
	if cableMode {
		// A rescued VibeTV has no identity to resolve by yet. Its own port is
		// the only proof, or another connected VibeTV could answer for it.
		rescuedPort := ""
		if rescueMode {
			rescuedPort = cablePort
		}
		verifiedHello, helloErr = waitForCableFirmwareVersion(ctx, targetVersion, deviceID, rescuedPort, cableFirmwareVerifyTimeout)
	} else {
		verifiedBase, err = waitForHTTPFirmwareVersionWithDiscovery(ctx, home, base, targetVersion, deviceID, 120*time.Second)
		if err == nil {
			verifiedHello, helloErr = fetchDeviceHelloHTTP(ctx, verifiedBase)
		} else {
			helloErr = err
		}
	}
	if helloErr != nil {
		if cableMode {
			emitFirmwareUpdateEvent(firmwareUpdateEvent{
				Stage:             "rebooting",
				Phase:             "attention",
				RetryPolicy:       "power_cycle",
				Firmware:          targetVersion,
				Target:            base,
				DeviceID:          deviceID,
				ArtifactValidated: true,
				UploadAccepted:    true,
				HelloVerified:     true,
			})
		}
		return &commandError{
			Op:   "post-update-verify",
			Code: errcode.UpgradeFlashFirmware,
			Err:  helloErr,
			Hint: "wait one minute, then reconnect VibeTV",
		}
	}
	if rescueMode {
		// The rescued firmware is the first to report the device identity.
		deviceID = strings.TrimSpace(verifiedHello.DeviceID)
	}
	if !strings.EqualFold(strings.TrimSpace(verifiedHello.DeviceID), deviceID) {
		return &commandError{
			Op:   "post-update-device-identity",
			Code: errcode.UpgradeFlashFirmware,
			Err:  fmt.Errorf("updated VibeTV identity changed: expected=%q got=%q", deviceID, strings.TrimSpace(verifiedHello.DeviceID)),
			Hint: "do not retry the flash; verify the saved VibeTV device identity",
		}
	}
	if rescueMode {
		// Verified on the rescued port: nothing is left half-written.
		if err := firmwareupdate.ClearRescueMarker(home); err != nil {
			fmt.Printf("warning: firmware updated, but clearing the rescue marker failed: %v\n", err)
		}
	}
	emitFirmwareUpdateEvent(firmwareUpdateEvent{
		Stage:             "verifying_health",
		Phase:             "installing",
		Firmware:          targetVersion,
		ObservedFirmware:  targetVersion,
		Target:            verifiedBase,
		DeviceID:          deviceID,
		ArtifactValidated: true,
		UploadAccepted:    true,
		HelloVerified:     true,
	})
	if !cableMode && verifiedBase != base {
		base = verifiedBase
		if _, err := ensureFirmwareUpdateDeviceToken(ctx, home, base, deviceID); err != nil {
			fmt.Printf("warning: firmware updated, but saving the rediscovered VibeTV address failed: %v\n", err)
		}
	}
	fmt.Printf("Done: firmware %s installed\n", targetVersion)
	return nil
}

func waitForCableFirmwareVersion(
	ctx context.Context,
	targetVersion,
	deviceID,
	port string,
	timeout time.Duration,
) (protocol.DeviceHello, error) {
	deadline := time.Now().Add(timeout)
	var lastErr error
	for time.Now().Before(deadline) {
		if err := ctx.Err(); err != nil {
			return protocol.DeviceHello{}, err
		}
		resolved, err := port, error(nil)
		if resolved == "" {
			resolved, err = resolveCableFirmwarePortFn("", deviceID)
		}
		if err == nil {
			var hello protocol.DeviceHello
			hello, err = readCableFirmwareHelloFn(resolved)
			if err == nil {
				if strings.TrimSpace(hello.DeviceID) == "" {
					err = errors.New("cable VibeTV has not reported its identity yet")
				} else if strings.TrimSpace(deviceID) != "" && !strings.EqualFold(strings.TrimSpace(hello.DeviceID), strings.TrimSpace(deviceID)) {
					err = fmt.Errorf("cable VibeTV identity changed from %s to %s", strings.TrimSpace(deviceID), strings.TrimSpace(hello.DeviceID))
				} else if normalizeReleaseVersion(hello.Firmware) == normalizeReleaseVersion(targetVersion) {
					return hello, nil
				} else {
					err = fmt.Errorf("cable VibeTV still reports firmware %s", strings.TrimSpace(hello.Firmware))
				}
			}
		}
		lastErr = err
		select {
		case <-ctx.Done():
			return protocol.DeviceHello{}, ctx.Err()
		case <-time.After(cableFirmwareVerifyPollInterval):
		}
	}
	return protocol.DeviceHello{}, fmt.Errorf("cable VibeTV did not report firmware %s: %v", targetVersion, lastErr)
}

func ensureFirmwareUpdateDeviceToken(ctx context.Context, home, base, expectedDeviceID string) (string, error) {
	base = strings.TrimSpace(base)
	expectedDeviceID = strings.TrimSpace(expectedDeviceID)
	if expectedDeviceID == "" {
		return "", errors.New("VibeTV /hello response did not include deviceId")
	}

	cfg, err := runtimeconfig.Load(home)
	if err != nil {
		return "", err
	}

	token := ""
	if known, ok := cfg.KnownDevice(expectedDeviceID); ok {
		token = strings.TrimSpace(known.DeviceToken)
	}
	if token == "" {
		token = strings.TrimSpace(cfg.DeviceToken)
	}
	paired := false
	if token == "" {
		token, err = pairFirmwareUpdateDevice(ctx, base)
		if err != nil {
			return "", err
		}
		paired = true
	}

	authenticatedHello, err := fetchDeviceHelloHTTPWithTokenRetry(ctx, base, token)
	if err != nil && firmwareOTAAuthError(err) && !paired {
		token, err = pairFirmwareUpdateDevice(ctx, base)
		if err != nil {
			return "", fmt.Errorf("repair VibeTV pairing: %w", err)
		}
		authenticatedHello, err = fetchDeviceHelloHTTPWithTokenRetry(ctx, base, token)
	}
	if err != nil {
		return "", fmt.Errorf("authenticate VibeTV /hello: %w", err)
	}
	actualDeviceID := strings.TrimSpace(authenticatedHello.DeviceID)
	if !strings.EqualFold(actualDeviceID, expectedDeviceID) {
		return "", fmt.Errorf(
			"authenticated VibeTV identity changed before OTA: expected=%q got=%q",
			expectedDeviceID,
			actualDeviceID,
		)
	}

	cfg.SetActiveDevice(runtimeconfig.KnownDevice{
		DeviceID:    expectedDeviceID,
		Target:      base,
		DeviceToken: token,
	})
	if err := runtimeconfig.Save(home, cfg); err != nil {
		return "", err
	}
	return token, nil
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
	emitFirmwareUpdateEvent(firmwareUpdateEvent{
		Stage:             "rediscovering",
		Phase:             "installing",
		Firmware:          version,
		Target:            base,
		DeviceID:          deviceID,
		ArtifactValidated: true,
		UploadAccepted:    true,
		HelloVerified:     true,
	})

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
	expectedDeviceID := strings.TrimSpace(deviceID)
	discoveredDeviceID := strings.TrimSpace(result.Hello.DeviceID)
	if expectedDeviceID != "" && discoveredDeviceID != "" && !strings.EqualFold(discoveredDeviceID, expectedDeviceID) {
		return "", fmt.Errorf("rediscovered deviceId %q does not match original deviceId %q", discoveredDeviceID, expectedDeviceID)
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
	// Do not leave a pooled keep-alive socket on the device between pairing
	// and the authenticated preflight.
	req.Close = true
	resp, err := releaseHTTPClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		// Current firmware pairs only over the USB cable (#489).
		return "", errors.New("VibeTV pairs only over the USB cable: connect it to this Mac, press Connect in the Mac App, then run the update again")
	}
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

func waitForHTTPFirmwareVersion(ctx context.Context, base, version string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	var lastErr error
	for time.Now().Before(deadline) {
		if err := ctx.Err(); err != nil {
			return err
		}
		// A reboot can black-hole TCP instead of refusing it. Bound every probe
		// so the shorter verification/rediscovery deadlines remain effective
		// even though the shared release client has a five-minute timeout.
		probeTimeout := firmwareHTTPVerifyProbeTimeout
		if remaining := time.Until(deadline); probeTimeout <= 0 || remaining < probeTimeout {
			probeTimeout = remaining
		}
		probeCtx, cancelProbe := context.WithTimeout(ctx, probeTimeout)
		hello, err := fetchDeviceHelloHTTP(probeCtx, base)
		cancelProbe()
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
