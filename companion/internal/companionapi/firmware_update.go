package companionapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	transportlayer "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/transport"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/firmwareupdate"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themeinstall"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/timeline"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/versioning"
)

type firmwareUpdateRequest struct {
	Force bool `json:"force,omitempty"`
	// Rescue flashes a VibeTV whose firmware predates the Cable identity
	// contract through its ROM loader, so it never needs WiFi first.
	Rescue bool `json:"rescue,omitempty"`
}

type firmwareLatestResponse struct {
	CheckedAt         string `json:"checkedAt"`
	InstalledFirmware string `json:"installedFirmware,omitempty"`
	LatestFirmware    string `json:"latestFirmware,omitempty"`
	Release           string `json:"release,omitempty"`
	UpdateAvailable   bool   `json:"updateAvailable"`
	Status            string `json:"status"`
	Message           string `json:"message,omitempty"`
}

type firmwareReleaseManifest struct {
	Release   string                    `json:"release"`
	Artifacts []firmwareReleaseArtifact `json:"artifacts"`
}

type firmwareReleaseArtifact struct {
	Board           string `json:"board"`
	FirmwareVersion string `json:"firmwareVersion"`
	Severity        string `json:"severity"`
	Message         string `json:"message"`
}

type firmwareUpdateResult struct {
	Firmware          string `json:"firmware,omitempty"`
	ObservedFirmware  string `json:"observedFirmware,omitempty"`
	Target            string `json:"target,omitempty"`
	DeviceID          string `json:"deviceId,omitempty"`
	ArtifactValidated bool   `json:"artifactValidated"`
	UploadAccepted    bool   `json:"uploadAccepted"`
	HelloVerified     bool   `json:"helloVerified"`
	HealthVerified    bool   `json:"healthVerified"`
	StreamVerified    bool   `json:"streamVerified"`
	RenderVerified    bool   `json:"renderVerified"`
	// RenderSkipped names the reason the picture could not be proven because
	// there is no picture to prove, not because the update went wrong. It stays
	// empty whenever RenderVerified is true.
	RenderSkipped string `json:"renderSkipped,omitempty"`
}

type firmwareUpdateJob struct {
	ID          string                `json:"id"`
	Phase       string                `json:"phase"`
	Stage       string                `json:"stage"`
	Outcome     string                `json:"outcome,omitempty"`
	RetryPolicy string                `json:"retryPolicy,omitempty"`
	Message     string                `json:"message"`
	Progress    int                   `json:"progress"`
	StartedAt   time.Time             `json:"startedAt"`
	FinishedAt  *time.Time            `json:"finishedAt,omitempty"`
	Logs        []string              `json:"logs,omitempty"`
	Result      *firmwareUpdateResult `json:"result,omitempty"`
	Warnings    []string              `json:"warnings,omitempty"`
	Error       *apiError             `json:"error,omitempty"`

	themeSetupRequiredBeforeUpdate bool
	themePathBeforeUpdate          string
	themeActiveBeforeUpdate        bool
}

type firmwareUpdateJobResponse struct {
	OK  bool              `json:"ok"`
	Job firmwareUpdateJob `json:"job"`
}

func (s *Server) handleFirmwareLatest(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	board := strings.TrimSpace(r.URL.Query().Get("board"))
	installedFirmware := strings.TrimSpace(r.URL.Query().Get("firmware"))
	checkedAt := time.Now().UTC().Format(time.RFC3339)
	// A VibeTV left half-written by a failed Cable rescue is finished from the
	// image cached for that write, not from the manifest: setup must name the
	// version that will really be written (Codex review on #819). Only for the
	// rescue itself (rescue=1), and before the configured-Cable lookup below,
	// which describes another VibeTV.
	if r.URL.Query().Get("rescue") == "1" {
		if target, ok := s.cachedRescueTarget(board, installedFirmware); ok {
			writeJSON(w, http.StatusOK, firmwareLatestResponse{
				CheckedAt:         checkedAt,
				InstalledFirmware: installedFirmware,
				LatestFirmware:    target,
				UpdateAvailable:   true,
				Status:            "update_available",
				Message:           "Firmware update available.",
			})
			return
		}
	}
	// A rescue check names the selected VibeTV by its own board and firmware;
	// the configured Cable VibeTV is another one (Codex review on #819).
	if cfg, err := s.config(); err == nil && r.URL.Query().Get("rescue") != "1" &&
		runtimeconfig.NormalizeConnectionMode(cfg.ConnectionMode) == "cable" {
		hello, ok := s.currentCableHello()
		verified := ok && cableHelloMatchesConfig(hello, cfg.DeviceID)
		if !verified {
			s.firmwareUpdateStartMu.Lock()
			if _, updateInProgress := s.activeFirmwareUpdateJob(); !updateInProgress {
				_, hello, err = s.cableControlDevice(cfg)
				verified = err == nil
			}
			s.firmwareUpdateStartMu.Unlock()
		}
		if !verified {
			board = ""
		} else {
			board = strings.TrimSpace(hello.Board)
			installedFirmware = strings.TrimSpace(hello.Firmware)
		}
		if verified && !hello.HasFeature(protocol.FeatureCableTransferV1) {
			writeJSON(w, http.StatusOK, firmwareLatestResponse{
				CheckedAt:         checkedAt,
				InstalledFirmware: installedFirmware,
				UpdateAvailable:   false,
				Status:            "unsupported",
				Message:           "Firmware updates are not supported for this VibeTV over Cable.",
			})
			return
		}
	}
	if board == "" || installedFirmware == "" {
		writeJSON(w, http.StatusOK, firmwareLatestResponse{
			CheckedAt:         checkedAt,
			InstalledFirmware: installedFirmware,
			UpdateAvailable:   false,
			Status:            "missing_device_info",
			Message:           "VibeTV update info is not available yet.",
		})
		return
	}

	installedVersion, installedErr := versioning.ParseSemVer(installedFirmware)
	if installedErr != nil {
		writeJSON(w, http.StatusOK, firmwareLatestResponse{
			CheckedAt:         checkedAt,
			InstalledFirmware: installedFirmware,
			UpdateAvailable:   false,
			Status:            "check_failed",
			Message:           fmt.Sprintf("Installed firmware version %q is not a valid version.", installedFirmware),
		})
		return
	}

	manifest, err := s.fetchFirmwareReleaseManifest(r.Context())
	if err != nil {
		writeJSON(w, http.StatusOK, firmwareLatestResponse{
			CheckedAt:         checkedAt,
			InstalledFirmware: installedFirmware,
			UpdateAvailable:   false,
			Status:            "check_failed",
			Message:           "Firmware check failed.",
		})
		return
	}
	artifact, latestVersion, hasArtifact := latestFirmwareArtifactForBoard(manifest, board)
	if !hasArtifact {
		writeJSON(w, http.StatusOK, firmwareLatestResponse{
			CheckedAt:         checkedAt,
			InstalledFirmware: installedFirmware,
			Release:           manifest.Release,
			UpdateAvailable:   false,
			Status:            "no_board_release",
			Message:           "No update is available for this VibeTV.",
		})
		return
	}

	updateAvailable := latestVersion.Compare(installedVersion) > 0
	message := "Firmware is up to date."
	status := "current"
	if updateAvailable {
		status = "update_available"
		message = strings.TrimSpace(artifact.Message)
		if message == "" {
			message = "Firmware update available."
		}
	}
	writeJSON(w, http.StatusOK, firmwareLatestResponse{
		CheckedAt:         checkedAt,
		InstalledFirmware: installedFirmware,
		LatestFirmware:    strings.TrimSpace(artifact.FirmwareVersion),
		Release:           manifest.Release,
		UpdateAvailable:   updateAvailable,
		Status:            status,
		Message:           message,
	})
}

func (s *Server) fetchFirmwareReleaseManifest(ctx context.Context) (firmwareReleaseManifest, error) {
	manifestURL := strings.TrimSpace(os.Getenv(firmwareManifestEnvVar))
	if manifestURL == "" {
		manifestURL = themeinstall.DefaultFirmwareManifestURL
	}
	ctx, cancel := context.WithTimeout(ctx, firmwareReleaseTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, manifestURL, nil)
	if err != nil {
		return firmwareReleaseManifest{}, err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return firmwareReleaseManifest{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return firmwareReleaseManifest{}, fmt.Errorf("firmware manifest status %d", resp.StatusCode)
	}
	var manifest firmwareReleaseManifest
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&manifest); err != nil {
		return firmwareReleaseManifest{}, err
	}
	return manifest, nil
}

func latestFirmwareArtifactForBoard(manifest firmwareReleaseManifest, board string) (firmwareReleaseArtifact, versioning.SemVer, bool) {
	normalizedBoard := strings.ToLower(strings.TrimSpace(board))
	var latest firmwareReleaseArtifact
	var latestVersion versioning.SemVer
	found := false
	for _, artifact := range manifest.Artifacts {
		if strings.ToLower(strings.TrimSpace(artifact.Board)) != normalizedBoard {
			continue
		}
		version, err := versioning.ParseSemVer(artifact.FirmwareVersion)
		if err != nil {
			continue
		}
		if !found || version.Compare(latestVersion) > 0 {
			latest = artifact
			latestVersion = version
			found = true
		}
	}
	return latest, latestVersion, found
}

func (s *Server) handleFirmwareUpdateInstall(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	var req firmwareUpdateRequest
	if !decodeOptionalJSON(w, r, &req) {
		return
	}
	s.firmwareUpdateStartMu.Lock()
	defer s.firmwareUpdateStartMu.Unlock()
	if active, ok := s.activeFirmwareUpdateJob(); ok {
		writeJSON(w, http.StatusAccepted, firmwareUpdateJobResponse{OK: true, Job: active})
		return
	}
	if s.updateHoldActive() {
		writeError(
			w,
			http.StatusConflict,
			"mac_app_restarting",
			"Mac App is restarting.",
			"Wait a moment, then start the update again.",
		)
		return
	}
	if s.rejectActiveThemeInstall(w) {
		return
	}
	cfg, err := s.config()
	if err != nil {
		writeInternalError(w, err)
		return
	}
	var hello protocol.DeviceHello
	ok := true
	// Issue #526: a WiFi VibeTV without heap for its capabilities still names
	// itself, and that is all an update start needs. The update is what gives
	// it the heap back, so "not found" would lock out the VibeTV that needs it.
	// What its capabilities would decide (cable-only updates, legacy WiFi) is
	// left undecided.
	identityOnly := false
	if req.Rescue {
		// The device cannot pass the paired checks below: it has no identity
		// yet. The updater finds exactly one such VibeTV and refuses the rest.
	} else if runtimeconfig.NormalizeConnectionMode(cfg.ConnectionMode) == "cable" {
		_, hello, ok = s.requireCableControlDevice(w, cfg)
	} else {
		cfg, hello, identityOnly, ok = s.requireDeviceIdentity(w, r, true)
		if transport := hello.Normalize().Capabilities.Transport; ok &&
			transport.CableOnlyUpdates != nil && *transport.CableOnlyUpdates {
			// Issue #522: this firmware refuses an upload over WiFi. If this
			// VibeTV answers on the USB cable, connect it by Cable and update
			// there; if not, say so before anything is uploaded.
			if _, err := s.resolveCablePort("", hello.DeviceID); err != nil {
				writeJSON(w, http.StatusConflict, errorResponse{OK: false, Error: firmwareUpdateErrorPayload(nil, "cable_required")})
				return
			}
			if s.selectConnectionMode(w, r, "cable", hello.DeviceID) == nil {
				return
			}
			if cfg, err = s.config(); err != nil {
				writeInternalError(w, err)
				return
			}
			_, hello, ok = s.requireCableControlDevice(w, cfg)
		}
	}
	if !ok {
		return
	}
	if !req.Rescue && runtimeconfig.NormalizeConnectionMode(cfg.ConnectionMode) == "cable" && !hello.HasFeature(protocol.FeatureCableTransferV1) {
		writeError(
			w,
			http.StatusConflict,
			"firmware_update_unsupported",
			"Firmware updates are not supported for this VibeTV over Cable.",
			"Switch to WiFi to update this VibeTV.",
		)
		return
	}
	if !req.Rescue && strings.TrimSpace(cfg.DeviceToken) == "" {
		writeError(
			w,
			http.StatusForbidden,
			"pairing_required",
			"VibeTV pairing is required before updating.",
			"Pair VibeTV, then retry.",
		)
		return
	}
	if transport := hello.Normalize().Capabilities.Transport; !req.Rescue && !identityOnly &&
		runtimeconfig.NormalizeConnectionMode(cfg.ConnectionMode) != "cable" &&
		(transport.CableOnlyUpdates == nil || !*transport.CableOnlyUpdates) {
		// The update restarts this VibeTV in legacy WiFi mode (issue #498).
		s.rememberLegacyWiFiDevice(cfg.DeviceID)
	}
	caps := protocol.CapabilitiesFromHello(hello)
	if !req.Rescue && (strings.TrimSpace(caps.Board) == "" || strings.TrimSpace(caps.Firmware) == "") {
		writeError(
			w,
			http.StatusBadGateway,
			"update_device_info_missing",
			"Could not read VibeTV update info.",
			"Keep VibeTV powered on, then retry.",
		)
		return
	}
	job := s.createFirmwareUpdateJob()
	s.startFirmwareUpdateJob(r.Context(), job.ID, cfg, req)
	writeJSON(w, http.StatusAccepted, firmwareUpdateJobResponse{OK: true, Job: job})
}

func (s *Server) handleFirmwareUpdateStatus(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	jobID := strings.TrimSpace(r.URL.Query().Get("jobId"))
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "missing_update_job", "Update status is missing.", "Start the update again.")
		return
	}
	job, ok := s.updateJobs.snapshot(jobID)
	if !ok {
		writeError(w, http.StatusNotFound, "update_job_not_found", "Update status was not found.", "Start the update again.")
		return
	}
	writeJSON(w, http.StatusOK, firmwareUpdateJobResponse{OK: true, Job: job})
}

func (s *Server) activeFirmwareUpdateJob() (firmwareUpdateJob, bool) {
	return s.updateJobs.find(func(job *firmwareUpdateJob) bool { return job.Phase == "installing" })
}

func (s *Server) createFirmwareUpdateJob() firmwareUpdateJob {
	return s.updateJobs.create("firmware-update", func(id string) *firmwareUpdateJob {
		return &firmwareUpdateJob{
			ID:        id,
			Phase:     "installing",
			Stage:     "validating_artifact",
			Message:   "Preparing VibeTV update.",
			Progress:  5,
			StartedAt: time.Now().UTC(),
			Logs:      []string{"Preparing VibeTV update."},
		}
	})
}

func (s *Server) startFirmwareUpdateJob(_ context.Context, jobID string, cfg runtimeconfig.Config, req firmwareUpdateRequest) {
	go func() {
		s.deviceMaintenanceMu.Lock()
		defer s.deviceMaintenanceMu.Unlock()

		s.firmwareUpdateActive.Store(true)
		// The OTA runs in a child process. Close this process's idle keep-alive
		// sockets to the device first, so no half-open connection occupies the
		// single-threaded ESP8266 server while the updater runs its
		// authenticated preflight and upload.
		if s.client != nil {
			s.client.CloseIdleConnections()
		}
		streamPaused := false
		if s.pauseDisplayStream != nil {
			s.pauseDisplayStream(true)
			streamPaused = true
		}
		resumeStream := func() {
			if !streamPaused {
				return
			}
			streamPaused = false
			s.pauseDisplayStream(false)
		}
		defer func() {
			s.firmwareUpdateActive.Store(false)
			resumeStream()
		}()
		ctx, cancel := context.WithTimeout(context.Background(), firmwareUpdateJobTime)
		defer cancel()
		// Only a positively unconfigured device may skip render verification.
		// Remember this before OTA: a theme lost during the update is a failure,
		// and an unavailable/older health response is not proof of first setup.
		cableUpdate := req.Rescue || runtimeconfig.NormalizeConnectionMode(cfg.ConnectionMode) == "cable"
		var before deviceHealth
		var probeReq *http.Request
		var probeErr error
		if req.Rescue {
			// Nothing to compare: the old firmware has no health over Cable.
		} else if cableUpdate {
			var port string
			var hello protocol.DeviceHello
			port, hello, probeErr = s.cableControlDevice(cfg)
			if probeErr == nil && hello.HasFeature(protocol.FeatureCableHealthV1) {
				before, probeErr = s.readCableHealth(port, hello.DeviceID)
			}
		} else {
			probeCtx, cancelProbe := context.WithTimeout(ctx, 3*time.Second)
			// Only this maintenance-owned request bypasses doJSON's OTA exclusion;
			// ordinary status probes remain blocked throughout the baseline.
			probeReq, probeErr = http.NewRequestWithContext(probeCtx, http.MethodGet, endpoint(cfg.DeviceTarget, "/health"), nil)
			if probeErr == nil {
				applyDeviceToken(probeReq, cfg.DeviceToken)
				probeErr = s.do(probeReq, &before)
			}
			cancelProbe()
		}
		if probeErr == nil && before.OK {
			s.updateJobs.update(jobID, func(job *firmwareUpdateJob) {
				job.themeSetupRequiredBeforeUpdate = firmwareThemeSetupRequired(before)
				job.themePathBeforeUpdate, job.themeActiveBeforeUpdate = firmwareUpdateLiveThemeState(before)
			})
		}
		if s.client != nil {
			s.client.CloseIdleConnections()
		}
		writer := &firmwareUpdateProgressWriter{server: s, jobID: jobID}
		// A probe that passed the exclusion before this job started may still
		// own or await the HTTP gate, even when our three-second baseline timed
		// out. Drain it and hold the gate across the child-process OTA.
		err := probeErr
		if cableUpdate {
			// Baseline reads retain the shared serial handle. Release it after
			// the probe, including failures, so the child updater can open it.
			if s.resetCableSender != nil {
				s.resetCableSender()
			}
			err = s.updateFirmware(ctx, s.home, cfg, req, writer)
		} else if probeReq != nil {
			var release func()
			release, err = transportlayer.AcquireDeviceHTTPGate(ctx, probeReq.URL)
			if err == nil {
				err = s.updateFirmware(ctx, s.home, cfg, req, writer)
				release()
			}
		}
		s.firmwareUpdateActive.Store(false)
		resumeStream()

		snapshot, _ := s.updateJobs.snapshot(jobID)
		// The rescue updater verifies its own result: only its success counts.
		shouldVerify := err == nil || (!req.Rescue && snapshot.Result != nil && snapshot.Result.UploadAccepted)
		if shouldVerify {
			var outcome string
			var attentionMessage string
			var verifyErr error
			if req.Rescue {
				// The updater already proved the new firmware and identity over
				// Cable. Connecting it is the setup's Cable step.
				outcome = "updated"
			} else if cableUpdate || (snapshot.Result != nil && samePublicTarget(snapshot.Result.Target, cableDeviceTarget)) {
				// A WiFi job whose updater found the VibeTV on the cable (#832).
				outcome, attentionMessage, verifyErr = s.verifyCableFirmwareUpdateResult(ctx, jobID, cfg)
			} else {
				outcome, attentionMessage, verifyErr = s.verifyFirmwareUpdateResult(ctx, jobID, cfg)
			}
			if verifyErr == nil {
				finishedAt := time.Now().UTC()
				if attentionMessage != "" {
					s.recordSetupEvent(setupEvent{Stage: "firmware_update", Status: "failed", Message: attentionMessage, Code: "firmware_update_attention", NextAction: firmwareUpdateDiagnosticNextAction(firmwareUpdateJob{Phase: "attention"})})
				} else {
					s.recordSetupEvent(setupEvent{Stage: "firmware_update", Status: "succeeded", Message: "VibeTV update complete."})
				}
				s.updateJobs.update(jobID, func(job *firmwareUpdateJob) {
					job.Progress = 100
					job.FinishedAt = &finishedAt
					job.Outcome = outcome
					if attentionMessage != "" {
						job.Phase = "attention"
						job.Message = attentionMessage
						job.Warnings = append(job.Warnings, attentionMessage)
						appendFirmwareUpdateJobLog(job, attentionMessage)
						return
					}
					job.Phase = "complete"
					job.Message = "Update complete."
					appendFirmwareUpdateJobLog(job, "Update complete.")
				})
				return
			}
			if err == nil {
				err = verifyErr
			} else {
				err = fmt.Errorf("%v; final verification: %w", err, verifyErr)
			}
		}
		finishedAt := time.Now().UTC()
		if err != nil {
			if detail := sanitizeErrorDetail(err); detail != "" {
				_, _ = fmt.Fprintf(os.Stderr, "VibeTV firmware update failed: %s\n", detail)
			}
			apiErr := firmwareUpdateErrorPayload(err, snapshot.RetryPolicy)
			s.recordSetupEvent(setupEvent{Stage: "firmware_update", Status: "failed", Message: apiErr.Message, Code: apiErr.Code, NextAction: apiErr.NextAction})
			s.updateJobs.update(jobID, func(job *firmwareUpdateJob) {
				job.Phase = "error"
				job.Message = "Update failed."
				job.Progress = 100
				job.FinishedAt = &finishedAt
				job.Error = &apiErr
				appendFirmwareUpdateJobLog(job, "Update failed.")
			})
			return
		}
	}()
}

func (s *Server) verifyCableFirmwareUpdateResult(ctx context.Context, jobID string, initialCfg runtimeconfig.Config) (string, string, error) {
	snapshot, ok := s.updateJobs.snapshot(jobID)
	if !ok || snapshot.Result == nil {
		return "", "", errors.New("firmware update produced no verification result")
	}
	expectedFirmware := strings.TrimSpace(snapshot.Result.Firmware)
	expectedDeviceID := strings.TrimSpace(snapshot.Result.DeviceID)
	if expectedFirmware == "" || expectedDeviceID == "" || !samePublicTarget(snapshot.Result.Target, cableDeviceTarget) {
		return "", "", errors.New("cable firmware update result is missing firmware, device id, or target")
	}
	cfg := initialCfg
	if current, err := s.loadConfig(s.home); err == nil {
		cfg = current
	}

	s.setFirmwareUpdateStage(jobID, "verifying_firmware")
	port, hello, err := s.cableControlDevice(cfg)
	if err != nil {
		return "", "", fmt.Errorf("verify installed Cable firmware: %w", err)
	}
	if !strings.EqualFold(expectedDeviceID, strings.TrimSpace(hello.DeviceID)) {
		return "", "", fmt.Errorf("VibeTV identity mismatch after update: expected=%q got=%q", expectedDeviceID, strings.TrimSpace(hello.DeviceID))
	}
	if strings.TrimSpace(hello.Firmware) != expectedFirmware {
		return "", "", fmt.Errorf("VibeTV firmware mismatch after update: expected=%q got=%q", expectedFirmware, strings.TrimSpace(hello.Firmware))
	}
	s.updateFirmwareVerification(jobID, func(result *firmwareUpdateResult) {
		result.HelloVerified = true
		result.Target = cableDeviceTarget
		result.Firmware = strings.TrimSpace(hello.Firmware)
		result.ObservedFirmware = strings.TrimSpace(hello.Firmware)
	})
	if runtimeconfig.NormalizeConnectionMode(cfg.ConnectionMode) != "cable" {
		// The updater can find the same VibeTV on Cable after WiFi times out.
		// The daemon chooses its transport from config, not the restart target.
		cfg, err = s.saveCableSelection(hello, cfg.DeviceToken)
		if err != nil {
			return "", "", fmt.Errorf("save verified Cable connection: %w", err)
		}
	}
	if !hello.HasFeature(protocol.FeatureCableHealthV1) {
		return firmwareAttentionOutcome("render"), "Firmware is current, but this VibeTV cannot verify the picture over Cable yet.", nil
	}

	s.setFirmwareUpdateStage(jobID, "verifying_health")
	healthDeadline := time.Now().Add(firmwareHealthVerifyTime)
	var health deviceHealth
	for {
		health, err = s.readCableHealth(port, hello.DeviceID)
		if err == nil && health.OK {
			break
		}
		if time.Now().After(healthDeadline) {
			return firmwareAttentionOutcome("health"), "Firmware is current, but VibeTV health still needs attention.", nil
		}
		select {
		case <-ctx.Done():
			return "", "", ctx.Err()
		case <-time.After(time.Second):
		}
	}
	s.updateFirmwareVerification(jobID, func(result *firmwareUpdateResult) {
		result.HealthVerified = true
	})

	s.setFirmwareUpdateStage(jobID, "restarting_stream")
	streamStartedAt := time.Now().UTC()
	if err := s.startDisplayStream(ctx, cableDeviceTarget); err != nil {
		// A restart that failed outright never recovers by itself, unlike a
		// stream that was only not seen in time: its own outcome keeps the app
		// from polling it back to "recovered" on an older frame (Codex on #829).
		return firmwareAttentionOutcome("stream_restart"), "Firmware is current, but the display stream could not restart.", nil
	}
	stream := s.waitForFirmwareUpdateStream(ctx, cableDeviceTarget, streamStartedAt)
	streamHealthy := displayStreamHealthyForTarget(&stream, cableDeviceTarget)
	streamAwaitingProvider := !streamHealthy && providerSetupStreamForTarget(&stream, cableDeviceTarget)
	if !streamHealthy && !streamAwaitingProvider {
		return firmwareAttentionOutcome("stream"), "Firmware is current, but the display stream still needs attention.", nil
	}
	s.updateFirmwareVerification(jobID, func(result *firmwareUpdateResult) {
		result.StreamVerified = true
	})
	renderSkipped, attentionMessage := firmwareUpdateRenderSkip(snapshot, health, streamAwaitingProvider)
	if attentionMessage != "" {
		s.setFirmwareUpdateStage(jobID, "verifying_render")
		return firmwareAttentionOutcome("render"), attentionMessage, nil
	}
	if renderSkipped != "" {
		s.updateFirmwareVerification(jobID, func(result *firmwareUpdateResult) {
			result.RenderSkipped = renderSkipped
		})
		return firmwareUpdateOutcome(snapshot), "", nil
	}

	s.setFirmwareUpdateStage(jobID, "verifying_render")
	if last, err := s.waitForVerifiedCableDisplayRender(ctx, port, hello.DeviceID, cfg.DeviceToken, health, stream); err != nil {
		// Only a fresh read that found the counters unchanged qualifies; a read
		// that failed afterwards (cable gone) keeps the attention result (Codex
		// review on #838).
		if !errors.Is(err, errDisplayRenderNotAdvanced) || !unchangedLivePicture(health, last) {
			return firmwareAttentionOutcome("render"), "Firmware is current, but the picture could not be verified.", nil
		}
		s.appendFirmwareUpdateDiagnostic(jobID, "render: live picture unchanged since the stream restart")
	}
	s.updateFirmwareVerification(jobID, func(result *firmwareUpdateResult) {
		result.RenderVerified = true
	})
	return firmwareUpdateOutcome(snapshot), "", nil
}

// unchangedLivePicture reports whether VibeTV still shows the healthy live
// picture it showed before the stream restart. The firmware redraws only when
// a frame changes the screen, so a frame with the same values leaves the
// render counters where they were (issue #835). The last draw may be the
// minute countdown on that picture ("reset"). Nothing was drawn in between:
// same boot, same counters, no new theme render failure.
func unchangedLivePicture(before, after deviceHealth) bool {
	beforeFull, beforePartial, beforeOK := displayRenderCounters(before)
	afterFull, afterPartial, afterOK := displayRenderCounters(after)
	return before.OK && after.OK && beforeOK && afterOK &&
		beforeFull == afterFull && beforePartial == afterPartial &&
		strings.TrimSpace(before.System.BootID) == strings.TrimSpace(after.System.BootID) &&
		before.Display.ThemeSpec.RenderFailures == after.Display.ThemeSpec.RenderFailures &&
		renderSurfaceHealthy(after) && liveScreenRenderKind(after.Render.LastKind)
}

func firmwareUpdateOutcome(snapshot firmwareUpdateJob) string {
	if strings.TrimSpace(snapshot.Outcome) == "already_current" {
		return "already_current"
	}
	return "updated"
}

func (s *Server) verifyFirmwareUpdateResult(ctx context.Context, jobID string, initialCfg runtimeconfig.Config) (string, string, error) {
	snapshot, ok := s.updateJobs.snapshot(jobID)
	if !ok || snapshot.Result == nil {
		return "", "", errors.New("firmware update produced no verification result")
	}
	expectedFirmware := strings.TrimSpace(snapshot.Result.Firmware)
	expectedDeviceID := strings.TrimSpace(snapshot.Result.DeviceID)
	target := strings.TrimSpace(snapshot.Result.Target)
	if expectedFirmware == "" || expectedDeviceID == "" || target == "" {
		return "", "", errors.New("firmware update result is missing firmware, device id, or target")
	}
	cfg := initialCfg
	if current, err := s.loadConfig(s.home); err == nil {
		cfg = current
	}
	token := strings.TrimSpace(cfg.DeviceToken)
	s.setFirmwareUpdateStage(jobID, "verifying_firmware")
	hello, err := s.getHello(ctx, target, token)
	if identity, ok := protocol.HelloIdentity(err); ok {
		// Device ID and firmware are all this check reads (issue #526).
		hello, err = identity, nil
	}
	if err != nil {
		return "", "", fmt.Errorf("verify installed firmware: %w", err)
	}
	if !strings.EqualFold(expectedDeviceID, strings.TrimSpace(hello.DeviceID)) {
		return "", "", fmt.Errorf("VibeTV identity mismatch after update: expected=%q got=%q", expectedDeviceID, strings.TrimSpace(hello.DeviceID))
	}
	if strings.TrimSpace(hello.Firmware) != expectedFirmware {
		return "", "", fmt.Errorf("VibeTV firmware mismatch after update: expected=%q got=%q", expectedFirmware, strings.TrimSpace(hello.Firmware))
	}
	s.updateFirmwareVerification(jobID, func(result *firmwareUpdateResult) {
		result.HelloVerified = true
		result.Target = target
		result.Firmware = strings.TrimSpace(hello.Firmware)
		result.ObservedFirmware = strings.TrimSpace(hello.Firmware)
	})
	if strings.TrimSpace(cfg.DeviceTarget) != target {
		cfg.DeviceTarget = target
		if err := s.saveConfig(s.home, cfg); err != nil {
			return "", "", fmt.Errorf("save rediscovered VibeTV target: %w", err)
		}
	}

	s.setFirmwareUpdateStage(jobID, "verifying_health")
	healthDeadline := time.Now().Add(firmwareHealthVerifyTime)
	var health deviceHealth
	for {
		health, err = s.getHealth(ctx, target, token)
		if err == nil && health.OK {
			break
		}
		if time.Now().After(healthDeadline) {
			return firmwareAttentionOutcome("health"), "Firmware is current, but VibeTV health still needs attention.", nil
		}
		select {
		case <-ctx.Done():
			return "", "", ctx.Err()
		case <-time.After(time.Second):
		}
	}
	s.updateFirmwareVerification(jobID, func(result *firmwareUpdateResult) {
		result.HealthVerified = true
	})

	s.setFirmwareUpdateStage(jobID, "restarting_stream")
	baseline := health
	streamStartedAt := time.Now().UTC()
	if err := s.startDisplayStream(ctx, target); err != nil {
		// A restart that failed outright never recovers by itself, unlike a
		// stream that was only not seen in time: its own outcome keeps the app
		// from polling it back to "recovered" on an older frame (Codex on #829).
		return firmwareAttentionOutcome("stream_restart"), "Firmware is current, but the display stream could not restart.", nil
	}
	stream := s.waitForFirmwareUpdateStream(ctx, target, streamStartedAt)
	streamHealthy := displayStreamHealthyForTarget(&stream, target)
	// A stream that restarted, owns this exact VibeTV, and is only held back by
	// provider setup has nothing left to prove about the firmware update. It
	// draws no usage picture because no provider is ready, so demanding one here
	// would report "needs attention" for a Mac that is simply not set up yet.
	streamAwaitingProvider := !streamHealthy && providerSetupStreamForTarget(&stream, target)
	if !streamHealthy && !streamAwaitingProvider {
		return firmwareAttentionOutcome("stream"), "Firmware is current, but the display stream still needs attention.", nil
	}
	s.updateFirmwareVerification(jobID, func(result *firmwareUpdateResult) {
		result.StreamVerified = true
	})
	renderSkipped, attentionMessage := firmwareUpdateRenderSkip(snapshot, health, streamAwaitingProvider)
	if attentionMessage != "" {
		s.setFirmwareUpdateStage(jobID, "verifying_render")
		return firmwareAttentionOutcome("render"), attentionMessage, nil
	}
	if renderSkipped != "" {
		s.updateFirmwareVerification(jobID, func(result *firmwareUpdateResult) {
			result.RenderSkipped = renderSkipped
		})
		return firmwareUpdateOutcome(snapshot), "", nil
	}

	s.setFirmwareUpdateStage(jobID, "verifying_render")
	// The device reboots into the new firmware parked on the setup screen with
	// the stored theme spec active but nothing drawn from it, and it does not
	// leave that screen on its own however many usage frames the Mac sends.
	// repairDevice already reactivates the stored theme in exactly this state,
	// so the update does the same rather than handing the customer a working
	// device with a setup screen on it.
	if err := s.repairParkedDisplayAfterFirmwareUpdate(ctx, jobID, target, token, baseline, stream); err != nil {
		return firmwareAttentionOutcome("render"), "Firmware is current, but the picture could not be verified.", nil
	}
	s.updateFirmwareVerification(jobID, func(result *firmwareUpdateResult) {
		result.RenderVerified = true
	})
	return firmwareUpdateOutcome(snapshot), "", nil
}

// Apply the same first-setup and lost-theme rules after Cable and WiFi updates.
// An empty skip reason still requires actual render verification.
func firmwareUpdateRenderSkip(snapshot firmwareUpdateJob, health deviceHealth, streamAwaitingProvider bool) (skipReason, attentionMessage string) {
	liveThemePath, liveThemeActive := firmwareUpdateLiveThemeState(health)
	themeSetupRequired := snapshot.themeSetupRequiredBeforeUpdate && firmwareThemeSetupRequired(health)
	storedThemeUnchanged := snapshot.themePathBeforeUpdate != "" &&
		snapshot.themePathBeforeUpdate == liveThemePath &&
		snapshot.themeActiveBeforeUpdate == liveThemeActive &&
		strings.TrimSpace(health.Display.ThemeSpec.RenderError) == "" &&
		(health.Display.ThemeSpec.RenderOK == nil || *health.Display.ThemeSpec.RenderOK)
	if (snapshot.themePathBeforeUpdate != "" && liveThemePath == "") ||
		(streamAwaitingProvider && !themeSetupRequired && !storedThemeUnchanged) {
		return "", "Firmware is current, but the stored theme could not be verified."
	}
	if themeSetupRequired {
		return "theme_setup_required", ""
	}
	if streamAwaitingProvider {
		return "provider_setup_required", ""
	}
	return "", ""
}

// Standby and screensaver preview display a separate slot. Compare the live slot,
// which firmware restores on reboot, not the picture currently on screen.
func firmwareUpdateLiveThemeState(health deviceHealth) (string, bool) {
	if health.Standby != nil {
		path := strings.TrimSpace(health.Standby.LiveThemePath)
		if path != "" || health.Standby.Active {
			return path, path != ""
		}
	}
	return strings.TrimSpace(health.Display.ThemeSpec.Path), health.Display.ThemeSpec.Active
}

func firmwareThemeSetupRequired(health deviceHealth) bool {
	spec := health.Display.ThemeSpec
	return health.OK && health.Display.ActiveTheme == "theme-missing" &&
		(health.Standby == nil || (!health.Standby.Active && strings.TrimSpace(health.Standby.LiveThemePath) == "")) &&
		!spec.Active && strings.TrimSpace(spec.Path) == "" &&
		strings.TrimSpace(spec.Hash) == "" && strings.TrimSpace(spec.RenderError) == ""
}

// repairParkedDisplayAfterFirmwareUpdate verifies the picture after an update
// and, when the device is parked on a non-live screen with a stored theme,
// reactivates that theme and waits for a full render. It mirrors what
// repairDevice does for the manual "Reload image" action.
func (s *Server) repairParkedDisplayAfterFirmwareUpdate(
	ctx context.Context,
	jobID string,
	target string,
	token string,
	baseline deviceHealth,
	stream displayStreamInfo,
) error {
	// The VibeTV serves one connection at a time, so the display stream this
	// function just restarted takes /theme/active away from the reactivation and
	// the device answers EOF. repairDevice and the theme install both pause the
	// stream around the same call for the same reason; measured on hardware,
	// where the unpaused call failed with
	// `reactivate current VibeTV theme: Post ".../theme/active": EOF`.
	// The passive wait below needs the stream running and must stay outside.
	reactivate := func(from deviceHealth) error {
		if s.pauseDisplayStream != nil {
			s.pauseDisplayStream(true)
			defer s.pauseDisplayStream(false)
		}
		_, err := s.reactivateCurrentThemeAndWaitForFullRender(ctx, target, token, from, stream)
		return err
	}

	s.appendFirmwareUpdateDiagnostic(jobID, "render-repair: baseline "+describeRepairRenderState(baseline))
	if activeThemeNeedsFullRepairRender(baseline) {
		err := reactivate(baseline)
		s.appendFirmwareUpdateDiagnostic(jobID, fmt.Sprintf("render-repair: reactivated from baseline err=%v", err))
		return err
	}
	health, err := s.waitForVerifiedDisplayRender(ctx, target, token, baseline, stream)
	if err == nil {
		return nil
	}
	s.appendFirmwareUpdateDiagnostic(jobID, fmt.Sprintf("render-repair: verify failed err=%v, health %s", err, describeRepairRenderState(health)))
	// The wait returns a zero health when every probe failed, and a device that
	// is still busy right after its reboot does exactly that, so decide on a
	// fresh reading rather than on whatever the failed wait left behind.
	fresh, freshErr := s.getHealth(ctx, target, token)
	s.appendFirmwareUpdateDiagnostic(jobID, fmt.Sprintf("render-repair: refetched health err=%v, %s", freshErr, describeRepairRenderState(fresh)))
	if freshErr != nil {
		return err
	}
	// Reactivate whenever a stored theme exists. The narrower "is it parked on a
	// non-live screen" test races the stream cadence: the render kind reported
	// right after a reboot depends on which frame happened to land last, and we
	// have already failed to observe a live render at this point. Reactivation
	// is idempotent and repairs the picture immediately on hardware.
	if !storedThemeAvailableForRepair(fresh) {
		return err
	}
	err = reactivate(fresh)
	s.appendFirmwareUpdateDiagnostic(jobID, fmt.Sprintf("render-repair: reactivated after verify err=%v", err))
	return err
}

// storedThemeAvailableForRepair reports whether the device has a stored theme
// that can be reactivated to force a full render.
func storedThemeAvailableForRepair(health deviceHealth) bool {
	spec := health.Display.ThemeSpec
	return spec.Active && strings.TrimSpace(spec.Path) != ""
}

func describeRepairRenderState(health deviceHealth) string {
	spec := health.Display.ThemeSpec
	full, partial, countersOK := displayRenderCounters(health)
	return fmt.Sprintf(
		"ok=%t specActive=%t specPath=%q lastKind=%q counters=%t/%d/%d needsRepair=%t",
		health.OK, spec.Active, strings.TrimSpace(spec.Path),
		strings.TrimSpace(health.Render.LastKind),
		countersOK, full, partial,
		activeThemeNeedsFullRepairRender(health),
	)
}

func firmwareUpdatePhaseFinal(phase string) bool {
	switch strings.TrimSpace(phase) {
	case "complete", "attention", "error":
		return true
	}
	return false
}

func firmwareAttentionOutcome(kind string) string {
	prefix := "firmware_current_"
	switch kind {
	case "health":
		return prefix + "health_attention"
	case "stream":
		return prefix + "stream_attention"
	case "stream_restart":
		return prefix + "stream_restart_attention"
	default:
		return prefix + "render_attention"
	}
}

func (s *Server) setFirmwareUpdateStage(jobID, stage string) {
	s.updateJobs.update(jobID, func(job *firmwareUpdateJob) {
		job.Stage = stage
		message, progress := firmwareUpdateStageProgress(stage)
		if message != "" {
			job.Message = message
			appendFirmwareUpdateJobLog(job, message)
		}
		if progress > job.Progress {
			job.Progress = progress
		}
	})
}

func (s *Server) updateFirmwareVerification(jobID string, update func(*firmwareUpdateResult)) {
	s.updateJobs.update(jobID, func(job *firmwareUpdateJob) {
		if job.Result == nil {
			job.Result = &firmwareUpdateResult{}
		}
		update(job.Result)
	})
}

func cloneFirmwareUpdateJob(job *firmwareUpdateJob) firmwareUpdateJob {
	clone := *job
	clone.Logs = append([]string(nil), job.Logs...)
	clone.Warnings = append([]string(nil), job.Warnings...)
	if job.Result != nil {
		result := *job.Result
		clone.Result = &result
	}
	if job.Error != nil {
		apiErr := *job.Error
		clone.Error = &apiErr
	}
	if job.FinishedAt != nil {
		finishedAt := *job.FinishedAt
		clone.FinishedAt = &finishedAt
	}
	return clone
}

type firmwareUpdateProgressWriter struct {
	server  *Server
	jobID   string
	pending string
}

// appendFirmwareUpdateDiagnostic records one raw updater line. The pairing
// token never reaches the file, and the log is truncated once it grows past its
// budget so an unattended Mac cannot fill its disk with update attempts.
func (s *Server) appendFirmwareUpdateDiagnostic(jobID, line string) {
	path := runtimepaths.FirmwareUpdateLog(s.home)
	if path == "" {
		return
	}
	if token := strings.TrimSpace(s.currentDeviceToken()); token != "" {
		for _, secret := range []string{token, url.QueryEscape(token), url.PathEscape(token)} {
			if secret != "" {
				line = strings.ReplaceAll(line, secret, "[REDACTED]")
			}
		}
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return
	}
	if info, err := os.Stat(path); err == nil && info.Size() > runtimepaths.FirmwareUpdateLogMaxBytes {
		_ = os.Truncate(path, 0)
	}
	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer file.Close()
	record := fmt.Sprintf("%s %s %s\n",
		time.Now().UTC().Format(time.RFC3339),
		jobID,
		sanitizeLogLine(line),
	)
	_, _ = file.WriteString(record)
}

func (s *Server) currentDeviceToken() string {
	cfg, err := s.loadConfig(s.home)
	if err != nil {
		return ""
	}
	return cfg.DeviceToken
}

func (w *firmwareUpdateProgressWriter) Write(p []byte) (int, error) {
	text := w.pending + string(p)
	lines := strings.Split(text, "\n")
	if !strings.HasSuffix(text, "\n") {
		w.pending = lines[len(lines)-1]
		lines = lines[:len(lines)-1]
	} else {
		w.pending = ""
	}
	for _, line := range lines {
		w.noteLine(line)
	}
	return len(p), nil
}

func (w *firmwareUpdateProgressWriter) noteLine(line string) {
	line = strings.TrimSpace(line)
	if line == "" || w.server == nil {
		return
	}
	// Everything the child prints is kept here before the customer-facing
	// curation below throws most of it away, so a failed update can still be
	// diagnosed afterwards.
	w.server.appendFirmwareUpdateDiagnostic(w.jobID, line)
	if strings.HasPrefix(line, firmwareupdate.EventPrefix) {
		var event firmwareUpdateEvent
		if err := json.Unmarshal([]byte(strings.TrimPrefix(line, firmwareupdate.EventPrefix)), &event); err == nil {
			w.server.applyFirmwareUpdateEvent(w.jobID, event)
		}
		return
	}
	w.server.updateJobs.update(w.jobID, func(job *firmwareUpdateJob) {
		message, progress, ok := customerFirmwareUpdateProgress(line)
		if !ok {
			return
		}
		job.Message = message
		if progress > job.Progress {
			job.Progress = progress
		}
		appendFirmwareUpdateJobLog(job, message)
	})
}

type firmwareUpdateEvent = firmwareupdate.Event

func (s *Server) applyFirmwareUpdateEvent(jobID string, event firmwareUpdateEvent) {
	if event.UploadAccepted && strings.HasPrefix(strings.ToLower(strings.TrimSpace(event.Target)), "http") {
		// Only firmware without cable-only updates takes an upload over WiFi
		// (docs/firmware-ota-contract.md), so this is the same fact the update
		// start reads from the hello. A hello without capabilities (issue
		// #526) could not say it there, and the new firmware has not started
		// yet, so nothing has ended its legacy mode over the cable.
		s.rememberLegacyWiFiDevice(event.DeviceID)
	}
	s.updateJobs.update(jobID, func(job *firmwareUpdateJob) {
		if stage := strings.TrimSpace(event.Stage); stage != "" {
			job.Stage = stage
		}
		// The updater's events only move the job while it runs. Its "complete",
		// "attention" or "error" is not the end: the server's own verification
		// (health, stream, picture; up to 90 s since #829) sets the final phase
		// together with FinishedAt. The page stops polling at a final phase, so
		// an early one would show "complete" before an attention.
		if phase := strings.TrimSpace(event.Phase); phase != "" && !firmwareUpdatePhaseFinal(phase) {
			job.Phase = phase
		}
		if outcome := strings.TrimSpace(event.Outcome); outcome != "" {
			job.Outcome = outcome
		}
		if retryPolicy := strings.TrimSpace(event.RetryPolicy); retryPolicy != "" {
			job.RetryPolicy = retryPolicy
		}
		if job.Result == nil {
			job.Result = &firmwareUpdateResult{}
		}
		if value := strings.TrimSpace(event.Firmware); value != "" {
			job.Result.Firmware = value
		}
		if value := strings.TrimSpace(event.ObservedFirmware); value != "" {
			job.Result.ObservedFirmware = value
		}
		if value := strings.TrimSpace(event.Target); value != "" {
			job.Result.Target = value
		}
		if value := strings.TrimSpace(event.DeviceID); value != "" {
			job.Result.DeviceID = value
		}
		job.Result.ArtifactValidated = job.Result.ArtifactValidated || event.ArtifactValidated
		job.Result.UploadAccepted = job.Result.UploadAccepted || event.UploadAccepted
		job.Result.HelloVerified = job.Result.HelloVerified || event.HelloVerified
		message, progress := firmwareUpdateStageProgress(job.Stage)
		if message != "" {
			job.Message = message
			appendFirmwareUpdateJobLog(job, message)
		}
		if progress > job.Progress {
			job.Progress = progress
		}
	})
	s.recordTimeline(timeline.Event{Component: "firmware_update", DeviceID: event.DeviceID, State: event.Stage, Reason: event.Outcome})
}

func firmwareUpdateStageProgress(stage string) (string, int) {
	switch strings.TrimSpace(stage) {
	case "validating_artifact":
		return "Validating update.", 20
	case "uploading":
		return "Updating VibeTV.", 55
	case "rebooting":
		return "Restarting VibeTV.", 70
	case "rediscovering":
		return "Finding VibeTV again.", 76
	case "verifying_firmware":
		return "Checking installed firmware.", 82
	case "verifying_health":
		return "Checking VibeTV health.", 87
	case "restarting_stream":
		return "Restarting display stream.", 92
	case "verifying_render":
		return "Checking the picture.", 97
	default:
		return "", 0
	}
}

func customerFirmwareUpdateProgress(line string) (string, int, bool) {
	switch {
	case strings.HasPrefix(line, "Checking device"):
		return "Checking VibeTV.", 10, true
	case strings.HasPrefix(line, "Device:"):
		return "VibeTV is ready.", 18, true
	case strings.HasPrefix(line, "Checking firmware"):
		return "Checking update.", 25, true
	case strings.HasPrefix(line, "Firmware: already current"):
		return "VibeTV is already up to date.", 95, true
	case strings.HasPrefix(line, "Updating firmware:"):
		return "Preparing update.", 35, true
	case strings.HasPrefix(line, "Firmware downloaded:"):
		return "Update downloaded.", 45, true
	case strings.HasPrefix(line, "Pausing Mac App during firmware update"):
		return "Preparing VibeTV.", 50, true
	case strings.HasPrefix(line, "Uploading firmware"):
		return "Updating VibeTV.", 65, true
	case strings.HasPrefix(line, "Writing firmware:"):
		// The Cable rescue writes for about a minute; say how far it got.
		percent, err := strconv.Atoi(strings.TrimSuffix(strings.TrimSpace(strings.TrimPrefix(line, "Writing firmware:")), "%"))
		if err != nil || percent < 0 || percent > 100 {
			return "", 0, false
		}
		return fmt.Sprintf("Updating VibeTV: %d%%.", percent), 65 + percent*17/100, true
	case strings.HasPrefix(line, "Restarting VibeTV"):
		return "Restarting VibeTV.", 82, true
	case strings.HasPrefix(line, "Done: firmware"):
		return "Checking result.", 96, true
	default:
		return "", 0, false
	}
}

func appendFirmwareUpdateJobLog(job *firmwareUpdateJob, message string) {
	message = strings.TrimSpace(message)
	if message == "" {
		return
	}
	if len(job.Logs) > 0 && job.Logs[len(job.Logs)-1] == message {
		return
	}
	// A progress line replaces the update line before it, so the earlier
	// steps stay in the log instead of scrolling out.
	if last := len(job.Logs) - 1; last >= 0 && strings.HasPrefix(message, "Updating VibeTV:") &&
		strings.HasPrefix(job.Logs[last], "Updating VibeTV") {
		job.Logs[last] = message
		return
	}
	job.Logs = append(job.Logs, message)
	if len(job.Logs) > 12 {
		job.Logs = append([]string(nil), job.Logs[len(job.Logs)-12:]...)
	}
}

func firmwareUpdateErrorPayload(err error, retryPolicy string) apiError {
	if errcode.Of(err) == errcode.UpgradeVersionGuard {
		return apiError{
			Code:       "firmware_update_blocked",
			Message:    "Update cannot be installed on this VibeTV.",
			NextAction: "Create a support report.",
		}
	}
	if strings.TrimSpace(retryPolicy) == "power_cycle" {
		return apiError{
			Code:       "firmware_update_restart_required",
			Message:    "VibeTV must restart before another update attempt.",
			NextAction: "Disconnect VibeTV from power for 10 seconds, reconnect it, and wait until the picture returns before trying again.",
		}
	}
	if strings.TrimSpace(retryPolicy) == "reconnect_cable" {
		return apiError{
			Code:       "firmware_update_cable_interrupted",
			Message:    "Cable update was interrupted.",
			NextAction: "Reconnect VibeTV with a data-capable Cable, wait for it to start, then try the update once.",
		}
	}
	if strings.TrimSpace(retryPolicy) == "cable_required" {
		return apiError{
			Code:       "firmware_update_cable_required",
			Message:    "VibeTV installs updates only over the USB cable.",
			NextAction: "Connect VibeTV to this Mac with the USB cable, then update again.",
		}
	}
	return apiError{
		Code:       "firmware_update_failed",
		Message:    "VibeTV update failed.",
		NextAction: "Keep VibeTV powered on, then try again.",
	}
}

func firmwareUpdateDiagnosticStatus(job firmwareUpdateJob) string {
	switch job.Phase {
	case "complete":
		return "pass"
	case "error":
		return "fail"
	default:
		return "attention"
	}
}

func firmwareUpdateDiagnosticDetail(job firmwareUpdateJob) string {
	stage := strings.TrimSpace(job.Stage)
	observed := ""
	if job.Result != nil && strings.TrimSpace(job.Result.ObservedFirmware) != "" {
		observed = " Last observed firmware: " + strings.TrimSpace(job.Result.ObservedFirmware) + "."
	}
	switch job.Phase {
	case "complete":
		if observed != "" {
			return "Last VibeTV update completed." + observed
		}
		if job.Result != nil && strings.TrimSpace(job.Result.Firmware) != "" {
			return "Last VibeTV update completed. Firmware " + strings.TrimSpace(job.Result.Firmware) + " is installed."
		}
		return "Last VibeTV update completed."
	case "error":
		prefix := "Last VibeTV update failed"
		if stage != "" {
			prefix += " during " + stage
		}
		if job.Error != nil && strings.TrimSpace(job.Error.Message) != "" {
			return prefix + ": " + strings.TrimSpace(job.Error.Message) + observed
		}
		return prefix + "." + observed
	case "attention":
		if strings.TrimSpace(job.Message) != "" {
			return strings.TrimSpace(job.Message) + observed
		}
		return "Firmware is current, but VibeTV still needs attention." + observed
	default:
		if stage != "" {
			return "VibeTV update is still running in " + stage + "." + observed
		}
		return "VibeTV update is still running." + observed
	}
}

func firmwareUpdateDiagnosticErrorCode(job firmwareUpdateJob) string {
	if job.Phase != "error" || job.Error == nil {
		return ""
	}
	return strings.TrimSpace(job.Error.Code)
}

func firmwareUpdateDiagnosticNextAction(job firmwareUpdateJob) string {
	if job.Phase == "attention" {
		return "Use connection or picture repair. Do not install the same firmware again."
	}
	if job.Phase != "error" || job.Error == nil {
		return ""
	}
	return strings.TrimSpace(job.Error.NextAction)
}

// firmwareUpdateCommandRunner binds the update command to whether this server
// owns (and therefore pauses) a display writer. Only then may the child
// updater be told its parent already quiesced the device.
func firmwareUpdateCommandRunner(ownsDisplayWriter bool) func(context.Context, string, runtimeconfig.Config, firmwareUpdateRequest, io.Writer) error {
	return func(ctx context.Context, home string, cfg runtimeconfig.Config, req firmwareUpdateRequest, out io.Writer) error {
		return runFirmwareUpdateCommand(ctx, home, cfg, req, out, ownsDisplayWriter)
	}
}

// firmwareUpdateCommandEnv grants the child updater the parent-paused marker
// only when this server really owns and paused the display stream. The
// standalone API server (codexbar-display api) has no writer of its own, so
// its child must still run the writer-quiesce check and detect a separate
// daemon writing the device.
func firmwareUpdateCommandEnv(parentPaused bool, home string) []string {
	env := os.Environ()
	if parentPaused {
		env = append(env, "VIBETV_UPDATE_PARENT_PAUSED=1")
	}
	if strings.TrimSpace(home) != "" {
		env = append(env, "HOME="+home)
	}
	return env
}

func runFirmwareUpdateCommand(ctx context.Context, home string, cfg runtimeconfig.Config, req firmwareUpdateRequest, out io.Writer, parentPaused bool) error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	target := publicTarget(cfg.DeviceTarget)
	if runtimeconfig.NormalizeConnectionMode(cfg.ConnectionMode) == "cable" {
		target = cableDeviceTarget
	}
	if req.Rescue {
		target = cableRescueTarget
	}
	if target == "" {
		return errors.New("device target is empty")
	}
	args := firmwareUpdateCommandArgs(target, os.Getenv(firmwareManifestEnvVar), req.Force)
	cmd := exec.CommandContext(ctx, executable, args...)
	cmd.Stdout = out
	cmd.Stderr = out
	cmd.Env = firmwareUpdateCommandEnv(parentPaused, home)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("firmware update command failed: %w", err)
	}
	return nil
}

func firmwareUpdateCommandArgs(target, manifestURL string, force bool) []string {
	args := []string{
		"install-update",
		"--target",
		target,
		"--confirm-live-update",
		"--skip-launchagent-pause",
	}
	if manifestURL = strings.TrimSpace(manifestURL); manifestURL != "" {
		args = append(args, "--manifest-url", manifestURL)
	}
	if force {
		args = append(args, "--force")
	}
	return args
}

// cachedRescueTarget is the version a Cable rescue of the marked VibeTV will
// write: the marker's cached image, while a rescue can really resume it. That
// needs the marked port connected and silent (a VibeTV that answers there makes
// the marker stale and the install updates from the manifest, see
// resumableRescueMarker), the same board and firmware, and an intact image.
func (s *Server) cachedRescueTarget(board, installedFirmware string) (string, bool) {
	marker, ok := firmwareupdate.LoadRescueMarker(s.home, time.Now())
	if !ok {
		return "", false
	}
	port, present, provenSilent := s.rescueMarkerPortProbed(marker)
	if !present ||
		strings.TrimSpace(marker.ChipMAC) == "" ||
		!strings.EqualFold(strings.TrimSpace(marker.Board), strings.TrimSpace(board)) ||
		strings.TrimSpace(marker.Firmware) != strings.TrimSpace(installedFirmware) ||
		!firmwareupdate.RescueImageIntact(marker) {
		return "", false
	}
	marker.Port = port
	// While a firmware update runs (the rescue itself, between its two write
	// attempts), the port is the update's: no hello probe (Codex review on #819).
	// A moved port was just proven silent by the search; reading it again would
	// double the wait (Codex on #840).
	if s.readCableHello != nil && !s.firmwareUpdateActive.Load() && !provenSilent {
		if hello, err := s.readCableHello(marker.Port); err == nil &&
			(strings.TrimSpace(hello.DeviceID) != "" || strings.TrimSpace(hello.Firmware) != "") {
			return "", false
		}
	}
	target := strings.TrimSpace(marker.TargetFirmware)
	installed, installedErr := versioning.ParseSemVer(installedFirmware)
	next, nextErr := versioning.ParseSemVer(target)
	if installedErr != nil || nextErr != nil || next.Compare(installed) <= 0 {
		return "", false
	}
	return target, true
}
