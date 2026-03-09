package daemon

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

type goldenFixture struct {
	Version int                 `json:"version"`
	Cases   []goldenFixtureCase `json:"cases"`
}

type goldenFixtureCase struct {
	Name           string                  `json:"name"`
	InputFrame     protocol.Frame          `json:"inputFrame"`
	RequestedTheme string                  `json:"requestedTheme"`
	DeviceCaps     goldenFixtureDeviceCaps `json:"deviceCaps"`
	ExpectedFrame  protocol.Frame          `json:"expectedFrame"`
}

type goldenFixtureDeviceCaps struct {
	Known         bool `json:"known"`
	SupportsTheme bool `json:"supportsTheme"`
	MaxFrameBytes int  `json:"maxFrameBytes"`
}

func TestProtocolV1GoldenCompanionFrames(t *testing.T) {
	fixture := loadGoldenFixture(t)
	if fixture.Version != 1 {
		t.Fatalf("unexpected fixture version %d", fixture.Version)
	}
	for _, tc := range fixture.Cases {
		tc := tc
		t.Run(tc.Name, func(t *testing.T) {
			caps := protocol.DeviceCapabilities{
				Known:         tc.DeviceCaps.Known,
				SupportsTheme: tc.DeviceCaps.SupportsTheme,
				MaxFrameBytes: tc.DeviceCaps.MaxFrameBytes,
			}

			frame, _ := applyThemeToFrame(tc.InputFrame, tc.RequestedTheme, caps)
			_, marshaledFrame, err := marshalFrameWithinLimit(frame, caps.MaxFrameBytes)
			if err != nil {
				t.Fatalf("marshal frame within limit: %v", err)
			}

			assertFrameMatch(t, marshaledFrame.Normalize(), tc.ExpectedFrame.Normalize())
		})
	}
}

func assertFrameMatch(t *testing.T, got, want protocol.Frame) {
	t.Helper()

	if got.V != want.V {
		t.Fatalf("v mismatch: got=%d want=%d", got.V, want.V)
	}
	if got.Provider != want.Provider {
		t.Fatalf("provider mismatch: got=%q want=%q", got.Provider, want.Provider)
	}
	if got.Label != want.Label {
		t.Fatalf("label mismatch: got=%q want=%q", got.Label, want.Label)
	}
	if got.Session != want.Session {
		t.Fatalf("session mismatch: got=%d want=%d", got.Session, want.Session)
	}
	if got.Weekly != want.Weekly {
		t.Fatalf("weekly mismatch: got=%d want=%d", got.Weekly, want.Weekly)
	}
	if got.ResetSec != want.ResetSec {
		t.Fatalf("reset mismatch: got=%d want=%d", got.ResetSec, want.ResetSec)
	}
	if got.UsageMode != want.UsageMode {
		t.Fatalf("usageMode mismatch: got=%q want=%q", got.UsageMode, want.UsageMode)
	}
	if got.SessionTokens != want.SessionTokens {
		t.Fatalf("sessionTokens mismatch: got=%d want=%d", got.SessionTokens, want.SessionTokens)
	}
	if got.WeekTokens != want.WeekTokens {
		t.Fatalf("weekTokens mismatch: got=%d want=%d", got.WeekTokens, want.WeekTokens)
	}
	if got.TotalTokens != want.TotalTokens {
		t.Fatalf("totalTokens mismatch: got=%d want=%d", got.TotalTokens, want.TotalTokens)
	}
	if got.Theme != want.Theme {
		t.Fatalf("theme mismatch: got=%q want=%q", got.Theme, want.Theme)
	}
	if got.Error != want.Error {
		t.Fatalf("error mismatch: got=%q want=%q", got.Error, want.Error)
	}
}

func loadGoldenFixture(t *testing.T) goldenFixture {
	t.Helper()
	path := filepath.Join(repoRoot(t), "protocol", "fixtures", "v1", "companion_frame_golden.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fixture goldenFixture
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatalf("parse fixture: %v", err)
	}
	return fixture
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
