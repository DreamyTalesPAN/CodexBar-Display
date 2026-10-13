package virtualvibetv

import (
	"bytes"
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"io/fs"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

func TestStartServesCompanionAndRawOTAOnSeparateListeners(t *testing.T) {
	firmware := []byte("candidate firmware")
	sum := sha256.Sum256(firmware)
	cfg := DefaultConfig()
	cfg.HTTPListenAddr = "127.0.0.1:0"
	cfg.RawOTAListenAddr = "127.0.0.1:0"
	cfg.ExpectedFirmwareSHA256 = hex.EncodeToString(sum[:])
	cfg.RebootUnavailableRequests = 0

	running, err := Start(cfg)
	if err != nil {
		t.Fatalf("start virtual VibeTV: %v", err)
	}
	t.Cleanup(func() { _ = running.Close() })
	if running.HTTPURL == running.RawOTAURL {
		t.Fatalf("HTTP and raw OTA must use separate listeners: %q", running.HTTPURL)
	}

	resp, err := http.Get(running.HTTPURL + "/hello")
	if err != nil {
		t.Fatalf("get hello: %v", err)
	}
	defer resp.Body.Close()
	var hello struct {
		DeviceID string `json:"deviceId"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&hello); err != nil {
		t.Fatalf("decode hello: %v", err)
	}
	if hello.DeviceID != cfg.DeviceID {
		t.Fatalf("deviceId = %q, want %q", hello.DeviceID, cfg.DeviceID)
	}

	req, err := http.NewRequest(http.MethodPost, running.RawOTAURL+"/update/firmware.raw", bytes.NewReader(firmware))
	if err != nil {
		t.Fatalf("create raw OTA request: %v", err)
	}
	req.Header.Set("X-VibeTV-Token", cfg.PairingToken)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("raw OTA request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("raw OTA status = %s", resp.Status)
	}
	if got := running.Snapshot(); got.UpdateUploads != 1 || got.Firmware != cfg.CandidateFirmware {
		t.Fatalf("unexpected post-OTA state: %+v", got)
	}
}

func TestScenariosExposeRequiredFailureStates(t *testing.T) {
	tests := []struct {
		name string
		cfg  func(*Config)
		want func(t *testing.T, server *Server, baseURL string)
	}{
		{
			name: "wrong device after update",
			cfg:  func(cfg *Config) { cfg.DeviceIDAfterUpdate = "wrong-device" },
			want: func(t *testing.T, server *Server, _ string) {
				server.mu.Lock()
				server.updateUploads = 1
				server.mu.Unlock()
				if got := server.Snapshot().DeviceID; got != "wrong-device" {
					t.Fatalf("deviceId = %q", got)
				}
			},
		},
		{
			name: "never returns",
			cfg:  func(cfg *Config) { cfg.NeverReturnsAfterUpdate = true },
			want: func(t *testing.T, server *Server, baseURL string) {
				server.mu.Lock()
				server.updateUploads = 1
				server.mu.Unlock()
				assertUnavailable(t, baseURL)
			},
		},
		{
			name: "unavailable",
			cfg:  Scenarios["unavailable"],
			want: func(t *testing.T, _ *Server, baseURL string) { assertUnavailable(t, baseURL) },
		},
		{
			name: "unhealthy",
			cfg:  func(cfg *Config) { cfg.HealthUnhealthy = true },
			want: func(t *testing.T, _ *Server, baseURL string) { assertHealth(t, baseURL, false, true, true) },
		},
		{
			name: "render failure",
			cfg:  func(cfg *Config) { cfg.RenderVerificationFails = true },
			want: func(t *testing.T, _ *Server, baseURL string) { assertHealth(t, baseURL, true, false, true) },
		},
		{
			name: "stream restart failure",
			cfg:  func(cfg *Config) { cfg.StreamRestartFails = true },
			want: func(t *testing.T, _ *Server, baseURL string) { assertHealth(t, baseURL, true, true, false) },
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := DefaultConfig()
			cfg.HTTPListenAddr = "127.0.0.1:0"
			cfg.RawOTAListenAddr = "127.0.0.1:0"
			tt.cfg(&cfg)
			running, err := Start(cfg)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = running.Close() })
			tt.want(t, running.Server, running.HTTPURL)
		})
	}
}

func assertUnavailable(t *testing.T, baseURL string) {
	t.Helper()
	resp, err := http.Get(baseURL + "/hello")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %s", resp.Status)
	}
}

func assertHealth(t *testing.T, baseURL string, wantOK, wantRenderOK, wantStreamHealthy bool) {
	t.Helper()
	resp, err := http.Get(baseURL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var health struct {
		OK      bool `json:"ok"`
		Display struct {
			ThemeSpec struct {
				RenderOK bool `json:"renderOk"`
			} `json:"themeSpec"`
		} `json:"display"`
		Stream struct {
			Healthy bool `json:"healthy"`
		} `json:"stream"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
		t.Fatal(err)
	}
	if health.OK != wantOK || health.Display.ThemeSpec.RenderOK != wantRenderOK || health.Stream.Healthy != wantStreamHealthy {
		t.Fatalf("unexpected health: %+v", health)
	}
}

// The virtual device must refuse exactly what the ESP8266 refuses (#354), so
// its advertised limits are read back from the firmware sources.
func TestCapabilitiesMatchFirmware(t *testing.T) {
	firmware := func(path, pattern string) int {
		t.Helper()
		source, err := os.ReadFile(filepath.Join("..", "..", "..", path))
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		match := regexp.MustCompile(pattern).FindSubmatch(source)
		if match == nil {
			t.Fatalf("%s: no match for %q", path, pattern)
		}
		value := 1
		for _, factor := range match[1:] {
			n, err := strconv.Atoi(string(factor))
			if err != nil {
				t.Fatal(err)
			}
			value *= n
		}
		return value
	}
	const mainCpp = "firmware_esp8266/src/main.cpp"
	const renderer = "firmware_shared/theme_spec_renderer_core.h"

	hello := virtualHello(t)
	theme := hello.Capabilities.Theme
	for _, check := range []struct {
		name string
		got  int
		want int
	}{
		{"maxFrameBytes", hello.MaxFrameBytes, firmware(mainCpp, `constexpr int kMaxFrameBytes = (\d+);`)},
		{"maxThemeSpecBytes", theme.MaxThemeSpecBytes, firmware(mainCpp, `maxThemeSpecBytes\\":(\d+),\\"maxThemePrimitives\\":";`)},
		{"maxStoredThemeSpecBytes", theme.MaxStoredThemeSpecBytes, firmware(mainCpp, `kMaxStoredThemeSpecBytes = (\d+);`)},
		{"maxThemeActivationBodyBytes", maxThemeActivationBodyBytes, firmware(mainCpp, `body\.length\(\) > (\d+)\) \{\s+addCorsHeaders\(\);\s+webServer\.send\(400, "text/plain; charset=utf-8", "invalid theme activation body"\);`)},
		{"maxThemePrimitives", theme.MaxThemePrimitives, firmware(renderer, `kMaxCompiledThemeSpecPrimitives = (\d+);`)},
		{"maxUsageWindows", theme.MaxUsageWindows, firmware("firmware_shared/usage_window_contract.h", `kMaxWindows = (\d+);`)},
		{"maxThemeGifAssets", theme.MaxThemeGifAssets, firmware(renderer, `kMaxThemeSpecGifAssets = (\d+);`)},
		{"maxThemeGifBytes", theme.MaxThemeGifBytes, firmware(renderer, `kMaxThemeSpecGifAssetBytes = (\d+) \* (\d+);`)},
		{"maxThemeGifWidth", theme.MaxThemeGifWidth, firmware(renderer, `kMaxThemeSpecGifWidth = (\d+);`)},
		{"maxThemeGifHeight", theme.MaxThemeGifHeight, firmware(renderer, `kMaxThemeSpecGifHeight = (\d+);`)},
		{"maxThemeGifLzwBits", theme.MaxThemeGifLzwBits, firmware("firmware_esp8266/src/gif_asset_validator.h", `kMaxThemeGifLzwBits = (\d+);`)},
	} {
		if check.got != check.want {
			t.Errorf("%s: virtual=%d firmware=%d", check.name, check.got, check.want)
		}
	}
}

// A theme feature the firmware announces is announced here too, in the feature
// list and in the theme block, or a pack that needs it could not be rehearsed.
func TestThemeFeaturesMatchFirmware(t *testing.T) {
	source, err := os.ReadFile(filepath.Join("..", "..", "..", "firmware_esp8266", "src", "main.cpp"))
	if err != nil {
		t.Fatal(err)
	}
	hello := virtualHello(t)
	block, err := json.Marshal(hello.Capabilities.Theme)
	if err != nil {
		t.Fatal(err)
	}
	features := regexp.MustCompile(`\\"([a-z-]+-v\d+)\\"`).FindAllSubmatch(source, -1)
	flags := regexp.MustCompile(`\\"(supports\w+)\\":true`).FindAllSubmatch(source, -1)
	if len(features) == 0 || len(flags) == 0 {
		t.Fatalf("no theme features found in the firmware source: %d features, %d flags", len(features), len(flags))
	}
	for _, match := range features {
		feature := string(match[1])
		if !strings.HasPrefix(feature, "cable-") && !slices.Contains(hello.Features, feature) {
			t.Errorf("firmware feature %s is missing from the virtual hello", feature)
		}
	}
	for _, match := range flags {
		if !bytes.Contains(block, []byte(`"`+string(match[1])+`":true`)) {
			t.Errorf("firmware theme capability %s is missing from the virtual hello", match[1])
		}
	}
}

func TestFrameLimitBoundary(t *testing.T) {
	cfg := DefaultConfig()
	cfg.RebootUnavailableRequests = 0
	running, err := Start(cfg)
	if err != nil {
		t.Fatalf("start virtual VibeTV: %v", err)
	}
	t.Cleanup(func() { _ = running.Close() })
	frame := func(size int) int {
		prefix, suffix := `{"v":2,"provider":"`, `"}`
		body := prefix + strings.Repeat("a", size-len(prefix)-len(suffix)) + suffix
		req, err := http.NewRequest(http.MethodPost, running.HTTPURL+"/frame", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("X-VibeTV-Token", cfg.PairingToken)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		return resp.StatusCode
	}
	if got := frame(MaxFrameBytes); got != http.StatusOK {
		t.Fatalf("frame of exactly %d bytes: status %d", MaxFrameBytes, got)
	}
	if got := frame(MaxFrameBytes + 1); got != http.StatusBadRequest {
		t.Fatalf("frame of %d bytes: status %d, want 400", MaxFrameBytes+1, got)
	}
}

// Like the ESP8266, activation refuses a stored spec above 4,096 bytes or 32
// primitives and a request body above 160 bytes (#354).
func TestThemeActivationLimitBoundaries(t *testing.T) {
	cfg := DefaultConfig()
	cfg.RebootUnavailableRequests = 0
	running, err := Start(cfg)
	if err != nil {
		t.Fatalf("start virtual VibeTV: %v", err)
	}
	t.Cleanup(func() { _ = running.Close() })
	const path = "/themes/u/limit.json"
	padded := func(prefix string, size int) string {
		return prefix + strings.Repeat("a", size-len(prefix)-len(`"}`)) + `"}`
	}
	for _, tt := range []struct {
		name                             string
		primitives, specBytes, bodyBytes int
		wantStatus                       int
		wantBody                         string
	}{
		{"largest stored spec", 1, maxStoredThemeSpecBytes, 64, http.StatusOK, ""},
		{"stored spec one byte over", 1, maxStoredThemeSpecBytes + 1, 64, http.StatusBadRequest, "theme file too large"},
		{"most primitives", maxThemePrimitives, 1024, 64, http.StatusOK, ""},
		{"one primitive over", maxThemePrimitives + 1, 1024, 64, http.StatusBadRequest, "theme spec has no renderable content"},
		{"largest activation body", 1, 1024, maxThemeActivationBodyBytes, http.StatusOK, ""},
		{"activation body one byte over", 1, 1024, maxThemeActivationBodyBytes + 1, http.StatusBadRequest, "invalid theme activation body"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			primitives := strings.TrimSuffix(strings.Repeat(`{"t":"r","w":1,"h":1},`, tt.primitives), ",")
			spec := padded(`{"id":"limit","rev":1,"p":[`+primitives+`],"pad":"`, tt.specBytes)
			body := padded(`{"path":"`+path+`","pad":"`, tt.bodyBytes)
			status, answer := activateStoredTheme(t, running, path, spec, body)
			if status != tt.wantStatus || !strings.Contains(answer, tt.wantBody) {
				t.Fatalf("spec=%d bytes, %d primitives, body=%d bytes: status %d %q, want %d %q",
					len(spec), tt.primitives, len(body), status, answer, tt.wantStatus, tt.wantBody)
			}
		})
	}
}

// Like the ESP8266, activation refuses a stored spec that is no JSON object
// with an id, a positive whole revision and one primitive that compiles, each
// under its long or short key.
func TestThemeActivationRefusesWhatTheFirmwareRefuses(t *testing.T) {
	cfg := DefaultConfig()
	cfg.RebootUnavailableRequests = 0
	running, err := Start(cfg)
	if err != nil {
		t.Fatalf("start virtual VibeTV: %v", err)
	}
	t.Cleanup(func() { _ = running.Close() })
	const (
		path      = "/themes/u/refusal.json"
		noJSON    = "bad theme json"
		noObject  = "theme json must be an object"
		noIDRev   = "theme id/rev missing"
		noContent = "theme spec has no renderable content"
	)
	type activation struct{ name, spec, wantRefusal string }
	cases := []activation{
		{"short keys", `{"id":"a","rev":1,"p":[{"t":"tx"}]}`, ""},
		{"long keys", `{"themeId":"a","themeRev":1,"primitives":[{"type":"text"}]}`, ""},
		{"rev behind a themeRev of zero", `{"id":"a","themeRev":0,"rev":1,"p":[{"t":"tx"}]}`, ""},
		{"only whitespace", " \n", "theme file too large"},
		{"JSON cut off", `{"id":"a","rev":1,"p":[{"t":"tx"}`, noJSON},
		{"array instead of object", `[{"t":"tx"}]`, noObject},
		{"empty object", `{}`, noIDRev},
		{"no id", `{"rev":1,"p":[{"t":"tx"}]}`, noIDRev},
		{"blank id", `{"id":" ","rev":1,"p":[{"t":"tx"}]}`, noIDRev},
		{"id behind an empty themeId", `{"themeId":"","id":"a","rev":1,"p":[{"t":"tx"}]}`, noIDRev},
		{"keys in upper case", `{"ID":"a","REV":1,"P":[{"T":"tx"}]}`, noIDRev},
		{"no rev", `{"id":"a","p":[{"t":"tx"}]}`, noIDRev},
		{"rev zero", `{"id":"a","rev":0,"p":[{"t":"tx"}]}`, noIDRev},
		{"rev with a fraction", `{"id":"a","rev":1.0,"p":[{"t":"tx"}]}`, noIDRev},
		{"rev above 32 bits", `{"id":"a","rev":2147483648,"p":[{"t":"tx"}]}`, noIDRev},
		{"rev behind a themeRev that is text", `{"id":"a","themeRev":"2","rev":1,"p":[{"t":"tx"}]}`, noIDRev},
		{"no primitives", `{"id":"a","rev":1}`, noContent},
		{"primitives that are no array", `{"id":"a","rev":1,"p":{"t":"tx"}}`, noContent},
		{"empty primitives", `{"id":"a","rev":1,"p":[]}`, noContent},
		{"p behind an empty primitives", `{"id":"a","rev":1,"primitives":[],"p":[{"t":"tx"}]}`, noContent},
		{"no primitive of a known type", `{"id":"a","rev":1,"p":[{"t":"circle"},{"x":1},7]}`, noContent},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			wantStatus := http.StatusBadRequest
			if tt.wantRefusal == "" {
				wantStatus = http.StatusOK
			}
			status, answer := activateStoredTheme(t, running, path, tt.spec, `{"path":"`+path+`"}`)
			if status != wantStatus || !strings.Contains(answer, tt.wantRefusal) {
				t.Fatalf("%s: status %d %q, want %d %q", tt.spec, status, answer, wantStatus, tt.wantRefusal)
			}
		})
	}
}

// Like the firmware's CompilePrimitive, activation refuses a spec in which no
// primitive compiles, judged rule by rule for each primitive type. A spec with
// one good primitive among bad ones still activates (#354).
func TestThemeActivationRefusesPrimitivesThatDoNotCompile(t *testing.T) {
	cfg := DefaultConfig()
	cfg.RebootUnavailableRequests = 0
	running, err := Start(cfg)
	if err != nil {
		t.Fatalf("start virtual VibeTV: %v", err)
	}
	t.Cleanup(func() { _ = running.Close() })
	const (
		path      = "/themes/u/compile.json"
		noContent = "theme spec has no renderable content"
		goodRect  = `{"t":"r","w":1,"h":1}`
	)
	for _, tt := range []struct {
		name, primitives string
		refused          bool
	}{
		// CompilePrimitive, slots: usageIndex, slot and providerSlot are uint8
		// after the limits of kMaxThemeSpecUsageWindows (3) and kMaxThemeSpecProviderSlots (2).
		{"usage index 2 is the last slot", `{"t":"r","w":1,"h":1,"ui":2}`, false},
		{"usage index 3 is past the last slot", `{"t":"r","w":1,"h":1,"ui":3}`, true},
		{"slot 3 is the last slot", `{"t":"r","w":1,"h":1,"sl":3}`, false},
		{"slot 4 is past the last slot", `{"t":"r","w":1,"h":1,"sl":4}`, true},
		{"provider slot 2 is the last slot", `{"t":"r","w":1,"h":1,"pl":2}`, false},
		{"provider slot 3 is past the last slot", `{"t":"r","w":1,"h":1,"pl":3}`, true},
		// CompilePrimitive, rect: width and height above zero.
		{"rect without width and height", `{"t":"r"}`, true},
		{"rect with height 0", `{"t":"r","w":1,"h":0}`, true},
		{"rect with width and height", `{"type":"rect","width":1,"height":1}`, false},
		// CompilePrimitive, text: font size above zero, default 1; empty text is kept.
		{"text with font size 0", `{"t":"tx","s":0}`, true},
		{"text with the default font size and no text", `{"t":"tx"}`, false},
		// CompilePrimitive, progress: width and height above zero.
		{"progress without height", `{"t":"p","w":10}`, true},
		{"progress with width and height", `{"t":"p","w":10,"h":10}`, false},
		// CompilePrimitive, progress arc: start 0-359, sweep 1-360, thickness at
		// least 1 and at most half the smaller side.
		{"arc starting at 360", `{"t":"p","w":10,"h":10,"ps":"arc","as":360,"aw":90,"at":2}`, true},
		{"arc sweep 0", `{"t":"p","w":10,"h":10,"ps":"arc","as":0,"aw":0,"at":2}`, true},
		{"arc sweep 360", `{"t":"p","w":10,"h":10,"ps":"arc","as":0,"aw":360,"at":2}`, false},
		{"arc thickness 0", `{"t":"p","w":10,"h":10,"ps":"arc","as":0,"aw":90,"at":0}`, true},
		{"arc thicker than half its side", `{"t":"p","w":10,"h":10,"ps":"arc","as":0,"aw":90,"at":6}`, true},
		{"arc at half its side", `{"t":"p","w":10,"h":10,"ps":"arc","as":0,"aw":90,"at":5}`, false},
		// CompileProgressColorStops: at most 4 stops, each with gte 0-100 and a colour.
		{"five colour stops", `{"t":"p","w":10,"h":10,"cs":[{"gte":90,"c":"#FFFFFF"},{"gte":80,"c":"#FFFFFF"},{"gte":70,"c":"#FFFFFF"},{"gte":60,"c":"#FFFFFF"},{"gte":50,"c":"#FFFFFF"}]}`, true},
		{"colour stop above 100", `{"t":"p","w":10,"h":10,"cs":[{"gte":101,"c":"#FFFFFF"}]}`, true},
		{"colour stop without a colour", `{"t":"p","w":10,"h":10,"cs":[{"gte":50}]}`, true},
		{"colour stop at 0 and 100", `{"t":"p","w":10,"h":10,"cs":[{"gte":100,"color":"#FFFFFF"},{"gte":0,"c":"#000000"}]}`, false},
		// CompilePrimitive, gif: at most 80 by 80, and the initial asset (idle, else
		// assetPath) and any idle or coding asset end in .gif.
		{"gif 81 wide", `{"t":"g","w":81,"h":10,"a":"/themes/u/a.gif"}`, true},
		{"gif without a size", `{"t":"g","a":"/themes/u/a.gif"}`, true},
		{"gif 80 by 80", `{"t":"g","w":80,"h":80,"a":"/themes/u/a.gif"}`, false},
		{"gif without an asset", `{"t":"g","w":10,"h":10}`, true},
		{"gif asset that is no GIF", `{"t":"g","w":10,"h":10,"a":"/themes/u/a.png"}`, true},
		{"gif idle asset that is no GIF", `{"t":"g","w":10,"h":10,"sa":{"idle":"/themes/u/a.png"}}`, true},
		{"gif with a GIF idle asset", `{"t":"g","w":10,"h":10,"sa":{"idle":"/themes/u/a.gif"}}`, false},
		// CompilePrimitive, sprite and image: an assetPath, an idle or coding
		// state asset, or a provider asset with a key and a path.
		{"sprite without any asset", `{"t":"sp","w":10,"h":10}`, true},
		{"sprite with an asset path", `{"t":"sp","a":"/themes/u/a.png"}`, false},
		{"image with a coding state asset", `{"type":"image","stateAssets":{"coding":"/themes/u/a.png"}}`, false},
		{"sprite with a provider asset", `{"t":"sp","pa":{"claude":"/themes/u/a.png"}}`, false},
		{"sprite with an empty provider path", `{"t":"sp","pa":{"claude":""}}`, true},
		// CompilePrimitive, pixels: width and height above zero.
		{"pixels without width", `{"t":"px","h":2}`, true},
		{"pixels of 1 by 1", `{"t":"px","w":1,"h":1}`, false},
		// CompileThemeSpecObject: one primitive that compiles is enough.
		{"bad rect next to a good one", `{"t":"r"},` + goodRect, false},
		{"good rect next to a bad one", goodRect + `,{"t":"r"}`, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			wantStatus, wantAnswer := http.StatusOK, ""
			if tt.refused {
				wantStatus, wantAnswer = http.StatusBadRequest, noContent
			}
			spec := `{"id":"compile","rev":1,"p":[` + tt.primitives + `]}`
			status, answer := activateStoredTheme(t, running, path, spec, `{"path":"`+path+`"}`)
			if status != wantStatus || !strings.Contains(answer, wantAnswer) {
				t.Fatalf("%s: status %d %q, want %d %q", spec, status, answer, wantStatus, wantAnswer)
			}
		})
	}
}

// Every theme spec the repository ships must activate on the virtual device, so
// a rule stricter than the firmware's shows up in the unit tests (#354). A pack
// manifest is not a theme spec and is skipped.
func TestEveryShippedThemeSpecActivates(t *testing.T) {
	cfg := DefaultConfig()
	cfg.RebootUnavailableRequests = 0
	running, err := Start(cfg)
	if err != nil {
		t.Fatalf("start virtual VibeTV: %v", err)
	}
	t.Cleanup(func() { _ = running.Close() })
	var specs []string
	for _, root := range []string{"theme-packs", "theme-render-packs"} {
		err := filepath.WalkDir(filepath.Join("..", "..", "..", root), func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if !entry.IsDir() && filepath.Ext(path) == ".json" && entry.Name() != "manifest.json" {
				specs = append(specs, path)
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if len(specs) == 0 {
		t.Fatal("no shipped theme spec found")
	}
	for i, spec := range specs {
		t.Run(filepath.Base(filepath.Dir(spec))+"/"+filepath.Base(spec), func(t *testing.T) {
			raw, err := os.ReadFile(spec)
			if err != nil {
				t.Fatal(err)
			}
			path := "/themes/u/shipped-" + strconv.Itoa(i) + ".json"
			status, answer := activateStoredTheme(t, running, path, string(raw), `{"path":"`+path+`"}`)
			if status != http.StatusOK {
				t.Fatalf("status %d %q, want %d", status, answer, http.StatusOK)
			}
		})
	}
}

// activateStoredTheme stores spec at path on the virtual device and returns its
// answer to an activation request with that body.
func activateStoredTheme(t *testing.T, running *RunningServer, path, spec, body string) (int, string) {
	t.Helper()
	running.mu.Lock()
	running.assets[path] = []byte(spec)
	running.mu.Unlock()
	req, err := http.NewRequest(http.MethodPost, running.HTTPURL+"/theme/active", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("X-VibeTV-Token", running.cfg.PairingToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	answer, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(answer)
}

func virtualHello(t *testing.T) protocol.DeviceHello {
	t.Helper()
	cfg := DefaultConfig()
	cfg.RebootUnavailableRequests = 0
	running, err := Start(cfg)
	if err != nil {
		t.Fatalf("start virtual VibeTV: %v", err)
	}
	t.Cleanup(func() { _ = running.Close() })
	resp, err := http.Get(running.HTTPURL + "/hello")
	if err != nil {
		t.Fatalf("get hello: %v", err)
	}
	defer resp.Body.Close()
	var hello protocol.DeviceHello
	if err := json.NewDecoder(resp.Body).Decode(&hello); err != nil {
		t.Fatalf("decode hello: %v", err)
	}
	return hello
}

// Like the firmware, an upload that names an MD5 is stored only when its bytes
// match it (#60); an upload without one is stored as before.
func TestAssetUploadRefusesBytesThatDoNotMatchTheirHash(t *testing.T) {
	cfg := DefaultConfig()
	cfg.RebootUnavailableRequests = 0
	running, err := Start(cfg)
	if err != nil {
		t.Fatalf("start virtual VibeTV: %v", err)
	}
	t.Cleanup(func() { _ = running.Close() })
	data := []byte("CBI1\n")
	digest := md5.Sum(data)
	upload := func(path, hash string) int {
		var body bytes.Buffer
		form := multipart.NewWriter(&body)
		part, _ := form.CreateFormFile("asset", "a.cbi")
		_, _ = part.Write(data)
		_ = form.Close()
		url := running.HTTPURL + "/assets?path=" + path
		if hash != "" {
			url += "&hash=" + hash
		}
		req, _ := http.NewRequest(http.MethodPost, url, &body)
		req.Header.Set("Content-Type", form.FormDataContentType())
		req.Header.Set("X-VibeTV-Token", cfg.PairingToken)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		return resp.StatusCode
	}
	wrong := md5.Sum([]byte("CBI2\n"))
	if got := upload("/themes/u/bad.cbi", hex.EncodeToString(wrong[:])); got != http.StatusBadRequest {
		t.Fatalf("same-size upload with a different hash: status %d, want 400", got)
	}
	if got := upload("/themes/u/good.cbi", hex.EncodeToString(digest[:])); got != http.StatusOK {
		t.Fatalf("upload with its own hash: status %d", got)
	}
	if got := upload("/themes/u/old.cbi", ""); got != http.StatusOK {
		t.Fatalf("upload without a hash: status %d", got)
	}
	running.mu.Lock()
	_, bad := running.assets["/themes/u/bad.cbi"]
	_, good := running.assets["/themes/u/good.cbi"]
	_, old := running.assets["/themes/u/old.cbi"]
	running.mu.Unlock()
	if bad || !good || !old {
		t.Fatalf("stored bad=%v good=%v old=%v, want only good and old", bad, good, old)
	}
}
