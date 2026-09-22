package codexbar

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

func TestParseUsageJSONReturnsFirstProvider(t *testing.T) {
	raw := []byte(`[
		{"provider":"codex","usage":{"primary":{"usedPercent":1}}},
		{"provider":"claude","usage":{"primary":{"usedPercent":9}}}
	]`)

	parsed, err := parseUsageJSON(raw)
	if err != nil {
		t.Fatalf("parseUsageJSON failed: %v", err)
	}
	if parsed.Provider != "codex" {
		t.Fatalf("expected first provider codex, got %q", parsed.Provider)
	}
}

func TestParseProviderPayloadPreservesKnownLaneWhenOtherLaneIsUnknown(t *testing.T) {
	tests := []struct {
		name               string
		raw                string
		sessionUnavailable bool
		weeklyUnavailable  bool
		knownPercent       int
	}{
		{
			name:              "missing secondary",
			raw:               `[{"provider":"antigravity","source":"cli","usage":{"primary":{"usedPercent":17}}}]`,
			weeklyUnavailable: true,
			knownPercent:      17,
		},
		{
			name:               "explicit unknown primary",
			raw:                `[{"provider":"codex","source":"oauth","usage":{"primary":{"usedPercent":0,"usageKnown":false},"secondary":{"usedPercent":57},"extra":[{"id":"codex-spark-weekly","label":"Codex Spark Weekly","usedPercent":12}]}}]`,
			sessionUnavailable: true,
			knownPercent:       57,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			parsed, err := parseUsageJSON([]byte(test.raw))
			if err != nil {
				t.Fatalf("parse usage: %v", err)
			}
			if parsed.Frame.UsageUnavailable {
				t.Fatalf("one unknown lane made the whole provider unavailable: %#v", parsed.Frame)
			}
			if parsed.Frame.SessionUnavailable != test.sessionUnavailable ||
				parsed.Frame.WeeklyUnavailable != test.weeklyUnavailable {
				t.Fatalf("unexpected lane availability: %#v", parsed.Frame)
			}
			if len(parsed.Meta.Windows) == 0 {
				t.Fatalf("known usage windows were lost: %#v", parsed.Meta)
			}
			if got := parsed.Meta.Windows[0].UsedPercent; got != test.knownPercent {
				t.Fatalf("known lane changed: got %d want %d", got, test.knownPercent)
			}
		})
	}
}

func TestParseProviderPayloadAcceptsKnownZeroPercentLanes(t *testing.T) {
	parsed, err := parseUsageJSON([]byte(`[
		{"provider":"antigravity","source":"cli","usage":{
			"primary":{"usedPercent":0,"usageKnown":true},
			"secondary":{"usedPercent":0}
		}}
	]`))
	if err != nil {
		t.Fatalf("parse usage: %v", err)
	}
	if parsed.Frame.UsageUnavailable {
		t.Fatalf("known zero-percent lanes were marked unavailable: %#v", parsed.Frame)
	}
	if len(parsed.Meta.Windows) != 2 {
		t.Fatalf("known zero-percent lanes must remain in normalized windows: %#v", parsed.Meta.Windows)
	}
}

func TestParseUsageJSONHandlesConcatenatedTopLevelArrays(t *testing.T) {
	raw := []byte(`[
		{"provider":"codex","usage":{"primary":{"usedPercent":1}}}
	][
		{"provider":"claude","usage":{"primary":{"usedPercent":9}}}
	]`)

	parsed, err := parseUsageJSON(raw)
	if err != nil {
		t.Fatalf("parseUsageJSON failed: %v", err)
	}
	if parsed.Provider != "codex" {
		t.Fatalf("expected first decoded provider codex, got %q", parsed.Provider)
	}
}

func TestParseUsageJSONKeepsFirstDecodedValueOnTrailingGarbage(t *testing.T) {
	raw := []byte(`[
		{"provider":"codex","usage":{"primary":{"usedPercent":1}}}
	]THIS_IS_GARBAGE`)

	parsed, err := parseUsageJSON(raw)
	if err != nil {
		t.Fatalf("parseUsageJSON failed: %v", err)
	}
	if parsed.Provider != "codex" {
		t.Fatalf("expected codex from first decoded value, got %q", parsed.Provider)
	}
}

func TestParseUsageJSONHandlesLeadingGarbageBeforeJSON(t *testing.T) {
	raw := []byte(`Error: OpenAI dashboard data not found
[{"source":"web","usage":{"primary":{"usedPercent":2}},"provider":"claude"}]`)

	parsed, err := parseUsageJSON(raw)
	if err != nil {
		t.Fatalf("parseUsageJSON failed: %v", err)
	}
	if parsed.Provider != "claude" {
		t.Fatalf("expected claude from JSON payload after error prefix, got %q", parsed.Provider)
	}
}

func TestParseAllProvidersKeepsSanitizedProviderErrorPayloads(t *testing.T) {
	raw := []byte(`[
		{
			"provider":"codex",
			"source":"codex-cli",
			"usage":{
				"primary":{"usedPercent":1,"resetsAt":"2099-01-01T00:00:00Z"},
				"secondary":{"usedPercent":28}
			}
		},
		{
			"provider":"cursor",
			"source":"auto",
			"error":{"kind":"provider","message":"No Cursor session found.","code":1}
		}
	]`)

	parsed, err := parseAllProviders(raw)
	if err != nil {
		t.Fatalf("parseAllProviders failed: %v", err)
	}
	if len(parsed) != 2 {
		t.Fatalf("expected usage and provider error results, got %d", len(parsed))
	}
	if got := providerKey(parsed[0]); got != "codex" {
		t.Fatalf("expected codex usage provider, got %q", got)
	}
	if got := providerKey(parsed[1]); got != "cursor" || !parsed[1].Frame.UsageUnavailable {
		t.Fatalf("expected sanitized unavailable cursor result, got %#v", parsed[1])
	}
	if parsed[1].Frame.Error != "" || parsed[1].Frame.Session != 0 || parsed[1].Frame.Weekly != 0 {
		t.Fatalf("provider error leaked into usage frame: %#v", parsed[1].Frame)
	}
}

func TestParseAllProvidersRejectsUnidentifiedGlobalError(t *testing.T) {
	_, err := parseAllProviders([]byte(`[{"error":{"kind":"runtime","message":"global failure"}}]`))
	if err == nil {
		t.Fatal("expected unidentified global error to remain a parse failure")
	}
}

func TestParseAllProvidersRejectsOfficialGlobalCLIError(t *testing.T) {
	_, err := parseAllProviders([]byte(`[{"provider":"cli","source":"cli","error":{"kind":"runtime","message":"global failure","code":1}}]`))
	if !errors.Is(err, errGlobalCLI) {
		t.Fatalf("expected official CLI error to remain global, got %v", err)
	}
}

func TestParseProviderPayloadKeepsCodexBarUsageMeta(t *testing.T) {
	raw := []byte(`[
		{
			"provider":"codex",
			"source":"openai-web",
			"status":{"indicator":"none","description":"Operational","updatedAt":"2026-06-26T10:00:00Z","url":"https://status.openai.com/"},
			"usage":{
				"primary":{"usedPercent":28,"windowMinutes":300,"resetsAt":"2099-01-01T01:00:00Z"},
				"secondary":{"usedPercent":59,"windowMinutes":10080,"resetsAt":"2099-01-02T01:00:00Z"},
				"tertiary":{"usedPercent":12,"windowMinutes":43200},
				"extra":[{"id":"codeReview","label":"Code review","usedPercent":7,"windowMinutes":10080}]
			},
			"pace":{
				"primary":{"stage":"ahead","deltaPercent":12,"expectedUsedPercent":16,"willLastToReset":false,"etaSeconds":9000,"summary":"12% in deficit | Expected 16% used | Projected empty in 2h 30m"}
			},
			"openaiDashboard":{
				"usageBreakdown":[
					{"day":"2026-06-24","services":[{"service":"CLI","creditsUsed":8.5},{"service":"Code review","creditsUsed":3.5}],"totalCreditsUsed":12},
					{"day":"2026-06-25","services":[{"service":"CLI","creditsUsed":10}],"totalCreditsUsed":10}
				]
			},
			"credits":{"remaining":112.4,"updatedAt":"2026-06-26T10:01:00Z"}
		}
	]`)

	parsed, err := parseAllProviders(raw)
	if err != nil {
		t.Fatalf("parseAllProviders failed: %v", err)
	}
	if len(parsed) != 1 {
		t.Fatalf("expected one provider, got %d", len(parsed))
	}
	meta := parsed[0].Meta
	if meta.Status == nil || meta.Status.Indicator != "none" || meta.Status.Description != "Operational" || meta.Status.URL == "" {
		t.Fatalf("expected status metadata, got %+v", meta.Status)
	}
	if meta.Credits == nil || meta.Credits.Remaining != 112.4 {
		t.Fatalf("expected credits metadata, got %+v", meta.Credits)
	}
	if len(meta.Pace) != 1 || meta.Pace[0].Window != "primary" || meta.Pace[0].Summary == "" || meta.Pace[0].ETASeconds != 9000 {
		t.Fatalf("expected pace metadata, got %+v", meta.Pace)
	}
	if len(meta.Windows) != 4 {
		t.Fatalf("expected primary, secondary, tertiary, extra windows, got %+v", meta.Windows)
	}
	if len(meta.OverTime) != 2 || meta.OverTime[0].Day != "2026-06-24" || meta.OverTime[0].TotalCreditsUsed != 12 {
		t.Fatalf("expected usage-over-time metadata, got %+v", meta.OverTime)
	}
	if len(meta.OverTime[0].Services) != 2 || meta.OverTime[0].Services[0].Service != "CLI" {
		t.Fatalf("expected usage-over-time services, got %+v", meta.OverTime[0].Services)
	}
	if meta.Windows[2].ID != "tertiary" || meta.Windows[2].UsedPercent != 12 {
		t.Fatalf("expected tertiary window, got %+v", meta.Windows[2])
	}
	if meta.Windows[3].ID != "codereview" || meta.Windows[3].Label != "Code review" || meta.Windows[3].UsedPercent != 7 {
		t.Fatalf("expected extra code review window, got %+v", meta.Windows[3])
	}
}

func TestParseProviderPayloadReadsExtraRateWindows(t *testing.T) {
	raw := []byte(`[
		{
			"provider":"codex",
			"usage":{
				"primary":null,
				"secondary":{"usedPercent":35,"windowMinutes":10080},
				"extraRateWindows":[
					{
						"id":"codex-spark-weekly",
						"title":"Codex Spark Weekly",
						"window":{"usedPercent":0,"windowMinutes":10080,"resetsAt":"2099-01-02T01:00:00Z"}
					}
				]
			}
		}
	]`)

	parsed, err := parseAllProviders(raw)
	if err != nil {
		t.Fatalf("parseAllProviders failed: %v", err)
	}
	windows := parsed[0].Meta.Windows
	if len(windows) != 2 {
		t.Fatalf("expected weekly and Codex Spark windows, got %+v", windows)
	}
	if windows[1].ID != "codex-spark-weekly" || windows[1].Label != "Codex Spark Weekly" || windows[1].UsedPercent != 0 || windows[1].WindowMinutes != 10080 || windows[1].ResetSec <= 0 {
		t.Fatalf("expected nested Codex Spark window, got %+v", windows[1])
	}
}

func TestParseProviderPayloadTreatsNamedOnlyUsageWindowsAsAvailable(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		id   string
	}{
		{
			name: "tertiary",
			raw:  `{"provider":"codex","usage":{"tertiary":{"usedPercent":42,"resetSecs":300}}}`,
			id:   "tertiary",
		},
		{
			name: "extra rate window",
			raw:  `{"provider":"codex","usage":{"extraRateWindows":[{"id":"spark-weekly","label":"Spark weekly","usedPercent":21,"resetSecs":600}]}}`,
			id:   "spark-weekly",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var payload map[string]any
			if err := json.Unmarshal([]byte(tt.raw), &payload); err != nil {
				t.Fatal(err)
			}
			parsed, err := parseProviderPayload(payload)
			if err != nil {
				t.Fatalf("parseProviderPayload failed: %v", err)
			}
			frame := parsed.Frame
			if frame.UsageUnavailable || frame.SessionUnavailable || !frame.WeeklyUnavailable {
				t.Fatalf("named-only window must be available with one legacy lane: %+v", frame)
			}
			if len(frame.UsageWindows) != 1 || frame.UsageWindows[0].ID != tt.id || frame.Session != frame.UsageWindows[0].Percent {
				t.Fatalf("expected the named window to be preserved and projected, got %+v", frame)
			}
		})
	}
}

func TestParseProviderPayloadKeepsUnknownNamedOnlyUsageUnavailable(t *testing.T) {
	parsed, err := parseProviderPayload(map[string]any{
		"provider": "codex",
		"usage": map[string]any{
			"extraRateWindows": []any{map[string]any{
				"id":          "unknown-percent",
				"label":       "Unknown percent",
				"usageKnown":  false,
				"usedPercent": 21,
			}},
		},
	})
	if err != nil {
		t.Fatalf("parseProviderPayload failed: %v", err)
	}
	if !parsed.Frame.UsageUnavailable || len(parsed.Frame.UsageWindows) != 0 {
		t.Fatalf("unknown named-only window must remain unavailable, got %+v", parsed.Frame)
	}
}

func TestParseUsageWindowKeepsPresentZeroPercent(t *testing.T) {
	window, ok := parseUsageWindowMap(
		map[string]any{"usedPercent": float64(0), "resetSecs": float64(0)},
		"primary",
		"Session",
	)
	if !ok || window.UsedPercent != 0 || window.ResetSec != 0 {
		t.Fatalf("expected present zero-percent window, got ok=%t window=%+v", ok, window)
	}
}

func TestParseProviderPayloadKeepsErroredCodexBodyUnavailable(t *testing.T) {
	parsed, err := parseProviderPayload(map[string]any{
		"provider": "codex",
		"source":   "oauth",
		"error": map[string]any{
			"kind": "provider",
			"message": `request failed body={
				"rate_limit":{
					"primary_window":{"used_percent":17,"reset_after_seconds":300},
					"secondary_window":{"used_percent":31}
				}
			}`,
		},
	})
	if err != nil {
		t.Fatalf("parseProviderPayload failed: %v", err)
	}
	frame := parsed.Frame.Normalize()
	if !frame.UsageUnavailable || !parsed.Stale {
		t.Fatalf("errored Codex payload became available: %+v", parsed)
	}
	if frame.Session != 0 || frame.Weekly != 0 || len(frame.UsageWindows) != 0 {
		t.Fatalf("errored Codex payload invented usage: %+v", frame)
	}
	if parsed.Source != "oauth" {
		t.Fatalf("provider source changed: %q", parsed.Source)
	}
}

func TestParseProviderPayloadReadsCodexDailyBreakdown(t *testing.T) {
	raw := []byte(`[
		{
			"provider":"codex",
			"source":"oauth",
			"usage":{
				"primary":{"usedPercent":0,"windowMinutes":300,"resetsAt":"2099-01-01T01:00:00Z"},
				"secondary":{"usedPercent":6,"windowMinutes":10080,"resetsAt":"2099-01-02T01:00:00Z"}
			},
			"openaiDashboard":{
				"usageBreakdown":[],
				"dailyBreakdown":[
					{"day":"2026-06-08","totalCreditsUsed":1008.691,"services":[{"service":"Desktop App","creditsUsed":1008.691}]}
				]
			},
			"credits":{"remaining":0,"updatedAt":"2026-06-29T10:47:46Z"}
		}
	]`)

	parsed, err := parseAllProviders(raw)
	if err != nil {
		t.Fatalf("parseAllProviders failed: %v", err)
	}
	if len(parsed) != 1 {
		t.Fatalf("expected one provider, got %d", len(parsed))
	}
	overTime := parsed[0].Meta.OverTime
	if len(overTime) != 1 {
		t.Fatalf("expected dailyBreakdown usage-over-time point, got %+v", overTime)
	}
	if overTime[0].Day != "2026-06-08" || math.Abs(overTime[0].TotalCreditsUsed-1008.691) > 0.0001 {
		t.Fatalf("unexpected dailyBreakdown point: %+v", overTime[0])
	}
	if len(overTime[0].Services) != 1 || overTime[0].Services[0].Service != "Desktop App" || math.Abs(overTime[0].Services[0].CreditsUsed-1008.691) > 0.0001 {
		t.Fatalf("unexpected dailyBreakdown services: %+v", overTime[0].Services)
	}
}

func TestParseProviderPayloadAggregatesCodexCreditEvents(t *testing.T) {
	raw := []byte(`[
		{
			"provider":"codex",
			"source":"oauth",
			"usage":{
				"primary":{"usedPercent":1},
				"secondary":{"usedPercent":21}
			},
			"openaiDashboard":{
				"creditEvents":[
					{"id":"a","service":"Desktop App","creditsUsed":610.148,"date":"2026-06-07T22:00:00Z"},
					{"id":"b","service":"Desktop App","creditsUsed":351.03,"date":"2026-06-07T23:00:00Z"},
					{"id":"c","service":"Code review","creditsUsed":7.296,"date":"2026-06-07T23:30:00Z"}
				]
			}
		}
	]`)

	parsed, err := parseAllProviders(raw)
	if err != nil {
		t.Fatalf("parseAllProviders failed: %v", err)
	}
	if len(parsed) != 1 {
		t.Fatalf("expected one provider, got %d", len(parsed))
	}
	overTime := parsed[0].Meta.OverTime
	if len(overTime) != 1 {
		t.Fatalf("expected aggregated credit event day, got %+v", overTime)
	}
	if overTime[0].Day != "2026-06-07" || math.Abs(overTime[0].TotalCreditsUsed-968.474) > 0.0001 {
		t.Fatalf("unexpected aggregated credit event total: %+v", overTime[0])
	}
	if len(overTime[0].Services) != 2 {
		t.Fatalf("expected two aggregated services, got %+v", overTime[0].Services)
	}
	if overTime[0].Services[0].Service != "Desktop App" || math.Abs(overTime[0].Services[0].CreditsUsed-961.178) > 0.0001 {
		t.Fatalf("unexpected primary aggregated service: %+v", overTime[0].Services)
	}
}

func TestParseProviderPayloadReadsCodexResetCredits(t *testing.T) {
	raw := []byte(`[
		{
			"provider":"codex",
			"source":"oauth",
			"usage":{
				"primary":{"usedPercent":1},
				"secondary":{"usedPercent":21},
				"codexResetCredits":{
					"updatedAt":"2026-06-29T11:09:22Z",
					"availableCount":3,
					"credits":[
						{"status":"used","expires_at":"2026-07-01T01:42:57Z"},
						{"status":"available","expires_at":"2026-07-12T01:42:57Z"},
						{"status":"available","expires_at":"2026-07-18T00:33:27Z"}
					]
				}
			}
		}
	]`)

	parsed, err := parseAllProviders(raw)
	if err != nil {
		t.Fatalf("parseAllProviders failed: %v", err)
	}
	if len(parsed) != 1 {
		t.Fatalf("expected one provider, got %d", len(parsed))
	}
	resetCredits := parsed[0].Meta.ResetCredits
	if resetCredits == nil {
		t.Fatalf("expected reset credits metadata")
	}
	if resetCredits.AvailableCount != 3 {
		t.Fatalf("expected three available reset credits, got %+v", resetCredits)
	}
	if got := resetCredits.NextExpiresAt.Format(time.RFC3339); got != "2026-07-12T01:42:57Z" {
		t.Fatalf("expected earliest available reset credit expiry, got %s", got)
	}
}

func TestUsageBarsShowUsedFromEnv(t *testing.T) {
	t.Setenv(usageModeEnvVar, "")
	if _, ok := usageBarsShowUsedFromEnv(); ok {
		t.Fatalf("expected empty env to skip override")
	}

	t.Setenv(usageModeEnvVar, "used")
	if showUsed, ok := usageBarsShowUsedFromEnv(); !ok || !showUsed {
		t.Fatalf("expected used override, got showUsed=%v ok=%v", showUsed, ok)
	}

	t.Setenv(usageModeEnvVar, "remaining")
	if showUsed, ok := usageBarsShowUsedFromEnv(); !ok || showUsed {
		t.Fatalf("expected remaining override, got showUsed=%v ok=%v", showUsed, ok)
	}

	t.Setenv(usageModeEnvVar, "invalid")
	if _, ok := usageBarsShowUsedFromEnv(); ok {
		t.Fatalf("expected invalid env to skip override")
	}
}

func TestCheckMinimumVersionRequiresCLIVersion(t *testing.T) {
	orig := runVersionCommandFn
	t.Cleanup(func() { runVersionCommandFn = orig })
	runVersionCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
		return []byte("CodexBar\n"), nil
	}
	if err := CheckMinimumVersion(context.Background(), "/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI"); err == nil {
		t.Fatal("missing CLI version must fail closed")
	}
}

func TestCheckMinimumVersionRejectsTooOldVersion(t *testing.T) {
	origRunVersion := runVersionCommandFn
	t.Cleanup(func() {
		runVersionCommandFn = origRunVersion
	})

	runVersionCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
		return []byte("CodexBar 0.22\n"), nil
	}

	err := CheckMinimumVersion(context.Background(), "/opt/homebrew/bin/codexbar")
	if err == nil {
		t.Fatalf("expected version check to reject old CodexBar")
	}
	if !strings.Contains(err.Error(), "need >= 0.23") {
		t.Fatalf("expected recovery-ready version error, got %v", err)
	}
}

func TestCheckDashboardSnapshotVersionBoundary(t *testing.T) {
	originalRunVersion := runVersionCommandFn
	t.Cleanup(func() {
		runVersionCommandFn = originalRunVersion
	})

	for _, test := range []struct {
		version string
		wantErr bool
	}{
		{version: "0.43.9", wantErr: true},
		{version: "0.44.0", wantErr: false},
	} {
		t.Run(test.version, func(t *testing.T) {
			runVersionCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
				return []byte("CodexBar " + test.version + "\n"), nil
			}
			err := CheckDashboardSnapshotVersion(context.Background(), "/opt/homebrew/bin/codexbar")
			if test.wantErr {
				if err == nil || !strings.Contains(err.Error(), "dashboard snapshot API") || !strings.Contains(err.Error(), "need >= 0.44.0") {
					t.Fatalf("expected dashboard snapshot API version error, got %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("dashboard snapshot API should be available: %v", err)
			}
		})
	}
}

func TestParseBoolPreference(t *testing.T) {
	cases := []struct {
		raw  string
		want bool
		ok   bool
	}{
		{raw: "1", want: true, ok: true},
		{raw: "true", want: true, ok: true},
		{raw: "0", want: false, ok: true},
		{raw: "false", want: false, ok: true},
		{raw: "unknown", want: false, ok: false},
	}

	for _, tc := range cases {
		got, ok := parseBoolPreference([]byte(tc.raw))
		if ok != tc.ok || got != tc.want {
			t.Fatalf("parseBoolPreference(%q) got=(%v,%v) want=(%v,%v)", tc.raw, got, ok, tc.want, tc.ok)
		}
	}
}

func TestProviderSelectorSticksWithoutNewActivity(t *testing.T) {
	selector := NewProviderSelector()

	_, _ = selector.Select([]ParsedFrame{
		testParsedFrame("codex", 2, 2, 12000),
		testParsedFrame("claude", 20, 20, 15000),
	})

	second, ok := selector.Select([]ParsedFrame{
		testParsedFrame("claude", 20, 20, 14940),
		testParsedFrame("codex", 2, 2, 11940),
	})
	if !ok {
		t.Fatalf("expected a selected provider in second cycle")
	}
	if second.Provider != "codex" {
		t.Fatalf("expected sticky provider codex without deltas, got %q", second.Provider)
	}
}

func TestProviderSelectorOrderFallbackPrefersAvailableProvider(t *testing.T) {
	selector := NewProviderSelector()
	decision, ok := selector.SelectWithDecision([]ParsedFrame{
		{
			Provider: "gemini",
			Stale:    true,
			Frame: protocol.Frame{
				Provider:         "gemini",
				UsageUnavailable: true,
			},
		},
		testParsedFrame("antigravity", 17, 42, 3600),
	})
	if !ok {
		t.Fatal("expected a selected provider")
	}
	if decision.Selected.Provider != "antigravity" ||
		decision.Reason != SelectionReasonCodexbarOrder {
		t.Fatalf("unavailable first provider displaced available fallback: %#v", decision)
	}
}

func TestProviderSelectorStickyFallbackDoesNotHoldUnavailableProvider(t *testing.T) {
	selector := NewProviderSelector()
	selector.SetCurrentProvider("gemini")
	decision, ok := selector.SelectWithDecision([]ParsedFrame{
		testParsedFrame("antigravity", 17, 42, 3600),
		{
			Provider: "gemini",
			Stale:    true,
			Frame: protocol.Frame{
				Provider:         "gemini",
				UsageUnavailable: true,
			},
		},
	})
	if !ok {
		t.Fatal("expected a selected provider")
	}
	if decision.Selected.Provider != "antigravity" ||
		decision.Reason != SelectionReasonCodexbarOrder {
		t.Fatalf("unavailable sticky provider displaced available fallback: %#v", decision)
	}
}

func TestFetchAllProvidersDoesNotFallBackToCodexCLIOnAggregateCommandFailure(t *testing.T) {
	stubSupportedCodexBarVersion(t)

	originalRunUsageCommand := runUsageCommandFn
	defer func() {
		runUsageCommandFn = originalRunUsageCommand
	}()

	t.Setenv("CODEXBAR_BIN", testBinary(t))
	var cliFallbackCalls int
	runUsageCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		argLine := strings.Join(args, " ")
		if strings.Contains(argLine, "--provider codex") && strings.Contains(argLine, "--source cli") {
			cliFallbackCalls++
			return nil, errors.New("codex cli fallback must not run")
		}
		if strings.Contains(argLine, "--web-timeout 8") {
			return []byte("signal: killed"), errors.New("signal: killed")
		}
		return nil, errors.New("unexpected command")
	}

	parsed, err := FetchAllProviders(context.Background())
	if err == nil {
		t.Fatalf("expected aggregate failure without CLI fallback, got %#v", parsed)
	}
	if cliFallbackCalls != 0 {
		t.Fatalf("expected no Codex CLI fallback calls, got %d", cliFallbackCalls)
	}
}

func TestFetchAllProvidersDoesNotRunCostScanOnFastPath(t *testing.T) {
	skipMacCLIContract(t)
	stubSupportedCodexBarVersion(t)

	originalRunUsageCommand := runUsageCommandFn
	originalRunCostCommand := runCostCommandFn
	defer func() {
		runUsageCommandFn = originalRunUsageCommand
		runCostCommandFn = originalRunCostCommand
	}()

	t.Setenv("CODEXBAR_BIN", testBinary(t))
	runUsageCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		argLine := strings.Join(args, " ")
		if strings.Contains(argLine, "usage --json") {
			return []byte(`[{"provider":"codex","source":"local","usage":{"primary":{"usedPercent":11},"secondary":{"usedPercent":22}}}]`), nil
		}
		return nil, errors.New("unexpected command")
	}
	runCostCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
		t.Fatal("fast provider usage path must not run codexbar cost --json")
		return nil, nil
	}

	parsed, err := FetchAllProviders(context.Background())
	if err != nil {
		t.Fatalf("fetch all providers: %v", err)
	}
	if len(parsed) != 1 || parsed[0].Frame.Session != 11 || parsed[0].Frame.TotalTokens != 0 {
		t.Fatalf("expected fast usage without token totals, got %#v", parsed)
	}
}

func TestFetchAllProvidersKeepsMixedJSONOnNonzeroExitWithoutFallback(t *testing.T) {
	skipMacCLIContract(t)
	stubSupportedCodexBarVersion(t)

	originalRunUsageCommand := runUsageCommandFn
	defer func() { runUsageCommandFn = originalRunUsageCommand }()

	t.Setenv("CODEXBAR_BIN", testBinary(t))
	var fallbackCalls int
	runUsageCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		argLine := strings.Join(args, " ")
		if strings.Contains(argLine, "--provider codex") && strings.Contains(argLine, "--source cli") {
			fallbackCalls++
			return nil, errors.New("fallback must not run")
		}
		return []byte(`[
			{"provider":"claude","source":"oauth","usage":{"primary":{"usedPercent":7},"secondary":{"usedPercent":13}}},
			{"provider":"gemini","label":"Gemini","source":"oauth-api","error":{"kind":"provider","message":"sensitive upstream detail"}}
		]`), errors.New("exit status 1")
	}

	parsed, err := FetchAllProviders(context.Background())
	if err != nil {
		t.Fatalf("expected useful mixed JSON despite nonzero exit, got %v", err)
	}
	if fallbackCalls != 0 {
		t.Fatalf("expected no Codex-only fallback, got %d calls", fallbackCalls)
	}
	if len(parsed) != 2 || providerKey(parsed[0]) != "claude" || providerKey(parsed[1]) != "gemini" {
		t.Fatalf("unexpected mixed provider results: %#v", parsed)
	}
	if !parsed[1].Frame.UsageUnavailable || parsed[1].Frame.Error != "" {
		t.Fatalf("expected sanitized unavailable Gemini result, got %#v", parsed[1])
	}
}

func TestFetchAllProvidersReturnsRuntimeErrorForOfficialGlobalCLIError(t *testing.T) {
	stubSupportedCodexBarVersion(t)

	originalRunUsageCommand := runUsageCommandFn
	defer func() { runUsageCommandFn = originalRunUsageCommand }()

	t.Setenv("CODEXBAR_BIN", testBinary(t))
	var fallbackCalls int
	runUsageCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		argLine := strings.Join(args, " ")
		if strings.Contains(argLine, "--provider codex") && strings.Contains(argLine, "--source cli") {
			fallbackCalls++
			return []byte(`[{"provider":"codex","source":"codex-cli","usage":{"primary":{"usedPercent":7}}}]`), nil
		}
		return []byte(`[{"provider":"cli","source":"cli","error":{"kind":"runtime","message":"sensitive global detail","code":1}}]`), errors.New("exit status 1")
	}

	parsed, err := FetchAllProviders(context.Background())
	if err == nil {
		t.Fatalf("expected global CLI error, got providers %#v", parsed)
	}
	if got := FetchErrorKindOf(err); got != FetchErrorCommand {
		t.Fatalf("expected global CLI error to remain a runtime command error, got %s", got)
	}
	if fallbackCalls != 0 {
		t.Fatalf("expected no Codex-only fallback for a global CLI error, got %d calls", fallbackCalls)
	}
}

func TestFetchAllProvidersDoesNotRetryByStartingCodexBarApp(t *testing.T) {
	skipMacCLIContract(t)
	stubSupportedCodexBarVersion(t)

	originalRunUsageCommand := runUsageCommandFn
	defer func() {
		runUsageCommandFn = originalRunUsageCommand
	}()

	t.Setenv("CODEXBAR_BIN", testBinary(t))
	var aggregateCalls int
	var cliFallbackCalls int
	runUsageCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		argLine := strings.Join(args, " ")
		if strings.Contains(argLine, "--web-timeout 8") {
			aggregateCalls++
			return []byte("dashboard data not found"), errors.New("exit status 1")
		}
		if strings.Contains(argLine, "--provider codex") && strings.Contains(argLine, "--source cli") {
			cliFallbackCalls++
			return nil, errors.New("codex cli unavailable")
		}
		return nil, errors.New("unexpected command")
	}

	_, err := FetchAllProviders(context.Background())
	if err == nil {
		t.Fatalf("expected fetch to fail when aggregate usage fails")
	}
	if aggregateCalls != 1 {
		t.Fatalf("expected exactly one aggregate usage attempt, got %d", aggregateCalls)
	}
	if cliFallbackCalls != 0 {
		t.Fatalf("expected no Codex CLI fallback calls, got %d", cliFallbackCalls)
	}
}

func TestFetchAllProvidersReturnsErrorWhenAggregateFails(t *testing.T) {
	stubSupportedCodexBarVersion(t)

	originalRunUsageCommand := runUsageCommandFn
	defer func() {
		runUsageCommandFn = originalRunUsageCommand
	}()

	t.Setenv("CODEXBAR_BIN", testBinary(t))
	var cliFallbackCalls int
	runUsageCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		argLine := strings.Join(args, " ")
		if strings.Contains(argLine, "--provider codex") && strings.Contains(argLine, "--source cli") {
			cliFallbackCalls++
			return nil, errors.New("codex cli fallback must not run")
		}
		if strings.Contains(argLine, "--web-timeout 8") {
			return []byte("signal: killed"), errors.New("signal: killed")
		}
		return nil, errors.New("unexpected command")
	}

	_, err := FetchAllProviders(context.Background())
	if err == nil {
		t.Fatalf("expected fetch-all failure")
	}
	if cliFallbackCalls != 0 {
		t.Fatalf("expected no Codex CLI fallback calls, got %d", cliFallbackCalls)
	}
}

func TestFetchProviderScopedUsageDetailedReturnsSanitizedProviderError(t *testing.T) {
	originalRunUsageCommand := runUsageCommandFn
	defer func() {
		runUsageCommandFn = originalRunUsageCommand
	}()

	runUsageCommandFn = func(_ context.Context, _ time.Duration, _ string, _ ...string) ([]byte, error) {
		return []byte(`[
			{"provider":"cursor","source":"auto","error":{"kind":"provider","message":"No Cursor session found.","code":1}},
			{"provider":"cli","source":"cli","error":{"kind":"provider","message":"Error","code":1}}
		]`), errors.New("exit status 1")
	}

	parsed, err := fetchProviderScopedUsageDetailed(context.Background(), 5*time.Second, testBinary(t), "cursor", 8, "")
	if err != nil {
		t.Fatalf("expected provider-scoped error result, got %v", err)
	}
	if providerKey(parsed) != "cursor" || !parsed.Frame.UsageUnavailable || parsed.Frame.Error != "" {
		t.Fatalf("unexpected sanitized provider result: %#v", parsed)
	}
}

func TestFetchProviderScopedUsageDetailedRejectsDifferentReadyProvider(t *testing.T) {
	originalRunUsageCommand := runUsageCommandFn
	defer func() {
		runUsageCommandFn = originalRunUsageCommand
	}()

	runUsageCommandFn = func(_ context.Context, _ time.Duration, _ string, _ ...string) ([]byte, error) {
		return []byte(`[
			{"provider":"codex","source":"oauth","usage":{"primary":{"usedPercent":7},"secondary":{"usedPercent":13}}}
		]`), nil
	}

	_, err := fetchProviderScopedUsageDetailed(context.Background(), 5*time.Second, testBinary(t), "antigravity", 8, "auto")
	if err == nil || FetchErrorKindOf(err) != FetchErrorNoProviders {
		t.Fatalf("different provider must not satisfy exact readiness: %v", err)
	}
}

func TestLiveAntigravityAutoUsageMatchesCompanionNormalization(t *testing.T) {
	if os.Getenv("CODEXBAR_LIVE_ANTIGRAVITY_TEST") != "1" {
		t.Skip("set CODEXBAR_LIVE_ANTIGRAVITY_TEST=1 for the read-only installed-provider check")
	}

	bin, err := FindBinary()
	if err != nil {
		t.Fatal("installed CodexBar CLI is unavailable")
	}
	raw, err := runUsageCommand(
		context.Background(),
		60*time.Second,
		bin,
		"usage",
		"--json",
		"--provider",
		"antigravity",
		"--source",
		"auto",
		"--web-timeout",
		"8",
	)
	if err != nil {
		t.Fatal("live Antigravity auto-source query failed")
	}

	providers, err := extractProvidersFromRawJSON(raw)
	if err != nil {
		t.Fatal("live Antigravity response was not valid provider JSON")
	}
	var direct map[string]any
	for _, item := range providers {
		payload, ok := item.(map[string]any)
		if ok && strings.EqualFold(strings.TrimSpace(firstStringAtPaths(payload, "provider", "id", "key")), "antigravity") {
			direct = payload
			break
		}
	}
	if direct == nil {
		t.Fatal("live response did not contain the requested Antigravity provider")
	}

	primary, primaryKnown := knownUsagePercentAtPaths(direct, "usage.primary", "primary")
	secondary, secondaryKnown := knownUsagePercentAtPaths(direct, "usage.secondary", "secondary")
	normalized, err := parseProviderPayload(direct)
	if err != nil {
		t.Fatal("Companion could not normalize the live Antigravity response")
	}
	if !primaryKnown || !secondaryKnown || normalized.Frame.UsageUnavailable {
		t.Fatal("live Antigravity response did not contain two trustworthy normalized lanes")
	}
	if normalized.Provider != "antigravity" ||
		normalized.Frame.Session != primary ||
		normalized.Frame.Weekly != secondary {
		t.Fatalf(
			"Companion normalization mismatch: provider=%s primary=%d secondary=%d",
			normalized.Provider,
			normalized.Frame.Session,
			normalized.Frame.Weekly,
		)
	}
	if normalized.Source == "" {
		t.Fatal("live Antigravity response did not contain a source label")
	}
	if normalized.ActivityObservedAt.IsZero() {
		t.Fatal("live Antigravity response did not contain a fresh usage timestamp")
	}

	t.Logf(
		"provider=%s source=%s primary=%d secondary=%d timestamp=%s unavailable=%t",
		normalized.Provider,
		normalized.Source,
		normalized.Frame.Session,
		normalized.Frame.Weekly,
		normalized.ActivityObservedAt.UTC().Format(time.RFC3339),
		normalized.Frame.UsageUnavailable,
	)
}

func TestFetchProviderUsesProviderScopedUsageForCodex(t *testing.T) {
	stubSupportedCodexBarVersion(t)

	originalRunUsageCommand := runUsageCommandFn
	defer func() {
		runUsageCommandFn = originalRunUsageCommand
	}()

	t.Setenv("CODEXBAR_BIN", testBinary(t))
	var cliFallbackCalls int

	runUsageCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		argLine := strings.Join(args, " ")
		if strings.Contains(argLine, "--provider codex") && strings.Contains(argLine, "--source cli") {
			cliFallbackCalls++
			return nil, errors.New("codex cli fallback must not run")
		}
		if strings.Contains(argLine, "--provider codex") && strings.Contains(argLine, "--web-timeout 3") {
			return []byte(`[{"provider":"codex","source":"web","usage":{"primary":{"usedPercent":11,"resetsAt":"2099-01-01T00:00:00Z"},"secondary":{"usedPercent":23}}}]`), nil
		}
		return nil, errors.New("unexpected command")
	}

	parsed, err := FetchProvider(context.Background(), "codex")
	if err != nil {
		t.Fatalf("expected codex provider fetch success, got %v", err)
	}
	if cliFallbackCalls != 0 {
		t.Fatalf("expected no Codex CLI fallback calls, got %d", cliFallbackCalls)
	}
	if providerKey(parsed) != "codex" {
		t.Fatalf("expected codex provider, got %q", providerKey(parsed))
	}
	if parsed.Frame.Session != 11 || parsed.Frame.Weekly != 23 {
		t.Fatalf("unexpected parsed values session=%d weekly=%d", parsed.Frame.Session, parsed.Frame.Weekly)
	}
}

func TestFetchProviderUsesProviderScopedUsage(t *testing.T) {
	stubSupportedCodexBarVersion(t)

	originalRunUsageCommand := runUsageCommandFn
	originalRunCostCommand := runCostCommandFn
	defer func() {
		runUsageCommandFn = originalRunUsageCommand
		runCostCommandFn = originalRunCostCommand
	}()

	t.Setenv("CODEXBAR_BIN", testBinary(t))

	runUsageCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		argLine := strings.Join(args, " ")
		if strings.Contains(argLine, "--provider claude") && strings.Contains(argLine, "--web-timeout 3") {
			return []byte(`[{"provider":"claude","source":"web","usage":{"primary":{"usedPercent":17,"resetsAt":"2099-01-01T00:00:00Z"},"secondary":{"usedPercent":31}}}]`), nil
		}
		return nil, errors.New("unexpected command")
	}
	runCostCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
		t.Fatal("provider-scoped fast usage path must not run codexbar cost --json")
		return nil, nil
	}

	parsed, err := FetchProvider(context.Background(), "claude")
	if err != nil {
		t.Fatalf("expected claude provider fetch success, got %v", err)
	}
	if providerKey(parsed) != "claude" {
		t.Fatalf("expected claude provider, got %q", providerKey(parsed))
	}
	if parsed.Frame.Session != 17 || parsed.Frame.Weekly != 31 {
		t.Fatalf("unexpected parsed values session=%d weekly=%d", parsed.Frame.Session, parsed.Frame.Weekly)
	}
}

func TestFetchErrorKindOf(t *testing.T) {
	parseErr := wrapFetchError(FetchErrorParse, errors.New("parse failure"))
	if got := FetchErrorKindOf(parseErr); got != FetchErrorParse {
		t.Fatalf("expected parse kind, got %s", got)
	}

	if got := FetchErrorKindOf(errors.New("plain error")); got != FetchErrorUnknown {
		t.Fatalf("expected unknown kind for non-fetch error, got %s", got)
	}
}

func TestClassifyParseError(t *testing.T) {
	if got := classifyParseError(errGlobalCLI); got != FetchErrorCommand {
		t.Fatalf("expected global CLI error to be a command error, got %s", got)
	}
	if got := classifyParseError(ErrNoProviders); got != FetchErrorNoProviders {
		t.Fatalf("expected no-providers kind, got %s", got)
	}
	if got := classifyParseError(errors.New("bad payload")); got != FetchErrorParse {
		t.Fatalf("expected parse kind, got %s", got)
	}
}

func stubSupportedCodexBarVersion(t *testing.T) {
	t.Helper()
	setExistingConfig(t)
	t.Setenv("CODEXBAR_BIN", testBinary(t))

	originalRunVersionCommand := runVersionCommandFn
	runVersionCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
		return []byte("CodexBar 0.23\n"), nil
	}
	t.Cleanup(func() {
		runVersionCommandFn = originalRunVersionCommand
	})
}

func testParsedFrame(provider string, session, weekly int, reset int64) ParsedFrame {
	return ParsedFrame{
		Provider: provider,
		Source:   "web",
		Frame: protocol.Frame{
			Provider: provider,
			Label:    humanLabel(provider),
			Session:  session,
			Weekly:   weekly,
			ResetSec: reset,
		},
	}
}

func TestParseProviderPayloadBuildsOrderedUsageWindows(t *testing.T) {
	raw := []byte(`[
		{
			"provider":"antigravity",
			"usage":{
				"primary":{"usedPercent":11,"resetSecs":100},
				"secondary":{"usedPercent":22,"resetSecs":200},
				"extraRateWindows":[
					{"id":"gemini-weekly","label":"Gemini weekly","usedPercent":33,"resetSecs":300},
					{"id":"claude-gpt-weekly","label":"Claude/GPT weekly","usedPercent":44,"resetSecs":400}
				]
			}
		}
	]`)

	parsed, err := parseAllProviders(raw)
	if err != nil {
		t.Fatalf("parseAllProviders failed: %v", err)
	}
	// The one-shot CLI path still uses structural primary/secondary labels.
	// #254 replaces these transitional labels with CodexBar dashboard labels
	// and generic deduplication; this test only locks ordered window transport.
	windows := parsed[0].Frame.UsageWindows
	if len(windows) != 4 {
		t.Fatalf("expected complete ordered windows, got %+v", windows)
	}
	if windows[0].Label != "Session" || windows[0].Percent != 11 || windows[0].ResetSec != 100 {
		t.Fatalf("expected first valid source window, got %+v", windows[0])
	}
	if windows[3].Label != "Claude/GPT weekly" || windows[3].Percent != 44 || windows[3].ResetSec != 400 {
		t.Fatalf("expected overflow source window to be preserved, got %+v", windows[3])
	}
	if parsed[0].Frame.Session != 11 || parsed[0].Frame.Weekly != 22 || parsed[0].Frame.ResetSec != 100 {
		t.Fatalf("expected legacy aliases to mirror the first two windows, got %+v", parsed[0].Frame)
	}
}

func TestSetUsageBarsShowUsedUsesCodexBarPreferenceAndReadback(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("macOS defaults contract; Windows covered by native secure-settings tests")
	}
	dir := t.TempDir()
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("CODEXBAR_DISPLAY_USAGE_MODE", "")
	t.Setenv("CODEX_TEST_USAGE_PREFERENCE", filepath.Join(dir, "value"))
	script := `#!/bin/sh
[ "$2" = "com.steipete.codexbar" ] && [ "$3" = "usageBarsShowUsed" ] || exit 1
if [ "$1" = "write" ]; then
  [ "$4" = "-bool" ] || exit 1
  printf '%s' "$5" > "$CODEX_TEST_USAGE_PREFERENCE"
else
  cat "$CODEX_TEST_USAGE_PREFERENCE"
fi
`
	if err := os.WriteFile(filepath.Join(dir, "defaults"), []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	for _, used := range []bool{false, true} {
		if err := SetUsageBarsShowUsed(context.Background(), used); err != nil {
			t.Fatal(err)
		}
		if got := UsageBarsShowUsed(); got != used {
			t.Fatalf("readback %v, want %v", got, used)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "defaults"), []byte("#!/bin/sh\nexit 1\n"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := SetUsageBarsShowUsed(context.Background(), false); err == nil {
		t.Fatal("failed writes must be reported")
	}
}
