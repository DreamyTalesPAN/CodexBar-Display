package companionapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/buildinfo"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/setup"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themeinstall"
)

const (
	DefaultAddr        = "127.0.0.1:47832"
	appOrigin          = "https://app.vibetv.shop"
	defaultDevOrigin   = "http://localhost:3000"
	deviceTimeout      = 15 * time.Second
	discoveryProbeTime = 1500 * time.Millisecond
	subnetProbeLimit   = 32
	subnetProbeTime    = 450 * time.Millisecond
	themeInstallEnv    = "VIBETV_ENABLE_WIFI_THEME_INSTALL"
)

type Options struct {
	Addr           string
	Home           string
	AllowedOrigins []string
	HTTPClient     *http.Client
}

type Server struct {
	addr           string
	home           string
	allowedOrigins map[string]struct{}
	client         *http.Client
	loadConfig     func(string) (runtimeconfig.Config, error)
	saveConfig     func(string, runtimeconfig.Config) error
	installTheme   func(context.Context, themeinstall.Options) (themeinstall.Result, error)
	subnetTargets  func() []string
}

type apiError struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	NextAction string `json:"nextAction"`
}

type errorResponse struct {
	OK    bool     `json:"ok"`
	Error apiError `json:"error"`
}

type multipleDevicesError struct {
	targets []string
}

func (e *multipleDevicesError) Error() string {
	if e == nil || len(e.targets) == 0 {
		return "multiple VibeTV devices found"
	}
	return fmt.Sprintf("multiple VibeTV devices found: %s", strings.Join(e.targets, ", "))
}

type invalidTargetError struct {
	target string
}

func (e *invalidTargetError) Error() string {
	return "invalid VibeTV target"
}

type deviceInfo struct {
	Target       string                    `json:"target,omitempty"`
	Connected    bool                      `json:"connected"`
	Paired       bool                      `json:"paired,omitempty"`
	Board        string                    `json:"board,omitempty"`
	Firmware     string                    `json:"firmware,omitempty"`
	ActiveTheme  string                    `json:"activeTheme,omitempty"`
	Capabilities *protocol.CapabilityBlock `json:"capabilities,omitempty"`
}

type statusResponse struct {
	OK        bool       `json:"ok"`
	Companion companion  `json:"companion"`
	Device    deviceInfo `json:"device"`
}

type diagnosticsResponse struct {
	OK          bool              `json:"ok"`
	GeneratedAt string            `json:"generatedAt"`
	Companion   companion         `json:"companion"`
	Device      deviceInfo        `json:"device"`
	Checks      []diagnosticCheck `json:"checks"`
}

type diagnosticCheck struct {
	Name       string `json:"name"`
	Status     string `json:"status"`
	Detail     string `json:"detail,omitempty"`
	ErrorCode  string `json:"errorCode,omitempty"`
	NextAction string `json:"nextAction,omitempty"`
}

type companion struct {
	Status   string            `json:"status"`
	Version  string            `json:"version"`
	Features companionFeatures `json:"features"`
}

type companionFeatures struct {
	ThemeInstallEnabled bool `json:"themeInstallEnabled"`
}

type settingsResponse struct {
	OK       bool           `json:"ok"`
	Settings deviceSettings `json:"settings"`
	Device   deviceInfo     `json:"device,omitempty"`
}

type deviceSettings struct {
	Display displaySettings `json:"display"`
}

type displaySettings struct {
	BrightnessPercent int `json:"brightnessPercent"`
}

func New(opts Options) (*Server, error) {
	addr := strings.TrimSpace(opts.Addr)
	if addr == "" {
		addr = DefaultAddr
	}
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, fmt.Errorf("parse companion api addr: %w", err)
	}
	if host != "127.0.0.1" {
		return nil, fmt.Errorf("companion api must bind to 127.0.0.1, got %s", host)
	}
	home := strings.TrimSpace(opts.Home)
	if home == "" {
		home, err = os.UserHomeDir()
		if err != nil {
			return nil, fmt.Errorf("resolve home directory: %w", err)
		}
	}
	client := opts.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: deviceTimeout}
	}
	origins := map[string]struct{}{
		appOrigin:        {},
		defaultDevOrigin: {},
	}
	for _, origin := range opts.AllowedOrigins {
		origin = strings.TrimSpace(origin)
		if origin != "" {
			origins[origin] = struct{}{}
		}
	}
	return &Server{
		addr:           addr,
		home:           home,
		allowedOrigins: origins,
		client:         client,
		loadConfig:     runtimeconfig.Load,
		saveConfig:     runtimeconfig.Save,
		installTheme:   themeinstall.Install,
		subnetTargets:  localSubnetTargets,
	}, nil
}

func (s *Server) ListenAndServe(ctx context.Context) error {
	server := &http.Server{
		Addr:              s.addr,
		Handler:           s.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	errc := make(chan error, 1)
	go func() {
		err := server.ListenAndServe()
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
		errc <- err
	}()
	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			return err
		}
		return <-errc
	case err := <-errc:
		return err
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/status", s.handleStatus)
	mux.HandleFunc("/v1/diagnostics", s.handleDiagnostics)
	mux.HandleFunc("/v1/device/discover", s.handleDeviceDiscover)
	mux.HandleFunc("/v1/device", s.handleDevice)
	mux.HandleFunc("/v1/device/pair", s.handleDevicePair)
	mux.HandleFunc("/v1/settings", s.handleSettings)
	mux.HandleFunc("/v1/themes/install", s.handleThemeInstall)
	return s.withCORS(mux)
}

func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		_, allowed := s.allowedOrigins[origin]
		if origin != "" && allowed {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			if strings.EqualFold(strings.TrimSpace(r.Header.Get("Access-Control-Request-Private-Network")), "true") {
				w.Header().Set("Access-Control-Allow-Private-Network", "true")
			}
		}
		if r.Method == http.MethodOptions {
			if origin != "" && !allowed {
				writeError(w, http.StatusForbidden, "cors_origin_not_allowed", "Origin is not allowed.", "Open the hosted VibeTV app or the configured local dev origin.")
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	cfg, _ := s.loadConfig(s.home)
	writeJSON(w, http.StatusOK, statusResponse{
		OK:        true,
		Companion: s.companionInfo(),
		Device: deviceInfo{
			Target:    publicTarget(cfg.DeviceTarget),
			Connected: false,
			Paired:    strings.TrimSpace(cfg.DeviceToken) != "",
		},
	})
}

func (s *Server) handleDiagnostics(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	cfg, err := s.config()
	if err != nil {
		writeInternalError(w, err)
		return
	}

	checks := []diagnosticCheck{
		{
			Name:   "companion_api",
			Status: "pass",
			Detail: "Companion API is responding on loopback.",
		},
	}
	if themeInstallEnabled() {
		checks = append(checks, diagnosticCheck{
			Name:   "theme_install_gate",
			Status: "attention",
			Detail: "Theme install write gate is enabled.",
		})
	} else {
		checks = append(checks, diagnosticCheck{
			Name:       "theme_install_gate",
			Status:     "locked",
			Detail:     "Theme install write gate is disabled.",
			NextAction: "Enable only during an approved hardware test window.",
		})
	}

	device := deviceInfo{
		Target:    publicTarget(cfg.DeviceTarget),
		Connected: false,
		Paired:    strings.TrimSpace(cfg.DeviceToken) != "",
	}
	if strings.TrimSpace(cfg.DeviceTarget) == "" {
		checks = append(checks, diagnosticCheck{
			Name:       "device_target",
			Status:     "attention",
			Detail:     "No VibeTV target is configured.",
			ErrorCode:  "device_target_missing",
			NextAction: "Run device discovery or enter the exact VibeTV target in the VibeTV target field.",
		})
		writeJSON(w, http.StatusOK, diagnosticsResponse{
			OK:          true,
			GeneratedAt: time.Now().UTC().Format(time.RFC3339),
			Companion:   s.companionInfo(),
			Device:      device,
			Checks:      checks,
		})
		return
	}

	checks = append(checks, diagnosticCheck{
		Name:   "device_target",
		Status: "pass",
		Detail: publicTarget(cfg.DeviceTarget),
	})
	hello, err := s.getHelloProbe(r.Context(), cfg.DeviceTarget, cfg.DeviceToken, discoveryProbeTime)
	if err != nil {
		checks = append(checks, diagnosticCheck{
			Name:       "device_hello",
			Status:     "fail",
			Detail:     sanitizeErrorDetail(err),
			ErrorCode:  "device_hello_failed",
			NextAction: "Keep VibeTV powered on, then run discovery again.",
		})
		writeJSON(w, http.StatusOK, diagnosticsResponse{
			OK:          true,
			GeneratedAt: time.Now().UTC().Format(time.RFC3339),
			Companion:   s.companionInfo(),
			Device:      device,
			Checks:      checks,
		})
		return
	}

	device = deviceFromHello(cfg.DeviceTarget, cfg.DeviceToken, hello)
	checks = append(checks, diagnosticCheck{
		Name:   "device_hello",
		Status: "pass",
		Detail: "VibeTV /hello is reachable.",
	})
	health, err := s.getHealth(r.Context(), cfg.DeviceTarget, cfg.DeviceToken)
	if err != nil {
		checks = append(checks, diagnosticCheck{
			Name:       "device_health",
			Status:     "attention",
			Detail:     sanitizeErrorDetail(err),
			ErrorCode:  "device_health_failed",
			NextAction: "Read-only device discovery works; retry settings or check firmware health.",
		})
	} else {
		device.ActiveTheme = strings.TrimSpace(health.Display.ActiveTheme)
		checks = append(checks, diagnosticCheck{
			Name:   "device_health",
			Status: "pass",
			Detail: "VibeTV /health is reachable.",
		})
	}

	writeJSON(w, http.StatusOK, diagnosticsResponse{
		OK:          true,
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Companion:   s.companionInfo(),
		Device:      device,
		Checks:      checks,
	})
}

func (s *Server) companionInfo() companion {
	return companion{
		Status:  "ready",
		Version: buildinfo.NormalizedVersion(),
		Features: companionFeatures{
			ThemeInstallEnabled: themeInstallEnabled(),
		},
	}
}

func (s *Server) handleDeviceDiscover(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	var req struct {
		Target string `json:"target"`
	}
	if !decodeOptionalJSON(w, r, &req) {
		return
	}
	cfg, err := s.config()
	if err != nil {
		writeInternalError(w, err)
		return
	}
	target, hello, err := s.discover(r.Context(), cfg, req.Target)
	if err != nil {
		writeDiscoveryError(w, err)
		return
	}
	cfg.DeviceTarget = target
	if err := s.saveConfig(s.home, cfg); err != nil {
		writeInternalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		OK     bool       `json:"ok"`
		Device deviceInfo `json:"device"`
	}{OK: true, Device: deviceFromHello(target, cfg.DeviceToken, hello)})
}

func (s *Server) handleDevice(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	cfg, err := s.config()
	if err != nil {
		writeInternalError(w, err)
		return
	}
	if strings.TrimSpace(cfg.DeviceTarget) == "" {
		writeDeviceNotFound(w)
		return
	}
	hello, err := s.getHello(r.Context(), cfg.DeviceTarget, cfg.DeviceToken)
	if err != nil {
		writeDeviceNotFound(w)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		OK     bool       `json:"ok"`
		Device deviceInfo `json:"device"`
	}{OK: true, Device: deviceFromHello(cfg.DeviceTarget, cfg.DeviceToken, hello)})
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
	cfg, err := s.config()
	if err != nil {
		writeInternalError(w, err)
		return
	}
	requestedTarget := strings.TrimSpace(req.Target)
	target := requestedTarget
	if requestedTarget != "" {
		normalizedTarget, targetErr := normalizeExplicitDeviceTarget(requestedTarget)
		if targetErr != nil {
			writeInvalidDeviceTarget(w)
			return
		}
		target = normalizedTarget
	}
	if target == "" {
		target = strings.TrimSpace(cfg.DeviceTarget)
	}
	if target == "" {
		discoveredTarget, _, discoverErr := s.discover(r.Context(), cfg, "")
		if discoverErr != nil {
			writeDiscoveryError(w, discoverErr)
			return
		}
		target = discoveredTarget
	}
	token, err := s.pair(r.Context(), target)
	if err != nil && requestedTarget == "" {
		discoveredTarget, _, discoverErr := s.discover(r.Context(), cfg, "")
		if discoverErr != nil {
			writeDiscoveryError(w, discoverErr)
			return
		}
		if discoveredTarget != target {
			target = discoveredTarget
			token, err = s.pair(r.Context(), target)
		}
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, "pair_failed", "VibeTV pairing failed.", "Keep VibeTV powered on, then retry pairing.")
		return
	}
	cfg.DeviceTarget = target
	cfg.DeviceToken = token
	if err := s.saveConfig(s.home, cfg); err != nil {
		writeInternalError(w, err)
		return
	}
	hello, _ := s.getHello(r.Context(), cfg.DeviceTarget, cfg.DeviceToken)
	writeJSON(w, http.StatusOK, struct {
		OK     bool       `json:"ok"`
		Device deviceInfo `json:"device"`
	}{OK: true, Device: deviceFromHello(cfg.DeviceTarget, cfg.DeviceToken, hello)})
}

func (s *Server) handleSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.handleSettingsGet(w, r)
	case http.MethodPost:
		s.handleSettingsPost(w, r)
	default:
		writeMethodNotAllowed(w)
	}
}

func (s *Server) handleSettingsGet(w http.ResponseWriter, r *http.Request) {
	cfg, hello, ok := s.requireDevice(w, r)
	if !ok {
		return
	}
	health, err := s.getHealth(r.Context(), cfg.DeviceTarget, cfg.DeviceToken)
	if err != nil {
		writeError(w, http.StatusBadGateway, "settings_read_failed", "Could not read VibeTV settings.", "Keep VibeTV powered on and retry.")
		return
	}
	device := deviceFromHello(cfg.DeviceTarget, cfg.DeviceToken, hello)
	device.ActiveTheme = strings.TrimSpace(health.Display.ActiveTheme)
	writeJSON(w, http.StatusOK, settingsResponse{
		OK:       true,
		Settings: health.Settings,
		Device:   device,
	})
}

func (s *Server) handleSettingsPost(w http.ResponseWriter, r *http.Request) {
	cfg, hello, ok := s.requireDevice(w, r)
	if !ok {
		return
	}
	var req struct {
		BrightnessPercent int `json:"brightnessPercent"`
		Display           struct {
			BrightnessPercent int `json:"brightnessPercent"`
		} `json:"display"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	brightness := req.BrightnessPercent
	if brightness == 0 {
		brightness = req.Display.BrightnessPercent
	}
	caps := protocol.CapabilitiesFromHello(hello)
	if caps.Known && !caps.SupportsBrightness {
		writeError(w, http.StatusBadRequest, "brightness_unsupported", "This VibeTV does not advertise brightness control.", "Update firmware or use a device with brightness support.")
		return
	}
	minBrightness := protocol.DefaultMinBrightness
	maxBrightness := protocol.DefaultMaxBrightness
	if caps.SupportsBrightness {
		minBrightness = caps.MinBrightnessPercent
		maxBrightness = caps.MaxBrightnessPercent
	}
	if brightness < minBrightness || brightness > maxBrightness {
		writeError(w, http.StatusBadRequest, "invalid_brightness", fmt.Sprintf("Brightness must be between %d and %d.", minBrightness, maxBrightness), "Choose a supported brightness value and retry.")
		return
	}
	settings, err := s.updateBrightness(r.Context(), cfg.DeviceTarget, cfg.DeviceToken, brightness)
	if err != nil {
		writeError(w, http.StatusBadGateway, "settings_write_failed", "Could not update VibeTV settings.", "Keep VibeTV powered on and retry.")
		return
	}
	writeJSON(w, http.StatusOK, settingsResponse{
		OK:       true,
		Settings: settings,
		Device:   deviceFromHello(cfg.DeviceTarget, cfg.DeviceToken, hello),
	})
}

func (s *Server) handleThemeInstall(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	var req struct {
		ThemeID            string `json:"themeId"`
		PackURL            string `json:"packUrl"`
		CatalogURL         string `json:"catalogUrl"`
		SkipFirmwareUpdate *bool  `json:"skipFirmwareUpdate"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.ThemeID) == "" && strings.TrimSpace(req.PackURL) == "" {
		writeError(w, http.StatusBadRequest, "missing_theme_source", "themeId or packUrl is required.", "Select a theme and retry.")
		return
	}
	if !validRemoteThemePackURL(req.PackURL) {
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
			"Set VIBETV_ENABLE_WIFI_THEME_INSTALL=1 only during a prepared hardware test window, then restart the Companion.",
		)
		return
	}
	cfg, hello, ok := s.requireDevice(w, r)
	if !ok {
		return
	}
	if !s.requireThemeInstallPreflight(w, r, cfg, hello) {
		return
	}
	skipFirmwareUpdate := true
	if req.SkipFirmwareUpdate != nil {
		skipFirmwareUpdate = *req.SkipFirmwareUpdate
	}
	var installLog bytes.Buffer
	result, err := s.installTheme(r.Context(), themeinstall.Options{
		ThemeID:            strings.TrimSpace(req.ThemeID),
		PackURL:            strings.TrimSpace(req.PackURL),
		CatalogURL:         strings.TrimSpace(req.CatalogURL),
		Target:             targetWithToken(cfg.DeviceTarget, cfg.DeviceToken),
		SkipFirmwareUpdate: skipFirmwareUpdate,
		Verbose:            true,
		Out:                &installLog,
	})
	if err != nil {
		writeInstallError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		OK     bool                `json:"ok"`
		Result themeinstall.Result `json:"result"`
		Logs   []string            `json:"logs,omitempty"`
	}{OK: true, Result: result, Logs: splitInstallLog(installLog.String())})
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
	return strings.EqualFold(parsed.Scheme, "http") || strings.EqualFold(parsed.Scheme, "https")
}

func (s *Server) config() (runtimeconfig.Config, error) {
	cfg, err := s.loadConfig(s.home)
	if err != nil {
		return runtimeconfig.Config{}, err
	}
	cfg.DeviceTarget = strings.TrimSpace(cfg.DeviceTarget)
	cfg.DeviceToken = strings.TrimSpace(cfg.DeviceToken)
	return cfg, nil
}

func (s *Server) requireDevice(w http.ResponseWriter, r *http.Request) (runtimeconfig.Config, protocol.DeviceHello, bool) {
	cfg, err := s.config()
	if err != nil {
		writeInternalError(w, err)
		return runtimeconfig.Config{}, protocol.DeviceHello{}, false
	}
	if strings.TrimSpace(cfg.DeviceTarget) == "" {
		writeDeviceNotFound(w)
		return runtimeconfig.Config{}, protocol.DeviceHello{}, false
	}
	hello, err := s.getHello(r.Context(), cfg.DeviceTarget, cfg.DeviceToken)
	if err != nil {
		writeDeviceNotFound(w)
		return runtimeconfig.Config{}, protocol.DeviceHello{}, false
	}
	return cfg, hello, true
}

func (s *Server) discover(ctx context.Context, cfg runtimeconfig.Config, explicitTarget string) (string, protocol.DeviceHello, error) {
	explicitTarget = strings.TrimSpace(explicitTarget)
	if explicitTarget != "" {
		target, targetErr := normalizeExplicitDeviceTarget(explicitTarget)
		if targetErr != nil {
			return "", protocol.DeviceHello{}, targetErr
		}
		hello, err := s.getHelloProbe(ctx, target, cfg.DeviceToken, discoveryProbeTime)
		if err != nil {
			return "", protocol.DeviceHello{}, err
		}
		return target, hello, nil
	}

	candidates := uniqueStrings(cfg.DeviceTarget, setup.DefaultWiFiTarget())
	var lastErr error
	for _, candidate := range candidates {
		hello, err := s.getHelloProbe(ctx, candidate, cfg.DeviceToken, discoveryProbeTime)
		if err == nil {
			return normalizeTarget(candidate), hello, nil
		}
		lastErr = err
	}
	if target, hello, err := s.discoverSubnet(ctx, cfg); err == nil {
		return target, hello, nil
	} else if err != nil {
		lastErr = err
	}
	if lastErr == nil {
		lastErr = errors.New("no device candidates")
	}
	return "", protocol.DeviceHello{}, lastErr
}

func (s *Server) discoverSubnet(ctx context.Context, cfg runtimeconfig.Config) (string, protocol.DeviceHello, error) {
	if s.subnetTargets == nil {
		return "", protocol.DeviceHello{}, errors.New("subnet discovery unavailable")
	}
	candidates := uniqueStrings(s.subnetTargets()...)
	if len(candidates) == 0 {
		return "", protocol.DeviceHello{}, errors.New("no subnet candidates")
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	type result struct {
		target string
		hello  protocol.DeviceHello
		err    error
	}
	jobs := make(chan string)
	results := make(chan result, len(candidates))
	workers := subnetProbeLimit
	if len(candidates) < workers {
		workers = len(candidates)
	}

	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for candidate := range jobs {
				hello, err := s.getHelloProbe(ctx, candidate, cfg.DeviceToken, subnetProbeTime)
				select {
				case results <- result{target: candidate, hello: hello, err: err}:
				case <-ctx.Done():
					return
				}
			}
		}()
	}

	go func() {
		defer close(jobs)
		for _, candidate := range candidates {
			select {
			case jobs <- candidate:
			case <-ctx.Done():
				return
			}
		}
	}()

	go func() {
		wg.Wait()
		close(results)
	}()

	var lastErr error
	var matches []result
	for res := range results {
		if res.err == nil {
			res.target = normalizeTarget(res.target)
			matches = append(matches, res)
			if len(matches) > 1 {
				cancel()
				targets := make([]string, 0, len(matches))
				for _, match := range matches {
					targets = append(targets, match.target)
				}
				sort.Strings(targets)
				return "", protocol.DeviceHello{}, &multipleDevicesError{targets: targets}
			}
			continue
		}
		lastErr = res.err
	}
	if len(matches) == 1 {
		return matches[0].target, matches[0].hello, nil
	}
	if lastErr == nil {
		lastErr = errors.New("subnet discovery found no device")
	}
	return "", protocol.DeviceHello{}, lastErr
}

func (s *Server) getHello(ctx context.Context, target, token string) (protocol.DeviceHello, error) {
	var hello protocol.DeviceHello
	if err := s.doJSON(ctx, http.MethodGet, target, "/hello", token, nil, &hello); err != nil {
		return protocol.DeviceHello{}, err
	}
	return hello.Normalize(), nil
}

func (s *Server) getHelloProbe(ctx context.Context, target, token string, timeout time.Duration) (protocol.DeviceHello, error) {
	if timeout <= 0 {
		return s.getHello(ctx, target, token)
	}
	probeCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	return s.getHello(probeCtx, target, token)
}

type deviceHealth struct {
	Settings deviceSettings `json:"settings"`
	Display  struct {
		ActiveTheme string `json:"activeTheme"`
	} `json:"display"`
}

func (s *Server) getHealth(ctx context.Context, target, token string) (deviceHealth, error) {
	var health deviceHealth
	if err := s.doJSON(ctx, http.MethodGet, target, "/health", token, nil, &health); err != nil {
		return deviceHealth{}, err
	}
	return health, nil
}

func (s *Server) updateBrightness(ctx context.Context, target, token string, brightness int) (deviceSettings, error) {
	form := url.Values{}
	form.Set("api", "1")
	form.Set("b", fmt.Sprintf("%d", brightness))
	var response struct {
		Settings deviceSettings `json:"settings"`
	}
	if err := s.doForm(ctx, target, "/api/settings", token, form, &response); err != nil {
		return deviceSettings{}, err
	}
	return response.Settings, nil
}

func (s *Server) pair(ctx context.Context, target string) (string, error) {
	form := url.Values{}
	form.Set("api", "1")
	var response struct {
		OK    bool   `json:"ok"`
		Token string `json:"token"`
	}
	if err := s.doForm(ctx, target, "/api/pair", "", form, &response); err != nil {
		return "", err
	}
	token := strings.TrimSpace(response.Token)
	if !response.OK || token == "" {
		return "", errors.New("pairing response did not include token")
	}
	return token, nil
}

func (s *Server) doJSON(ctx context.Context, method, target, path, token string, body any, out any) error {
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
		return fmt.Errorf("device status=%d body=%q", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func requireMethod(w http.ResponseWriter, r *http.Request, method string) bool {
	if r.Method == method {
		return true
	}
	writeMethodNotAllowed(w)
	return false
}

func decodeOptionalJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if r.Body == nil {
		return true
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "Request body could not be read.", "Send a valid JSON request.")
		return false
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return true
	}
	if err := json.Unmarshal(data, v); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "Request body must be valid JSON.", "Send a valid JSON request.")
		return false
	}
	return true
}

func decodeJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if r.Body == nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "Request body is required.", "Send a valid JSON request.")
		return false
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "Request body must be valid JSON.", "Send a valid JSON request.")
		return false
	}
	return true
}

func writeDeviceNotFound(w http.ResponseWriter) {
	writeError(w, http.StatusNotFound, "device_not_found", "No VibeTV device was found.", "Make sure VibeTV is powered on and run device discovery again.")
}

func writeDiscoveryError(w http.ResponseWriter, err error) {
	var invalidTarget *invalidTargetError
	if errors.As(err, &invalidTarget) {
		writeInvalidDeviceTarget(w)
		return
	}
	var multiple *multipleDevicesError
	if errors.As(err, &multiple) {
		writeError(
			w,
			http.StatusConflict,
			"multiple_devices_found",
			"Multiple VibeTV devices were found.",
			"Enter the exact VibeTV target in the VibeTV target field, for example http://vibetv.local or http://<device-ip>, then search again.",
		)
		return
	}
	writeDeviceNotFound(w)
}

func writeInvalidDeviceTarget(w http.ResponseWriter) {
	writeError(w, http.StatusBadRequest, "invalid_device_target", "VibeTV target is invalid.", "Enter vibetv.local, an IP address, or an http(s) URL with a valid port and without path, username, password, query, or fragment.")
}

func writeMethodNotAllowed(w http.ResponseWriter) {
	writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "HTTP method is not allowed.", "Use the documented method for this endpoint.")
}

func writeInternalError(w http.ResponseWriter, err error) {
	_ = err
	writeError(w, http.StatusInternalServerError, "internal_error", "The companion could not complete the request.", "Restart the companion and retry.")
}

func writeInstallError(w http.ResponseWriter, err error) {
	code := "theme_install_failed"
	if c := errcode.Of(err); c != "" {
		code = string(c)
	}
	next := errcode.Recovery(err)
	if strings.TrimSpace(next) == "" {
		next = "Keep VibeTV powered on and retry the install."
	}
	message := "Theme install failed."
	if detail := sanitizeErrorDetail(err); detail != "" {
		message = "Theme install failed: " + detail
	}
	writeError(w, http.StatusBadGateway, code, message, next)
}

var sensitiveQueryValuePattern = regexp.MustCompile(`(?i)([?&](?:token|auth|key|secret)=)[^&\s"]+`)
var sensitiveURLUserInfoPattern = regexp.MustCompile(`(?i)\b(https?://)[^/\s"@]+@`)
var publicLogURLPattern = regexp.MustCompile(`https?://[^\s)]+`)

func sanitizeLogLine(line string) string {
	return publicLogURLPattern.ReplaceAllStringFunc(line, func(raw string) string {
		parsed, err := url.Parse(raw)
		if err != nil {
			return raw
		}
		parsed.User = nil
		parsed.RawQuery = ""
		parsed.Fragment = ""
		return parsed.String()
	})
}

func sanitizeErrorDetail(err error) string {
	if err == nil {
		return ""
	}
	detail := strings.TrimSpace(err.Error())
	if detail == "" {
		return ""
	}
	detail = sensitiveURLUserInfoPattern.ReplaceAllString(detail, "${1}<redacted>@")
	detail = sensitiveQueryValuePattern.ReplaceAllString(detail, "${1}<redacted>")
	if len(detail) > 240 {
		detail = detail[:237] + "..."
	}
	return detail
}

func themeInstallEnabled() bool {
	return strings.TrimSpace(os.Getenv(themeInstallEnv)) == "1"
}

func writeError(w http.ResponseWriter, status int, code, message, nextAction string) {
	writeJSON(w, status, errorResponse{
		OK: false,
		Error: apiError{
			Code:       code,
			Message:    message,
			NextAction: nextAction,
		},
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
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
		Connected:    caps.Known,
		Paired:       strings.TrimSpace(token) != "",
		Board:        caps.Board,
		Firmware:     caps.Firmware,
		Capabilities: capabilityBlock,
	}
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

func localSubnetTargets() []string {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	var targets []string
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			ip, _, ok := addrToIPv4(addr)
			if !ok {
				continue
			}
			for host := 1; host <= 254; host++ {
				if int(ip[3]) == host {
					continue
				}
				targets = append(targets, fmt.Sprintf("http://%d.%d.%d.%d", ip[0], ip[1], ip[2], host))
			}
		}
	}
	return uniqueStrings(targets...)
}

func addrToIPv4(addr net.Addr) (net.IP, *net.IPNet, bool) {
	var ip net.IP
	var network *net.IPNet
	switch value := addr.(type) {
	case *net.IPNet:
		ip = value.IP
		network = value
	case *net.IPAddr:
		ip = value.IP
	default:
		return nil, nil, false
	}
	ip = ip.To4()
	if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() || !ip.IsPrivate() {
		return nil, nil, false
	}
	return ip, network, true
}

func uniqueStrings(values ...string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		value = normalizeTarget(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}
