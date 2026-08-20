package daemon

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

type resetTrustFixture struct {
	Version          int                     `json:"version"`
	TrustHorizonSecs int64                   `json:"trustHorizonSecs"`
	Cases            []resetTrustFixtureCase `json:"cases"`
}

type resetTrustFixtureCase struct {
	Name             string         `json:"name"`
	Description      string         `json:"description"`
	CollectedAgeSecs int64          `json:"collectedAgeSecs"`
	BasisUnknown     bool           `json:"basisUnknown"`
	SourceLive       bool           `json:"sourceLive"`
	InputFrame       protocol.Frame `json:"inputFrame"`
	ExpectedFrame    protocol.Frame `json:"expectedFrame"`
}

func TestResetTrustGoldenFrames(t *testing.T) {
	fixture := loadResetTrustFixture(t)
	if fixture.Version != 1 {
		t.Fatalf("unexpected fixture version %d", fixture.Version)
	}
	if got := int64(protocol.ResetTrustHorizon / time.Second); got != fixture.TrustHorizonSecs {
		t.Fatalf("trust horizon mismatch: code=%d fixture=%d", got, fixture.TrustHorizonSecs)
	}

	sendAt := time.Date(2026, 7, 28, 9, 0, 0, 0, time.UTC)
	for _, tc := range fixture.Cases {
		tc := tc
		t.Run(tc.Name, func(t *testing.T) {
			collectedAt := time.Time{}
			if !tc.BasisUnknown {
				collectedAt = sendAt.Add(-time.Duration(tc.CollectedAgeSecs) * time.Second)
			}

			got := tc.InputFrame.ApplyResetTrust(collectedAt, sendAt, tc.SourceLive)
			assertFrameMatch(t, got, tc.ExpectedFrame.Normalize())
		})
	}
}

// Older firmware only knows the v1 fields and ignores everything else. Decoding
// a trust-annotated frame into that legacy shape must yield exactly the frame
// such a device sees today.
func TestResetTrustFieldsAreIgnorableByLegacyFirmware(t *testing.T) {
	type legacyFrame struct {
		V             int    `json:"v"`
		Provider      string `json:"provider"`
		Label         string `json:"label"`
		Session       int    `json:"session"`
		Weekly        int    `json:"weekly"`
		ResetSec      int64  `json:"resetSecs"`
		SessionTokens int64  `json:"sessionTokens"`
		Theme         string `json:"theme"`
		Error         string `json:"error"`
	}

	base := protocol.Frame{
		V:             protocol.ProtocolVersionV2,
		Provider:      "claude",
		Label:         "Claude",
		Session:       73,
		Weekly:        45,
		ResetSec:      8040,
		SessionTokens: 1437166,
		Theme:         "mini",
	}
	sendAt := time.Date(2026, 7, 28, 9, 0, 0, 0, time.UTC)
	annotated := base.ApplyResetTrust(sendAt, sendAt, true)

	if annotated.ResetTrust != protocol.ResetTrustLive {
		t.Fatalf("expected live trust, got %q", annotated.ResetTrust)
	}

	line, err := annotated.MarshalLine()
	if err != nil {
		t.Fatalf("marshal line: %v", err)
	}
	var legacy legacyFrame
	if err := json.Unmarshal(line, &legacy); err != nil {
		t.Fatalf("legacy decode: %v", err)
	}

	want := legacyFrame{
		V:             base.V,
		Provider:      base.Provider,
		Label:         base.Label,
		Session:       base.Session,
		Weekly:        base.Weekly,
		ResetSec:      base.ResetSec,
		SessionTokens: base.SessionTokens,
		Theme:         base.Theme,
	}
	if legacy != want {
		t.Fatalf("legacy frame changed: got=%+v want=%+v", legacy, want)
	}

	// The added fields must not push a normal frame over the ESP8266 limit.
	if len(line) > protocol.DefaultMaxFrameBytes {
		t.Fatalf("annotated frame too large: %d bytes", len(line))
	}
}

// A provider or window change must never inherit the previous deadline: the
// source key travels with the frame, so the device can tell the countdowns apart.
func TestResetSourceChangesWithProviderAndWindow(t *testing.T) {
	sendAt := time.Date(2026, 7, 28, 9, 0, 0, 0, time.UTC)
	first := protocol.Frame{Provider: "claude", ResetSec: 3600, ResetSource: protocol.ResetSourceKey("claude", "primary")}.
		ApplyResetTrust(sendAt, sendAt, true)
	sameProviderOtherWindow := protocol.Frame{Provider: "claude", ResetSec: 3600, ResetSource: protocol.ResetSourceKey("claude", "secondary")}.
		ApplyResetTrust(sendAt, sendAt, true)
	otherProvider := protocol.Frame{Provider: "codex", ResetSec: 3600, ResetSource: protocol.ResetSourceKey("codex", "primary")}.
		ApplyResetTrust(sendAt, sendAt, true)

	if first.ResetSource == sameProviderOtherWindow.ResetSource {
		t.Fatalf("window change kept source %q", first.ResetSource)
	}
	if first.ResetSource == otherProvider.ResetSource {
		t.Fatalf("provider change kept source %q", first.ResetSource)
	}
	if first.ResetSource != "claude:primary" {
		t.Fatalf("unexpected source %q", first.ResetSource)
	}
}

// The last known good frame is resent with a deadline re-anchored to the send
// instant, and marked offline because the source is no longer live.
func TestRunCycleWithDepsReanchorsLastGoodResetDeadline(t *testing.T) {
	prepareFastTestEnv(t)

	collectedAt := time.Date(2026, 7, 28, 9, 0, 0, 0, time.UTC)
	now := collectedAt.Add(3 * time.Minute)
	state := &runtimeState{
		selector:    codexbar.NewProviderSelector(),
		lastGood:    protocol.Frame{Provider: "codex", Label: "Codex", Session: 12, Weekly: 30, ResetSec: 3600, ResetSource: "codex:primary"},
		lastGoodAt:  collectedAt,
		hasLastGood: true,
	}

	var sent protocol.Frame
	err := runCycleWithDeps(context.Background(), "http://192.168.178.65", state, runtimeDeps{
		now:           func() time.Time { return now },
		transportName: "wifi",
		homeDir:       func() (string, error) { return t.TempDir(), nil },
		loadConfig: func(string) (runtimeconfig.Config, error) {
			return runtimeconfig.Config{DeviceToken: "pair-token"}, nil
		},
		resolvePort: func(string) (string, error) { return "http://192.168.178.65", nil },
		deviceCaps: func(string) (protocol.DeviceCapabilities, error) {
			return protocol.DeviceCapabilities{
				Known:                     true,
				NegotiatedProtocolVersion: protocol.ProtocolVersionV2,
				MaxFrameBytes:             2048,
			}, nil
		},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return nil, codexbar.ErrNoProviders
		},
		logf: func(string, ...any) {},
		sendLine: func(_ string, line []byte) error {
			return json.Unmarshal(line, &sent)
		},
	})
	if err != nil {
		t.Fatalf("expected cycle success, got %v", err)
	}

	if sent.ResetTrust != protocol.ResetTrustOffline {
		t.Fatalf("expected offline trust, got %q", sent.ResetTrust)
	}
	if sent.ResetSec != 3420 {
		t.Fatalf("expected re-anchored deadline 3420, got %d", sent.ResetSec)
	}
	if sent.ResetAgeSec != 180 {
		t.Fatalf("expected age 180, got %d", sent.ResetAgeSec)
	}
	if want := int64(protocol.ResetTrustHorizon/time.Second) - 180; sent.ResetTrustSec != want {
		t.Fatalf("expected trust budget %d, got %d", want, sent.ResetTrustSec)
	}
	if sent.ResetSource != "codex:primary" {
		t.Fatalf("unexpected source %q", sent.ResetSource)
	}
}

func loadResetTrustFixture(t *testing.T) resetTrustFixture {
	t.Helper()
	path := filepath.Join(repoRoot(t), "protocol", "fixtures", "v2", "reset_trust_golden.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fixture resetTrustFixture
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatalf("parse fixture: %v", err)
	}
	return fixture
}
