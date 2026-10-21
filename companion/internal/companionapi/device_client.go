package companionapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

type deviceHTTPError struct {
	statusCode int
	body       string
}

func (e *deviceHTTPError) Error() string {
	if e == nil {
		return ""
	}
	return fmt.Sprintf("device status=%d body=%q", e.statusCode, e.body)
}

type helloProbeSnapshot struct {
	at    time.Time
	hello protocol.DeviceHello
	err   error
}

type helloProbeFlight struct {
	done  chan struct{}
	hello protocol.DeviceHello
	err   error
}

type healthProbeSnapshot struct {
	at     time.Time
	health deviceHealth
	err    error
}

type healthProbeFlight struct {
	done   chan struct{}
	health deviceHealth
	err    error
}

func (s *Server) requireDevice(w http.ResponseWriter, r *http.Request) (runtimeconfig.Config, protocol.DeviceHello, bool) {
	cfg, hello, _, ok := s.requireDeviceIdentity(w, r, false)
	return cfg, hello, ok
}

// requireDeviceIdentity is requireDevice for a caller that says whether the
// identity of the saved VibeTV is enough for it (issue #526). identityOnly
// reports a hello without capabilities: device ID, board, firmware and
// features are real, transport mode, limits and theme capabilities are empty
// because they are not known.
func (s *Server) requireDeviceIdentity(w http.ResponseWriter, r *http.Request, identityIsEnough bool) (
	_ runtimeconfig.Config, _ protocol.DeviceHello, identityOnly bool, _ bool,
) {
	cfg, err := s.config()
	if err != nil {
		writeInternalError(w, err)
		return runtimeconfig.Config{}, protocol.DeviceHello{}, false, false
	}
	if strings.TrimSpace(cfg.DeviceTarget) == "" {
		writeDeviceNotFound(w)
		return runtimeconfig.Config{}, protocol.DeviceHello{}, false, false
	}
	// Reuse the central single-flight probe: a dead device must not occupy the
	// serialized per-host gate for the full 15s device timeout and starve the
	// 5s status poll (head-of-line blocking during cold start).
	hello, err := s.getHelloProbe(r.Context(), cfg.DeviceTarget, cfg.DeviceToken, discoveryProbeTime)
	if identity, ok := protocol.HelloIdentity(err); ok && identityIsEnough &&
		strings.EqualFold(strings.TrimSpace(cfg.DeviceID), identity.DeviceID) && !cfg.WiFiTransitionPending() {
		// Whether a WiFi transition is pending on the device is not known
		// either, so only a VibeTV this Mac is not waiting for passes.
		return cfg, identity, true, true
	}
	if err != nil {
		// A read-only status poll must never fan out into a subnet scan. The
		// Control Center polls this endpoint frequently; when VibeTV is offline,
		// overlapping scans can consume every ESP8266 receive buffer just as a
		// recovery or OTA update starts. Discovery remains available through the
		// explicit /v1/device/discover and /v1/device/repair actions.
		writeDeviceNotFound(w)
		return runtimeconfig.Config{}, protocol.DeviceHello{}, false, false
	}
	if err := s.confirmPendingWiFiTransition(
		r.Context(), cfg.DeviceTarget, cfg.DeviceToken, cfg.DeviceID, hello,
	); err != nil {
		writeDeviceNotFound(w)
		return runtimeconfig.Config{}, protocol.DeviceHello{}, false, false
	}
	return cfg, hello, false, true
}

func (s *Server) getHello(ctx context.Context, target, token string) (protocol.DeviceHello, error) {
	var hello protocol.DeviceHello
	if err := s.doJSON(ctx, http.MethodGet, target, "/hello", token, nil, &hello); err != nil {
		return protocol.DeviceHello{}, err
	}
	hello = hello.Normalize()
	if hello.Capabilities.Transport.Mode == "legacy-wifi-only" {
		// Every WiFi hello passes here, so no caller can miss legacy mode.
		s.rememberLegacyWiFiDevice(hello.DeviceID)
	}
	return hello, nil
}

func (s *Server) getHelloProbe(ctx context.Context, target, token string, timeout time.Duration) (protocol.DeviceHello, error) {
	if timeout <= 0 || s.probeCacheTime <= 0 {
		return s.getHelloProbeDirect(ctx, target, token, timeout)
	}
	key := deviceProbeKey(target, token)
	now := s.currentTime()
	s.probeMu.Lock()
	if cached, ok := s.helloProbeCache[key]; ok && now.Sub(cached.at) < s.probeCacheTime {
		s.probeMu.Unlock()
		return cached.hello, cached.err
	}
	if flight := s.helloProbeFlights[key]; flight != nil {
		s.probeMu.Unlock()
		select {
		case <-flight.done:
			return flight.hello, flight.err
		case <-ctx.Done():
			return protocol.DeviceHello{}, ctx.Err()
		}
	}
	flight := &helloProbeFlight{done: make(chan struct{})}
	s.helloProbeFlights[key] = flight
	s.probeMu.Unlock()
	go s.runHelloProbeFlight(key, target, token, timeout, flight)
	select {
	case <-flight.done:
		return flight.hello, flight.err
	case <-ctx.Done():
		return protocol.DeviceHello{}, ctx.Err()
	}
}

func (s *Server) runHelloProbeFlight(
	key string,
	target string,
	token string,
	timeout time.Duration,
	flight *helloProbeFlight,
) {
	hello, err := s.getHelloProbeDirect(context.Background(), target, token, timeout)
	s.probeMu.Lock()
	flight.hello = hello
	flight.err = err
	s.helloProbeCache[key] = helloProbeSnapshot{at: s.currentTime(), hello: hello, err: err}
	delete(s.helloProbeFlights, key)
	close(flight.done)
	s.probeMu.Unlock()
}

func (s *Server) getHelloProbeDirect(ctx context.Context, target, token string, timeout time.Duration) (protocol.DeviceHello, error) {
	if timeout <= 0 {
		return s.getHello(ctx, target, token)
	}
	probeCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	return s.getHello(probeCtx, target, token)
}

func (s *Server) getHelloProbeWithTokenFallback(ctx context.Context, target, token string, timeout time.Duration) (protocol.DeviceHello, string, bool, error) {
	hello, err := s.getHelloProbe(ctx, target, token, timeout)
	if err == nil || strings.TrimSpace(token) == "" {
		return hello, strings.TrimSpace(token), false, err
	}
	tokenlessHello, tokenlessErr := s.getHelloProbe(ctx, target, "", timeout)
	if tokenlessErr == nil {
		return tokenlessHello, "", deviceAuthorizationRejected(err), nil
	}
	return protocol.DeviceHello{}, strings.TrimSpace(token), deviceAuthorizationRejected(err), err
}

func deviceAuthorizationRejected(err error) bool {
	var responseErr *deviceHTTPError
	return errors.As(err, &responseErr) &&
		(responseErr.statusCode == http.StatusUnauthorized || responseErr.statusCode == http.StatusForbidden)
}

type deviceHealth struct {
	OK       bool               `json:"ok"`
	Settings deviceSettings     `json:"settings"`
	Standby  *deviceStandbyInfo `json:"standby"`
	// correlatedFrameProof is set only by the companion after it correlates a
	// fresh, target-matching stream acknowledgement with device render counters.
	// It is intentionally not populated from device JSON.
	correlatedFrameProof bool
	System               struct {
		BootID      string `json:"bootId"`
		UptimeMs    uint64 `json:"uptimeMs"`
		ResetCount  uint32 `json:"resetCount"`
		ResetReason string `json:"resetReason"`
	} `json:"system"`
	WiFi    deviceWiFiHealth `json:"wifi"`
	Display struct {
		ActiveTheme string `json:"activeTheme"`
		ThemeSpec   struct {
			Active           bool   `json:"active"`
			Path             string `json:"path"`
			Hash             string `json:"hash"`
			RenderOK         *bool  `json:"renderOk"`
			RenderError      string `json:"renderError"`
			RenderErrorAsset string `json:"renderErrorAsset"`
			RenderFailures   uint64 `json:"renderFailures"`
			CBABufferBytes   uint64 `json:"cbaBufferBytes"`
		} `json:"themeSpec"`
	} `json:"display"`
	Render struct {
		FullCount    *uint64 `json:"fullCount"`
		PartialCount *uint64 `json:"partialCount"`
		LastKind     string  `json:"lastKind"`
	} `json:"render"`
}

func (s *Server) getHealth(ctx context.Context, target, token string) (deviceHealth, error) {
	var health deviceHealth
	if err := s.doJSON(ctx, http.MethodGet, target, "/health", token, nil, &health); err != nil {
		return deviceHealth{}, err
	}
	// Every reading over WiFi passes here, so each device answer counts once
	// however many callers reuse it. The Cable reads health another way and
	// never gets the flag.
	health.WiFi.Weak, health.WiFi.Recovered = s.wifiSignalState(target, health.WiFi.RSSI)
	return health, nil
}

func (s *Server) getHealthProbe(ctx context.Context, target, token string, timeout time.Duration) (deviceHealth, error) {
	if timeout <= 0 || s.probeCacheTime <= 0 {
		return s.getHealthProbeDirect(ctx, target, token, timeout)
	}
	key := deviceProbeKey(target, token)
	now := s.currentTime()
	s.probeMu.Lock()
	if cached, ok := s.healthProbeCache[key]; ok && now.Sub(cached.at) < s.probeCacheTime {
		s.probeMu.Unlock()
		return cached.health, cached.err
	}
	if flight := s.healthProbeFlights[key]; flight != nil {
		s.probeMu.Unlock()
		select {
		case <-flight.done:
			return flight.health, flight.err
		case <-ctx.Done():
			return deviceHealth{}, ctx.Err()
		}
	}
	flight := &healthProbeFlight{done: make(chan struct{})}
	s.healthProbeFlights[key] = flight
	s.probeMu.Unlock()
	go s.runHealthProbeFlight(key, target, token, timeout, flight)
	select {
	case <-flight.done:
		return flight.health, flight.err
	case <-ctx.Done():
		return deviceHealth{}, ctx.Err()
	}
}

func (s *Server) runHealthProbeFlight(
	key string,
	target string,
	token string,
	timeout time.Duration,
	flight *healthProbeFlight,
) {
	health, err := s.getHealthProbeDirect(context.Background(), target, token, timeout)
	s.probeMu.Lock()
	flight.health = health
	flight.err = err
	s.healthProbeCache[key] = healthProbeSnapshot{at: s.currentTime(), health: health, err: err}
	delete(s.healthProbeFlights, key)
	close(flight.done)
	s.probeMu.Unlock()
}

func (s *Server) getHealthProbeDirect(ctx context.Context, target, token string, timeout time.Duration) (deviceHealth, error) {
	if timeout <= 0 {
		return s.getHealth(ctx, target, token)
	}
	probeCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	return s.getHealth(probeCtx, target, token)
}

func deviceProbeKey(target, token string) string {
	return normalizeTarget(target) + "\x00" + strings.TrimSpace(token)
}

func (s *Server) doJSON(ctx context.Context, method, target, path, token string, body any, out any) error {
	if s.firmwareUpdateActive.Load() {
		return errors.New("VibeTV firmware update is in progress")
	}
	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(payload)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint(target, path), reader)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	applyDeviceToken(req, token)
	return s.do(req, out)
}

func (s *Server) doForm(ctx context.Context, target, path, token string, form url.Values, out any) error {
	if s.firmwareUpdateActive.Load() {
		return errors.New("VibeTV firmware update is in progress")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint(target, path), strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	applyDeviceToken(req, token)
	return s.do(req, out)
}

func (s *Server) do(req *http.Request, out any) error {
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return &deviceHTTPError{
			statusCode: resp.StatusCode,
			body:       strings.TrimSpace(string(body)),
		}
	}
	if out == nil {
		return nil
	}
	if hello, ok := out.(*protocol.DeviceHello); ok {
		*hello, err = protocol.DecodeWiFiHello(resp.Body)
		return err
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func deviceFromHello(target, token string, hello protocol.DeviceHello) deviceInfo {
	hello = hello.Normalize()
	caps := protocol.CapabilitiesFromHello(hello)
	var capabilityBlock *protocol.CapabilityBlock
	if caps.Known {
		capabilityBlock = &hello.Capabilities
	}
	return deviceInfo{
		Target:       publicTarget(target),
		DeviceID:     hello.DeviceID,
		NetworkMode:  hello.NetworkMode,
		Connected:    caps.Known,
		Paired:       strings.TrimSpace(token) != "",
		Board:        caps.Board,
		Firmware:     caps.Firmware,
		Capabilities: capabilityBlock,
	}
}

func supportsTransport(hello protocol.DeviceHello, transport string) bool {
	transport = strings.TrimSpace(strings.ToLower(transport))
	for _, supported := range hello.Normalize().Capabilities.Transport.Supported {
		if supported == transport {
			return true
		}
	}
	return false
}

func endpoint(target, path string) string {
	base := normalizeTarget(target)
	return strings.TrimRight(base, "/") + path
}

func normalizeTarget(target string) string {
	target = strings.TrimSpace(target)
	if target == "" {
		return ""
	}
	if !strings.Contains(target, "://") {
		target = "http://" + target
	}
	parsed, err := url.Parse(target)
	if err != nil {
		return target
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}

func normalizeExplicitDeviceTarget(target string) (string, error) {
	target = strings.TrimSpace(target)
	if target == "" {
		return "", &invalidTargetError{}
	}
	if !strings.Contains(target, "://") {
		target = "http://" + target
	}
	parsed, err := url.Parse(target)
	if err != nil {
		return "", &invalidTargetError{target: target}
	}
	if parsed.User != nil || strings.TrimSpace(parsed.Host) == "" {
		return "", &invalidTargetError{target: target}
	}
	if !validExplicitTargetPort(parsed) {
		return "", &invalidTargetError{target: target}
	}
	if !strings.EqualFold(parsed.Scheme, "http") && !strings.EqualFold(parsed.Scheme, "https") {
		return "", &invalidTargetError{target: target}
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return "", &invalidTargetError{target: target}
	}
	if strings.TrimSpace(parsed.RawQuery) != "" || strings.TrimSpace(parsed.Fragment) != "" {
		return "", &invalidTargetError{target: target}
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	return parsed.String(), nil
}

func validExplicitTargetPort(parsed *url.URL) bool {
	port := parsed.Port()
	if port == "" {
		return !strings.HasSuffix(parsed.Host, ":")
	}
	value, err := strconv.Atoi(port)
	return err == nil && value > 0 && value <= 65535
}

func publicTarget(target string) string {
	target = normalizeTarget(target)
	if target == "" {
		return ""
	}
	parsed, err := url.Parse(target)
	if err != nil {
		return target
	}
	parsed.User = nil
	return parsed.String()
}

func targetWithToken(target, token string) string {
	base := normalizeTarget(target)
	token = strings.TrimSpace(token)
	if base == "" || token == "" {
		return base
	}
	parsed, err := url.Parse(base)
	if err != nil {
		return base
	}
	query := parsed.Query()
	query.Set("token", token)
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func applyDeviceToken(req *http.Request, token string) {
	if token = strings.TrimSpace(token); token != "" {
		req.Header.Set("X-VibeTV-Token", token)
	}
}
