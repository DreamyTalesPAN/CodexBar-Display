package companionapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themeinstall"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themepack"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/timeline"
)

type themeInstallRequest struct {
	// Slot is themepack.UsageLive or themepack.UsageScreensaver. Empty means
	// the live theme slot.
	Slot               string `json:"slot"`
	ThemeID            string `json:"themeId"`
	ThemeName          string `json:"themeName"`
	PackURL            string `json:"packUrl"`
	PackBytes          []byte `json:"-"`
	PackSHA256         string `json:"packSha256"`
	PackSizeBytes      int64  `json:"packSizeBytes"`
	CatalogURL         string `json:"catalogUrl"`
	SkipFirmwareUpdate *bool  `json:"skipFirmwareUpdate"`
	Async              bool   `json:"async"`
	// shown is called once VibeTV confirmed the new live theme while drawing
	// a usage frame. What runs after it only refreshes the display stream.
	shown func(themeinstall.Result)
}

type themeInstallJob struct {
	ID         string               `json:"id"`
	ThemeID    string               `json:"themeId,omitempty"`
	ThemeName  string               `json:"themeName,omitempty"`
	Slot       string               `json:"slot,omitempty"`
	Phase      string               `json:"phase"`
	Message    string               `json:"message"`
	Progress   int                  `json:"progress"`
	StartedAt  time.Time            `json:"startedAt"`
	FinishedAt *time.Time           `json:"finishedAt,omitempty"`
	Logs       []string             `json:"logs,omitempty"`
	Result     *themeinstall.Result `json:"result,omitempty"`
	Error      *apiError            `json:"error,omitempty"`
	uploads    int
}

type themeInstallJobResponse struct {
	OK  bool            `json:"ok"`
	Job themeInstallJob `json:"job"`
}

func (s *Server) handleThemeInstall(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	switch refusal := s.tryStartThemeInstall(); refusal {
	case "":
	case "mac_app_restarting":
		writeError(w, http.StatusConflict, refusal, "Mac App is restarting.", "Wait a moment, then try again.")
		return
	case "firmware_update_in_progress":
		writeError(w, http.StatusConflict, refusal, "VibeTV update is still running.", "Wait for the update to finish, then try again.")
		return
	default:
		writeError(w, http.StatusConflict, refusal, "A theme or screensaver is already being installed.", "Wait for it to finish, then try again.")
		return
	}
	releaseInstall := true
	defer func() {
		if releaseInstall {
			s.finishThemeInstall()
		}
	}()
	// An upload names its slot in the URL, so a refusal while its file is read
	// is filed under screensaver_install as well.
	if step, ok := w.(*setupStepRecorder); ok {
		step.stage = installText(strings.TrimSpace(r.URL.Query().Get("slot")), "theme_install")
	}
	req, ok := decodeThemeInstallRequest(w, r)
	if !ok {
		return
	}
	req, err := s.resolveEmbeddedThemePack(r, req)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_theme_pack_url", "Theme pack URL is invalid.", "Reload the theme catalog, then try again.")
		return
	}
	if strings.TrimSpace(req.ThemeID) == "" && strings.TrimSpace(req.PackURL) == "" && req.PackBytes == nil {
		writeError(w, http.StatusBadRequest, "missing_theme_source", "themeId or packUrl is required.", "Select a theme and retry.")
		return
	}
	req.Slot = installSlot(req.Slot)
	if req.Slot == "" {
		writeError(w, http.StatusBadRequest, "invalid_install_slot", "This theme cannot be installed here.", "Reload Control Center, then try again.")
		return
	}
	// The setup log files a screensaver install under screensaver_install.
	// Only the request names the slot, so the entry opens here and not at the
	// route. A request that names the slot in its JSON body is still logged as
	// theme_install when it is refused before this point.
	stage := installText(req.Slot, "theme_install")
	if step, ok := w.(*setupStepRecorder); ok {
		step.stage = stage
	}
	// The start names what is installed: the installs of two different themes
	// are two entries, and only the same one made again is a repeat. An upload
	// from Theme Studio has no address and need not name an id, so its file
	// tells it apart. The subject is not saved: after a restart of the runtime
	// the entries before it have none, and the restart's own entry stands
	// between them and the next install anyway.
	subject := req.ThemeID + " " + req.PackURL
	if req.PackBytes != nil {
		subject = fmt.Sprintf("%x", sha256.Sum256(req.PackBytes))
	}
	// The start line names the theme as Recent activity does; the name is the
	// customer's own text and is not reworded for a screensaver.
	started := installText(req.Slot, "Installing theme.")
	if name := strings.TrimSpace(req.ThemeName); name != "" {
		started = "Installing " + name + "."
	}
	s.recordSetupEvent(setupEvent{Stage: stage, Status: "started", Message: started, Subject: subject})
	if !validRemoteThemePackURL(req.PackURL) || !validRemoteThemePackURL(req.CatalogURL) {
		writeError(
			w,
			http.StatusBadRequest,
			"invalid_theme_pack_url",
			"Theme pack URL is invalid.",
			"Fix the Shopify theme pack URL to an http(s) download URL, then reload the catalog.",
		)
		return
	}
	if !themeInstallEnabled() {
		writeError(
			w,
			http.StatusForbidden,
			"theme_install_disabled",
			"Theme install is disabled for this Companion build.",
			"Unset VIBETV_DISABLE_WIFI_THEME_INSTALL, then restart the Mac App.",
		)
		return
	}
	var cfg runtimeconfig.Config
	if req.Async {
		// The async job pauses the display stream before it probes the device.
		// Probing here would race the active ESP8266 render loop and can consume
		// the receive/heap budget before maintenance has started.
		cfg, err = s.config()
		if err != nil {
			writeInternalError(w, err)
			return
		}
	} else {
		var hello protocol.DeviceHello
		var ok bool
		cfg, err = s.config()
		if err != nil {
			writeInternalError(w, err)
			return
		}
		if runtimeconfig.NormalizeConnectionMode(cfg.ConnectionMode) == "cable" {
			_, hello, ok = s.requireCableControlDevice(w, cfg)
		} else {
			cfg, hello, ok = s.requireDevice(w, r)
		}
		if !ok {
			return
		}
		if !s.requireThemeInstallPreflight(w, r, cfg, hello) {
			return
		}
	}
	if req.Async {
		job := s.createThemeInstallJob(req)
		s.startThemeInstallJob(r.Context(), job.ID, cfg, req)
		releaseInstall = false
		writeJSON(w, http.StatusAccepted, themeInstallJobResponse{OK: true, Job: job})
		return
	}

	var installLog bytes.Buffer
	result, err := s.runThemeInstall(r.Context(), cfg, req, &installLog)
	if err != nil {
		writeThemeInstallError(w, req.Slot, err)
		return
	}
	s.recordSetupEvent(setupEvent{Stage: stage, Status: "succeeded", Message: installText(req.Slot, "Theme installed.")})
	writeJSON(w, http.StatusOK, struct {
		OK     bool                `json:"ok"`
		Result themeinstall.Result `json:"result"`
		Logs   []string            `json:"logs,omitempty"`
	}{OK: true, Result: result, Logs: splitInstallLog(installLog.String())})
}

// installSlot normalizes the requested slot and returns "" for an unknown one.
func installSlot(raw string) string {
	switch slot := strings.TrimSpace(raw); slot {
	case "", themepack.UsageLive:
		return themepack.UsageLive
	case themepack.UsageScreensaver:
		return themepack.UsageScreensaver
	default:
		return ""
	}
}

func decodeThemeInstallRequest(w http.ResponseWriter, r *http.Request) (themeInstallRequest, bool) {
	var req themeInstallRequest
	contentType := strings.TrimSpace(strings.SplitN(r.Header.Get("Content-Type"), ";", 2)[0])
	if !strings.EqualFold(contentType, "application/zip") {
		return req, decodeJSON(w, r, &req)
	}
	// An upload names its slot in the URL, so a refused screensaver is not
	// called a theme (issue #558).
	slot := strings.TrimSpace(r.URL.Query().Get("slot"))
	refuse := func(status int, code, message, nextAction string) {
		writeError(w, status, code, installText(slot, message), installText(slot, nextAction))
	}

	async := false
	if raw := strings.TrimSpace(r.URL.Query().Get("async")); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			refuse(http.StatusBadRequest, "invalid_theme_install_request", "Theme install request is invalid.", "Try the theme install again.")
			return themeInstallRequest{}, false
		}
		async = parsed
	}
	if r.ContentLength > themepack.MaxZipBytes {
		refuse(http.StatusRequestEntityTooLarge, "theme_pack_too_large", "Theme file is too large.", "Export a smaller theme, then try again.")
		return themeInstallRequest{}, false
	}
	packBytes, ok := readThemePackUpload(w, r, refuse)
	if !ok {
		return themeInstallRequest{}, false
	}
	if len(packBytes) == 0 {
		refuse(http.StatusBadRequest, "empty_theme_pack", "Theme file is empty.", "Export the theme again, then retry.")
		return themeInstallRequest{}, false
	}
	if len(packBytes) > themepack.MaxZipBytes {
		refuse(http.StatusRequestEntityTooLarge, "theme_pack_too_large", "Theme file is too large.", "Export a smaller theme, then try again.")
		return themeInstallRequest{}, false
	}
	if _, err := themepack.LoadZipBytes(packBytes); err != nil {
		refuse(http.StatusBadRequest, "invalid_theme_pack", "Theme file is invalid.", "Export the theme again, then retry.")
		return themeInstallRequest{}, false
	}

	return themeInstallRequest{
		Slot:      slot,
		ThemeID:   strings.TrimSpace(r.URL.Query().Get("themeId")),
		ThemeName: strings.TrimSpace(r.URL.Query().Get("themeName")),
		PackBytes: packBytes,
		Async:     async,
	}, true
}

func readThemePackUpload(w http.ResponseWriter, r *http.Request, refuse func(status int, code, message, nextAction string)) ([]byte, bool) {
	controller := http.NewResponseController(w)
	deadlineSet := false
	if err := controller.SetReadDeadline(time.Now().Add(themePackUploadReadTime)); err != nil {
		if !errors.Is(err, http.ErrNotSupported) {
			refuse(http.StatusInternalServerError, "theme_pack_upload_unavailable", "Theme upload is unavailable.", "Restart the Mac App, then retry.")
			return nil, false
		}
	} else {
		deadlineSet = true
	}

	packBytes, readErr := io.ReadAll(io.LimitReader(r.Body, int64(themepack.MaxZipBytes)+1))
	var resetErr error
	if deadlineSet {
		resetErr = controller.SetReadDeadline(time.Time{})
	}
	if readErr != nil {
		var timeoutErr net.Error
		if errors.Is(readErr, os.ErrDeadlineExceeded) || (errors.As(readErr, &timeoutErr) && timeoutErr.Timeout()) {
			w.Header().Set("Connection", "close")
			refuse(http.StatusRequestTimeout, "theme_pack_upload_timeout", "Theme upload took too long.", "Export the theme again, then retry.")
			return nil, false
		}
		refuse(http.StatusBadRequest, "invalid_theme_pack", "Theme file could not be read.", "Export the theme again, then retry.")
		return nil, false
	}
	if resetErr != nil {
		w.Header().Set("Connection", "close")
		refuse(http.StatusInternalServerError, "theme_pack_upload_unavailable", "Theme upload is unavailable.", "Restart the Mac App, then retry.")
		return nil, false
	}
	return packBytes, true
}

func (s *Server) handleThemeInstallStatus(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	jobID := strings.TrimSpace(r.URL.Query().Get("jobId"))
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "missing_install_job", "Theme install status is missing.", "Start theme install again.")
		return
	}
	job, ok := s.themeInstallJobSnapshot(jobID)
	if !ok {
		writeError(w, http.StatusNotFound, "install_job_not_found", "Theme install status was not found.", "Start theme install again.")
		return
	}
	writeJSON(w, http.StatusOK, themeInstallJobResponse{OK: true, Job: job})
}

func (s *Server) runThemeInstall(ctx context.Context, cfg runtimeconfig.Config, req themeInstallRequest, out io.Writer) (themeinstall.Result, error) {
	installStartedAt := time.Now()
	defer logThemeInstallTiming(out, "total", installStartedAt)

	maintenanceStartedAt := time.Now()
	s.deviceMaintenanceMu.Lock()
	defer s.deviceMaintenanceMu.Unlock()

	s.repairMu.Lock()
	defer s.repairMu.Unlock()

	streamPaused := false
	if s.pauseDisplayStream != nil {
		s.pauseDisplayStream(true)
		streamPaused = true
	}
	logThemeInstallTiming(out, "device-maintenance", maintenanceStartedAt)
	resumeStream := func() {
		if streamPaused && s.pauseDisplayStream != nil {
			s.pauseDisplayStream(false)
			streamPaused = false
		}
	}
	defer resumeStream()

	preflightStartedAt := time.Now()
	latestCfg, err := s.config()
	if err != nil {
		return themeinstall.Result{}, err
	}
	cfg = latestCfg
	cableMode := runtimeconfig.NormalizeConnectionMode(cfg.ConnectionMode) == "cable"
	displayTarget := cfg.DeviceTarget
	if cableMode {
		displayTarget = cableDeviceTarget
	}
	if strings.TrimSpace(cfg.DeviceToken) == "" ||
		(cableMode && strings.TrimSpace(cfg.DeviceID) == "") ||
		(!cableMode && strings.TrimSpace(cfg.DeviceTarget) == "") {
		return themeinstall.Result{}, &statusAPIError{
			status: http.StatusForbidden,
			api: apiError{
				Code:       "pairing_required",
				Message:    "VibeTV pairing is required before installing a theme.",
				NextAction: "Finish VibeTV setup, then retry the theme install.",
			},
		}
	}
	// Only the live slot replaces the selected usage theme and needs a new
	// usage render to baseline and verify afterwards.
	live := req.Slot != themepack.UsageScreensaver
	var baseline deviceHealth
	var cablePort string
	var cableHello protocol.DeviceHello
	if cableMode {
		cablePort, cableHello, err = s.cableControlDevice(cfg)
		if err != nil {
			return themeinstall.Result{}, err
		}
	}
	if live {
		s.clearDisplayVerification(displayTarget)
		if cableMode {
			if !cableHello.HasFeature(protocol.FeatureCableHealthV1) {
				return themeinstall.Result{}, &statusAPIError{
					status: http.StatusConflict,
					api: apiError{
						Code:       "theme_render_verification_unsupported",
						Message:    "This VibeTV cannot verify a live theme over Cable yet.",
						NextAction: "Update VibeTV firmware, then retry the theme install.",
					},
				}
			}
			baseline, err = s.readCableHealth(cablePort, cableHello.DeviceID)
		} else {
			baseline, err = s.captureDisplayRenderBaseline(ctx, cfg.DeviceTarget, cfg.DeviceToken)
		}
		if err != nil {
			return themeinstall.Result{}, &statusAPIError{
				status: http.StatusBadGateway,
				api: apiError{
					Code:       "display_render_failed",
					Message:    "Mac App could not read the current VibeTV screen state.",
					NextAction: "Keep VibeTV powered on, then retry the theme install.",
				},
			}
		}
	}
	logThemeInstallTiming(out, "preflight", preflightStartedAt)

	skipFirmwareUpdate := true
	if req.SkipFirmwareUpdate != nil {
		skipFirmwareUpdate = *req.SkipFirmwareUpdate
	}
	pairedDuringThemeInstall := false
	var cableInstall *themeinstall.CableInstallOptions
	if cableMode {
		cableInstall = &themeinstall.CableInstallOptions{
			Capabilities: protocol.CapabilitiesFromHello(cableHello),
			SendLine:     func(line []byte) error { return s.sendCableLine(cablePort, line) },
			Prepare: func(ctx context.Context, slot string) error {
				return s.prepareCableTheme(ctx, cablePort, cableHello.DeviceID, cfg.DeviceToken, slot)
			},
			Upload: func(ctx context.Context, devicePath string, payload []byte, activation string) error {
				return s.transferCableAsset(ctx, cablePort, cableHello.DeviceID, cfg.DeviceToken, devicePath, activation, payload)
			},
		}
	}
	deviceInstallStartedAt := time.Now()
	result, err := s.installTheme(ctx, themeinstall.Options{
		Slot:               req.Slot,
		ThemeID:            strings.TrimSpace(req.ThemeID),
		PackURL:            strings.TrimSpace(req.PackURL),
		PackBytes:          req.PackBytes,
		PackSHA256:         strings.TrimSpace(req.PackSHA256),
		PackSizeBytes:      req.PackSizeBytes,
		CatalogURL:         strings.TrimSpace(req.CatalogURL),
		Target:             targetWithToken(cfg.DeviceTarget, cfg.DeviceToken),
		SkipFirmwareUpdate: skipFirmwareUpdate,
		Verbose:            true,
		Out:                out,
		HTTPClient:         s.client,
		Cable:              cableInstall,
		PairTokenStore: func(target, token string) error {
			pairedDuringThemeInstall = true
			target = normalizeTarget(target)
			updated, updateErr := s.updateConfig(func(current *runtimeconfig.Config) {
				if target != "" {
					current.DeviceTarget = target
				}
				current.DeviceToken = token
			})
			if updateErr == nil {
				cfg = updated
			}
			return updateErr
		},
	})
	logThemeInstallTiming(out, "device-install", deviceInstallStartedAt)
	if err != nil {
		return themeinstall.Result{}, err
	}
	if len(req.PackBytes) > 0 {
		if err := s.persistThemeRenderPack(req.PackBytes); err != nil {
			fmt.Fprintf(out, "Preview cache: unavailable (%v)\n", err)
		} else {
			fmt.Fprintln(out, "Preview cache: ready")
		}
	}
	if !live {
		// Screensaver selection owns its brief preview. Resume usage without
		// verifying it as a replacement for the selected live theme.
		resumeStream()
		return result, nil
	}
	// Issue #911: the customer already sees the theme with their usage, so the
	// install is done for them. The stream refresh and its check below still
	// run under the same device locks.
	if req.shown != nil && result.LiveFrameShown {
		req.shown(result)
	}
	fmt.Fprintln(out, "Refreshing display stream...")
	resumeStream()
	streamRefreshStartedAt := time.Now()
	streamStartedAt := time.Now().UTC()
	if err := s.startDisplayStream(ctx, displayTarget); err != nil {
		logThemeInstallTiming(out, "stream-refresh", streamRefreshStartedAt)
		return themeinstall.Result{}, &statusAPIError{
			status: http.StatusBadGateway,
			api: apiError{
				Code:       "display_stream_refresh_failed",
				Message:    "Theme installed, but Mac App could not refresh the VibeTV display.",
				NextAction: "Run setup again or restart the Mac App, then retry.",
			},
		}
	}
	var stream displayStreamInfo
	if pairedDuringThemeInstall {
		stream = s.waitForFreshDisplayStreamAfterPair(ctx, displayTarget, streamStartedAt, themeInstallStreamWaitTime)
	} else {
		stream = s.waitForFreshDisplayStreamUpTo(ctx, displayTarget, streamStartedAt, themeInstallStreamWaitTime)
	}
	logThemeInstallTiming(out, "stream-refresh", streamRefreshStartedAt)
	// A stream that restarted, owns this exact VibeTV, and is only held back by
	// provider setup has nothing left to prove about the theme install. It draws
	// no usage picture because no provider is ready, so waiting for one reports
	// a failed install to a customer whose theme is already on the device. The
	// firmware update path makes the same call for the same reason.
	if providerSetupStreamForTarget(&stream, displayTarget) {
		fmt.Fprintln(out, "Display stream: waiting for AI provider")
		return result, nil
	}
	renderVerificationStartedAt := time.Now()
	var health deviceHealth
	if cableMode {
		health, err = s.waitForVerifiedCableDisplayRender(ctx, cablePort, cableHello.DeviceID, cfg.DeviceToken, baseline, stream)
	} else {
		health, err = s.waitForVerifiedDisplayRender(ctx, cfg.DeviceTarget, cfg.DeviceToken, baseline, stream)
	}
	logThemeInstallTiming(out, "render-verification", renderVerificationStartedAt)
	if err != nil {
		if !stream.Healthy {
			return themeinstall.Result{}, &statusAPIError{
				status: http.StatusBadGateway,
				api: apiError{
					Code:       "display_stream_refresh_failed",
					Message:    "Theme installed, but Mac App did not send a fresh image to VibeTV.",
					NextAction: "Keep VibeTV connected and try installing the theme again.",
				},
			}
		}
		return themeinstall.Result{}, &statusAPIError{
			status: http.StatusBadGateway,
			api: apiError{
				Code:       "display_render_failed",
				Message:    "Theme installed, but VibeTV could not redraw the image.",
				NextAction: "Keep VibeTV connected and try installing the theme again.",
			},
		}
	}
	if cableMode {
		device := withDisplayStreamInfo(deviceInfo{
			DeviceID:  cfg.DeviceID,
			Target:    publicTarget(displayTarget),
			Connected: true,
			Paired:    true,
		}, stream)
		if !s.withVerifiedDeviceHealth(device, health, displayTarget, cfg.DeviceToken, true).Ready {
			return themeinstall.Result{}, &statusAPIError{
				status: http.StatusBadGateway,
				api: apiError{
					Code:       "display_stream_refresh_failed",
					Message:    "Theme installed, but the continuous VibeTV display stream is not running.",
					NextAction: "Keep VibeTV connected and try installing the theme again.",
				},
			}
		}
	}
	fmt.Fprintln(out, "Theme render: verified")
	return result, nil
}

func logThemeInstallTiming(out io.Writer, phase string, startedAt time.Time) {
	if out == nil || startedAt.IsZero() {
		return
	}
	fmt.Fprintf(
		out,
		"Theme install timing: phase=%s duration=%s\n",
		strings.TrimSpace(phase),
		time.Since(startedAt).Round(time.Millisecond),
	)
}

func (s *Server) createThemeInstallJob(req themeInstallRequest) themeInstallJob {
	s.installJobsMu.Lock()
	defer s.installJobsMu.Unlock()
	if s.installJobs == nil {
		s.installJobs = make(map[string]*themeInstallJob)
	}
	s.nextInstallJob++
	id := fmt.Sprintf("theme-install-%d-%d", time.Now().UnixNano(), s.nextInstallJob)
	slot := strings.TrimSpace(req.Slot)
	if slot == "" {
		slot = themepack.UsageLive
	}
	job := &themeInstallJob{
		ID:        id,
		ThemeID:   strings.TrimSpace(req.ThemeID),
		ThemeName: strings.TrimSpace(req.ThemeName),
		Slot:      slot,
		Phase:     "installing",
		Progress:  5,
		StartedAt: time.Now().UTC(),
	}
	job.say("Preparing theme install.")
	s.installJobs[id] = job
	return cloneThemeInstallJob(job)
}

// Returns the error code that refused the start, or "" when the install may
// run. Each guard sits under the lock that owns the thing it guards, and both
// are taken in the same order handleRuntimeUpdateHold uses --
// firmwareUpdateStartMu, then installJobsMu -- so a repair and an install can
// never deadlock and one of the two always loses cleanly. Checking the hold
// outside this lock would leave the gap the hold exists to close: an install
// that starts after the Mac App was told it may restart dies with the runtime.
func (s *Server) tryStartThemeInstall() string {
	s.firmwareUpdateStartMu.Lock()
	defer s.firmwareUpdateStartMu.Unlock()
	if s.updateHoldActive() {
		return "mac_app_restarting"
	}
	if _, running := s.activeFirmwareUpdateJob(); running {
		return "firmware_update_in_progress"
	}
	s.installJobsMu.Lock()
	defer s.installJobsMu.Unlock()
	if s.themeInstallActive {
		return "theme_install_in_progress"
	}
	s.themeInstallActive = true
	return ""
}

func (s *Server) finishThemeInstall() {
	s.installJobsMu.Lock()
	s.themeInstallActive = false
	s.installJobsMu.Unlock()
}

// The install finished, but the device cannot draw usage yet. Both the progress
// step and the job's terminal message use this one wording.
const themeInstallAwaitingProviderMessage = "Theme installed. VibeTV shows it once AI usage is ready."

// themeInstallTailWaitTime bounds how long a new install waits for the
// previous one to finish refreshing the display stream after it already
// reported Installed (#911). After that it is refused as before.
var themeInstallTailWaitTime = 30 * time.Second

func (s *Server) startThemeInstallJob(_ context.Context, jobID string, cfg runtimeconfig.Config, req themeInstallRequest) {
	go func() {
		released := false
		release := func() {
			if !released {
				released = true
				s.finishThemeInstall()
			}
		}
		defer release()
		ctx, cancel := context.WithTimeout(context.Background(), themeInstallJobTime)
		defer cancel()
		stage := installText(req.Slot, "theme_install")
		fail := func(apiErr apiError) {
			finishedAt := time.Now().UTC()
			s.recordSetupEvent(setupEvent{Stage: stage, Status: "failed", Message: apiErr.Message, Code: apiErr.Code, NextAction: apiErr.NextAction})
			s.updateThemeInstallJob(jobID, func(job *themeInstallJob) {
				job.Phase = "error"
				job.Progress = 100
				job.FinishedAt = &finishedAt
				job.Error = &apiErr
				job.say("Theme install failed.")
			})
		}
		if !s.waitForThemeInstallTail(ctx) {
			fail(apiError{
				Code:       "theme_install_in_progress",
				Message:    "A theme or screensaver is already being installed.",
				NextAction: "Wait for it to finish, then try again.",
			})
			return
		}
		writer := &themeInstallProgressWriter{server: s, jobID: jobID}
		shownEarly := false
		req.shown = func(result themeinstall.Result) {
			shownEarly = true
			s.completeThemeInstallJob(jobID, stage, req.Slot, result)
			// The next install may start now; it waits for this tail.
			s.beginThemeInstallTail()
			release()
		}
		result, err := s.runThemeInstall(ctx, cfg, req, writer)
		if shownEarly {
			s.endThemeInstallTail()
			// The job already reported Installed. A stream refresh that fails
			// afterwards is kept for support and shows in the device status.
			// The setup log already says Installed, so it gets no "failed"
			// line after it (#939).
			if err != nil {
				_, apiErr := themeInstallErrorPayload(req.Slot, err)
				s.recordTimeline(timeline.Event{Component: stage, State: "failed", Reason: apiErr.Code})
			}
			return
		}
		if err != nil {
			_, apiErr := themeInstallErrorPayload(req.Slot, err)
			fail(apiErr)
			return
		}
		s.completeThemeInstallJob(jobID, stage, req.Slot, result)
	}()
}

func (s *Server) completeThemeInstallJob(jobID, stage, slot string, result themeinstall.Result) {
	finishedAt := time.Now().UTC()
	// A screensaver is stored for standby, not put on screen, so saying it
	// is active would be wrong.
	done := "Theme is active on VibeTV."
	if slot == themepack.UsageScreensaver {
		done = "Screensaver is ready on VibeTV."
	}
	s.recordSetupEvent(setupEvent{Stage: stage, Status: "succeeded", Message: done})
	s.updateThemeInstallJob(jobID, func(job *themeInstallJob) {
		job.Phase = "complete"
		// Without a ready provider the VibeTV keeps drawing the error frame,
		// so "active on VibeTV" would contradict the screen the customer is
		// looking at. The install still succeeded: the provider outcome owns
		// the final message and says what is still missing.
		if job.Message != themeInstallAwaitingProviderMessage {
			job.say(done)
		}
		job.Progress = 100
		job.FinishedAt = &finishedAt
		job.Result = &result
	})
}

// beginThemeInstallTail marks that an install reported Installed and still
// refreshes the display stream.
func (s *Server) beginThemeInstallTail() {
	s.themeInstallTailMu.Lock()
	defer s.themeInstallTailMu.Unlock()
	s.themeInstallTail = make(chan struct{})
}

func (s *Server) endThemeInstallTail() {
	s.themeInstallTailMu.Lock()
	defer s.themeInstallTailMu.Unlock()
	if s.themeInstallTail != nil {
		close(s.themeInstallTail)
		s.themeInstallTail = nil
	}
}

// waitForThemeInstallTail reports whether the previous install's stream
// refresh is over, waiting at most themeInstallTailWaitTime for it.
func (s *Server) waitForThemeInstallTail(ctx context.Context) bool {
	s.themeInstallTailMu.Lock()
	tail := s.themeInstallTail
	s.themeInstallTailMu.Unlock()
	if tail == nil {
		return true
	}
	timer := time.NewTimer(themeInstallTailWaitTime)
	defer timer.Stop()
	select {
	case <-tail:
		return true
	case <-ctx.Done():
		return false
	case <-timer.C:
		return false
	}
}

func (s *Server) updateThemeInstallJob(jobID string, update func(*themeInstallJob)) {
	s.installJobsMu.Lock()
	defer s.installJobsMu.Unlock()
	if s.installJobs == nil {
		return
	}
	job := s.installJobs[jobID]
	if job == nil {
		return
	}
	update(job)
}

func (s *Server) themeInstallJobSnapshot(jobID string) (themeInstallJob, bool) {
	s.installJobsMu.Lock()
	defer s.installJobsMu.Unlock()
	job := s.installJobs[jobID]
	if job == nil {
		return themeInstallJob{}, false
	}
	return cloneThemeInstallJob(job), true
}

func (s *Server) latestThemeInstallJob() (themeInstallJob, bool) {
	s.installJobsMu.Lock()
	defer s.installJobsMu.Unlock()
	var latest *themeInstallJob
	for _, job := range s.installJobs {
		if job == nil || (latest != nil && !job.StartedAt.After(latest.StartedAt)) {
			continue
		}
		latest = job
	}
	if latest == nil {
		return themeInstallJob{}, false
	}
	return cloneThemeInstallJob(latest), true
}

func cloneThemeInstallJob(job *themeInstallJob) themeInstallJob {
	if job == nil {
		return themeInstallJob{}
	}
	clone := *job
	clone.Logs = append([]string(nil), job.Logs...)
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

type themeInstallProgressWriter struct {
	server  *Server
	jobID   string
	pending string
}

func (w *themeInstallProgressWriter) Write(p []byte) (int, error) {
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

func (w *themeInstallProgressWriter) noteLine(line string) {
	line = strings.TrimSpace(line)
	if line == "" || w.server == nil {
		return
	}
	w.server.updateThemeInstallJob(w.jobID, func(job *themeInstallJob) {
		// A job that reported Installed keeps its message while the
		// display stream refresh still writes lines (#911).
		if job.Phase != "installing" {
			return
		}
		message, progress, ok := customerInstallProgress(line, job)
		if !ok {
			return
		}
		if progress > job.Progress {
			job.Progress = progress
		}
		job.say(message)
	})
}

func customerInstallProgress(line string, job *themeInstallJob) (string, int, bool) {
	switch {
	case strings.HasPrefix(line, "Preparing theme:"):
		return "Preparing theme files.", 10, true
	case strings.HasPrefix(line, "Checking device"):
		return "Checking VibeTV.", 20, true
	case strings.HasPrefix(line, "Install screen: showing"):
		return "Showing install screen on VibeTV.", 30, true
	case strings.HasPrefix(line, "Upload interrupted"):
		return "Upload interrupted. Retrying.", max(job.Progress, 40), true
	case strings.HasPrefix(line, "Retrying upload:"):
		return "Retrying theme file upload.", max(job.Progress, 40), true
	case strings.HasPrefix(line, "Uploading theme files"):
		return "Uploading theme files.", 40, true
	case strings.HasPrefix(line, "Uploaded asset:"):
		job.uploads++
		return fmt.Sprintf("Uploaded theme file %d.", job.uploads), min(70, 40+job.uploads*6), true
	case strings.HasPrefix(line, "Uploaded theme spec:"):
		return "Uploaded theme layout.", 76, true
	case strings.HasPrefix(line, "Activating theme"):
		return "Activating theme.", 84, true
	case strings.HasPrefix(line, "Theme activation interrupted"):
		return "Theme activation interrupted. Retrying.", max(job.Progress, 84), true
	case strings.HasPrefix(line, "Theme activation retry"):
		return "Retrying theme activation.", max(job.Progress, 84), true
	case strings.HasPrefix(line, "Theme activation did not settle"):
		return "Waiting for VibeTV to apply theme.", max(job.Progress, 86), true
	case strings.HasPrefix(line, "Live usage frame: refreshed"):
		return "Refreshing live usage.", 90, true
	case strings.HasPrefix(line, "Live usage frame: skipped"):
		return "Waiting for live usage.", 90, true
	case strings.HasPrefix(line, "Refreshing display stream"):
		return "Refreshing display stream.", 94, true
	case strings.HasPrefix(line, "Display stream: refreshed"):
		return "Display stream refreshed.", 98, true
	case strings.HasPrefix(line, "Display stream: waiting for AI provider"):
		return themeInstallAwaitingProviderMessage, 98, true
	case strings.HasPrefix(line, "Done:"):
		return "Theme installed.", 88, true
	default:
		return "", 0, false
	}
}

// installText words text that is written for a theme install for the slot
// installed into: a screensaver install names the screensaver instead.
func installText(slot, text string) string {
	if slot != themepack.UsageScreensaver {
		return text
	}
	return strings.NewReplacer("Theme", "Screensaver", "theme", "screensaver").Replace(text)
}

// say makes message the job's current line and logs it.
func (job *themeInstallJob) say(message string) {
	message = installText(job.Slot, message)
	job.Message = message
	if len(job.Logs) > 0 && job.Logs[len(job.Logs)-1] == message {
		return
	}
	job.Logs = append(job.Logs, message)
	if len(job.Logs) > 12 {
		job.Logs = append([]string(nil), job.Logs[len(job.Logs)-12:]...)
	}
}

func (s *Server) requireThemeInstallPreflight(w http.ResponseWriter, r *http.Request, cfg runtimeconfig.Config, hello protocol.DeviceHello) bool {
	if strings.TrimSpace(cfg.DeviceToken) == "" {
		writeError(
			w,
			http.StatusForbidden,
			"pairing_required",
			"VibeTV pairing is required before installing themes.",
			"Pair VibeTV, then retry install.",
		)
		return false
	}

	caps := protocol.CapabilitiesFromHello(hello)
	if !caps.Known || !caps.SupportsThemeSpecV1 {
		writeError(
			w,
			http.StatusBadRequest,
			"theme_install_unsupported",
			"This VibeTV does not advertise theme install support.",
			"Update VibeTV firmware or use a device that supports ThemeSpec v1.",
		)
		return false
	}
	if runtimeconfig.NormalizeConnectionMode(cfg.ConnectionMode) == "cable" {
		return true
	}

	if _, err := s.getHealth(r.Context(), cfg.DeviceTarget, cfg.DeviceToken); err != nil {
		writeError(
			w,
			http.StatusBadGateway,
			"device_health_failed",
			"VibeTV health check failed before theme install.",
			"Keep VibeTV powered on, confirm it is on the same WiFi, then retry discovery before installing.",
		)
		return false
	}
	return true
}

func splitInstallLog(log string) []string {
	lines := strings.Split(log, "\n")
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			out = append(out, sanitizeLogLine(line))
		}
	}
	return out
}

func validRemoteThemePackURL(raw string) bool {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return true
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return false
	}
	if parsed.User != nil || strings.TrimSpace(parsed.Host) == "" {
		return false
	}
	return strings.EqualFold(parsed.Scheme, "https")
}

func (s *Server) resolveEmbeddedThemePack(r *http.Request, req themeInstallRequest) (themeInstallRequest, error) {
	raw := strings.TrimSpace(req.PackURL)
	if raw == "" {
		return req, nil
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return req, nil
	}
	if !strings.EqualFold(parsed.Scheme, "http") || !strings.EqualFold(parsed.Host, r.Host) {
		return req, nil
	}
	assetPath, ok := normalizeControlCenterAssetPath(parsed.Path)
	if !ok || !strings.HasPrefix(assetPath, "theme-packs/") || !strings.HasSuffix(strings.ToLower(assetPath), ".zip") {
		return req, errors.New("invalid embedded theme pack path")
	}
	info, err := fs.Stat(s.controlCenterFS, assetPath)
	if err != nil || info.IsDir() || info.Size() <= 0 || info.Size() > themepack.MaxZipBytes {
		return req, errors.New("embedded theme pack unavailable")
	}
	data, err := fs.ReadFile(s.controlCenterFS, assetPath)
	if err != nil || len(data) == 0 || len(data) > themepack.MaxZipBytes {
		return req, errors.New("embedded theme pack unavailable")
	}
	req.PackURL = ""
	req.CatalogURL = ""
	req.PackBytes = data
	return req, nil
}

func writeThemeInstallError(w http.ResponseWriter, slot string, err error) {
	status, apiErr := themeInstallErrorPayload(slot, err)
	writeError(w, status, apiErr.Code, apiErr.Message, apiErr.NextAction)
}

// The failure of an install into slot, in the words of that slot: a
// screensaver that failed is not called a theme (issue #558).
func themeInstallErrorPayload(slot string, err error) (int, apiError) {
	var apiStatus *statusAPIError
	if errors.As(err, &apiStatus) {
		api := apiStatus.api
		api.Message = installText(slot, api.Message)
		api.NextAction = installText(slot, api.NextAction)
		return apiStatus.status, api
	}
	code := "theme_install_failed"
	if c := errcode.Of(err); c != "" {
		code = string(c)
	}
	next := installText(slot, errcode.Recovery(err))
	if strings.TrimSpace(next) == "" {
		next = "Keep VibeTV powered on and retry the install."
	}
	// The detail is the engine's own text and stays as it is.
	message := installText(slot, "Theme install failed.")
	if detail := sanitizeErrorDetail(err); detail != "" {
		message = installText(slot, "Theme install failed: ") + detail
	}
	// Issue #498: the theme is on the VibeTV but it cannot draw it. The raw
	// render health is for the support report, not for the customer's dialog.
	if errors.Is(err, themeinstall.ErrThemeNotRendered) {
		code, message, next = "display_render_failed", "VibeTV can't show this theme.", "Choose another theme."
	}
	return http.StatusBadGateway, apiError{
		Code:       code,
		Message:    message,
		NextAction: next,
	}
}
