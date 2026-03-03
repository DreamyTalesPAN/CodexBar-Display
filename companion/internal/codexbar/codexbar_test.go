package codexbar

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
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

func TestParseAllProvidersSkipsProviderErrorPayloads(t *testing.T) {
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
	if len(parsed) != 1 {
		t.Fatalf("expected exactly one usable provider, got %d", len(parsed))
	}
	if got := providerKey(parsed[0]); got != "codex" {
		t.Fatalf("expected codex provider after filtering error payloads, got %q", got)
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

func TestShouldRetryAfterStartingCodexBarAppWhenDashboardMissing(t *testing.T) {
	raw := []byte("Error: OpenAI dashboard data not found. Body sample: Download app")
	should := shouldRetryAfterStartingCodexBarApp(errors.New("exit status 1"), ErrNoProviders, nil, raw)
	if !should {
		t.Fatalf("expected retry when codexbar output indicates dashboard app requirement")
	}
}

func TestShouldRetryAfterStartingCodexBarAppSkipsWhenParsedDataExists(t *testing.T) {
	raw := []byte("Error but with usable payload")
	parsed := []ParsedFrame{
		{Frame: protocol.Frame{Provider: "claude"}, Provider: "claude"},
	}
	should := shouldRetryAfterStartingCodexBarApp(errors.New("exit status 1"), nil, parsed, raw)
	if should {
		t.Fatalf("expected no retry when parsed providers already exist")
	}
}

func TestShouldRetryAfterStartingCodexBarAppOnEmptyOutput(t *testing.T) {
	should := shouldRetryAfterStartingCodexBarApp(errors.New("exit status 1"), ErrNoProviders, nil, bytes.TrimSpace([]byte{}))
	if !should {
		t.Fatalf("expected retry on empty output + command error")
	}
}

func TestProviderSelectorSwitchesOnUsageDelta(t *testing.T) {
	selector := newSelectorWithoutLocalActivity()

	first, ok := selector.Select([]ParsedFrame{
		testParsedFrame("codex", 2, 2, 12000),
		testParsedFrame("claude", 20, 20, 15000),
	})
	if !ok {
		t.Fatalf("expected a selected provider in first cycle")
	}
	if first.Provider != "codex" {
		t.Fatalf("expected first-cycle fallback codex, got %q", first.Provider)
	}

	second, ok := selector.Select([]ParsedFrame{
		testParsedFrame("codex", 2, 2, 11940),
		testParsedFrame("claude", 21, 20, 14940),
	})
	if !ok {
		t.Fatalf("expected a selected provider in second cycle")
	}
	if second.Provider != "claude" {
		t.Fatalf("expected switch to claude on session delta, got %q", second.Provider)
	}
}

func TestProviderSelectorSticksWithoutNewActivity(t *testing.T) {
	selector := newSelectorWithoutLocalActivity()

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

func TestProviderSelectorSwitchesBackWhenOtherProviderMoves(t *testing.T) {
	selector := newSelectorWithoutLocalActivity()

	_, _ = selector.Select([]ParsedFrame{
		testParsedFrame("codex", 2, 2, 12000),
		testParsedFrame("claude", 20, 20, 15000),
	})

	_, _ = selector.Select([]ParsedFrame{
		testParsedFrame("codex", 2, 2, 11940),
		testParsedFrame("claude", 21, 20, 14940),
	})

	third, ok := selector.Select([]ParsedFrame{
		testParsedFrame("codex", 3, 2, 11880),
		testParsedFrame("claude", 21, 20, 14880),
	})
	if !ok {
		t.Fatalf("expected a selected provider in third cycle")
	}
	if third.Provider != "codex" {
		t.Fatalf("expected switch back to codex on new codex delta, got %q", third.Provider)
	}
}

func TestComputeActivityScoreTreatsResetJumpAsSignal(t *testing.T) {
	prev := providerSnapshot{session: 0, weekly: 0, reset: 0}
	score := computeActivityScore(prev, protocol.Frame{Session: 0, Weekly: 0, ResetSec: 9000})
	if !score.hasSignal() {
		t.Fatalf("expected reset jump to count as activity signal")
	}
}

func TestProviderSelectorPrefersRecentLocalActivity(t *testing.T) {
	now := time.Now()
	selector := NewProviderSelectorWithActivityReader(func() (map[string]providerActivitySignal, error) {
		return map[string]providerActivitySignal{
			"codex":  testSignal(now.Add(-2*time.Minute), activityConfidenceHigh, "test"),
			"claude": testSignal(now, activityConfidenceHigh, "test"),
		}, nil
	})

	selected, ok := selector.Select([]ParsedFrame{
		testParsedFrame("codex", 4, 2, 9000),
		testParsedFrame("claude", 47, 21, 10000),
	})
	if !ok {
		t.Fatalf("expected a selected provider")
	}
	if selected.Provider != "claude" {
		t.Fatalf("expected claude from local activity, got %q", selected.Provider)
	}
}

func TestProviderSelectorFallsBackToUsageDeltaWhenNoLocalActivity(t *testing.T) {
	selector := NewProviderSelectorWithActivityReader(func() (map[string]providerActivitySignal, error) {
		return map[string]providerActivitySignal{}, nil
	})

	_, _ = selector.Select([]ParsedFrame{
		testParsedFrame("codex", 2, 2, 12000),
		testParsedFrame("claude", 20, 20, 15000),
	})

	selected, ok := selector.Select([]ParsedFrame{
		testParsedFrame("codex", 2, 2, 11940),
		testParsedFrame("claude", 21, 20, 14940),
	})
	if !ok {
		t.Fatalf("expected a selected provider")
	}
	if selected.Provider != "claude" {
		t.Fatalf("expected claude from usage delta fallback, got %q", selected.Provider)
	}
}

func TestProviderSelectorConflictKeepsCurrentProvider(t *testing.T) {
	now := time.Now().UTC()
	selector := NewProviderSelectorWithConfig(func() (map[string]providerActivitySignal, error) {
		return map[string]providerActivitySignal{
			"codex":  testSignal(now, activityConfidenceHigh, "test"),
			"claude": testSignal(now.Add(-5*time.Second), activityConfidenceHigh, "test"),
		}, nil
	}, 15*time.Second)

	first, ok := selector.SelectWithDecision([]ParsedFrame{
		testParsedFrame("codex", 5, 5, 9000),
		testParsedFrame("claude", 5, 5, 9000),
	})
	if !ok {
		t.Fatalf("expected first selection")
	}
	if first.Selected.Provider != "codex" {
		t.Fatalf("expected codex from first conflict tie-break, got %q", first.Selected.Provider)
	}

	second, ok := selector.SelectWithDecision([]ParsedFrame{
		testParsedFrame("claude", 5, 5, 8940),
		testParsedFrame("codex", 5, 5, 8940),
	})
	if !ok {
		t.Fatalf("expected second selection")
	}
	if second.Selected.Provider != "codex" {
		t.Fatalf("expected sticky current codex in conflict window, got %q", second.Selected.Provider)
	}
	if second.Reason != SelectionReasonLocalActivity {
		t.Fatalf("expected local-activity reason, got %q", second.Reason)
	}
	if !strings.Contains(second.Detail, "keep-current") {
		t.Fatalf("expected keep-current detail, got %q", second.Detail)
	}
}

func TestProviderSelectorConflictResolvesByUsageDeltaWithoutCurrent(t *testing.T) {
	now := time.Now().UTC()
	selector := NewProviderSelectorWithConfig(func() (map[string]providerActivitySignal, error) {
		return map[string]providerActivitySignal{
			"codex":  testSignal(now, activityConfidenceHigh, "test"),
			"claude": testSignal(now.Add(-2*time.Second), activityConfidenceHigh, "test"),
		}, nil
	}, 15*time.Second)

	_, _ = selector.SelectWithDecision([]ParsedFrame{
		testParsedFrame("codex", 10, 10, 9000),
		testParsedFrame("claude", 10, 10, 9000),
	})

	selector.currentKey = ""
	decision, ok := selector.SelectWithDecision([]ParsedFrame{
		testParsedFrame("codex", 10, 10, 8940),
		testParsedFrame("claude", 11, 10, 8940),
	})
	if !ok {
		t.Fatalf("expected selection")
	}
	if decision.Selected.Provider != "claude" {
		t.Fatalf("expected claude from usage delta conflict tie-break, got %q", decision.Selected.Provider)
	}
	if !strings.Contains(decision.Detail, "resolved-by=usage-delta") {
		t.Fatalf("expected usage-delta conflict detail, got %q", decision.Detail)
	}
}

func TestProviderSelectorPrefersHigherConfidenceSignal(t *testing.T) {
	now := time.Now().UTC()
	selector := NewProviderSelectorWithConfig(func() (map[string]providerActivitySignal, error) {
		return map[string]providerActivitySignal{
			"codex":  testSignal(now.Add(-20*time.Second), activityConfidenceHigh, "codex-log"),
			"cursor": testSignal(now, activityConfidenceMedium, "cursor-session"),
		}, nil
	}, 15*time.Second)

	selected, ok := selector.Select([]ParsedFrame{
		testParsedFrame("codex", 4, 2, 9000),
		testParsedFrame("cursor", 20, 10, 10000),
	})
	if !ok {
		t.Fatalf("expected selected provider")
	}
	if selected.Provider != "codex" {
		t.Fatalf("expected codex from higher-confidence local signal, got %q", selected.Provider)
	}
}

func TestReadLocalProviderActivityWithDetectorsFiltersStaleEntries(t *testing.T) {
	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	activity, err := readLocalProviderActivityWithDetectors([]ProviderActivityDetector{
		staticActivityDetector{key: "codex", at: now.Add(-10 * time.Minute), ok: true, confidence: activityConfidenceHigh},
		staticActivityDetector{key: "claude", at: now.Add(-8 * time.Hour), ok: true, confidence: activityConfidenceHigh},
		staticActivityDetector{key: "cursor", at: now.Add(-1 * time.Minute), ok: false, confidence: activityConfidenceHigh},
	}, func() time.Time {
		return now
	}, 1*time.Hour)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(activity) != 1 {
		t.Fatalf("expected exactly one fresh activity, got %d (%v)", len(activity), activity)
	}
	signal, ok := activity["codex"]
	if !ok {
		t.Fatalf("expected codex activity to be present, got %v", activity)
	}
	if signal.Confidence != activityConfidenceHigh {
		t.Fatalf("expected codex signal confidence high, got %s", signal.Confidence)
	}
	if _, ok := activity["claude"]; ok {
		t.Fatalf("expected stale claude activity to be filtered out, got %v", activity)
	}
}

func TestReadLocalProviderActivityLowConfidenceHasShorterTTL(t *testing.T) {
	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	activity, err := readLocalProviderActivityWithDetectors([]ProviderActivityDetector{
		staticActivityDetector{key: "kimi", at: now.Add(-30 * time.Minute), ok: true, confidence: activityConfidenceLow},
	}, func() time.Time {
		return now
	}, 6*time.Hour)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(activity) != 0 {
		t.Fatalf("expected low-confidence activity to expire with short ttl, got %v", activity)
	}
}

func TestLatestClaudeActivityAtIgnoresCodexBarProbeArtifacts(t *testing.T) {
	home := t.TempDir()
	probePath := filepath.Join(home, ".claude", "projects", "-Users-test-Library-Application-Support-CodexBar-ClaudeProbe", "probe.jsonl")
	if err := os.MkdirAll(filepath.Dir(probePath), 0o755); err != nil {
		t.Fatalf("mkdir probe path: %v", err)
	}
	if err := os.WriteFile(probePath, []byte("{}\n"), 0o644); err != nil {
		t.Fatalf("write probe file: %v", err)
	}
	probeAt := time.Date(2026, 3, 2, 15, 0, 0, 0, time.UTC)
	if err := os.Chtimes(probePath, probeAt, probeAt); err != nil {
		t.Fatalf("chtimes probe file: %v", err)
	}

	if at, ok := latestClaudeActivityAt(home); ok {
		t.Fatalf("expected no claude activity from codexbar probe artifacts, got %s", at)
	}
}

func TestLatestClaudeActivityAtUsesNonProbeProjectFiles(t *testing.T) {
	home := t.TempDir()

	probePath := filepath.Join(home, ".claude", "projects", "-Users-test-Library-Application-Support-CodexBar-ClaudeProbe", "probe.jsonl")
	realPath := filepath.Join(home, ".claude", "projects", "-Users-test-code-real-project", "session.jsonl")
	for _, path := range []string{probePath, realPath} {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", path, err)
		}
		if err := os.WriteFile(path, []byte("{}\n"), 0o644); err != nil {
			t.Fatalf("write %s: %v", path, err)
		}
	}

	probeAt := time.Date(2026, 3, 2, 16, 0, 0, 0, time.UTC)
	realAt := time.Date(2026, 3, 2, 15, 30, 0, 0, time.UTC)
	if err := os.Chtimes(probePath, probeAt, probeAt); err != nil {
		t.Fatalf("chtimes probe: %v", err)
	}
	if err := os.Chtimes(realPath, realAt, realAt); err != nil {
		t.Fatalf("chtimes real: %v", err)
	}

	got, ok := latestClaudeActivityAt(home)
	if !ok {
		t.Fatalf("expected claude activity from real project file")
	}
	if !got.Equal(realAt) {
		t.Fatalf("expected real project modtime %s, got %s", realAt, got)
	}
}

func TestDefaultActivityDetectorsIncludeCodexAndClaude(t *testing.T) {
	detectors := defaultActivityDetectors()
	seen := map[string]bool{}
	for _, detector := range detectors {
		seen[detector.ProviderKey()] = true
	}

	if !seen["codex"] {
		t.Fatalf("expected codex detector in defaults")
	}
	if !seen["claude"] {
		t.Fatalf("expected claude detector in defaults")
	}
	if !seen["vertexai"] {
		t.Fatalf("expected vertexai detector in defaults")
	}
	if !seen["jetbrains"] {
		t.Fatalf("expected jetbrains detector in defaults")
	}
	if !seen["kimi"] {
		t.Fatalf("expected kimi detector in defaults")
	}
	if !seen["ollama"] {
		t.Fatalf("expected ollama detector in defaults")
	}
}

func TestProviderSelectionMatrix30Scenarios(t *testing.T) {
	for i := 0; i < 30; i++ {
		t.Run("scenario-"+strconv.Itoa(i+1), func(t *testing.T) {
			selector := newSelectorWithoutLocalActivity()

			_, _ = selector.Select([]ParsedFrame{
				testParsedFrame("codex", 10+i, 20, 12000-int64(i*60)),
				testParsedFrame("claude", 10+i, 20, 12000-int64(i*60)),
			})

			want := "codex"
			nextCodex := 10 + i
			nextClaude := 10 + i

			switch i % 3 {
			case 0:
				nextCodex++
				want = "codex"
			case 1:
				nextClaude++
				want = "claude"
			case 2:
				nextCodex++
				nextClaude++
				// Session delta tie keeps first provider in a deterministic way.
				want = "codex"
			}

			selected, ok := selector.Select([]ParsedFrame{
				testParsedFrame("codex", nextCodex, 20, 11940-int64(i*60)),
				testParsedFrame("claude", nextClaude, 20, 11940-int64(i*60)),
			})
			if !ok {
				t.Fatalf("expected selected provider")
			}
			if selected.Provider != want {
				t.Fatalf("expected %s, got %s", want, selected.Provider)
			}
		})
	}
}

func TestNeedsCodexCLIPriorityForWebCodex(t *testing.T) {
	all := []ParsedFrame{
		{
			Provider: "codex",
			Source:   "openai-web",
			Frame:    protocol.Frame{Provider: "codex", Label: "Codex"},
		},
	}

	if !needsCodexCLIPriority(all) {
		t.Fatalf("expected CLI priority for codex web source")
	}
}

func TestNeedsCodexCLIPriorityWhenCodexMissing(t *testing.T) {
	all := []ParsedFrame{
		{
			Provider: "claude",
			Source:   "web",
			Frame:    protocol.Frame{Provider: "claude", Label: "Claude"},
		},
	}

	if !needsCodexCLIPriority(all) {
		t.Fatalf("expected CLI priority when codex provider missing")
	}
}

func TestNeedsCodexCLIPriorityFalseWhenCodexAlreadyCLI(t *testing.T) {
	all := []ParsedFrame{
		{
			Provider: "codex",
			Source:   "codex-cli",
			Frame:    protocol.Frame{Provider: "codex", Label: "Codex"},
		},
	}

	if needsCodexCLIPriority(all) {
		t.Fatalf("expected no CLI repair when codex already from CLI")
	}
}

func TestRepairCodexFromCLKeepsWebFrameWhenCLIRepairFails(t *testing.T) {
	originalRunUsageCommand := runUsageCommandFn
	defer func() {
		runUsageCommandFn = originalRunUsageCommand
	}()

	runUsageCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
		return nil, errors.New("temporary codex cli failure")
	}

	all := []ParsedFrame{
		{
			Provider: "codex",
			Source:   "openai-web",
			Frame: protocol.Frame{
				Provider: "codex",
				Label:    "Codex",
				Session:  0,
				Weekly:   1,
				ResetSec: 540000,
			},
		},
	}

	repaired := repairCodexFromCLI(context.Background(), 5*time.Second, "/opt/homebrew/bin/codexbar", all)
	if repaired[0].Frame.Session != 0 || repaired[0].Frame.Weekly != 1 {
		t.Fatalf("expected original web frame on CLI failure, got session=%d weekly=%d", repaired[0].Frame.Session, repaired[0].Frame.Weekly)
	}
}

func TestRepairCodexFromCLIRepairsWithCLIResult(t *testing.T) {
	originalRunUsageCommand := runUsageCommandFn
	defer func() {
		runUsageCommandFn = originalRunUsageCommand
	}()

	runUsageCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
		return []byte(`[{"provider":"codex","source":"codex-cli","usage":{"primary":{"usedPercent":3,"resetsAt":"2099-01-01T00:00:00Z"},"secondary":{"usedPercent":11}}}]`), nil
	}

	all := []ParsedFrame{
		{
			Provider: "codex",
			Source:   "openai-web",
			Frame: protocol.Frame{
				Provider: "codex",
				Label:    "Codex",
				Session:  0,
				Weekly:   1,
				ResetSec: 540000,
			},
		},
	}

	repaired := repairCodexFromCLI(context.Background(), 5*time.Second, "/opt/homebrew/bin/codexbar", all)
	if repaired[0].Frame.Session != 3 || repaired[0].Frame.Weekly != 11 {
		t.Fatalf("expected CLI repair frame, got session=%d weekly=%d", repaired[0].Frame.Session, repaired[0].Frame.Weekly)
	}
}

func TestRepairCodexFromCLIReplacesEvenWhenCLIWeeklyLower(t *testing.T) {
	originalRunUsageCommand := runUsageCommandFn
	defer func() {
		runUsageCommandFn = originalRunUsageCommand
	}()

	runUsageCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
		return []byte(`[{"provider":"codex","source":"codex-cli","usage":{"primary":{"usedPercent":2,"resetsAt":"2099-01-01T00:00:00Z"},"secondary":{"usedPercent":10}}}]`), nil
	}

	all := []ParsedFrame{
		{
			Provider: "codex",
			Source:   "openai-web",
			Frame: protocol.Frame{
				Provider: "codex",
				Label:    "Codex",
				Session:  0,
				Weekly:   40,
				ResetSec: 150 * 60 * 60,
			},
		},
	}

	repaired := repairCodexFromCLI(context.Background(), 5*time.Second, "/opt/homebrew/bin/codexbar", all)
	if repaired[0].Frame.Weekly != 10 {
		t.Fatalf("expected CLI weekly to be preferred, got %d", repaired[0].Frame.Weekly)
	}
}

func TestRepairCodexFromCLIAppendsCodexWhenMissing(t *testing.T) {
	originalRunUsageCommand := runUsageCommandFn
	defer func() {
		runUsageCommandFn = originalRunUsageCommand
	}()

	runUsageCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
		return []byte(`[{"provider":"codex","source":"codex-cli","usage":{"primary":{"usedPercent":7,"resetsAt":"2099-01-01T00:00:00Z"},"secondary":{"usedPercent":13}}}]`), nil
	}

	all := []ParsedFrame{
		{
			Provider: "claude",
			Source:   "web",
			Frame: protocol.Frame{
				Provider: "claude",
				Label:    "Claude",
				Session:  5,
				Weekly:   9,
				ResetSec: 3600,
			},
		},
	}

	repaired := repairCodexFromCLI(context.Background(), 5*time.Second, "/opt/homebrew/bin/codexbar", all)
	if len(repaired) != 2 {
		t.Fatalf("expected codex provider to be appended, got %d providers", len(repaired))
	}
	if providerKey(repaired[1]) != "codex" {
		t.Fatalf("expected appended provider codex, got %q", providerKey(repaired[1]))
	}
}

func TestFetchAllProvidersFallsBackToCodexCLIOnAggregateCommandFailure(t *testing.T) {
	originalRunUsageCommand := runUsageCommandFn
	defer func() {
		runUsageCommandFn = originalRunUsageCommand
	}()

	t.Setenv("CODEXBAR_BIN", "/bin/sh")
	runUsageCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		argLine := strings.Join(args, " ")
		if strings.Contains(argLine, "--provider codex") && strings.Contains(argLine, "--source cli") {
			return []byte(`[{"provider":"codex","source":"codex-cli","usage":{"primary":{"usedPercent":7,"resetsAt":"2099-01-01T00:00:00Z"},"secondary":{"usedPercent":13}}}]`), nil
		}
		if strings.Contains(argLine, "--web-timeout 8") {
			return []byte("signal: killed"), errors.New("signal: killed")
		}
		return nil, errors.New("unexpected command")
	}

	parsed, err := FetchAllProviders(context.Background())
	if err != nil {
		t.Fatalf("expected CLI fallback to succeed, got %v", err)
	}
	if len(parsed) != 1 {
		t.Fatalf("expected single fallback provider, got %d", len(parsed))
	}
	if providerKey(parsed[0]) != "codex" {
		t.Fatalf("expected fallback provider codex, got %q", providerKey(parsed[0]))
	}
	if parsed[0].Frame.Session != 7 || parsed[0].Frame.Weekly != 13 {
		t.Fatalf("expected fallback session=7 weekly=13, got session=%d weekly=%d", parsed[0].Frame.Session, parsed[0].Frame.Weekly)
	}
}

func TestFetchAllProvidersFallsBackToProviderScopedWhenCodexCLIFallbackFails(t *testing.T) {
	originalRunUsageCommand := runUsageCommandFn
	defer func() {
		runUsageCommandFn = originalRunUsageCommand
	}()

	t.Setenv("CODEXBAR_BIN", "/bin/sh")
	runUsageCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		argLine := strings.Join(args, " ")
		switch {
		case strings.Contains(argLine, "--provider codex") && strings.Contains(argLine, "--source cli"):
			return nil, errors.New("codex cli crashed")
		case strings.Contains(argLine, "--provider claude") && strings.Contains(argLine, "--web-timeout 8"):
			return []byte(`[{"provider":"claude","source":"web","usage":{"primary":{"usedPercent":13,"resetsAt":"2099-01-01T00:00:00Z"},"secondary":{"usedPercent":24}}}]`), nil
		case strings.Contains(argLine, "--web-timeout 8"):
			return []byte("signal: killed"), errors.New("signal: killed")
		default:
			return nil, errors.New("unexpected command")
		}
	}

	parsed, err := FetchAllProviders(context.Background())
	if err != nil {
		t.Fatalf("expected provider-scoped fallback to succeed, got %v", err)
	}
	if len(parsed) != 1 {
		t.Fatalf("expected single provider from provider-scoped fallback, got %d", len(parsed))
	}
	if providerKey(parsed[0]) != "claude" {
		t.Fatalf("expected claude fallback provider, got %q", providerKey(parsed[0]))
	}
	if parsed[0].Frame.Session != 13 || parsed[0].Frame.Weekly != 24 {
		t.Fatalf("expected claude fallback session=13 weekly=24, got session=%d weekly=%d", parsed[0].Frame.Session, parsed[0].Frame.Weekly)
	}
}

func TestFetchAllProvidersUsesDetachedContextForCLIFallback(t *testing.T) {
	originalRunUsageCommand := runUsageCommandFn
	defer func() {
		runUsageCommandFn = originalRunUsageCommand
	}()

	t.Setenv("CODEXBAR_BIN", "/bin/sh")
	cliCtxAlive := false

	runUsageCommandFn = func(ctx context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		argLine := strings.Join(args, " ")
		if strings.Contains(argLine, "--provider codex") && strings.Contains(argLine, "--source cli") {
			cliCtxAlive = ctx.Err() == nil
			return []byte(`[{"provider":"codex","source":"codex-cli","usage":{"primary":{"usedPercent":2,"resetsAt":"2099-01-01T00:00:00Z"},"secondary":{"usedPercent":5}}}]`), nil
		}
		if strings.Contains(argLine, "--web-timeout 8") {
			return []byte("signal: killed"), errors.New("signal: killed")
		}
		return nil, errors.New("unexpected command")
	}

	expiredCtx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()

	parsed, err := FetchAllProviders(expiredCtx)
	if err != nil {
		t.Fatalf("expected CLI fallback to recover from expired parent context, got %v", err)
	}
	if !cliCtxAlive {
		t.Fatalf("expected detached fallback context with remaining budget")
	}
	if len(parsed) != 1 || providerKey(parsed[0]) != "codex" {
		t.Fatalf("expected codex fallback frame, got %#v", parsed)
	}
}

func TestFetchAllProvidersUsesDetachedContextForProviderScopedFallback(t *testing.T) {
	originalRunUsageCommand := runUsageCommandFn
	defer func() {
		runUsageCommandFn = originalRunUsageCommand
	}()

	t.Setenv("CODEXBAR_BIN", "/bin/sh")
	claudeCtxAlive := false

	runUsageCommandFn = func(ctx context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		argLine := strings.Join(args, " ")
		switch {
		case strings.Contains(argLine, "--provider codex") && strings.Contains(argLine, "--source cli"):
			return nil, errors.New("codex cli crashed")
		case strings.Contains(argLine, "--provider claude") && strings.Contains(argLine, "--web-timeout 8"):
			claudeCtxAlive = ctx.Err() == nil
			return []byte(`[{"provider":"claude","source":"web","usage":{"primary":{"usedPercent":9,"resetsAt":"2099-01-01T00:00:00Z"},"secondary":{"usedPercent":22}}}]`), nil
		case strings.Contains(argLine, "--web-timeout 8"):
			return []byte("signal: killed"), errors.New("signal: killed")
		default:
			return nil, errors.New("unexpected command")
		}
	}

	expiredCtx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()

	parsed, err := FetchAllProviders(expiredCtx)
	if err != nil {
		t.Fatalf("expected provider-scoped fallback from expired parent context, got %v", err)
	}
	if !claudeCtxAlive {
		t.Fatalf("expected detached fallback context for provider-scoped command")
	}
	if len(parsed) != 1 || providerKey(parsed[0]) != "claude" {
		t.Fatalf("expected claude fallback frame, got %#v", parsed)
	}
}

func TestFetchProviderScopedUsageRejectsProviderErrorPayload(t *testing.T) {
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

	if _, ok := fetchProviderScopedUsage(context.Background(), 5*time.Second, "/bin/sh", "cursor"); ok {
		t.Fatalf("expected provider-scoped usage to reject error-only payload")
	}
}

func TestFetchProviderPrefersCodexCLI(t *testing.T) {
	originalRunUsageCommand := runUsageCommandFn
	defer func() {
		runUsageCommandFn = originalRunUsageCommand
	}()

	t.Setenv("CODEXBAR_BIN", "/bin/sh")
	cliCalled := false

	runUsageCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		argLine := strings.Join(args, " ")
		if strings.Contains(argLine, "--provider codex") && strings.Contains(argLine, "--source cli") {
			cliCalled = true
			return []byte(`[{"provider":"codex","source":"codex-cli","usage":{"primary":{"usedPercent":11,"resetsAt":"2099-01-01T00:00:00Z"},"secondary":{"usedPercent":23}}}]`), nil
		}
		return nil, errors.New("unexpected command")
	}

	parsed, err := FetchProvider(context.Background(), "codex")
	if err != nil {
		t.Fatalf("expected codex provider fetch success, got %v", err)
	}
	if !cliCalled {
		t.Fatalf("expected codex CLI command path")
	}
	if providerKey(parsed) != "codex" {
		t.Fatalf("expected codex provider, got %q", providerKey(parsed))
	}
	if parsed.Frame.Session != 11 || parsed.Frame.Weekly != 23 {
		t.Fatalf("unexpected parsed values session=%d weekly=%d", parsed.Frame.Session, parsed.Frame.Weekly)
	}
}

func TestFetchProviderUsesProviderScopedUsage(t *testing.T) {
	originalRunUsageCommand := runUsageCommandFn
	defer func() {
		runUsageCommandFn = originalRunUsageCommand
	}()

	t.Setenv("CODEXBAR_BIN", "/bin/sh")

	runUsageCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		argLine := strings.Join(args, " ")
		if strings.Contains(argLine, "--provider claude") && strings.Contains(argLine, "--web-timeout 3") {
			return []byte(`[{"provider":"claude","source":"web","usage":{"primary":{"usedPercent":17,"resetsAt":"2099-01-01T00:00:00Z"},"secondary":{"usedPercent":31}}}]`), nil
		}
		return nil, errors.New("unexpected command")
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
	if got := classifyParseError(ErrNoProviders); got != FetchErrorNoProviders {
		t.Fatalf("expected no-providers kind, got %s", got)
	}
	if got := classifyParseError(errors.New("bad payload")); got != FetchErrorParse {
		t.Fatalf("expected parse kind, got %s", got)
	}
}

type staticActivityDetector struct {
	key        string
	at         time.Time
	ok         bool
	confidence activitySignalConfidence
}

func (d staticActivityDetector) ProviderKey() string {
	return d.key
}

func (d staticActivityDetector) Confidence() activitySignalConfidence {
	if d.confidence == activityConfidenceUnknown {
		return activityConfidenceHigh
	}
	return d.confidence
}

func (d staticActivityDetector) LatestActivityAt(home string) (time.Time, bool) {
	return d.at, d.ok
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

func newSelectorWithoutLocalActivity() *ProviderSelector {
	return NewProviderSelectorWithActivityReader(func() (map[string]providerActivitySignal, error) {
		return map[string]providerActivitySignal{}, nil
	})
}

func testSignal(at time.Time, confidence activitySignalConfidence, evidence string) providerActivitySignal {
	return providerActivitySignal{
		At:         at,
		Confidence: confidence,
		Evidence:   evidence,
	}
}
