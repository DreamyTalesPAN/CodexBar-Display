package virtualvibetv

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

const maxUploadBytes = 8 << 20

// Config describes one deterministic Virtual VibeTV scenario.
type Config struct {
	HTTPListenAddr                string
	RawOTAListenAddr              string
	DeviceID                      string
	DeviceIDAfterUpdate           string
	Board                         string
	Firmware                      string
	CandidateFirmware             string
	PairingToken                  string
	ExpectedFirmwareSHA256        string
	RebootUnavailableRequests     int
	NeverReturnsAfterUpdate       bool
	HealthUnhealthy               bool
	RenderVerificationFails       bool
	StreamRestartFails            bool
	DropUpdateResponseAfterAccept bool
	RejectUnnecessarySecondFlash  bool
}

func DefaultConfig() Config {
	return Config{
		HTTPListenAddr:               "127.0.0.1:0",
		RawOTAListenAddr:             "127.0.0.1:8081",
		DeviceID:                     "virtual-vibetv-001",
		Board:                        "esp8266-smalltv-st7789",
		Firmware:                     "1.0.0",
		CandidateFirmware:            "1.0.1",
		PairingToken:                 "virtual-pair-token",
		RebootUnavailableRequests:    2,
		RejectUnnecessarySecondFlash: true,
	}
}

// RunningServer owns the Companion HTTP listener and its separate Raw-OTA
// listener. Raw OTA defaults to 8081 to mirror the firmware device protocol.
type RunningServer struct {
	*Server
	HTTPURL    string
	RawOTAURL  string
	httpServer *http.Server
	rawServer  *http.Server
	httpListen net.Listener
	rawListen  net.Listener
}

// Start opens real loopback listeners so tests exercise the same TCP Raw-OTA
// path as the release client instead of its multipart compatibility fallback.
func Start(cfg Config) (*RunningServer, error) {
	device := New(cfg)
	httpAddr := strings.TrimSpace(cfg.HTTPListenAddr)
	if httpAddr == "" {
		httpAddr = DefaultConfig().HTTPListenAddr
	}
	rawAddr := strings.TrimSpace(cfg.RawOTAListenAddr)
	if rawAddr == "" {
		rawAddr = DefaultConfig().RawOTAListenAddr
	}
	httpListen, err := net.Listen("tcp", httpAddr)
	if err != nil {
		return nil, fmt.Errorf("listen Companion HTTP: %w", err)
	}
	rawListen, err := net.Listen("tcp", rawAddr)
	if err != nil {
		_ = httpListen.Close()
		return nil, fmt.Errorf("listen Raw OTA: %w", err)
	}
	running := &RunningServer{
		Server:     device,
		HTTPURL:    "http://" + httpListen.Addr().String(),
		RawOTAURL:  "http://" + rawListen.Addr().String(),
		httpListen: httpListen,
		rawListen:  rawListen,
	}
	running.httpServer = &http.Server{Handler: device}
	running.rawServer = &http.Server{Handler: http.HandlerFunc(device.serveRawOTA)}
	go func() { _ = running.httpServer.Serve(httpListen) }()
	go func() { _ = running.rawServer.Serve(rawListen) }()
	return running, nil
}

func (s *RunningServer) Close() error {
	if s == nil {
		return nil
	}
	firstErr := s.httpServer.Close()
	if err := s.rawServer.Close(); firstErr == nil {
		firstErr = err
	}
	return firstErr
}

type Event struct {
	Sequence int    `json:"sequence"`
	At       string `json:"at"`
	Method   string `json:"method"`
	Path     string `json:"path"`
	Status   int    `json:"status"`
	Detail   string `json:"detail,omitempty"`
}

type Asset struct {
	Path      string `json:"path"`
	SizeBytes int64  `json:"sizeBytes"`
	SHA256    string `json:"sha256"`
}

type Snapshot struct {
	DeviceID          string          `json:"deviceId"`
	Firmware          string          `json:"firmware"`
	ActiveTheme       string          `json:"activeTheme"`
	ActiveThemePath   string          `json:"activeThemePath,omitempty"`
	ActiveThemeSHA256 string          `json:"activeThemeSha256,omitempty"`
	UpdateUploads     int             `json:"updateUploads"`
	FramesAccepted    int             `json:"framesAccepted"`
	LastFrame         json.RawMessage `json:"lastFrame,omitempty"`
	Assets            []Asset         `json:"assets,omitempty"`
	Violations        []string        `json:"violations,omitempty"`
	Events            []Event         `json:"events"`
}

type Server struct {
	mu sync.Mutex

	cfg Config

	firmware            string
	activeTheme         string
	activeThemePath     string
	activeThemeSHA256   string
	assets              map[string][]byte
	lastFrame           json.RawMessage
	framesAccepted      int
	renderFullCount     uint64
	renderPartialCount  uint64
	updateUploads       int
	offlineRequestsLeft int
	droppedUpdateReply  bool
	violations          []string
	events              []Event
}

func New(cfg Config) *Server {
	defaults := DefaultConfig()
	if strings.TrimSpace(cfg.DeviceID) == "" {
		cfg.DeviceID = defaults.DeviceID
	}
	if strings.TrimSpace(cfg.Board) == "" {
		cfg.Board = defaults.Board
	}
	if strings.TrimSpace(cfg.Firmware) == "" {
		cfg.Firmware = defaults.Firmware
	}
	if strings.TrimSpace(cfg.CandidateFirmware) == "" {
		cfg.CandidateFirmware = defaults.CandidateFirmware
	}
	if strings.TrimSpace(cfg.PairingToken) == "" {
		cfg.PairingToken = defaults.PairingToken
	}
	return &Server{
		cfg:         cfg,
		firmware:    strings.TrimSpace(cfg.Firmware),
		activeTheme: "mini-classic",
		assets:      make(map[string][]byte),
	}
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if s.temporarilyUnavailable(w, r) {
		return
	}

	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/hello":
		s.handleHello(w, r)
	case r.Method == http.MethodGet && r.URL.Path == "/health":
		s.handleHealth(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/api/pair":
		s.handlePair(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/frame":
		s.handleFrame(w, r)
	case r.Method == http.MethodGet && r.URL.Path == "/assets":
		s.handleAssets(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/assets":
		s.handleAssetUpload(w, r)
	case r.Method == http.MethodDelete && r.URL.Path == "/assets":
		s.handleAssetDelete(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/theme/active":
		s.handleThemeActive(w, r)
	case r.Method == http.MethodPost && (r.URL.Path == "/update" || r.URL.Path == "/update/firmware"):
		s.handleFirmwareUpdate(w, r)
	case r.Method == http.MethodGet && r.URL.Path == "/framebuffer":
		s.handleFramebuffer(w, r)
	case r.Method == http.MethodGet && r.URL.Path == "/__virtual/state":
		s.writeJSON(w, r, http.StatusOK, s.Snapshot(), "")
	default:
		s.respond(w, r, http.StatusNotFound, "not found", "")
	}
}

func (s *Server) serveRawOTA(w http.ResponseWriter, r *http.Request) {
	if s.temporarilyUnavailable(w, r) {
		return
	}
	if r.Method != http.MethodPost || r.URL.Path != "/update/firmware.raw" {
		s.respond(w, r, http.StatusNotFound, "not found", "")
		return
	}
	s.handleFirmwareUpdate(w, r)
}

func (s *Server) Snapshot() Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()

	assets := make([]Asset, 0, len(s.assets))
	for path, data := range s.assets {
		assets = append(assets, Asset{Path: path, SizeBytes: int64(len(data)), SHA256: sha256Hex(data)})
	}
	sort.Slice(assets, func(i, j int) bool { return assets[i].Path < assets[j].Path })
	return Snapshot{
		DeviceID:          s.currentDeviceIDLocked(),
		Firmware:          s.firmware,
		ActiveTheme:       s.activeTheme,
		ActiveThemePath:   s.activeThemePath,
		ActiveThemeSHA256: s.activeThemeSHA256,
		UpdateUploads:     s.updateUploads,
		FramesAccepted:    s.framesAccepted,
		LastFrame:         append(json.RawMessage(nil), s.lastFrame...),
		Assets:            assets,
		Violations:        append([]string(nil), s.violations...),
		Events:            append([]Event(nil), s.events...),
	}
}

func (s *Server) handleHello(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	firmware := s.firmware
	deviceID := s.currentDeviceIDLocked()
	s.mu.Unlock()
	hello := protocol.DeviceHello{
		Kind:                      "hello",
		ProtocolVersion:           2,
		SupportedProtocolVersions: []int{2, 1},
		PreferredProtocolVersion:  2,
		Board:                     s.cfg.Board,
		Firmware:                  firmware,
		DeviceID:                  deviceID,
		NetworkMode:               "station",
		Features:                  []string{protocol.FeatureTheme, protocol.FeatureThemeSpecV1},
		MaxFrameBytes:             4096,
		Capabilities: protocol.CapabilityBlock{
			Display: protocol.DisplayCapabilities{WidthPx: 240, HeightPx: 240, ColorDepthBits: 16},
			// Mirrors themeCapabilitiesJSON in firmware_esp8266/src/main.cpp:
			// without these a repository theme pack is refused before it ever
			// reaches the device, so no harness could rehearse a live install.
			Theme: protocol.ThemeCapabilities{
				SupportsThemeSpecV1:     true,
				SupportsUsageSlotsV1:    true,
				SupportsUsageWindowsV1:  true,
				SupportsProviderSlotsV1: true,
				MaxUsageWindows:         3,
				SupportsStoredThemes:    true,
				MaxThemeSpecBytes:       2048,
				MaxStoredThemeSpecBytes: 4096,
				MaxThemePrimitives:      32,
				MaxThemeGifAssets:       1,
				MaxThemeGifBytes:        24 * 1024,
				MaxThemeGifWidth:        80,
				MaxThemeGifHeight:       80,
				MaxThemeGifPixels:       80 * 80,
				MaxThemeGifLzwBits:      11,
				BuiltinThemes:           []string{"mini-classic", "claude-creature"},
			},
			Transport: protocol.TransportCapabilities{Active: "wifi", Supported: []string{"usb", "wifi"}, Mode: "station"},
		},
	}
	s.writeJSON(w, r, http.StatusOK, hello, "")
}

func (s *Server) currentDeviceIDLocked() string {
	if s.updateUploads > 0 && strings.TrimSpace(s.cfg.DeviceIDAfterUpdate) != "" {
		return strings.TrimSpace(s.cfg.DeviceIDAfterUpdate)
	}
	return strings.TrimSpace(s.cfg.DeviceID)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	// RendererESP8266::HealthSnapshot reports the theme of the frame currently
	// on screen, not the stored one: an error frame carries no ThemeSpec, so
	// the device reports theme-missing while the file is still installed. That
	// is the customer state in issue #371, and a double that always reports the
	// stored theme can never reproduce it.
	themeSpecActive := s.activeThemePath != "" && !s.lastFrameIsErrorLocked()
	activeTheme := s.activeTheme
	if !themeSpecActive {
		activeTheme = "theme-missing"
	}
	payload := map[string]any{
		"ok": !s.cfg.HealthUnhealthy,
		"display": map[string]any{
			"activeTheme": activeTheme,
			"themeSpec": map[string]any{
				"active":         themeSpecActive,
				"path":           s.activeThemePath,
				"hash":           s.activeThemeSHA256,
				"renderOk":       !s.cfg.RenderVerificationFails,
				"renderError":    renderError(s.cfg.RenderVerificationFails),
				"renderFailures": boolInt(s.cfg.RenderVerificationFails),
			},
			"gif": s.activeGIFHealthLocked(),
		},
		"render": map[string]any{
			"fullCount":    s.renderFullCount,
			"partialCount": s.renderPartialCount,
			"lastKind":     s.renderLastKind(),
		},
		"stream": map[string]any{
			"healthy": !s.cfg.StreamRestartFails,
		},
	}
	s.mu.Unlock()
	s.writeJSON(w, r, http.StatusOK, payload, "")
}

// lastFrameIsErrorLocked reports whether the frame on screen is the runtime's
// error frame. protocol.ErrorFrame carries an error code and no usage, and the
// firmware draws its status screen for it.
func (s *Server) lastFrameIsErrorLocked() bool {
	if len(s.lastFrame) == 0 {
		return false
	}
	var frame struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(s.lastFrame, &frame); err != nil {
		return false
	}
	return strings.TrimSpace(frame.Error) != ""
}

// activeGIFHealthLocked mirrors the firmware's gif playback health for the GIF
// the active ThemeSpec references. themeinstall verifies it after every live
// install, so a double without it fails every install that ships a GIF.
func (s *Server) activeGIFHealthLocked() map[string]any {
	health := map[string]any{
		"activePath":       "",
		"filePresent":      false,
		"decoderAllocated": false,
		"decoderOpen":      false,
		"lastError":        nil,
	}
	spec, ok := s.assets[s.activeThemePath]
	if !ok || s.lastFrameIsErrorLocked() {
		return health
	}
	var parsed struct {
		Primitives []struct {
			Type  string `json:"t"`
			Asset string `json:"a"`
		} `json:"p"`
	}
	if err := json.Unmarshal(spec, &parsed); err != nil {
		return health
	}
	for _, primitive := range parsed.Primitives {
		asset := strings.TrimSpace(primitive.Asset)
		if primitive.Type != "g" || asset == "" {
			continue
		}
		if _, present := s.assets[asset]; !present {
			continue
		}
		health["activePath"] = asset
		health["filePresent"] = true
		health["decoderAllocated"] = true
		health["decoderOpen"] = true
		break
	}
	return health
}

// renderLastKind mirrors recordRenderFull/recordRenderPartial in the firmware:
// the status screen for an error frame is not a usage render, and the Companion
// refuses to call a device ready without one.
func (s *Server) renderLastKind() string {
	switch {
	case len(s.lastFrame) == 0:
		return "none"
	case s.lastFrameIsErrorLocked():
		return "status"
	case s.activeThemePath != "":
		return "theme_spec_usage"
	default:
		return "usage"
	}
}

func (s *Server) handlePair(w http.ResponseWriter, r *http.Request) {
	s.writeJSON(w, r, http.StatusOK, map[string]any{"ok": true, "token": s.cfg.PairingToken}, "paired")
}

func (s *Server) handleFrame(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 4097))
	if err != nil || len(body) == 0 || len(body) > 4096 || !json.Valid(body) {
		s.respond(w, r, http.StatusBadRequest, "invalid frame", "invalid frame")
		return
	}
	s.mu.Lock()
	s.lastFrame = append(s.lastFrame[:0], body...)
	s.framesAccepted++
	if s.activeThemePath != "" && !s.lastFrameIsErrorLocked() {
		s.renderPartialCount++
	} else {
		s.renderFullCount++
	}
	s.mu.Unlock()
	s.respond(w, r, http.StatusOK, "ok", "frame accepted")
}

func (s *Server) handleAssets(w http.ResponseWriter, r *http.Request) {
	snapshot := s.Snapshot()
	s.writeJSON(w, r, http.StatusOK, map[string]any{"mounted": true, "assets": snapshot.Assets}, "")
}

func (s *Server) handleAssetUpload(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	path := cleanAssetPath(r.URL.Query().Get("path"))
	if path == "" {
		s.respond(w, r, http.StatusBadRequest, "asset path required", "missing asset path")
		return
	}
	data, err := readMultipartFile(r, "asset")
	if err != nil {
		s.respond(w, r, http.StatusBadRequest, err.Error(), "invalid asset")
		return
	}
	s.mu.Lock()
	s.assets[path] = append([]byte(nil), data...)
	s.mu.Unlock()
	s.respond(w, r, http.StatusOK, "ok", "asset uploaded "+path)
}

func (s *Server) handleAssetDelete(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	path := cleanAssetPath(r.URL.Query().Get("path"))
	s.mu.Lock()
	if path == s.activeThemePath {
		s.mu.Unlock()
		s.respond(w, r, http.StatusConflict, "active theme cannot be deleted", "active asset delete rejected")
		return
	}
	delete(s.assets, path)
	s.mu.Unlock()
	s.respond(w, r, http.StatusOK, "ok", "asset deleted "+path)
}

func (s *Server) handleThemeActive(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	var request struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&request); err != nil {
		s.respond(w, r, http.StatusBadRequest, "invalid theme activation", "invalid theme activation")
		return
	}
	path := cleanAssetPath(request.Path)
	s.mu.Lock()
	data, ok := s.assets[path]
	if ok {
		s.activeThemePath = path
		s.activeTheme = strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
		s.activeThemeSHA256 = sha256Hex(data)
	}
	s.mu.Unlock()
	if !ok {
		s.respond(w, r, http.StatusNotFound, "theme not found", "theme activation missing asset")
		return
	}
	s.writeJSON(w, r, http.StatusOK, map[string]any{"ok": true, "path": path, "hash": sha256Hex(data)}, "theme activated "+path)
}

func (s *Server) handleFirmwareUpdate(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	data, err := readFirmwareBody(r)
	if err != nil {
		s.respond(w, r, http.StatusBadRequest, err.Error(), "invalid firmware upload")
		return
	}
	actualSHA := sha256Hex(data)
	expectedSHA := strings.ToLower(strings.TrimSpace(s.cfg.ExpectedFirmwareSHA256))
	if expectedSHA != "" && actualSHA != expectedSHA {
		s.respond(w, r, http.StatusUnprocessableEntity, "firmware sha256 mismatch", "firmware sha256 mismatch")
		return
	}

	s.mu.Lock()
	if s.cfg.RejectUnnecessarySecondFlash && s.firmware == strings.TrimSpace(s.cfg.CandidateFirmware) {
		s.violations = append(s.violations, "unnecessary second firmware flash")
		s.mu.Unlock()
		s.respond(w, r, http.StatusConflict, "firmware already current", "second flash rejected")
		return
	}
	s.updateUploads++
	s.firmware = strings.TrimSpace(s.cfg.CandidateFirmware)
	s.offlineRequestsLeft = s.cfg.RebootUnavailableRequests
	dropReply := s.cfg.DropUpdateResponseAfterAccept && !s.droppedUpdateReply
	if dropReply {
		s.droppedUpdateReply = true
	}
	s.mu.Unlock()

	if dropReply {
		s.record(r, 0, "firmware accepted; response connection dropped")
		if hijacker, ok := w.(http.Hijacker); ok {
			conn, _, hijackErr := hijacker.Hijack()
			if hijackErr == nil {
				_ = conn.Close()
				return
			}
		}
		return
	}
	s.respond(w, r, http.StatusOK, "ok", "firmware accepted sha256="+actualSHA)
}

func (s *Server) handleFramebuffer(w http.ResponseWriter, r *http.Request) {
	snapshot := s.Snapshot()
	s.writeJSON(w, r, http.StatusOK, map[string]any{
		"renderOk": !s.cfg.RenderVerificationFails,
		"frame":    snapshot.LastFrame,
	}, "")
}

func (s *Server) temporarilyUnavailable(w http.ResponseWriter, r *http.Request) bool {
	s.mu.Lock()
	unavailable := false
	if s.cfg.NeverReturnsAfterUpdate && s.updateUploads > 0 {
		unavailable = true
	} else if s.offlineRequestsLeft > 0 {
		s.offlineRequestsLeft--
		unavailable = true
	}
	s.mu.Unlock()
	if unavailable {
		s.respond(w, r, http.StatusServiceUnavailable, "rebooting", "temporarily unavailable")
	}
	return unavailable
}

func (s *Server) authorize(w http.ResponseWriter, r *http.Request) bool {
	expected := strings.TrimSpace(s.cfg.PairingToken)
	if expected == "" || r.Header.Get("X-VibeTV-Token") == expected || r.URL.Query().Get("token") == expected {
		return true
	}
	s.respond(w, r, http.StatusUnauthorized, "pairing token required", "authentication rejected")
	return false
}

func (s *Server) writeJSON(w http.ResponseWriter, r *http.Request, status int, payload any, detail string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
	s.record(r, status, detail)
}

func (s *Server) respond(w http.ResponseWriter, r *http.Request, status int, body, detail string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, body)
	s.record(r, status, detail)
}

func (s *Server) record(r *http.Request, status int, detail string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.events = append(s.events, Event{
		Sequence: len(s.events) + 1,
		At:       time.Now().UTC().Format(time.RFC3339Nano),
		Method:   r.Method,
		Path:     r.URL.Path,
		Status:   status,
		Detail:   detail,
	})
}

func readFirmwareBody(r *http.Request) ([]byte, error) {
	if strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "multipart/form-data") {
		return readMultipartFile(r, "firmware")
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, maxUploadBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return nil, fmt.Errorf("firmware body required")
	}
	if len(data) > maxUploadBytes {
		return nil, fmt.Errorf("firmware body too large")
	}
	return data, nil
}

func readMultipartFile(r *http.Request, field string) ([]byte, error) {
	if err := r.ParseMultipartForm(maxUploadBytes); err != nil {
		return nil, fmt.Errorf("parse multipart: %w", err)
	}
	file, _, err := r.FormFile(field)
	if err != nil {
		return nil, fmt.Errorf("multipart field %q required: %w", field, err)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxUploadBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxUploadBytes {
		return nil, fmt.Errorf("multipart field %q too large", field)
	}
	return data, nil
}

func cleanAssetPath(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" || !strings.HasPrefix(raw, "/") || strings.Contains(raw, "..") {
		return ""
	}
	return filepath.ToSlash(filepath.Clean(raw))
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func renderError(failed bool) string {
	if failed {
		return "simulated render verification failure"
	}
	return ""
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
