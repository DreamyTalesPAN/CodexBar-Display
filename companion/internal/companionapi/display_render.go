package companionapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

var firmwareHealthVerifyTime = 30 * time.Second

// displayStreamWaitTime is how long a normal restart waits for the first frame.
var displayStreamWaitTime = 30 * time.Second

// firmwareStreamVerifyTime is how long the check after a firmware update waits
// for the first frames. The runtime holds its device writes for the whole
// update, and its next frame can land a full 30 s interval after the update
// ends (issue #826), so the normal wait is too short to judge the stream.
var firmwareStreamVerifyTime = 90 * time.Second

type displayVerification struct {
	Token        string
	FullCount    uint64
	PartialCount uint64
	VerifiedAt   time.Time
}

func (s *Server) handleDeviceReloadDisplay(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	s.repairMu.Lock()
	defer s.repairMu.Unlock()
	cfg, hello, ok := s.requireDevice(w, r)
	if !ok {
		return
	}
	if strings.TrimSpace(cfg.DeviceToken) == "" {
		writeError(
			w,
			http.StatusForbidden,
			"pairing_required",
			"VibeTV pairing is required before reloading the image.",
			"Pair VibeTV, then retry.",
		)
		return
	}
	s.clearDisplayVerification(cfg.DeviceTarget)
	baseline, err := s.captureDisplayRenderBaseline(r.Context(), cfg.DeviceTarget, cfg.DeviceToken)
	if err != nil {
		writeError(
			w,
			http.StatusBadGateway,
			"display_reload_failed",
			"Could not read the current VibeTV screen state.",
			"Keep VibeTV powered on, then press Reload image again.",
		)
		return
	}
	streamStartedAt := time.Now().UTC()
	if err := s.startDisplayStream(r.Context(), cfg.DeviceTarget); err != nil {
		writeError(
			w,
			http.StatusBadGateway,
			"display_reload_failed",
			"Could not reload the VibeTV image.",
			"Keep VibeTV powered on, then retry.",
		)
		return
	}
	stream := s.waitForFreshDisplayStream(r.Context(), cfg.DeviceTarget, streamStartedAt)
	device := withDisplayStreamInfo(deviceFromHello(cfg.DeviceTarget, cfg.DeviceToken, hello), stream)
	// There is no image to reload while no provider delivers usage. Name that
	// instead of reporting an unexplained render failure the customer cannot act
	// on.
	if providerSetupStreamForTarget(&stream, cfg.DeviceTarget) {
		writeError(
			w,
			http.StatusConflict,
			"provider_setup_required",
			"VibeTV is connected, but AI usage is not ready yet.",
			"Finish AI setup in the Mac App, then press Reload image again.",
		)
		return
	}
	health, err := s.waitForVerifiedDisplayRender(r.Context(), cfg.DeviceTarget, cfg.DeviceToken, baseline, stream)
	if err != nil {
		writeError(
			w,
			http.StatusBadGateway,
			"display_reload_failed",
			"Could not reload the VibeTV image.",
			"Keep VibeTV powered on, then press Reload image again.",
		)
		return
	}
	device = s.withVerifiedDeviceHealth(device, health, cfg.DeviceTarget, cfg.DeviceToken, true)
	if !device.Ready {
		writeError(
			w,
			http.StatusBadGateway,
			"display_reload_failed",
			"VibeTV did not render a fresh image.",
			"Keep VibeTV powered on, then press Reload image again.",
		)
		return
	}
	device.Active = strings.TrimSpace(cfg.DeviceID) != "" && strings.EqualFold(cfg.DeviceID, device.DeviceID)
	writeJSON(w, http.StatusOK, deviceActionResponse{OK: true, Device: device})
}

func (s *Server) captureDisplayRenderBaseline(ctx context.Context, target, token string) (deviceHealth, error) {
	health, err := s.getHealthProbe(ctx, target, token, deviceHealthProbeTime)
	if err == nil || strings.TrimSpace(token) == "" {
		return health, err
	}
	return s.getHealthProbe(ctx, target, "", deviceHealthProbeTime)
}

func (s *Server) waitForDisplayRenderWithStream(
	ctx context.Context,
	target string,
	token string,
	baseline deviceHealth,
	stream displayStreamInfo,
) (deviceHealth, error) {
	return waitForDisplayRenderWithHealthReader(ctx, target, baseline, stream, func() (deviceHealth, error) {
		return s.getHealth(ctx, target, token)
	})
}

const displayRenderPollInterval = 750 * time.Millisecond

// errDisplayRenderNotAdvanced marks a render check whose last health read
// succeeded but showed the same render counters as the baseline.
var errDisplayRenderNotAdvanced = errors.New("render counters did not advance")

func waitForDisplayRenderWithHealthReader(
	ctx context.Context,
	target string,
	baseline deviceHealth,
	stream displayStreamInfo,
	readHealth func() (deviceHealth, error),
) (deviceHealth, error) {
	return waitForDisplayRenderPolling(ctx, target, baseline, stream, displayRenderWaitTime, displayRenderPollInterval, readHealth)
}

// waitForDisplayRenderPolling is the render check with its wait and poll
// interval as arguments, so tests can run the timeout paths in milliseconds.
func waitForDisplayRenderPolling(
	ctx context.Context,
	target string,
	baseline deviceHealth,
	stream displayStreamInfo,
	wait time.Duration,
	poll time.Duration,
	readHealth func() (deviceHealth, error),
) (deviceHealth, error) {
	deadline := time.Now().Add(wait)
	var last deviceHealth
	var lastErr error
	for {
		health, err := readHealth()
		if err == nil {
			last = health
			if health.OK && renderHealthyFromHealth(health) && displayRenderAdvanced(baseline, health) {
				return health, nil
			}
			if health.OK && correlatedOverlayProvesUsage(baseline, health, stream, target) {
				health.correlatedFrameProof = true
				return health, nil
			}
			detail := strings.TrimSpace(health.Display.ThemeSpec.RenderError)
			switch {
			case detail == "" && !displayRenderAdvanced(baseline, health):
				// A fresh, successful read whose counters did not move: the only
				// result an unchanged live picture may stand in for (#835).
				lastErr = fmt.Errorf("display render not ready: %w", errDisplayRenderNotAdvanced)
			case detail == "":
				lastErr = fmt.Errorf("display render not ready: lastKind=%s", strings.TrimSpace(health.Render.LastKind))
			default:
				lastErr = fmt.Errorf("display render not ready: %s", detail)
			}
		} else {
			lastErr = err
		}
		if time.Now().After(deadline) {
			if lastErr == nil {
				lastErr = errors.New("display render did not become healthy")
			}
			return last, lastErr
		}
		select {
		case <-ctx.Done():
			if lastErr == nil {
				lastErr = ctx.Err()
			}
			return last, lastErr
		case <-time.After(poll):
		}
	}
}

func displayRenderAdvanced(baseline, current deviceHealth) bool {
	baselineFull, baselinePartial, baselineOK := displayRenderCounters(baseline)
	currentFull, currentPartial, currentOK := displayRenderCounters(current)
	return baselineOK && currentOK &&
		currentFull >= baselineFull && currentPartial >= baselinePartial &&
		(currentFull > baselineFull || currentPartial > baselinePartial)
}

func displayRenderCounters(health deviceHealth) (uint64, uint64, bool) {
	if health.Render.FullCount == nil || health.Render.PartialCount == nil {
		return 0, 0, false
	}
	return *health.Render.FullCount, *health.Render.PartialCount, true
}

func renderHealthyFromHealth(health deviceHealth) bool {
	if !renderSurfaceHealthy(health) {
		return false
	}
	return usageRenderKind(health.Render.LastKind)
}

func fullUsageRenderKind(raw string) bool {
	switch strings.TrimSpace(raw) {
	case "usage", "theme_spec_usage":
		return true
	default:
		return false
	}
}

func activeThemeNeedsFullRepairRender(health deviceHealth) bool {
	spec := health.Display.ThemeSpec
	return spec.Active && strings.TrimSpace(spec.Path) != "" && !liveScreenRenderKind(health.Render.LastKind)
}

func renderSurfaceHealthy(health deviceHealth) bool {
	if _, _, ok := displayRenderCounters(health); !ok {
		return false
	}
	spec := health.Display.ThemeSpec
	if !spec.Active {
		// Older firmware may omit ThemeSpec health entirely. If it explicitly
		// reports renderOk while active=false, normal usage frames draw the
		// customer-visible "Theme missing" screen and must never count as ready.
		return spec.RenderOK == nil
	}
	return spec.RenderOK != nil && *spec.RenderOK
}

func usageRenderKind(raw string) bool {
	switch strings.TrimSpace(raw) {
	case "usage", "theme_spec_usage", "theme_spec_frame":
		return true
	default:
		return false
	}
}

func localOverlayRenderKind(raw string) bool {
	switch strings.TrimSpace(raw) {
	case "reset", "update_notice":
		return true
	default:
		return false
	}
}

func liveScreenRenderKind(raw string) bool {
	return usageRenderKind(raw) || localOverlayRenderKind(raw) || strings.TrimSpace(raw) == "clock"
}

func correlatedOverlayProvesUsage(
	baseline deviceHealth,
	current deviceHealth,
	stream displayStreamInfo,
	target string,
) bool {
	baselineFull, baselinePartial, baselineOK := displayRenderCounters(baseline)
	currentFull, currentPartial, currentOK := displayRenderCounters(current)
	if !baselineOK || !currentOK {
		return false
	}
	fullAdvanced := currentFull > baselineFull && currentPartial >= baselinePartial
	overlayPartialAdvanced := localOverlayRenderKind(current.Render.LastKind) &&
		currentFull >= baselineFull && currentPartial > baselinePartial
	if !fullAdvanced && !overlayPartialAdvanced {
		return false
	}
	if !localOverlayRenderKind(current.Render.LastKind) || !renderSurfaceHealthy(current) {
		return false
	}
	if !displayStreamHealthyForTarget(&stream, target) {
		return false
	}
	return true
}

func (s *Server) waitForVerifiedDisplayRender(
	ctx context.Context,
	target string,
	token string,
	baseline deviceHealth,
	stream displayStreamInfo,
) (deviceHealth, error) {
	if s.waitRender != nil {
		health, err := s.waitRender(ctx, target, token, baseline)
		if err != nil && health.OK && correlatedOverlayProvesUsage(baseline, health, stream, target) {
			health.correlatedFrameProof = true
			return health, nil
		}
		return health, err
	}
	return s.waitForDisplayRenderWithStream(ctx, target, token, baseline, stream)
}

func (s *Server) waitForVerifiedCableDisplayRender(
	ctx context.Context,
	port string,
	deviceID string,
	token string,
	baseline deviceHealth,
	stream displayStreamInfo,
) (deviceHealth, error) {
	if s.waitRender != nil {
		health, err := s.waitRender(ctx, cableDeviceTarget, token, baseline)
		if err != nil && health.OK && correlatedOverlayProvesUsage(baseline, health, stream, cableDeviceTarget) {
			health.correlatedFrameProof = true
			return health, nil
		}
		return health, err
	}
	return waitForDisplayRenderWithHealthReader(ctx, cableDeviceTarget, baseline, stream, func() (deviceHealth, error) {
		return s.readCableHealth(port, deviceID)
	})
}

func (s *Server) reactivateCurrentThemeAndWaitForFullRender(
	ctx context.Context,
	target string,
	token string,
	baseline deviceHealth,
	stream displayStreamInfo,
) (deviceHealth, error) {
	themePath := strings.TrimSpace(baseline.Display.ThemeSpec.Path)
	if !baseline.Display.ThemeSpec.Active || themePath == "" {
		return baseline, errors.New("active VibeTV theme path is unavailable")
	}
	var response struct {
		OK bool `json:"ok"`
	}
	if err := s.doJSON(
		ctx,
		http.MethodPost,
		target,
		"/theme/active",
		token,
		struct {
			Path string `json:"path"`
		}{Path: themePath},
		&response,
	); err != nil {
		return baseline, fmt.Errorf("reactivate current VibeTV theme: %w", err)
	}
	if !response.OK {
		return baseline, errors.New("VibeTV did not confirm current theme reactivation")
	}
	health, err := s.waitForVerifiedDisplayRender(ctx, target, token, baseline, stream)
	if err != nil {
		return health, err
	}
	if !fullUsageRenderKind(health.Render.LastKind) && !health.correlatedFrameProof {
		return health, fmt.Errorf("VibeTV did not confirm a full display render: lastKind=%s", strings.TrimSpace(health.Render.LastKind))
	}
	return health, nil
}

func withDeviceHealth(device deviceInfo, health deviceHealth) deviceInfo {
	lastResetAt := ""
	if health.System.UptimeMs > 0 {
		lastResetAt = time.Now().UTC().Add(-time.Duration(health.System.UptimeMs) * time.Millisecond).Format(time.RFC3339Nano)
	}
	device.Health = &deviceHealthInfo{
		OK:          health.OK,
		BootID:      strings.TrimSpace(health.System.BootID),
		UptimeMs:    health.System.UptimeMs,
		ResetCount:  health.System.ResetCount,
		ResetReason: strings.TrimSpace(health.System.ResetReason),
		LastResetAt: lastResetAt,
		RenderKind:  strings.TrimSpace(health.Render.LastKind),
	}
	// Signal strength is negative dBm. A VibeTV that is not on WiFi, such as
	// one on the Cable, reports 31.
	if health.WiFi.RSSI < 0 {
		device.Health.WiFi = &health.WiFi
	}
	device.ActiveTheme = strings.TrimSpace(health.Display.ActiveTheme)
	device.Standby = nil
	if health.Standby != nil {
		device.Standby = &deviceStandbyInfo{
			Active:        health.Standby.Active,
			LiveThemePath: strings.TrimSpace(health.Standby.LiveThemePath),
		}
		// The device reports the slot under settings, not under standby, but it
		// arrives on this same probe. Firmware emits both blocks together, so a
		// health payload without a standby block has no slot worth reporting.
		if health.Settings.Standby != nil &&
			health.Settings.Standby.ScreensaverPath != nil {
			device.Standby.ScreensaverPath = strings.TrimSpace(
				*health.Settings.Standby.ScreensaverPath,
			)
		}
	}
	if health.Display.ThemeSpec.Active || health.Display.ThemeSpec.RenderOK != nil {
		device.Display = &deviceDisplayInfo{
			ThemeSpec: &themeSpecHealth{
				Active:           health.Display.ThemeSpec.Active,
				Path:             strings.TrimSpace(health.Display.ThemeSpec.Path),
				Hash:             strings.TrimSpace(health.Display.ThemeSpec.Hash),
				RenderOK:         health.Display.ThemeSpec.RenderOK,
				RenderError:      strings.TrimSpace(health.Display.ThemeSpec.RenderError),
				RenderErrorAsset: strings.TrimSpace(health.Display.ThemeSpec.RenderErrorAsset),
				RenderFailures:   health.Display.ThemeSpec.RenderFailures,
				cbaBufferBytes:   health.Display.ThemeSpec.CBABufferBytes,
			},
		}
	}
	device.Ready = device.Paired &&
		device.Connected &&
		health.OK &&
		device.Stream != nil &&
		(device.Stream.Healthy || providerSetupStreamForTarget(device.Stream, device.Target)) &&
		renderHealthyFromHealth(health)
	return device
}

func (s *Server) withVerifiedDeviceHealth(
	device deviceInfo,
	health deviceHealth,
	target string,
	token string,
	explicit bool,
) deviceInfo {
	device = withDeviceHealth(device, health)
	// Recompute readiness below with the stricter target, service, and proof
	// checks. withDeviceHealth only attaches the raw health fields.
	device.Ready = false
	target = publicTarget(target)
	token = strings.TrimSpace(token)
	fullCount, partialCount, countersOK := displayRenderCounters(health)
	directRenderProof := renderHealthyFromHealth(health)
	overlayTail := localOverlayRenderKind(health.Render.LastKind)
	liveScreenHealthy := renderSurfaceHealthy(health) && liveScreenRenderKind(health.Render.LastKind)
	healthyExactStream := displayStreamReadyForDevice(device.Stream, target)
	lostResponseStream := displayStreamLostResponseForTarget(device.Stream, target)
	explicitRenderProof := directRenderProof || (overlayTail && health.correlatedFrameProof)
	baseReady := target != "" && token != "" && device.Connected && device.Paired &&
		health.OK && countersOK && liveScreenHealthy && (healthyExactStream || lostResponseStream)
	if !baseReady || (explicit && !explicitRenderProof) {
		if explicit {
			s.clearDisplayVerification(target)
		}
		return device
	}

	now := time.Now().UTC()
	s.verificationMu.Lock()
	if s.displayVerifications == nil {
		s.displayVerifications = make(map[string]displayVerification)
	}
	verification, found := s.displayVerifications[target]
	matchingToken := found && verification.Token == token
	countersRegressed := matchingToken &&
		(fullCount < verification.FullCount || partialCount < verification.PartialCount)
	if countersRegressed {
		delete(s.displayVerifications, target)
		matchingToken = false
	} else if explicit {
		verification = displayVerification{
			Token:        token,
			FullCount:    fullCount,
			PartialCount: partialCount,
			VerifiedAt:   now,
		}
		s.displayVerifications[target] = verification
		matchingToken = true
	}
	verified := matchingToken && !verification.VerifiedAt.IsZero() &&
		now.Sub(verification.VerifiedAt) <= displayVerificationAge
	s.verificationMu.Unlock()

	// A healthy stream is itself a recent, exact-target frame acknowledgement
	// from the expected persistent LaunchAgent. It can keep a live reset or
	// update overlay ready even after the API process restarts and loses its
	// in-memory action proof.
	if healthyExactStream {
		device.Ready = true
		return device
	}
	// The short-lived cache only recovers a direct usage render whose HTTP/log
	// acknowledgement was lost. Local overlay counters never create, renew, or
	// reuse that fallback.
	if !verified || !directRenderProof || !lostResponseStream {
		return device
	}

	stream := *device.Stream
	stream.Healthy = true
	stream.ErrorCode = ""
	stream.Detail = "VibeTV confirmed a freshly rendered image."
	if stream.Target == "" {
		stream.Target = target
	}
	if stream.LastTarget == "" {
		stream.LastTarget = target
	}
	if stream.LastSentAt == "" {
		stream.LastSentAt = verification.VerifiedAt.Format(time.RFC3339)
	}
	device.Stream = &stream
	device.Ready = true
	return device
}

func displayStreamSafeForProof(stream *displayStreamInfo, target string) bool {
	if stream == nil || !stream.Running || strings.TrimSpace(target) == "" {
		return false
	}
	if code := strings.TrimSpace(stream.ErrorCode); code != "" && code != "display_send_failed" {
		return false
	}
	if streamTarget := strings.TrimSpace(stream.Target); streamTarget != "" && !samePublicTarget(target, streamTarget) {
		return false
	}
	if lastTarget := strings.TrimSpace(stream.LastTarget); lastTarget != "" && !samePublicTarget(target, lastTarget) {
		return false
	}
	return true
}

func displayStreamHealthyForTarget(stream *displayStreamInfo, target string) bool {
	return displayStreamSafeForProof(stream, target) &&
		stream.Healthy && strings.TrimSpace(stream.ErrorCode) == "" &&
		strings.TrimSpace(stream.LastTarget) != "" && samePublicTarget(target, stream.LastTarget)
}

func displayStreamReadyForDevice(stream *displayStreamInfo, target string) bool {
	if displayStreamHealthyForTarget(stream, target) {
		return true
	}
	return providerSetupStreamForTarget(stream, target)
}

func providerSetupStreamForTarget(stream *displayStreamInfo, target string) bool {
	return stream != nil && stream.Running &&
		strings.TrimSpace(stream.ErrorCode) == "provider_setup_required" &&
		strings.TrimSpace(stream.Target) != "" && samePublicTarget(target, stream.Target)
}

func displayStreamLostResponseForTarget(stream *displayStreamInfo, target string) bool {
	return displayStreamSafeForProof(stream, target) &&
		!stream.Healthy && strings.TrimSpace(stream.ErrorCode) == "display_send_failed"
}

func (s *Server) clearDisplayVerification(target string) {
	target = publicTarget(target)
	s.verificationMu.Lock()
	defer s.verificationMu.Unlock()
	if target == "" {
		clear(s.displayVerifications)
		return
	}
	delete(s.displayVerifications, target)
}

func withDeviceHealthProbeError(device deviceInfo, err error) deviceInfo {
	if err == nil {
		return device
	}
	device.Health = &deviceHealthInfo{
		OK:    false,
		Error: sanitizeErrorDetail(err),
	}
	device.Ready = false
	return device
}

func renderHealthDiagnosticDetail(spec *themeSpecHealth) string {
	if spec == nil {
		return "VibeTV render health is unavailable."
	}
	if spec.RenderOK == nil {
		return "VibeTV firmware did not report render health."
	}
	if *spec.RenderOK {
		return "VibeTV rendered the current image."
	}
	if spec.RenderError != "" {
		if spec.RenderErrorAsset != "" {
			return "VibeTV could not redraw the current image: " + spec.RenderError +
				" (asset " + spec.RenderErrorAsset + ")."
		}
		return "VibeTV could not redraw the current image: " + spec.RenderError + "."
	}
	return "VibeTV could not redraw the current image."
}
