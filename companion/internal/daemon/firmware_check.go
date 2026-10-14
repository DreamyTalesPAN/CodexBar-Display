package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/versioning"
)

func attachFirmwareUpdateState(ctx context.Context, state *runtimeState, deps runtimeDeps, caps protocol.DeviceCapabilities, result *cycleResult) {
	if result == nil || strings.TrimSpace(caps.Board) == "" || strings.TrimSpace(caps.Firmware) == "" {
		return
	}

	now := deps.now()
	board := strings.TrimSpace(strings.ToLower(caps.Board))
	firmware := strings.TrimSpace(caps.Firmware)
	if state.hasFirmwareUpdate &&
		state.updateCheckedBoard == board &&
		state.updateCheckedFirmware == firmware &&
		now.Sub(state.updateCheckedAt) >= 0 &&
		now.Sub(state.updateCheckedAt) < firmwareUpdateCheckGap {
		update := state.firmwareUpdate
		result.frame.Update = &update
		return
	}

	update, err := deps.fetchUpdateState(ctx, caps)
	if err != nil {
		update = protocol.UpdateState{
			Available: false,
			Status:    "check_failed",
			LastError: truncateUpdateError(err.Error()),
		}
	}
	state.firmwareUpdate = update
	state.hasFirmwareUpdate = true
	state.updateCheckedAt = now
	state.updateCheckedBoard = board
	state.updateCheckedFirmware = firmware
	result.frame.Update = &update
}

func truncateUpdateError(raw string) string {
	const maxLen = 160
	value := strings.TrimSpace(raw)
	if len(value) <= maxLen {
		return value
	}
	return strings.TrimSpace(value[:maxLen]) + "..."
}

type firmwareManifest struct {
	Artifacts []firmwareArtifact `json:"artifacts"`
}

type firmwareArtifact struct {
	Board           string `json:"board"`
	FirmwareVersion string `json:"firmwareVersion"`
	Severity        string `json:"severity"`
	Message         string `json:"message"`
	FirmwareURL     string `json:"firmwareUrl"`
	FilesystemURL   string `json:"filesystemUrl"`
	SHA256          string `json:"sha256"`
}

func fetchFirmwareUpdateState(ctx context.Context, caps protocol.DeviceCapabilities) (protocol.UpdateState, error) {
	manifestURL := strings.TrimSpace(os.Getenv(firmwareManifestEnvVar))
	if manifestURL == "" {
		manifestURL = firmwareManifestURL
	}
	if manifestURL == "-" || strings.EqualFold(manifestURL, "off") || strings.EqualFold(manifestURL, "disabled") {
		return protocol.UpdateState{Available: false, Status: "disabled"}, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, manifestURL, nil)
	if err != nil {
		return protocol.UpdateState{}, fmt.Errorf("build firmware manifest request: %w", err)
	}
	client := http.Client{Timeout: firmwareManifestTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return protocol.UpdateState{}, fmt.Errorf("fetch firmware manifest: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
		return protocol.UpdateState{}, fmt.Errorf("fetch firmware manifest: status=%d body=%q", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var manifest firmwareManifest
	if err := json.NewDecoder(io.LimitReader(resp.Body, 128*1024)).Decode(&manifest); err != nil {
		return protocol.UpdateState{}, fmt.Errorf("decode firmware manifest: %w", err)
	}
	return selectFirmwareUpdate(caps, manifest)
}

func selectFirmwareUpdate(caps protocol.DeviceCapabilities, manifest firmwareManifest) (protocol.UpdateState, error) {
	current, err := versioning.ParseSemVer(caps.Firmware)
	if err != nil {
		return protocol.UpdateState{}, fmt.Errorf("parse current firmware version %q: %w", caps.Firmware, err)
	}

	board := strings.TrimSpace(strings.ToLower(caps.Board))
	var latest *versioning.SemVer
	var latestRaw string
	var latestArtifact firmwareArtifact
	for _, artifact := range manifest.Artifacts {
		if strings.TrimSpace(strings.ToLower(artifact.Board)) != board {
			continue
		}
		artifactVersion, err := versioning.ParseSemVer(artifact.FirmwareVersion)
		if err != nil {
			continue
		}
		if latest == nil || artifactVersion.Compare(*latest) > 0 {
			candidate := artifactVersion
			latest = &candidate
			latestRaw = strings.TrimSpace(artifact.FirmwareVersion)
			latestArtifact = artifact
		}
	}
	if latest == nil {
		return protocol.UpdateState{Available: false, Status: "no_board_release"}, nil
	}
	update := protocol.UpdateState{
		Available:     firmwareReleaseNewerThanCurrent(*latest, current),
		LatestVersion: latestRaw,
		Severity:      latestArtifact.Severity,
		Message:       latestArtifact.Message,
		FirmwareURL:   latestArtifact.FirmwareURL,
		FilesystemURL: latestArtifact.FilesystemURL,
		SHA256:        latestArtifact.SHA256,
	}
	if !update.Available {
		update.Status = "current"
		return update, nil
	}
	update.Status = "update_available"
	return update, nil
}

func firmwareReleaseNewerThanCurrent(latest, current versioning.SemVer) bool {
	return latest.Compare(current) > 0
}
