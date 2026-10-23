package companionapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
)

type repairStageError struct {
	stage    string
	firmware string
	err      error
}

var errDeviceIdentityChanged = errors.New("VibeTV identity changed")

type pairingAuthorizationError struct {
	statusCode int
	err        error
}

func (e *pairingAuthorizationError) Error() string {
	if e == nil || e.err == nil {
		return "pairing authorization rejected"
	}
	return e.err.Error()
}

func (e *pairingAuthorizationError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.err
}

type deviceRepairFlight struct {
	done   chan struct{}
	device deviceInfo
	err    error
}

func (e *repairStageError) Error() string {
	if e == nil || e.err == nil {
		return ""
	}
	return fmt.Sprintf("%s: %v", e.stage, e.err)
}

func (e *repairStageError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.err
}

func (s *Server) handleDeviceSelect(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	var req struct {
		Target           string `json:"target"`
		ExpectedDeviceID string `json:"expectedDeviceId"`
	}
	if !decodeOptionalJSON(w, r, &req) {
		return
	}
	target := strings.TrimSpace(req.Target)
	expectedDeviceID := strings.TrimSpace(req.ExpectedDeviceID)
	if isCableTarget(target) {
		s.selectCableDevice(w, r, expectedDeviceID)
		return
	}
	device, err := s.selectDevice(r.Context(), target, expectedDeviceID)
	if err != nil {
		writeRepairError(w, err)
		return
	}
	s.clearAmbiguousDeviceSelection()
	writeJSON(w, http.StatusOK, deviceActionResponse{OK: true, Device: device})
}

// isCableTarget reports whether target is the Cable selector. Exact match on
// purpose: publicTarget would strip credentials, query and fragment and let a
// malformed selector reach the Cable pairing flow.
func isCableTarget(target string) bool {
	return target == cableDeviceTarget
}

// repairCableDevice: a Cable has no WiFi repair steps (IP search, WiFi token
// pairing, render check). Repair on the Cable re-runs the Cable identity check
// and only answers for a Cable that is the active connection. forcePair runs
// the same Cable pairing as the connection choice and saves the new token.
func (s *Server) repairCableDevice(w http.ResponseWriter, r *http.Request, expectedDeviceID string, forcePair bool) {
	s.firmwareUpdateStartMu.Lock()
	defer s.firmwareUpdateStartMu.Unlock()
	if s.rejectBusyDevice(w, "Wait for the update to finish, then repair the connection again.") {
		return
	}
	defer s.holdDeviceForMaintenance()()
	cfg, err := s.config()
	if err != nil {
		writeInternalError(w, err)
		return
	}
	if runtimeconfig.NormalizeConnectionMode(cfg.ConnectionMode) != "cable" {
		writeError(w, http.StatusConflict, "cable_setup_required", "VibeTV is not connected by Cable.", "Choose Cable for this VibeTV, then try again.")
		return
	}
	port, hello, ok := s.requireCableControlDevice(w, cfg)
	if !ok {
		return
	}
	if err := validateRepairIdentity(cfg, hello, true, expectedDeviceID); err != nil {
		writeRepairError(w, err)
		return
	}
	if forcePair && hello.Capabilities.Auth != nil {
		token, err := s.pairCableDevice(port, hello.DeviceID)
		if err != nil {
			writeError(w, http.StatusBadGateway, "cable_pairing_failed", "VibeTV could not pair through Cable.", "Keep VibeTV connected by Cable, then try again.")
			return
		}
		cfg, err = s.updateConfig(func(current *runtimeconfig.Config) {
			// Keep the WiFi target the Cable connection choice keeps for this device.
			known, isKnown := current.KnownDevice(hello.DeviceID)
			target := current.DeviceTarget
			if isKnown {
				target = known.Target
			} else if !strings.EqualFold(current.DeviceID, hello.DeviceID) {
				target = ""
			}
			current.SetActiveDevice(runtimeconfig.KnownDevice{
				DeviceID:    hello.DeviceID,
				Target:      target,
				DeviceToken: token,
			})
			current.ConnectionMode = "cable"
		})
		if err != nil {
			writeInternalError(w, err)
			return
		}
	}
	device := s.cableDeviceInfo(r.Context(), cfg, hello)
	s.recordRepairResult(device)
	writeJSON(w, http.StatusOK, deviceActionResponse{OK: true, Device: device})
}

// selectCableDevice connects the VibeTV on the Cable through the same switch
// as the connection choice. It never goes through the WiFi repair flow.
func (s *Server) selectCableDevice(w http.ResponseWriter, r *http.Request, expectedDeviceID string) {
	s.firmwareUpdateStartMu.Lock()
	defer s.firmwareUpdateStartMu.Unlock()
	if s.rejectBusyDevice(w, "Wait for the update to finish, then select the VibeTV again.") {
		return
	}
	device := s.selectConnectionMode(w, r, "cable", expectedDeviceID)
	if device == nil {
		return
	}
	s.clearAmbiguousDeviceSelection()
	writeJSON(w, http.StatusOK, deviceActionResponse{OK: true, Device: *device})
}

func (s *Server) handleDeviceRepair(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	var req struct {
		Target           string `json:"target"`
		ExpectedDeviceID string `json:"expectedDeviceId"`
		ForcePair        bool   `json:"forcePair"`
	}
	if !decodeOptionalJSON(w, r, &req) {
		return
	}
	target := strings.TrimSpace(req.Target)
	expectedDeviceID := strings.TrimSpace(req.ExpectedDeviceID)
	if isCableTarget(target) {
		s.repairCableDevice(w, r, expectedDeviceID, req.ForcePair)
		return
	}
	repairCtx, cancel := context.WithTimeout(r.Context(), repairRequestTimeout)
	defer cancel()
	device, err := s.repairDevice(
		repairCtx,
		target,
		expectedDeviceID,
		req.ForcePair,
	)
	if err != nil {
		writeRepairError(w, err)
		return
	}
	s.recordRepairResult(device)
	writeJSON(w, http.StatusOK, deviceActionResponse{OK: true, Device: device})
}

// recordRepairResult logs a repair as done only once VibeTV reports it paired;
// a forced pair can answer before the device confirms it.
func (s *Server) recordRepairResult(device deviceInfo) {
	if device.Paired {
		s.recordSetupEvent(setupEvent{Stage: "device_pair", Status: "succeeded", Message: "VibeTV connection repaired."})
		return
	}
	s.recordSetupEvent(setupEvent{Stage: "device_pair", Status: "started", Message: "Waiting for VibeTV to finish pairing."})
}

func (s *Server) handleDevicePair(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	var req struct {
		Target string `json:"target"`
	}
	if !decodeOptionalJSON(w, r, &req) {
		return
	}
	device, err := s.selectDevice(r.Context(), strings.TrimSpace(req.Target), "")
	if err != nil {
		writeRepairError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, deviceActionResponse{OK: true, Device: device})
}

func (s *Server) repairDevice(
	ctx context.Context,
	requestedTarget string,
	expectedDeviceID string,
	forcePair bool,
) (deviceInfo, error) {
	return s.repairDeviceWithFailureWake(ctx, requestedTarget, expectedDeviceID, forcePair)
}

func (s *Server) repairDeviceWithFailureWake(
	ctx context.Context,
	requestedTarget string,
	expectedDeviceID string,
	forcePair bool,
) (deviceInfo, error) {
	key := s.repairFlightKey(requestedTarget, expectedDeviceID, forcePair)
	s.repairFlightsMu.Lock()
	if s.repairFlights == nil {
		s.repairFlights = make(map[string]*deviceRepairFlight)
	}
	if active := s.repairFlights[key]; active != nil {
		s.repairFlightsMu.Unlock()
		select {
		case <-active.done:
			return active.device, active.err
		case <-ctx.Done():
			return deviceInfo{}, ctx.Err()
		}
	}
	flight := &deviceRepairFlight{done: make(chan struct{})}
	s.repairFlights[key] = flight
	s.repairFlightsMu.Unlock()

	flight.device, flight.err = s.repairDeviceOnce(ctx, requestedTarget, expectedDeviceID, forcePair)
	if flight.err != nil && s.wakeDisplayStream != nil {
		s.wakeDisplayStream()
	}
	s.repairFlightsMu.Lock()
	delete(s.repairFlights, key)
	close(flight.done)
	s.repairFlightsMu.Unlock()
	return flight.device, flight.err
}

func (s *Server) repairFlightKey(requestedTarget, expectedDeviceID string, forcePair bool) string {
	deviceID := strings.ToLower(strings.TrimSpace(expectedDeviceID))
	if deviceID == "" {
		if cfg, err := s.config(); err == nil {
			deviceID = strings.ToLower(strings.TrimSpace(cfg.DeviceID))
		}
	}
	identity := "device:" + deviceID
	if deviceID == "" {
		target := strings.ToLower(normalizeTarget(requestedTarget))
		if target == "" {
			identity = "active-device"
		} else {
			identity = "target:" + target
		}
	}
	return fmt.Sprintf("%t|%s", forcePair, identity)
}

func (s *Server) selectDevice(
	ctx context.Context,
	requestedTarget string,
	expectedDeviceID string,
) (deviceInfo, error) {
	return s.repairDeviceWithFailureWake(ctx, requestedTarget, expectedDeviceID, true)
}

func (s *Server) repairDeviceOnce(
	ctx context.Context,
	requestedTarget string,
	expectedDeviceID string,
	forcePair bool,
) (deviceInfo, error) {
	s.deviceMaintenanceMu.Lock()
	defer s.deviceMaintenanceMu.Unlock()

	s.repairMu.Lock()
	defer s.repairMu.Unlock()
	return s.repairDeviceOnceLocked(ctx, requestedTarget, expectedDeviceID, forcePair)
}

// holdDeviceForMaintenance takes VibeTV for a maintenance step: no other
// maintenance or repair runs and the display stream pauses until the returned
// release runs.
func (s *Server) holdDeviceForMaintenance() (release func()) {
	s.deviceMaintenanceMu.Lock()
	s.repairMu.Lock()
	if s.pauseDisplayStream != nil {
		s.pauseDisplayStream(true)
	}
	return func() {
		if s.pauseDisplayStream != nil {
			s.pauseDisplayStream(false)
		}
		s.repairMu.Unlock()
		s.deviceMaintenanceMu.Unlock()
	}
}

func (s *Server) repairDeviceOnceLocked(
	ctx context.Context,
	requestedTarget string,
	expectedDeviceID string,
	forcePair bool,
) (deviceInfo, error) {

	streamPaused := false
	pauseStream := func() {
		if streamPaused || s.pauseDisplayStream == nil {
			return
		}
		s.pauseDisplayStream(true)
		streamPaused = true
	}
	resumeStream := func() {
		if !streamPaused || s.pauseDisplayStream == nil {
			return
		}
		s.pauseDisplayStream(false)
		streamPaused = false
	}
	pauseStream()
	defer resumeStream()

	cfg, err := s.config()
	if err != nil {
		return deviceInfo{}, &repairStageError{stage: "config", err: err}
	}
	if known, ok := cfg.KnownDevice(expectedDeviceID); ok {
		cfg.DeviceID = known.DeviceID
		cfg.DeviceTarget = known.Target
		cfg.DeviceToken = known.DeviceToken
	}
	pendingTransitionWithoutToken := forcePair && cfg.WiFiTransitionPending() &&
		strings.TrimSpace(cfg.DeviceToken) == ""
	discoveryCfg := cfg
	if forcePair {
		discoveryCfg.DeviceToken = ""
	}
	// An already-paired known device proves its saved token with an
	// authenticated /hello first. Pairing only runs when the device really
	// rejects the token (401/403); a closed pairing window must not break
	// Connect for a device whose saved token still works.
	provenToken := ""
	var target string
	var hello protocol.DeviceHello
	if forcePair {
		if known, ok := cfg.KnownDevice(expectedDeviceID); ok {
			if saved := strings.TrimSpace(known.DeviceToken); saved != "" {
				authCfg := cfg
				authCfg.DeviceToken = saved
				if authTarget, authHello, authErr := s.discoverRepairTarget(ctx, authCfg, requestedTarget); authErr == nil {
					target, hello = authTarget, authHello
					provenToken = saved
				}
			}
		}
	}
	if provenToken == "" {
		target, hello, err = s.discoverRepairTarget(ctx, discoveryCfg, requestedTarget)
	}
	if pendingTransitionWithoutToken && provenToken == "" && err == nil {
		if refreshed, refreshErr := s.config(); refreshErr == nil &&
			strings.EqualFold(refreshed.DeviceID, hello.DeviceID) &&
			strings.TrimSpace(refreshed.DeviceToken) != "" {
			cfg = refreshed
			provenToken = strings.TrimSpace(refreshed.DeviceToken)
		}
	}
	tokenRejected := false
	if err != nil && !forcePair && strings.TrimSpace(cfg.DeviceToken) != "" && deviceAuthorizationRejected(err) {
		discoveryCfg = cfg
		discoveryCfg.DeviceToken = ""
		target, hello, err = s.discoverRepairTarget(ctx, discoveryCfg, requestedTarget)
		if err == nil {
			tokenRejected = true
		}
	}
	if err != nil {
		return deviceInfo{}, err
	}
	if err := validateRepairIdentity(
		cfg,
		hello,
		strings.TrimSpace(requestedTarget) != "",
		expectedDeviceID,
	); err != nil {
		return deviceInfo{}, err
	}

	token := strings.TrimSpace(cfg.DeviceToken)
	if tokenRejected || (token == "" && !forcePair) {
		return deviceInfo{}, &repairStageError{
			stage:    "pair",
			firmware: strings.TrimSpace(hello.Firmware),
			err: &pairingAuthorizationError{
				statusCode: http.StatusUnauthorized,
				err:        errors.New("saved pairing token was rejected or is missing"),
			},
		}
	}
	if forcePair {
		if provenToken != "" {
			token = provenToken
		} else {
			token, err = s.pair(ctx, target, token)
			if err != nil {
				return deviceInfo{}, &repairStageError{
					stage:    "pair",
					firmware: strings.TrimSpace(hello.Firmware),
					err:      err,
				}
			}
		}
		if _, err = s.updateConfig(func(current *runtimeconfig.Config) {
			current.SetActiveDevice(runtimeconfig.KnownDevice{
				DeviceID:    strings.TrimSpace(hello.DeviceID),
				Target:      target,
				DeviceToken: token,
			})
			current.ConnectionMode = "wifi"
			current.DeviceTransports = append(
				[]string(nil),
				hello.Normalize().Capabilities.Transport.Supported...,
			)
		}); err != nil {
			return deviceInfo{}, &repairStageError{stage: "config", err: err}
		}
		// Connect is complete once the new token is persisted. Starting the
		// display stream is deliberately detached: a slow first image must not
		// roll back a successful connection or block the customer.
		s.clearDisplayVerification(target)
		go func(streamTarget string) {
			_ = s.startDisplayStream(context.Background(), streamTarget)
		}(target)
		if refreshedHello, helloErr := s.getHello(ctx, target, token); helloErr == nil {
			hello = refreshedHello
		}
		device := s.withDisplayStream(ctx, target, deviceFromHello(target, token, hello))
		device.Active = true
		readyBeforeHealth := device.Ready
		if health, healthErr := s.getHealthProbe(ctx, target, token, deviceHealthProbeTime); healthErr == nil {
			device = withDeviceHealth(device, health)
			device.Ready = readyBeforeHealth
		} else {
			device = withDeviceHealthProbeError(device, healthErr)
		}
		if device.Ready {
			device.ConnectionState = deviceConnectionReady
		} else {
			device.ConnectionState = deviceConnectionRetrying
			if device.Stream == nil {
				device.Stream = &displayStreamInfo{
					Healthy: false,
					Running: false,
					Target:  target,
					Detail:  "VibeTV is connected. The Mac App will retry the display stream.",
				}
			}
		}
		device.LastSeenAt = s.currentTime().Format(time.RFC3339Nano)
		return device, nil
	}
	s.clearDisplayVerification(target)
	baseline, err := s.captureDisplayRenderBaseline(ctx, target, token)
	if err != nil {
		return deviceInfo{}, &repairStageError{stage: "display-render", err: err}
	}
	resumeStream()
	streamStartedAt := time.Now().UTC()
	if err := s.startDisplayStream(ctx, target); err != nil {
		return deviceInfo{}, &repairStageError{stage: "display-stream", err: err}
	}
	stream := s.waitForFreshDisplayStream(ctx, target, streamStartedAt)
	if !stream.Healthy && stream.ErrorCode == "device_pairing_required" && !forcePair {
		return deviceInfo{}, &repairStageError{stage: "pair", err: &pairingAuthorizationError{
			statusCode: http.StatusUnauthorized,
			err:        errors.New("saved pairing token was rejected"),
		}}
	}
	if refreshedHello, err := s.getHello(ctx, target, token); err == nil {
		hello = refreshedHello
	}
	device := withDisplayStreamInfo(deviceFromHello(target, token, hello), stream)
	var health deviceHealth
	if activeThemeNeedsFullRepairRender(baseline) {
		pauseStream()
		health, err = s.reactivateCurrentThemeAndWaitForFullRender(
			ctx,
			target,
			token,
			baseline,
			stream,
		)
		resumeStream()
	} else {
		health, err = s.waitForVerifiedDisplayRender(ctx, target, token, baseline, stream)
		if activeThemeNeedsFullRepairRender(health) {
			pauseStream()
			health, err = s.reactivateCurrentThemeAndWaitForFullRender(
				ctx,
				target,
				token,
				health,
				stream,
			)
			resumeStream()
		}
	}
	if err != nil {
		if !stream.Healthy {
			return deviceInfo{}, &repairStageError{stage: "display-stream", err: errors.New(displayStreamDiagnosticDetail(streamPointer(stream)))}
		}
		return deviceInfo{}, &repairStageError{stage: "display-render", err: err}
	}
	device = s.withVerifiedDeviceHealth(device, health, target, token, true)
	if !device.Ready {
		return deviceInfo{}, &repairStageError{stage: "display-render", err: errors.New("device is reachable but not ready")}
	}
	if _, err := s.updateConfig(func(current *runtimeconfig.Config) {
		current.SetActiveDevice(runtimeconfig.KnownDevice{
			DeviceID:    strings.TrimSpace(hello.DeviceID),
			Target:      target,
			DeviceToken: token,
		})
		current.ConnectionMode = "wifi"
		current.DeviceTransports = append(
			[]string(nil),
			hello.Normalize().Capabilities.Transport.Supported...,
		)
	}); err != nil {
		return deviceInfo{}, &repairStageError{stage: "config", err: err}
	}
	device.Active = true
	device.ConnectionState = deviceConnectionReady
	device.LastSeenAt = s.currentTime().Format(time.RFC3339Nano)
	return device, nil
}

func (s *Server) discoverRepairTarget(ctx context.Context, cfg runtimeconfig.Config, requestedTarget string) (string, protocol.DeviceHello, error) {
	var lastErr error
	var authorizationErr error
	for _, candidate := range s.repairTargetCandidates(cfg, requestedTarget) {
		target, hello, err := s.discoverForRepair(ctx, cfg, candidate)
		if err == nil {
			return target, hello, nil
		}
		if authorizationErr == nil && deviceAuthorizationRejected(err) {
			authorizationErr = err
		}
		lastErr = err
	}
	if authorizationErr != nil {
		return "", protocol.DeviceHello{}, authorizationErr
	}
	if lastErr == nil {
		lastErr = errors.New("no device candidates")
	}
	return "", protocol.DeviceHello{}, lastErr
}

func (s *Server) repairTargetCandidates(cfg runtimeconfig.Config, requestedTarget string) []string {
	requestedTarget = strings.TrimSpace(requestedTarget)
	if requestedTarget != "" {
		return []string{requestedTarget}
	}
	candidates := []string{strings.TrimSpace(cfg.DeviceTarget)}
	if strings.TrimSpace(cfg.DeviceTarget) == "" {
		candidates = append(candidates, s.recoveredDeviceTargets()...)
	}
	return append(uniqueStrings(candidates...), "")
}

func (s *Server) discoverForRepair(ctx context.Context, cfg runtimeconfig.Config, requestedTarget string) (string, protocol.DeviceHello, error) {
	requestedTarget = strings.TrimSpace(requestedTarget)
	attempts := 1
	if requestedTarget != "" || strings.TrimSpace(cfg.DeviceToken) == "" {
		attempts = repairDiscoveryAttempts
	}

	var lastErr error
	for attempt := 0; attempt < attempts; attempt++ {
		target, hello, err := s.discover(ctx, cfg, requestedTarget)
		if err == nil {
			return target, hello, nil
		}
		lastErr = err
		if !repairDiscoveryErrorIsRetryable(err) || attempt == attempts-1 {
			break
		}
		select {
		case <-ctx.Done():
			return "", protocol.DeviceHello{}, ctx.Err()
		case <-time.After(repairDiscoveryRetryGap):
		}
	}
	return "", protocol.DeviceHello{}, lastErr
}

func (s *Server) recoveredDeviceTargets() []string {
	candidates := []string{}
	if _, target := lastDisplayStreamFrame(s.recoveryDisplayStreamOutLogPath()); strings.TrimSpace(target) != "" {
		candidates = append(candidates, target)
	}
	candidates = append(candidates, s.recoveredConfigDeviceTargets()...)
	normalized := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		target, err := normalizeExplicitDeviceTarget(candidate)
		if err == nil {
			normalized = append(normalized, target)
		}
	}
	return uniqueStrings(normalized...)
}

func (s *Server) recoveryDisplayStreamOutLogPath() string {
	return runtimepaths.DisplayStreamOutLog(s.home)
}

func (s *Server) recoveredConfigDeviceTargets() []string {
	home := strings.TrimSpace(s.home)
	if home == "" {
		return nil
	}
	configDir := filepath.Dir(runtimeconfig.ConfigPath(home))
	type candidateFile struct {
		path    string
		modTime time.Time
	}
	files := []candidateFile{}
	for _, pattern := range runtimeconfig.ConfigBackupFilePatterns() {
		matches, err := filepath.Glob(filepath.Join(configDir, pattern))
		if err != nil {
			continue
		}
		for _, match := range matches {
			info, err := os.Stat(match)
			if err != nil || info.IsDir() {
				continue
			}
			files = append(files, candidateFile{path: match, modTime: info.ModTime()})
		}
	}
	sort.Slice(files, func(i, j int) bool {
		if files[i].modTime.Equal(files[j].modTime) {
			return files[i].path > files[j].path
		}
		return files[i].modTime.After(files[j].modTime)
	})

	targets := make([]string, 0, len(files))
	for _, file := range files {
		raw, err := os.ReadFile(file.path)
		if err != nil {
			continue
		}
		var cfg runtimeconfig.Config
		if err := json.Unmarshal(raw, &cfg); err != nil {
			continue
		}
		if strings.TrimSpace(cfg.DeviceTarget) != "" {
			targets = append(targets, cfg.DeviceTarget)
		}
	}
	return uniqueStrings(targets...)
}

func repairDiscoveryErrorIsRetryable(err error) bool {
	if err == nil {
		return false
	}
	var invalidTarget *invalidTargetError
	if errors.As(err, &invalidTarget) {
		return false
	}
	var multiple *multipleDevicesError
	return !errors.As(err, &multiple)
}

func validateRepairIdentity(
	cfg runtimeconfig.Config,
	hello protocol.DeviceHello,
	explicit bool,
	expectedDeviceID string,
) error {
	hello = hello.Normalize()
	if hello.NetworkMode == "setup" {
		return &repairStageError{stage: "discovery", err: errors.New("VibeTV is still in Wi-Fi setup mode")}
	}
	expectedDeviceID = strings.TrimSpace(expectedDeviceID)
	if expectedDeviceID != "" && !strings.EqualFold(expectedDeviceID, strings.TrimSpace(hello.DeviceID)) {
		return &repairStageError{stage: "discovery", err: errDeviceIdentityChanged}
	}
	if explicit || strings.TrimSpace(cfg.DeviceID) == "" {
		return nil
	}
	if !strings.EqualFold(strings.TrimSpace(cfg.DeviceID), strings.TrimSpace(hello.DeviceID)) {
		return &repairStageError{stage: "discovery", err: errDeviceIdentityChanged}
	}
	return nil
}

func (s *Server) pair(ctx context.Context, target, currentToken string) (string, error) {
	s.pairMu.Lock()
	defer s.pairMu.Unlock()

	proposedToken, err := protocol.NewPairingToken(nil)
	if err != nil {
		return "", err
	}
	attempts := s.pairAttempts
	if attempts <= 0 {
		attempts = 1
	}
	var lastErr error
	for attempt := 1; attempt <= attempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		attemptCtx := ctx
		cancel := func() {}
		if s.pairAttemptTimeout > 0 {
			attemptCtx, cancel = context.WithTimeout(ctx, s.pairAttemptTimeout)
		}
		token, err := s.pairOnce(attemptCtx, target, currentToken, proposedToken)
		cancel()
		if err == nil {
			return token, nil
		}
		lastErr = err
		if pairingAuthorizationRejected(err) {
			break
		}
		if attempt == attempts {
			break
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(s.pairRetryGap):
		}
	}
	return "", fmt.Errorf("pairing failed after %d attempts: %w", attempts, lastErr)
}

func (s *Server) pairOnce(ctx context.Context, target, currentToken, proposedToken string) (string, error) {
	pairURL, err := url.Parse(endpoint(target, "/api/pair"))
	if err != nil {
		return "", err
	}
	query := pairURL.Query()
	query.Set("api", "1")
	pairURL.RawQuery = query.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, pairURL.String(), strings.NewReader(url.Values{"token": {proposedToken}}.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Close = true
	applyDeviceToken(req, currentToken)
	var response struct {
		OK    bool   `json:"ok"`
		Token string `json:"token"`
	}
	if err := s.do(req, &response); err != nil {
		var responseErr *deviceHTTPError
		if errors.As(err, &responseErr) && isPairingAuthorizationStatus(responseErr.statusCode) {
			return "", &pairingAuthorizationError{statusCode: responseErr.statusCode, err: err}
		}
		return "", err
	}
	token := strings.TrimSpace(response.Token)
	if !response.OK || token == "" {
		return "", errors.New("pairing response did not include token")
	}
	return token, nil
}

func pairingAuthorizationRejected(err error) bool {
	_, ok := pairingAuthorizationStatus(err)
	return ok
}

func pairingAuthorizationStatus(err error) (int, bool) {
	var authorizationErr *pairingAuthorizationError
	if !errors.As(err, &authorizationErr) || !isPairingAuthorizationStatus(authorizationErr.statusCode) {
		return 0, false
	}
	return authorizationErr.statusCode, true
}

func isPairingAuthorizationStatus(statusCode int) bool {
	// Current firmware has no WiFi pairing endpoint (404): only the USB cable
	// issues a token.
	return statusCode == http.StatusUnauthorized ||
		statusCode == http.StatusForbidden ||
		statusCode == http.StatusNotFound ||
		statusCode == http.StatusTooManyRequests
}

func writeRepairError(w http.ResponseWriter, err error) {
	var invalidTarget *invalidTargetError
	if errors.As(err, &invalidTarget) {
		writeInvalidDeviceTarget(w)
		return
	}
	var multiple *multipleDevicesError
	if errors.As(err, &multiple) {
		writeDiscoveryError(w, err)
		return
	}
	if errors.Is(err, errDeviceIdentityChanged) {
		writeError(
			w,
			http.StatusConflict,
			"device_identity_changed",
			"That address answered as a different VibeTV.",
			"Check the IP on the VibeTV screen, then try again.",
		)
		return
	}
	var stageErr *repairStageError
	if errors.As(err, &stageErr) {
		switch stageErr.stage {
		case "config":
			writeInternalError(w, err)
			return
		case "pair":
			writePairingError(w, err, stageErr.firmware)
			return
		case "display-stream":
			writeError(w, http.StatusBadGateway, "display_stream_repair_failed", "Mac App could not refresh the VibeTV display stream.", "Run setup again or restart the Mac App, then retry Fix connection.")
			return
		case "display-render":
			writeError(w, http.StatusBadGateway, "display_render_repair_failed", "VibeTV did not render a fresh image.", "Keep VibeTV powered on, then retry Fix connection.")
			return
		}
	}
	writeDeviceNotFound(w)
}

func writePairingError(w http.ResponseWriter, err error, firmware string) {
	statusCode, ok := pairingAuthorizationStatus(err)
	if !ok {
		writeError(
			w,
			http.StatusBadGateway,
			"connect_failed",
			"VibeTV could not connect.",
			"Press Connect again. If it still fails, create a report.",
		)
		return
	}

	if isLegacyPairingFirmware(firmware) &&
		(statusCode == http.StatusUnauthorized || statusCode == http.StatusForbidden) {
		writeError(
			w,
			http.StatusConflict,
			"legacy_pairing_recovery_required",
			"This VibeTV uses an older recovery method.",
			"Follow the recovery steps in Control Center, then press Connect.",
		)
		return
	}

	switch statusCode {
	case http.StatusNotFound:
		writeError(
			w,
			http.StatusConflict,
			"cable_pairing_required",
			"VibeTV pairs only over the USB cable.",
			"Connect VibeTV to this Mac with the USB cable, then press Connect.",
		)
	case http.StatusUnauthorized, http.StatusForbidden:
		writeError(
			w,
			http.StatusConflict,
			"connect_failed",
			"VibeTV could not connect.",
			"Press Connect again. If it still fails, create a report.",
		)
	case http.StatusTooManyRequests:
		writeError(
			w,
			http.StatusTooManyRequests,
			"connect_temporarily_unavailable",
			"VibeTV is temporarily unavailable.",
			"Wait one minute, then press Connect again.",
		)
	}
}

func isLegacyPairingFirmware(firmware string) bool {
	return strings.EqualFold(strings.TrimSpace(firmware), "1.0.38")
}
