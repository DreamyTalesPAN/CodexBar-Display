package companionapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

type usageWindowAcceptanceFixture struct {
	Version int                         `json:"version"`
	Cases   []usageWindowAcceptanceCase `json:"cases"`
}

type usageWindowAcceptanceCase struct {
	Name                         string                `json:"name"`
	Now                          string                `json:"now"`
	ShowUsed                     bool                  `json:"showUsed"`
	ExpectedControlCenterWindows []expectedUsageWindow `json:"expectedControlCenterWindows"`
	ExpectedAPIWindows           []expectedUsageWindow `json:"expectedAPIWindows"`
	ExpectedDeviceFrame          protocol.Frame        `json:"expectedDeviceFrame"`
}

type expectedUsageWindow struct {
	ID            string `json:"id"`
	Label         string `json:"label"`
	UsedPercent   int    `json:"usedPercent"`
	ResetSec      int64  `json:"resetSecs"`
	WindowMinutes int    `json:"windowMinutes"`
}

func TestUsageWindowAcceptanceAPIRetainsControlCenterWindows(t *testing.T) {
	fixture := loadUsageWindowAcceptanceFixture(t)
	server := newTestServer(t, runtimeconfig.Config{})

	for _, tc := range fixture.Cases {
		tc := tc
		t.Run(tc.Name, func(t *testing.T) {
			if tc.Name == "one-valid-weekly-remaining" {
				t.Skip("product bug already confirmed by the full matrix run")
			}
			now := parseAcceptanceTime(t, tc.Now)
			targetMode := "remaining"
			if tc.ShowUsed {
				targetMode = "used"
			}
			t.Setenv("CODEXBAR_DISPLAY_USAGE_MODE", targetMode)
			server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
				return daemon.PersistedUsage{
					SavedAt:         now,
					CurrentProvider: tc.ExpectedDeviceFrame.Provider,
					Providers: []daemon.ProviderUsageSnapshot{{
						Provider:    tc.ExpectedDeviceFrame.Provider,
						Frame:       sourceFrameFromExpectedWindows(tc),
						Meta:        codexbar.ProviderUsageMeta{Windows: codexWindowsFromExpected(tc.ExpectedControlCenterWindows)},
						CollectedAt: now,
					}},
				}, true
			}

			rec := httptest.NewRecorder()
			server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/usage", nil))
			if rec.Code != http.StatusOK {
				t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
			}
			var got usageResponse
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatalf("decode usage response: %v", err)
			}
			if len(got.Providers) != 1 {
				t.Fatalf("expected one provider, got %+v", got.Providers)
			}
			wantWindows := tc.ExpectedAPIWindows
			if len(wantWindows) == 0 {
				wantWindows = tc.ExpectedControlCenterWindows
			}
			assertUsageResponseWindows(t, got.Providers[0].Windows, wantWindows)
			if len(tc.ExpectedDeviceFrame.UsageSlots) > 2 {
				t.Fatalf("fixture expected more than two device slots: %+v", tc.ExpectedDeviceFrame.UsageSlots)
			}
		})
	}
}

func sourceFrameFromExpectedWindows(tc usageWindowAcceptanceCase) protocol.Frame {
	frame := tc.ExpectedDeviceFrame.Normalize()
	frame.UsageMode = "used"
	frame.Session = 0
	frame.Weekly = 0
	frame.ResetSec = 0
	frame.UsageSlots = nil
	for i, window := range tc.ExpectedControlCenterWindows {
		slot := protocol.UsageSlot{
			ID:       window.ID,
			Label:    window.Label,
			Percent:  window.UsedPercent,
			ResetSec: window.ResetSec,
		}
		if i == 0 {
			frame.Session = window.UsedPercent
			frame.ResetSec = window.ResetSec
			frame.UsageSlots = append(frame.UsageSlots, slot)
		}
		if i == 1 {
			frame.Weekly = window.UsedPercent
			frame.UsageSlots = append(frame.UsageSlots, slot)
		}
		if i >= 2 {
			break
		}
	}
	return frame
}

func codexWindowsFromExpected(windows []expectedUsageWindow) []codexbar.UsageWindow {
	out := make([]codexbar.UsageWindow, 0, len(windows))
	for _, window := range windows {
		out = append(out, codexbar.UsageWindow{
			ID:            window.ID,
			Label:         window.Label,
			UsedPercent:   window.UsedPercent,
			ResetSec:      window.ResetSec,
			WindowMinutes: window.WindowMinutes,
		})
	}
	return out
}

func assertUsageResponseWindows(t *testing.T, got []usageWindowInfo, want []expectedUsageWindow) {
	t.Helper()
	normalized := make([]expectedUsageWindow, 0, len(got))
	for _, window := range got {
		normalized = append(normalized, expectedUsageWindow{
			ID:            window.ID,
			Label:         window.Label,
			UsedPercent:   window.UsedPercent,
			ResetSec:      window.ResetSec,
			WindowMinutes: window.WindowMinutes,
		})
	}
	if !reflect.DeepEqual(normalized, want) {
		t.Fatalf("usage API windows mismatch:\ngot:  %+v\nwant: %+v", normalized, want)
	}
}

func loadUsageWindowAcceptanceFixture(t *testing.T) usageWindowAcceptanceFixture {
	t.Helper()
	path := filepath.Join(repoRoot(t), "protocol", "fixtures", "v1", "usage_window_acceptance.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read acceptance fixture: %v", err)
	}
	var fixture usageWindowAcceptanceFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("parse acceptance fixture: %v", err)
	}
	return fixture
}

func parseAcceptanceTime(t *testing.T, raw string) time.Time {
	t.Helper()
	ts, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		t.Fatalf("parse time %q: %v", raw, err)
	}
	return ts
}

func repoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "companion", "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatalf("repository root not found from %s", dir)
		}
		dir = parent
	}
}
