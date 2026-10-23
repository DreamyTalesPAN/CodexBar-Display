package virtualvibetv

import (
	"bytes"
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

const maxUploadBytes = 8 << 20

// MaxFrameBytes is the ESP8266 frame limit (kMaxFrameBytes in
// firmware_esp8266/src/main.cpp). TestCapabilitiesMatchFirmware keeps the two
// and every advertised theme limit in step (#354).
const MaxFrameBytes = 2048

// Theme activation limits of the ESP8266, kept in step by the same test:
// kMaxStoredThemeSpecBytes and the request body limit of handleThemeActive in
// firmware_esp8266/src/main.cpp, kMaxCompiledThemeSpecPrimitives in
// firmware_shared/theme_spec_renderer_core.h.
const (
	maxStoredThemeSpecBytes     = 4096
	maxThemePrimitives          = 32
	maxThemeActivationBodyBytes = 160
)

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
	Unavailable                   bool
	HealthUnhealthy               bool
	RenderVerificationFails       bool
	StreamRestartFails            bool
	DropUpdateResponseAfterAccept bool
	RejectUnnecessarySecondFlash  bool
}

// Scenarios are the deterministic failures the CLI can start with.
var Scenarios = map[string]func(*Config){
	"healthy":                    func(*Config) {},
	"unavailable":                func(cfg *Config) { cfg.Unavailable = true },
	"unhealthy":                  func(cfg *Config) { cfg.HealthUnhealthy = true },
	"render-rejected":            func(cfg *Config) { cfg.RenderVerificationFails = true },
	"lost-ota-response":          func(cfg *Config) { cfg.DropUpdateResponseAfterAccept = true },
	"never-returns-after-update": func(cfg *Config) { cfg.NeverReturnsAfterUpdate = true },
	// A healthy device already refuses a second flash of the same firmware.
	"allow-second-flash": func(cfg *Config) { cfg.RejectUnnecessarySecondFlash = false },
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
		s.writeJSON(w, r, s.Snapshot(), "")
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
		Features: []string{
			protocol.FeatureTheme,
			protocol.FeatureThemeSpecV1,
			protocol.FeatureProviderSlotsV1,
			protocol.FeatureProviderAssetsV1,
			protocol.FeatureColorStopsV1,
			protocol.FeatureTextValignV1,
			protocol.FeatureProgressArcV1,
			protocol.FeatureProgressNeedleV1,
		},
		MaxFrameBytes: MaxFrameBytes,
		Capabilities: protocol.CapabilityBlock{
			Display: protocol.DisplayCapabilities{WidthPx: 240, HeightPx: 240, ColorDepthBits: 16},
			// Mirrors themeCapabilitiesJSON in firmware_esp8266/src/main.cpp:
			// without these a repository theme pack is refused before it ever
			// reaches the device, so no harness could rehearse a live install.
			Theme: protocol.ThemeCapabilities{
				SupportsThemeSpecV1:      true,
				SupportsUsageSlotsV1:     true,
				SupportsUsageWindowsV1:   true,
				SupportsProviderSlotsV1:  true,
				SupportsProviderAssetsV1: true,
				SupportsColorStopsV1:     true,
				SupportsTextValignV1:     true,
				SupportsProgressArcV1:    true,
				SupportsProgressNeedleV1: true,
				MaxUsageWindows:          3,
				SupportsStoredThemes:     true,
				MaxThemeSpecBytes:        2048,
				MaxStoredThemeSpecBytes:  maxStoredThemeSpecBytes,
				MaxThemePrimitives:       maxThemePrimitives,
				MaxThemeGifAssets:        1,
				MaxThemeGifBytes:         24 * 1024,
				MaxThemeGifWidth:         80,
				MaxThemeGifHeight:        80,
				MaxThemeGifPixels:        80 * 80,
				MaxThemeGifLzwBits:       11,
				SupportedPrimitiveTypes:  []string{"text", "rect", "progress", "gif", "sprite", "pixels"},
				BuiltinThemes:            []string{"mini-classic", "claude-creature"},
			},
			Transport: protocol.TransportCapabilities{Active: "wifi", Supported: []string{"usb", "wifi"}, Mode: "station"},
		},
	}
	s.writeJSON(w, r, hello, "")
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
	s.writeJSON(w, r, payload, "")
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
	s.writeJSON(w, r, map[string]any{"ok": true, "token": s.cfg.PairingToken}, "paired")
}

func (s *Server) handleFrame(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, MaxFrameBytes+1))
	if err != nil {
		s.respond(w, r, http.StatusBadRequest, "invalid frame", "invalid frame")
		return
	}
	// The same answers as handleFrame in firmware_esp8266/src/main.cpp: 413 for
	// a frame above the limit, 400 for an empty body.
	if len(body) == 0 {
		s.respond(w, r, http.StatusBadRequest, "empty frame body", "invalid frame")
		return
	}
	if len(body) > MaxFrameBytes {
		s.respond(w, r, http.StatusRequestEntityTooLarge, "frame body too large", "frame too large")
		return
	}
	// A frame is one line: the firmware trims the body, then refuses any line
	// break left inside it.
	body = bytes.TrimSpace(body)
	if len(body) == 0 {
		s.respond(w, r, http.StatusBadRequest, "empty frame body", "invalid frame")
		return
	}
	if bytes.ContainsAny(body, "\r\n") {
		s.respond(w, r, http.StatusBadRequest, "expected one newline-delimited JSON frame", "invalid frame")
		return
	}
	if !json.Valid(body) {
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
	s.writeJSON(w, r, map[string]any{"mounted": true, "assets": snapshot.Assets}, "")
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
	if hash := r.URL.Query().Get("hash"); hash != "" {
		digest := md5.Sum(data)
		if !strings.EqualFold(hash, hex.EncodeToString(digest[:])) {
			s.respond(w, r, http.StatusBadRequest, "asset hash mismatch", "asset hash mismatch "+path)
			return
		}
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
	body, err := io.ReadAll(io.LimitReader(r.Body, 4096))
	body = bytes.TrimSpace(body)
	if err != nil || len(body) == 0 || len(body) > maxThemeActivationBodyBytes {
		s.respond(w, r, http.StatusBadRequest, "invalid theme activation body", "invalid theme activation")
		return
	}
	var request struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(bytes.NewReader(body)).Decode(&request); err != nil {
		s.respond(w, r, http.StatusBadRequest, "bad theme activation json", "invalid theme activation")
		return
	}
	path := cleanAssetPath(request.Path)
	// readStoredThemeSpec in the firmware refuses any path outside /themes/
	// before it looks for the file.
	if !strings.HasPrefix(path, "/themes/") {
		s.respond(w, r, http.StatusBadRequest, "invalid theme path", "theme activation path outside /themes/")
		return
	}
	s.mu.Lock()
	data, ok := s.assets[path]
	refusal := storedThemeRefusal(data)
	if ok && refusal == "" {
		s.activeThemePath = path
		var spec struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal(data, &spec)
		s.activeTheme = spec.ID
		if s.activeTheme == "" {
			s.activeTheme = strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
		}
		s.activeThemeSHA256 = sha256Hex(data)
	}
	s.mu.Unlock()
	if !ok {
		s.respond(w, r, http.StatusNotFound, "theme file not found", "theme activation missing asset")
		return
	}
	if refusal != "" {
		s.respond(w, r, http.StatusBadRequest, refusal, "theme activation refused: "+refusal)
		return
	}
	s.writeJSON(w, r, map[string]any{"ok": true, "path": path, "hash": sha256Hex(data)}, "theme activated "+path)
}

// storedThemeRefusal is the firmware's 400 answer for a stored spec it will not
// activate (activateStoredThemePath in firmware_esp8266/src/main.cpp), in the
// firmware's order: readStoredThemeSpec refuses an empty or oversized file,
// themeSpecMetadata a spec that is no JSON object or lacks an id or a positive
// whole revision, CompileThemeSpecObject in
// firmware_shared/theme_spec_renderer_core.h a primitive array that is missing,
// empty, above the limit or without one primitive of a type CompilePrimitive
// knows.
//
// A primitive counts when primitiveCompiles accepts it, as CompilePrimitive does.
// The whole-spec limits of CompileThemeSpecObject answer the same 400: a second
// compiled GIF, and the storage that CountCompiledThemeSpecStorage counts over
// every primitive (see storageOf).
//
// Not mirrored: JSON is judged by Go's parser and refused as "bad theme json":
// ArduinoJson appends its error name, answers with a later wording where its
// filtered first pass does not reach the error, takes single quotes and unquoted
// keys, and refuses more than 10 nested levels. Strings that are invalid UTF-8 or
// hold a lone surrogate escape are counted as Go decodes them, which may differ
// from the bytes ArduinoJson stores.
func storedThemeRefusal(spec []byte) string {
	if len(bytes.TrimSpace(spec)) == 0 || len(spec) > maxStoredThemeSpecBytes {
		return "theme file too large"
	}
	var parsed any
	decoder := json.NewDecoder(bytes.NewReader(spec))
	decoder.UseNumber()
	if decoder.Decode(&parsed) != nil {
		return "bad theme json"
	}
	object, isObject := parsed.(map[string]any)
	if !isObject {
		return "theme json must be an object"
	}
	// spec["themeRev"] | spec["rev"] | 0 in the firmware: "rev" counts only when
	// "themeRev" is absent, null, false or zero.
	themeRev := object["themeRev"]
	number, _ := themeRev.(json.Number)
	if zero, err := number.Float64(); themeRev == nil || themeRev == false || err == nil && zero == 0 {
		number, _ = object["rev"].(json.Number)
	}
	revision, err := strconv.ParseInt(string(number), 10, 32)
	if strings.TrimSpace(jsonFor[string](object, "themeId", "id")) == "" || err != nil || revision <= 0 {
		return "theme id/rev missing"
	}
	primitives := jsonFor[[]any](object, "primitives", "p")
	var compiling, gifs, stringBytes, providerAssets int
	for _, primitive := range primitives {
		fields, _ := primitive.(map[string]any)
		primitiveBytes, primitiveAssets := storageOf(fields)
		stringBytes += primitiveBytes
		providerAssets += primitiveAssets
		if primitiveCompiles(fields) {
			compiling++
			if kind := jsonFor[string](fields, "type", "t"); kind == "gif" || kind == "g" {
				gifs++
			}
		}
	}
	if len(primitives) > maxThemePrimitives || compiling == 0 || gifs > themeGifAssets ||
		stringBytes > themeStringBytes || providerAssets > themeProviderAssets {
		return "theme spec has no renderable content"
	}
	return ""
}

// Whole-spec limits of CompileThemeSpecObject and CountCompiledThemeSpecStorage
// in firmware_shared/theme_spec_renderer_core.h: kMaxThemeSpecGifAssets,
// kMaxCompiledThemeSpecStringBytes and kMaxCompiledProviderAssets.
const (
	themeGifAssets      = 1
	themeStringBytes    = 1024
	themeProviderAssets = 16
)

// storageOf is CountCompiledThemeSpecStorage for one primitive, whether or not it
// compiles. Each string of the types the firmware copies into its pool takes its
// bytes up to a NUL plus one, an empty one nothing, and no two strings share
// bytes. The provider assets are the entries with a key and a path of a sprite or
// image; a GIF has none counted.
func storageOf(primitive map[string]any) (stringBytes, providerAssets int) {
	var strs []string
	switch jsonFor[string](primitive, "type", "t") {
	case "text", "tx":
		strs = []string{jsonFor[string](primitive, "binding", "b"), jsonFor[string](primitive, "text", "v")}
	case "progress", "p":
		strs = []string{jsonFor[string](primitive, "binding", "b")}
	case "gif", "g":
		strs = assetStrings(primitive)
	case "sprite", "sp", "image", "img":
		strs = assetStrings(primitive)
		for key, value := range jsonFor[map[string]any](primitive, "providerAssets", "pa") {
			if path, _ := value.(string); cString(key) != "" && cString(path) != "" {
				providerAssets++
				strs = append(strs, key, path)
			}
		}
	case "pixels", "px":
		strs = []string{jsonFor[string](primitive, "data", "d")}
	}
	for _, value := range strs {
		if text := cString(value); text != "" {
			stringBytes += len(text) + 1
		}
	}
	return stringBytes, providerAssets
}

// assetStrings are the assetPath and the idle and coding state assets of a GIF,
// sprite or image.
func assetStrings(primitive map[string]any) []string {
	return []string{jsonFor[string](primitive, "assetPath", "a"), stateAsset(primitive, "idle"), stateAsset(primitive, "coding")}
}

// cString is the C string the firmware reads from a JSON string: up to its first NUL.
func cString(value string) string {
	before, _, _ := strings.Cut(value, "\x00")
	return before
}

// Slot and colour stop limits of the firmware: usage_window_contract.h kMaxWindows,
// theme_spec_renderer_core.h kMaxThemeSpecProviderSlots and kMaxCompiledColorStops.
const (
	themeUsageWindows  = 3
	themeProviderSlots = 2
	themeColorStops    = 4
)

// primitiveCompiles mirrors the refusals of CompilePrimitive in
// firmware_shared/theme_spec_renderer_core.h for one primitive. A primitive it
// refuses is skipped, so a spec in which none compiles is refused.
func primitiveCompiles(primitive map[string]any) bool {
	// Lines 1383-1401: the slots are uint8_t in the firmware, so a value that
	// wraps into range passes, here as there.
	usageSlot := uint8(jsonInt(primitive, "slot", "sl", 0))
	if usageIndex := jsonInt(primitive, "usageIndex", "ui", -1); usageIndex >= 0 {
		if usageIndex >= themeUsageWindows {
			return false
		}
		usageSlot = uint8(usageIndex + 1)
	}
	if usageSlot > themeUsageWindows || uint8(jsonInt(primitive, "providerSlot", "pl", 0)) > themeProviderSlots {
		return false
	}
	switch jsonFor[string](primitive, "type", "t") {
	case "rect", "r", "pixels", "px":
		// Lines 1406-1410 (rect) and 1555-1567 (pixels): width and height above zero.
		return jsonInt(primitive, "width", "w", 0) > 0 && jsonInt(primitive, "height", "h", 0) > 0
	case "text", "tx":
		// Lines 1415-1441: a font size above zero, 1 when unset. Empty text is kept.
		return jsonInt(primitive, "fontSize", "s", 1) > 0
	case "progress", "p":
		return progressCompiles(primitive)
	case "gif", "g":
		return gifCompiles(primitive)
	case "sprite", "sp", "image", "img":
		return spriteCompiles(primitive)
	}
	return false
}

// progressCompiles mirrors lines 1449-1491: an arc keeps its start 0-359, its
// sweep 1-360 and a thickness from 1 to half the smaller side, the colour stops
// must compile, and width and height are above zero.
func progressCompiles(primitive map[string]any) bool {
	width, height := jsonInt(primitive, "width", "w", 0), jsonInt(primitive, "height", "h", 0)
	style := jsonFor[string](primitive, "progressStyle", "ps")
	if style == "arc" {
		start := jsonInt(primitive, "arcStart", "as", 0)
		sweep := jsonInt(primitive, "arcSweep", "aw", 0)
		thickness := jsonInt(primitive, "arcThickness", "at", 0)
		if start < 0 || start > 359 || sweep < 1 || sweep > 360 || thickness < 1 || thickness*2 > min(width, height) {
			return false
		}
	}
	if style == "needle" {
		start := jsonInt(primitive, "arcStart", "as", 0)
		sweep := jsonInt(primitive, "arcSweep", "aw", 0)
		asset := jsonFor[string](primitive, "assetPath", "a")
		if start < 0 || start > 359 || sweep < 1 || sweep > 360 || !strings.HasSuffix(strings.ToLower(asset), ".cbi") {
			return false
		}
	}
	return width > 0 && height > 0 && colorStopsCompile(primitive)
}

// colorStopsCompile mirrors CompileProgressColorStops (lines 1770-1790): at most
// four stops, each an object with gte from 0 to 100 and a colour under "color",
// or else under "c".
func colorStopsCompile(primitive map[string]any) bool {
	stops := jsonFor[[]any](primitive, "colorStops", "cs")
	if len(stops) > themeColorStops {
		return false
	}
	for _, entry := range stops {
		stop, ok := entry.(map[string]any)
		if !ok {
			return false
		}
		color, _ := stop["color"].(string)
		if color = cString(color); color == "" {
			color, _ = stop["c"].(string)
			color = cString(color)
		}
		if gte := jsonInt(stop, "gte", "gte", -1); gte < 0 || gte > 100 || color == "" {
			return false
		}
	}
	return true
}

// gifCompiles mirrors lines 1492-1520: width and height above zero and at most
// 80 by 80 (kMaxThemeSpecGifWidth and kMaxThemeSpecGifHeight; the 6,400-pixel
// limit follows from them). The initial asset, the idle asset when set and
// otherwise assetPath, and the coding asset when set must all end in .gif.
func gifCompiles(primitive map[string]any) bool {
	width, height := jsonInt(primitive, "width", "w", 0), jsonInt(primitive, "height", "h", 0)
	if width <= 0 || height <= 0 || width > 80 || height > 80 {
		return false
	}
	idle, coding := stateAsset(primitive, "idle"), stateAsset(primitive, "coding")
	initial := idle
	if initial == "" {
		initial = cString(jsonFor[string](primitive, "assetPath", "a"))
	}
	return strings.HasSuffix(initial, ".gif") &&
		(idle == "" || strings.HasSuffix(idle, ".gif")) &&
		(coding == "" || strings.HasSuffix(coding, ".gif"))
}

// spriteCompiles mirrors lines 1522-1552 and CompiledPrimitiveHasAssetReference:
// an assetPath, an idle or coding state asset, or a provider asset with a key
// and a path. Dimensions are not checked for sprites.
func spriteCompiles(primitive map[string]any) bool {
	if cString(jsonFor[string](primitive, "assetPath", "a")) != "" || stateAsset(primitive, "idle") != "" || stateAsset(primitive, "coding") != "" {
		return true
	}
	for key, value := range jsonFor[map[string]any](primitive, "providerAssets", "pa") {
		if path, _ := value.(string); cString(key) != "" && cString(path) != "" {
			return true
		}
	}
	return false
}

// stateAsset is the idle or coding path under stateAssets (or "sa"), or "".
func stateAsset(primitive map[string]any, state string) string {
	path, _ := jsonFor[map[string]any](primitive, "stateAssets", "sa")[state].(string)
	return cString(path)
}

// jsonFor is the firmware's JsonStringFor, JsonArrayFor and JsonObjectFor: the
// long key when it holds a T, otherwise the short key.
// A string is read up to its first NUL, as the firmware reads it (cString).
func jsonFor[T any](object map[string]any, long, short string) T {
	value, ok := object[long].(T)
	if !ok {
		value, _ = object[short].(T)
	}
	if text, isString := any(value).(string); isString {
		return any(cString(text)).(T)
	}
	return value
}

// jsonInt is the firmware's JsonIntFor: the long key when it holds a whole number
// that fits 32 bits, otherwise the short key, otherwise fallback.
func jsonInt(object map[string]any, long, short string, fallback int) int {
	for _, key := range []string{long, short} {
		if number, ok := object[key].(json.Number); ok {
			if value, err := strconv.ParseInt(string(number), 10, 32); err == nil {
				return int(value)
			}
		}
	}
	return fallback
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
	s.writeJSON(w, r, map[string]any{
		"renderOk": !s.cfg.RenderVerificationFails,
		"frame":    snapshot.LastFrame,
	}, "")
}

func (s *Server) temporarilyUnavailable(w http.ResponseWriter, r *http.Request) bool {
	s.mu.Lock()
	unavailable := false
	if s.cfg.Unavailable || (s.cfg.NeverReturnsAfterUpdate && s.updateUploads > 0) {
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

func (s *Server) writeJSON(w http.ResponseWriter, r *http.Request, payload any, detail string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(payload)
	s.record(r, http.StatusOK, detail)
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
