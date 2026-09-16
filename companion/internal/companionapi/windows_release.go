package companionapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Same static feed as the native Windows updater. A Mac release tag alone
// must never advertise a Windows update or block its firmware behind one.
const windowsAppReleaseURL = "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/latest-windows.json"

func fetchWindowsAppReleaseInfo(ctx context.Context, endpoint, installed string) companionReleaseInfo {
	info := companionReleaseInfo{CheckedAt: time.Now().UTC().Format(time.RFC3339), Status: "check_failed", InstalledVersion: installed, Message: "Windows App update check failed."}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return info
	}
	client := http.Client{Timeout: macAppReleaseTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return info
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		info.Status, info.Message = "missing_asset", "No published Windows update is available yet."
		return info
	}
	if resp.StatusCode != http.StatusOK {
		return info
	}
	var manifest struct {
		Version   string `json:"version"`
		Platforms map[string]struct {
			URL       string `json:"url"`
			Signature string `json:"signature"`
		} `json:"platforms"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&manifest) != nil {
		return info
	}
	latest := normalizeMacAppReleaseVersion(manifest.Version)
	if latest == "" {
		return info
	}
	asset := manifest.Platforms["windows-x86_64"]
	download, err := url.Parse(asset.URL)
	if err != nil || download.Scheme != "https" || download.Host == "" || strings.TrimSpace(asset.Signature) == "" {
		info.Status, info.Message = "missing_asset", "This release has no signed Windows installer."
		return info
	}
	info.Status, info.LatestVersion, info.Release = "available", latest, manifest.Version
	info.UpdateAvailable = installed != "" && compareMacAppReleaseVersions(latest, installed) > 0
	info.Message = "Windows App is up to date."
	if info.UpdateAvailable {
		info.Message = "Windows App update is available."
	}
	return info
}
