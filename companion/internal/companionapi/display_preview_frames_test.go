package companionapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

func getUsage(t *testing.T, server *Server, target string) usageResponse {
	t.Helper()
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))
	var got usageResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil || recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s err=%v", recorder.Code, recorder.Body.String(), err)
	}
	return got
}

func getPreviewFrames(t *testing.T, server *Server) previewFramesResponse {
	t.Helper()
	got := getUsage(t, server, "/v1/usage?previewFrames=1")
	if got.PreviewFrames == nil {
		t.Fatal("previewFrames missing")
	}
	return *got.PreviewFrames
}

// Usage and frames of one response are built from one loaded snapshot: a
// collector cycle between two requests cannot make them disagree.
func TestUsagePreviewFramesComeFromTheSameSnapshotAsUsage(t *testing.T) {
	isolatePreviewHome(t)
	server := newTestServer(t, runtimeconfig.Config{})
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	server.now = func() time.Time { return now }
	loads := 0
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		loads++
		return daemon.PersistedUsage{Providers: []daemon.ProviderUsageSnapshot{{
			Provider: "codex", CollectedAt: now,
			Frame: protocol.Frame{
				V: 2, Provider: "codex", Label: "Codex", UsageMode: "used",
				UsageWindows: []protocol.UsageWindow{{ID: "weekly", Label: "Weekly", Percent: loads, ResetSec: 3600}},
			},
		}}}, true
	}

	got := getUsage(t, server, "/v1/usage?previewFrames=1")
	if loads != 1 {
		t.Fatalf("usage loaded %d times for one response", loads)
	}
	frame := got.PreviewFrames.Providers[0].Pinned
	if len(got.Providers) != 1 || got.Providers[0].Weekly != 1 ||
		len(frame.ProviderSlots) != 1 || frame.ProviderSlots[0].Percent != 1 {
		t.Fatalf("usage and frame disagree: usage=%+v frame=%+v", got.Providers, frame.ProviderSlots)
	}
	if plain := getUsage(t, server, "/v1/usage"); plain.PreviewFrames != nil {
		t.Fatalf("frames only on request: %+v", plain.PreviewFrames)
	}
}

func TestDisplayPreviewFramesAreTheDaemonsFrames(t *testing.T) {
	isolatePreviewHome(t)
	server := newTestServer(t, runtimeconfig.Config{})
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	server.now = func() time.Time { return now }
	usage := daemon.PersistedUsage{Providers: []daemon.ProviderUsageSnapshot{
		{
			Provider:    "codex",
			CollectedAt: now.Add(-time.Minute),
			Frame: protocol.Frame{
				V: 2, Provider: "codex", Label: "Codex", UsageMode: "used",
				UsageWindows: []protocol.UsageWindow{{ID: "weekly", Label: "Weekly", Percent: 12, ResetSec: 3600}},
			},
		},
	}}
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) { return usage, true }

	got := getPreviewFrames(t, server)
	want := daemon.PreviewFrames(usage, true, false, server.previewDeviceCapabilities(), now, nil)
	if len(got.Providers) != 1 || got.Providers[0].ID != "codex" {
		t.Fatalf("providers: %+v", got.Providers)
	}
	gotJSON, _ := json.Marshal(got.Providers[0].Automatic)
	wantJSON, _ := json.Marshal(want[0].Automatic)
	if string(gotJSON) != string(wantJSON) {
		t.Fatalf("endpoint frame differs from the daemon's:\n got %s\nwant %s", gotJSON, wantJSON)
	}
	if rows := got.Providers[0].Pinned.ProviderSlots; len(rows) != 1 || rows[0].ResetSec != 3540 {
		t.Fatalf("re-anchored pinned row: %+v", rows)
	}
}

func TestUsagePreviewFramesReuseCapturedUsageMode(t *testing.T) {
	for _, mode := range []string{"used", "remaining"} {
		t.Run(mode, func(t *testing.T) {
			isolatePreviewHome(t)
			server := newTestServer(t, runtimeconfig.Config{})
			now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
			server.now = func() time.Time { return now }
			reads := 0
			server.usageBarsShowUsed = func() bool {
				reads++
				return (mode == "used") == (reads == 1)
			}
			server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
				return daemon.PersistedUsage{Providers: []daemon.ProviderUsageSnapshot{{
					Provider: "codex", CollectedAt: now,
					Frame: protocol.Frame{V: 2, Provider: "codex", Label: "Codex", UsageMode: "used",
						UsageWindows: []protocol.UsageWindow{{ID: "weekly", Label: "Weekly", Percent: 12, ResetSec: 3600}},
					},
				}}}, true
			}
			got := getUsage(t, server, "/v1/usage?previewFrames=1")
			want := 12
			if mode == "remaining" {
				want = 88
			}
			if got.UsageMode != mode || len(got.Providers) != 1 || got.Providers[0].Weekly != want {
				t.Fatalf("usage mode=%s providers=%+v", got.UsageMode, got.Providers)
			}
			preview := got.PreviewFrames.Providers[0]
			for _, frame := range []*protocol.Frame{preview.Automatic, &preview.Pinned} {
				if frame == nil || frame.UsageMode != mode || frame.UsageWindows[0].Percent != want || frame.ProviderSlots[0].Percent != want {
					t.Fatalf("preview differs from captured %s mode: %+v", mode, frame)
				}
			}
			if reads != 1 {
				t.Fatalf("usage mode read %d times for one response", reads)
			}
		})
	}
}

// Every provider switched on in CodexBar is listed in its order. One without a
// reading yet has the host's unavailable frame when pinned, and no Automatic
// frame while another provider is current, as the stream drops it there.
func TestDisplayPreviewFramesCoverEveryEnabledProvider(t *testing.T) {
	isolatePreviewHome(t)
	server := newTestServer(t, runtimeconfig.Config{})
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	server.now = func() time.Time { return now }
	server.providerPreferences.loadInventory = func(context.Context) ([]codexbar.ProviderSetting, error) {
		return []codexbar.ProviderSetting{
			{ID: "gemini", Label: "Gemini", Enabled: true},
			{ID: "cursor", Label: "Cursor", Enabled: false},
			{ID: "codex", Label: "Codex", Enabled: true},
		}, nil
	}
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return daemon.PersistedUsage{Providers: []daemon.ProviderUsageSnapshot{
			{
				Provider: "codex", CollectedAt: now,
				Frame: protocol.Frame{
					V: 2, Provider: "codex", Label: "Codex", UsageMode: "used",
					UsageWindows: []protocol.UsageWindow{{ID: "weekly", Label: "Weekly", Percent: 12, ResetSec: 3600}},
				},
			},
			{Provider: "cursor", CollectedAt: now, Frame: protocol.Frame{V: 2, Provider: "cursor", Label: "Cursor", Session: 5}},
		}}, true
	}

	got := getPreviewFrames(t, server)
	if len(got.Providers) != 2 || got.Providers[0].ID != "gemini" || got.Providers[1].ID != "codex" {
		t.Fatalf("enabled providers in CodexBar's order: %+v", got.Providers)
	}
	if got.Providers[0].Automatic != nil {
		t.Fatalf("the stream never rotates to a provider without a reading: %+v", got.Providers[0].Automatic)
	}
	gemini := got.Providers[0].Pinned
	if gemini.Error == "" || gemini.ResetSec != 0 || gemini.Session != 0 {
		t.Fatalf("a provider without a reading must be the unavailable frame: %+v", gemini)
	}
	if rows := got.Providers[1].Automatic.ProviderSlots; len(rows) != 1 || rows[0].ID != "codex" {
		t.Fatalf("the unavailable provider has no row: %+v", rows)
	}
}

// PreviewFrames reads the runtime's persisted last-good frame from the home
// directory; a test must not see the developer's.
func isolatePreviewHome(t *testing.T) {
	t.Helper()
	previous := time.Local
	time.Local = time.UTC
	t.Cleanup(func() { time.Local = previous })
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
}

func TestUsagePreviewFramesUseCurrentSystemBusyVerdict(t *testing.T) {
	isolatePreviewHome(t)
	server := newTestServer(t, runtimeconfig.Config{})
	now := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	server.now = func() time.Time { return now }
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return daemon.PersistedUsage{Providers: []daemon.ProviderUsageSnapshot{{
			Provider: "codex", CollectedAt: now,
			Frame: protocol.Frame{V: 2, Provider: "codex", Label: "Codex", Session: 12},
		}}}, true
	}
	server.systemBusy = func() *daemon.SystemBusy { return &daemon.SystemBusy{} }
	preview := getPreviewFrames(t, server).Providers[0]
	if preview.Automatic == nil || preview.Automatic.Label != daemon.SystemBusyLabel || preview.Pinned.Label != daemon.SystemBusyLabel {
		t.Fatalf("preview must use the runtime's busy verdict: %+v", preview)
	}
}

func TestUsagePreviewFramesRespectDeviceWireBudget(t *testing.T) {
	for _, budget := range []int{512, 2048} {
		t.Run(fmt.Sprint(budget), func(t *testing.T) {
			isolatePreviewHome(t)
			server := newTestServer(t, runtimeconfig.Config{ConnectionMode: "cable", DeviceID: "preview-device"})
			now := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
			server.now = func() time.Time { return now }
			server.currentCableHello = func() (protocol.DeviceHello, bool) {
				return protocol.DeviceHello{DeviceID: "preview-device", ProtocolVersion: 2, MaxFrameBytes: budget,
					Features:     []string{protocol.FeatureProviderSlotsV1},
					Capabilities: protocol.CapabilityBlock{Transport: protocol.TransportCapabilities{Active: "usb", Mode: "cable"}},
				}, true
			}
			server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
				return daemon.PersistedUsage{Providers: []daemon.ProviderUsageSnapshot{{
					Provider: "codex", CollectedAt: now,
					Frame: protocol.Frame{V: 2, Provider: "codex", Label: "Codex", UsageMode: "used",
						SessionTokens: 123456789012, WeekTokens: 234567890123, TotalTokens: 345678901234, TokenTotalsKnown: true,
						UsageWindows: []protocol.UsageWindow{
							{ID: "session", Label: "Session window usage", Percent: 12, ResetSec: 3600},
							{ID: "weekly", Label: "Weekly window usage", Percent: 23, ResetSec: 7200},
							{ID: "monthly", Label: "Monthly window usage", Percent: 34, ResetSec: 9000},
						},
					},
				}}}, true
			}
			preview := getPreviewFrames(t, server).Providers[0]
			for _, frame := range []*protocol.Frame{preview.Automatic, &preview.Pinned} {
				if frame == nil {
					t.Fatal("missing preview frame")
				}
				line, err := frame.MarshalNormalizedLine()
				if err != nil || len(line) > budget {
					t.Fatalf("preview exceeds %d-byte device budget: bytes=%d err=%v", budget, len(line), err)
				}
				if frame.TokenTotalsKnown != (budget == 2048) {
					t.Fatalf("preview token visibility differs from wire budget %d: %+v", budget, frame)
				}
			}
		})
	}
}

func TestPreviewDeviceCapabilitiesNeverProbeWiFi(t *testing.T) {
	for _, cached := range []bool{false, true} {
		t.Run(fmt.Sprint(cached), func(t *testing.T) {
			requests := 0
			device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests++
				_ = json.NewEncoder(w).Encode(protocol.DeviceHello{DeviceID: "preview-device", ProtocolVersion: 2, MaxFrameBytes: 2048,
					Features:     []string{protocol.FeatureProviderSlotsV1},
					Capabilities: protocol.CapabilityBlock{Transport: protocol.TransportCapabilities{Active: "wifi", Mode: "wifi"}},
				})
			}))
			defer device.Close()
			now := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
			server := newTestServer(t, runtimeconfig.Config{ConnectionMode: "wifi", DeviceID: "preview-device", DeviceTarget: device.URL})
			server.now = func() time.Time { return now }
			server.probeCacheTime = time.Second
			if cached {
				if _, err := server.getHelloProbe(context.Background(), device.URL, "", time.Second); err != nil {
					t.Fatal(err)
				}
				// Capabilities can be read from an old hello; this is not a reachability check.
				now = now.Add(time.Minute)
			}
			requestsBefore := requests
			caps := server.previewDeviceCapabilities()
			if requests != requestsBefore {
				t.Fatalf("local usage preview triggered %d device requests", requests-requestsBefore)
			}
			want := protocol.DefaultMaxFrameBytes
			if cached {
				want = 2048
			}
			if caps.MaxFrameBytes != want {
				t.Fatalf("got budget %d, want %d", caps.MaxFrameBytes, want)
			}
		})
	}
}

func TestUsagePreviewFramesUseTheLocalStreamClock(t *testing.T) {
	isolatePreviewHome(t)
	location, err := time.LoadLocation("Europe/Berlin")
	if err != nil {
		t.Fatal(err)
	}
	previous := time.Local
	time.Local = location
	t.Cleanup(func() { time.Local = previous })
	now := time.Date(2026, 10, 21, 12, 0, 0, 0, location)
	server := newTestServer(t, runtimeconfig.Config{})
	server.now = func() time.Time { return now }
	usage := daemon.PersistedUsage{Providers: []daemon.ProviderUsageSnapshot{{Provider: "codex", CollectedAt: now, Frame: protocol.Frame{V: 2, Provider: "codex", Label: "Codex", Session: 12}}}}
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) { return usage, true }
	preview := getPreviewFrames(t, server).Providers[0]
	want := daemon.PreviewFrames(usage, true, false, server.previewDeviceCapabilities(), now, nil)[0]
	for mode, frame := range map[string]*protocol.Frame{"automatic": preview.Automatic, "pinned": &preview.Pinned} {
		gotJSON, _ := json.Marshal(frame.NextClockTransition)
		wantJSON, _ := json.Marshal(want.Pinned.NextClockTransition)
		if frame.Time != want.Pinned.Time || string(gotJSON) != string(wantJSON) {
			t.Errorf("%s clock %s / %s; stream %s / %s", mode, frame.Time, gotJSON, want.Pinned.Time, wantJSON)
		}
	}
}
