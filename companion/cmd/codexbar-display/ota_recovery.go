package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

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

// restoreStoredThemeAfterAbortedUpload repairs the theme state an aborted OTA
// upload leaves behind. Measured on esp8266-smalltv-st7789 firmware 1.0.39
// (2026-08-07): the device reboots after an aborted upload and comes back with
// the stored theme spec path intact but themeSpec.active=false
// ("theme-missing"), and does not heal itself (seven-minute isolated
// observation). The repair is best-effort: one authenticated
// header-token-only POST /theme/active, no retry, and never a second firmware
// upload. The caller still returns the original update error.
func restoreStoredThemeAfterAbortedUpload(ctx context.Context, base, token string) {
	deadline := time.Now().Add(themeRestoreHelloTimeout)
	reachable := false
	for time.Now().Before(deadline) {
		probeCtx, cancelProbe := context.WithTimeout(ctx, firmwareHTTPVerifyProbeTimeout)
		_, err := fetchDeviceHelloHTTP(probeCtx, base)
		cancelProbe()
		if err == nil {
			reachable = true
			break
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(themeRestorePollInterval):
		}
	}
	if !reachable {
		fmt.Printf("warning: could not check stored theme after aborted upload: VibeTV did not return within %s\n", themeRestoreHelloTimeout)
		return
	}

	// The device may still be on the pre-abort boot here, with the stored theme
	// looking perfectly active; it only goes missing on the reboot the aborted
	// upload triggers. Measured on hardware 2026-08-07: a single check right
	// after the failure sees active=true, returns, and the customer is left on
	// "theme-missing" for good. So watch until the theme is seen missing, or
	// until the device has come back from a reboot with the theme intact.
	path, active, err := watchStoredThemeAfterAbortedUpload(ctx, base)
	if err != nil {
		fmt.Printf("warning: could not read VibeTV health after aborted upload: %v\n", err)
		return
	}
	if path == "" || active {
		return
	}
	if err := activateStoredThemeHTTP(ctx, base, token, path); err != nil {
		fmt.Printf("warning: could not restore stored theme after aborted upload: %v\n", err)
		return
	}
	_, active, err = fetchDeviceThemeSpecHealth(ctx, base)
	if err == nil && active {
		fmt.Println("restored stored theme after aborted upload")
		return
	}
	fmt.Printf("warning: stored theme activation did not take effect after aborted upload (path=%s, err=%v)\n", path, err)
}

// watchStoredThemeAfterAbortedUpload samples device health until the stored
// theme is seen inactive, until the device has rebooted and still reports it
// active, or until the watch window expires. It returns the last reading.
func watchStoredThemeAfterAbortedUpload(ctx context.Context, base string) (string, bool, error) {
	deadline := time.Now().Add(themeRestoreRebootWatch)
	firstBootID, _, _, err := fetchDeviceThemeSpecHealthWithBoot(ctx, base)
	if err != nil {
		return "", false, err
	}
	for {
		bootID, path, active, err := fetchDeviceThemeSpecHealthWithBoot(ctx, base)
		if err == nil {
			if path != "" && !active {
				return path, active, nil
			}
			// A completed reboot that still shows the theme active means the
			// device survived the abort; there is nothing to restore.
			if bootID != "" && firstBootID != "" && bootID != firstBootID {
				return path, active, nil
			}
		}
		if time.Now().After(deadline) {
			return path, active, err
		}
		select {
		case <-ctx.Done():
			return path, active, ctx.Err()
		case <-time.After(themeRestorePollInterval):
		}
	}
}

func fetchDeviceThemeSpecHealthWithBoot(ctx context.Context, base string) (bootID, path string, active bool, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(base, "/")+"/health", nil)
	if err != nil {
		return "", "", false, err
	}
	resp, err := releaseHTTPClient.Do(req)
	if err != nil {
		return "", "", false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", "", false, fmt.Errorf("GET /health returned %d", resp.StatusCode)
	}
	var payload struct {
		System struct {
			BootID string `json:"bootId"`
		} `json:"system"`
		Display struct {
			ThemeSpec struct {
				Active bool   `json:"active"`
				Path   string `json:"path"`
			} `json:"themeSpec"`
		} `json:"display"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64*1024)).Decode(&payload); err != nil {
		return "", "", false, err
	}
	return strings.TrimSpace(payload.System.BootID),
		strings.TrimSpace(payload.Display.ThemeSpec.Path),
		payload.Display.ThemeSpec.Active,
		nil
}

func fetchDeviceThemeSpecHealth(ctx context.Context, base string) (path string, active bool, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(base, "/")+"/health", nil)
	if err != nil {
		return "", false, err
	}
	req.Header.Set("User-Agent", "codexbar-display-update")
	req.Close = true
	resp, err := releaseHTTPClient.Do(req)
	if err != nil {
		return "", false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return "", false, fmt.Errorf("GET /health returned %s body=%q", resp.Status, strings.TrimSpace(string(body)))
	}
	var payload struct {
		Display struct {
			ThemeSpec struct {
				Active bool   `json:"active"`
				Path   string `json:"path"`
			} `json:"themeSpec"`
		} `json:"display"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64*1024)).Decode(&payload); err != nil {
		return "", false, err
	}
	return strings.TrimSpace(payload.Display.ThemeSpec.Path), payload.Display.ThemeSpec.Active, nil
}

// activateStoredThemeHTTP sends the token in the header only. Header plus
// query at the same time makes the device close the connection without a
// response; see docs/hardware-contract.md.
func activateStoredThemeHTTP(ctx context.Context, base, token, path string) error {
	payload, err := json.Marshal(struct {
		Path string `json:"path"`
	}{Path: path})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(base, "/")+"/theme/active", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "codexbar-display-update")
	applyFirmwareUpdateToken(req, token)
	req.Close = true
	resp, err := releaseHTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("POST /theme/active returned %s body=%q", resp.Status, strings.TrimSpace(string(body)))
	}
	return nil
}
