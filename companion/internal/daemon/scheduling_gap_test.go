package daemon

import (
	"reflect"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

// These tests pin the current behaviour of small pure helpers that had no
// direct test: poll/hold/age clamps read from the environment, the sleep/wake
// threshold, the fixed-selection shutdown check, provider order merging and
// the snapshot freshness rules. They use env vars and fixed clocks only.

func TestSleepWakeGapThresholdPinsFloorAndIntervalMargin(t *testing.T) {
	cases := []struct {
		name     string
		interval time.Duration
		want     time.Duration
	}{
		{"zero interval uses default interval plus margin, floored", 0, 45 * time.Second},
		{"negative interval uses default", -5 * time.Second, 45 * time.Second},
		{"short interval is floored to 45s", 2 * time.Second, 45 * time.Second},
		{"10s interval is still floored", 10 * time.Second, 45 * time.Second},
		{"15s interval hits the floor exactly", 15 * time.Second, 45 * time.Second},
		{"30s interval adds 30s margin", 30 * time.Second, 60 * time.Second},
		{"60s interval adds 30s margin", 60 * time.Second, 90 * time.Second},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := sleepWakeGapThreshold(tc.interval); got != tc.want {
				t.Fatalf("sleepWakeGapThreshold(%s) = %s, want %s", tc.interval, got, tc.want)
			}
			if got := SleepWakeGapThreshold(tc.interval); got != tc.want {
				t.Fatalf("SleepWakeGapThreshold(%s) = %s, want %s (exported wrapper must agree)", tc.interval, got, tc.want)
			}
		})
	}
}

func TestCollectorIntervalClampsOverrideAndRenderInterval(t *testing.T) {
	cases := []struct {
		name   string
		env    string
		render time.Duration
		want   time.Duration
	}{
		{"no override, no render interval gives the maximum", "", 0, 60 * time.Second},
		{"no override, negative render interval gives the maximum", "", -time.Second, 60 * time.Second},
		{"no override, render below minimum is raised", "", 10 * time.Second, 30 * time.Second},
		{"no override, render inside range is used as is", "", 45 * time.Second, 45 * time.Second},
		{"no override, render above maximum is capped", "", 90 * time.Second, 60 * time.Second},
		{"override below minimum is raised", "5", 45 * time.Second, 30 * time.Second},
		{"override above maximum is capped", "120", 45 * time.Second, 60 * time.Second},
		{"override inside range wins over render interval", "40", 90 * time.Second, 40 * time.Second},
		{"zero override falls back to render interval", "0", 45 * time.Second, 45 * time.Second},
		{"unparseable override falls back to render interval", "soon", 45 * time.Second, 45 * time.Second},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(collectorIntervalEnvVar, tc.env)
			if got := collectorInterval(tc.render); got != tc.want {
				t.Fatalf("collectorInterval(%s) with %q = %s, want %s", tc.render, tc.env, got, tc.want)
			}
		})
	}
}

func TestActivityPollIntervalDefaultsAndClamps(t *testing.T) {
	cases := []struct {
		name string
		env  string
		want time.Duration
	}{
		{"empty uses 2s default", "", 2 * time.Second},
		{"zero falls back to default", "0", 2 * time.Second},
		{"garbage falls back to default", "abc", 2 * time.Second},
		{"minimum 1s is kept", "1", time.Second},
		{"value inside range is kept", "5", 5 * time.Second},
		{"maximum 10s is kept", "10", 10 * time.Second},
		{"above maximum is capped at 10s", "15", 10 * time.Second},
		{"surrounding spaces are trimmed", " 3 ", 3 * time.Second},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(activityPollEnvVar, tc.env)
			if got := activityPollInterval(); got != tc.want {
				t.Fatalf("activityPollInterval() with %q = %s, want %s", tc.env, got, tc.want)
			}
		})
	}
}

func TestActivityHoldDurationDefaultsAndClamps(t *testing.T) {
	cases := []struct {
		name string
		env  string
		want time.Duration
	}{
		{"empty uses 180s default", "", 180 * time.Second},
		{"negative falls back to default", "-1", 180 * time.Second},
		{"below minimum is raised to 5s", "1", 5 * time.Second},
		{"value inside range is kept", "90", 90 * time.Second},
		{"above maximum is capped at 600s", "700", 600 * time.Second},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(activityHoldEnvVar, tc.env)
			if got := activityHoldDuration(); got != tc.want {
				t.Fatalf("activityHoldDuration() with %q = %s, want %s", tc.env, got, tc.want)
			}
		})
	}
}

func TestActivityIdleEvidenceRequiredDefaultsAndClamps(t *testing.T) {
	cases := []struct {
		name string
		env  string
		want int
	}{
		{"empty uses 2 as default", "", 2},
		{"whitespace only uses default", "   ", 2},
		{"unparseable uses default", "x", 2},
		{"zero is raised to the minimum 1", "0", 1},
		{"negative is raised to the minimum 1", "-4", 1},
		{"1 is kept", "1", 1},
		{"value inside range is kept, trimmed", " 4 ", 4},
		{"above maximum is capped at 10", "50", 10},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(activityIdleEvidenceEnvVar, tc.env)
			if got := activityIdleEvidenceRequired(); got != tc.want {
				t.Fatalf("activityIdleEvidenceRequired() with %q = %d, want %d", tc.env, got, tc.want)
			}
		})
	}
}

func TestCodingMaxAgeExpiredHonoursTokenScanWindow(t *testing.T) {
	now := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		name          string
		lastCodingAt  time.Time
		lastTokenScan time.Time
		want          bool
	}{
		{"never coded is not expired", time.Time{}, time.Time{}, false},
		{"coding timestamp in the future is not expired", now.Add(time.Minute), time.Time{}, false},
		{"inside default 5m max", now.Add(-4*time.Minute - 59*time.Second), time.Time{}, false},
		{"exactly at default 5m max is not expired", now.Add(-5 * time.Minute), time.Time{}, false},
		{"past default 5m max expires", now.Add(-5*time.Minute - time.Second), time.Time{}, true},
		{"pending token scan extends the window, 6m still inside", now.Add(-6 * time.Minute), now.Add(-6 * time.Minute), false},
		{"pending token scan window is 8m05s, exactly there is not expired", now.Add(-8*time.Minute - 5*time.Second), now.Add(-8 * time.Minute), false},
		{"pending token scan window still expires past 8m05s", now.Add(-8*time.Minute - 6*time.Second), now.Add(-8 * time.Minute), true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(activityCodingMaxAgeEnvVar, "")
			state := &runtimeState{lastCodingAt: tc.lastCodingAt, lastCodingTokenScanAt: tc.lastTokenScan}
			if got := codingMaxAgeExpired(state, now); got != tc.want {
				t.Fatalf("codingMaxAgeExpired() = %t, want %t", got, tc.want)
			}
		})
	}
}

func TestCodingMaxAgeExpiredUsesConfiguredMaxAgeWithinBounds(t *testing.T) {
	now := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	t.Setenv(activityCodingMaxAgeEnvVar, "45")

	state := &runtimeState{lastCodingAt: now.Add(-44 * time.Second)}
	if codingMaxAgeExpired(state, now) {
		t.Fatalf("44s old coding must not expire with a 45s max age")
	}
	state.lastCodingAt = now.Add(-46 * time.Second)
	if !codingMaxAgeExpired(state, now) {
		t.Fatalf("46s old coding must expire with a 45s max age")
	}
}

func TestFixedSelectionDisabledNeedsEveryAllowedProviderOff(t *testing.T) {
	type providerState struct{ off, current bool }
	offFrom := func(states map[string]providerState) providerOffFunc {
		return func(provider string) (bool, bool) {
			s := states[provider]
			return s.off, s.current
		}
	}
	allowed := func(keys ...string) map[string]struct{} {
		out := make(map[string]struct{}, len(keys))
		for _, k := range keys {
			out[k] = struct{}{}
		}
		return out
	}

	cases := []struct {
		name        string
		allowed     map[string]struct{}
		providerOff providerOffFunc
		acceptOlder bool
		want        bool
	}{
		{"nil provider check is never disabled", allowed("codex"), nil, false, false},
		{"empty allowed set is never disabled", allowed(), offFrom(nil), false, false},
		{"single provider off and current is disabled", allowed("codex"),
			offFrom(map[string]providerState{"codex": {off: true, current: true}}), false, true},
		{"one allowed provider still on keeps selection enabled", allowed("codex", "claude"),
			offFrom(map[string]providerState{
				"codex":  {off: true, current: true},
				"claude": {off: false, current: true},
			}), false, false},
		{"off but older inventory is refused unless accepted", allowed("codex"),
			offFrom(map[string]providerState{"codex": {off: true, current: false}}), false, false},
		{"off with older inventory is disabled when older inventory is accepted", allowed("codex"),
			offFrom(map[string]providerState{"codex": {off: true, current: false}}), true, true},
		{"mixed current and older inventory is refused without acceptance", allowed("codex", "claude"),
			offFrom(map[string]providerState{
				"codex":  {off: true, current: true},
				"claude": {off: true, current: false},
			}), false, false},
		{"unknown provider counts as on", allowed("codex", "gemini"),
			offFrom(map[string]providerState{"codex": {off: true, current: true}}), false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := fixedSelectionDisabled(tc.allowed, tc.providerOff, tc.acceptOlder); got != tc.want {
				t.Fatalf("fixedSelectionDisabled() = %t, want %t", got, tc.want)
			}
		})
	}
}

func TestMergeProviderOrderKeepsCurrentFirstAndDedupes(t *testing.T) {
	cases := []struct {
		name     string
		current  []string
		previous []string
		want     []string
	}{
		{
			name:     "current order first, then previous keys not yet seen",
			current:  []string{"Codex", " claude ", "", "codex"},
			previous: []string{"gemini", "CLAUDE", "cursor"},
			want:     []string{"codex", "claude", "gemini", "cursor"},
		},
		{
			name:     "previous only keeps its blanks and duplicates out",
			current:  nil,
			previous: []string{"  ", "Gemini", "gemini"},
			want:     []string{"gemini"},
		},
		{
			name:     "current only",
			current:  []string{"A"},
			previous: nil,
			want:     []string{"a"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := mergeProviderOrder(tc.current, tc.previous)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("mergeProviderOrder(%q, %q) = %q, want %q", tc.current, tc.previous, got, tc.want)
			}
		})
	}

	if got := mergeProviderOrder(nil, nil); len(got) != 0 {
		t.Fatalf("mergeProviderOrder(nil, nil) = %q, want empty", got)
	}
}

func TestUsageSourceOrDefaultTrimsLowercasesAndFallsBack(t *testing.T) {
	cases := []struct {
		name     string
		source   string
		fallback string
		want     string
	}{
		{"source is trimmed and lowercased", "  CodexBar ", "fallback", "codexbar"},
		{"blank source uses trimmed lowercased fallback", "", " Fallback ", "fallback"},
		{"blank source and blank fallback give unknown", "  ", "", "unknown"},
		{"whitespace fallback gives unknown", "", "  ", "unknown"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := usageSourceOrDefault(tc.source, tc.fallback); got != tc.want {
				t.Fatalf("usageSourceOrDefault(%q, %q) = %q, want %q", tc.source, tc.fallback, got, tc.want)
			}
		})
	}
}

func TestSnapshotWithExpiredUsageClearedKeepsFreshUsageAndClearsStaleParts(t *testing.T) {
	now := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	const maxAge = 10 * time.Minute

	base := func() providerSnapshot {
		return providerSnapshot{
			Provider: "codex",
			Frame: protocol.Frame{
				Provider:           "codex",
				Session:            55,
				Weekly:             20,
				ResetSec:           600,
				SessionTokens:      1200,
				WeekTokens:         3400,
				TotalTokens:        5600,
				TokenTotalsKnown:   true,
				UsageUnavailable:   false,
				SessionUnavailable: false,
				WeeklyUnavailable:  false,
			},
			Meta:                codexbar.ProviderUsageMeta{Cost: &codexbar.ProviderCostUsage{TodayCostUSD: 1.5}},
			TokenHistorySettled: true,
		}
	}

	t.Run("fresh usage is returned unchanged even with stale token stats", func(t *testing.T) {
		in := base()
		in.Collected = now.Add(-time.Minute)
		in.TokenStatsCollected = now.Add(-time.Hour)
		got := snapshotWithExpiredUsageCleared(in, now, maxAge)
		if !reflect.DeepEqual(got, in) {
			t.Fatalf("fresh snapshot changed:\n got  %+v\n want %+v", got, in)
		}
	})

	t.Run("expired usage with fresh token stats clears usage but keeps tokens", func(t *testing.T) {
		in := base()
		in.Collected = now.Add(-time.Hour)
		in.TokenStatsCollected = now.Add(-time.Minute)
		got := snapshotWithExpiredUsageCleared(in, now, maxAge)
		f := got.Frame
		if !f.UsageUnavailable || !f.SessionUnavailable || !f.WeeklyUnavailable {
			t.Fatalf("usage not marked unavailable: %+v", f)
		}
		if f.Session != 0 || f.Weekly != 0 || f.ResetSec != 0 {
			t.Fatalf("usage numbers not cleared: session=%d weekly=%d reset=%d", f.Session, f.Weekly, f.ResetSec)
		}
		if f.UsageWindows != nil || f.UsageSlots != nil {
			t.Fatalf("usage windows/slots not cleared")
		}
		if f.SessionTokens != 1200 || f.WeekTokens != 3400 || f.TotalTokens != 5600 || !f.TokenTotalsKnown {
			t.Fatalf("fresh token stats were dropped: %+v", f)
		}
		if got.Meta.Cost == nil || !got.TokenStatsCollected.Equal(in.TokenStatsCollected) || !got.TokenHistorySettled {
			t.Fatalf("fresh token metadata was dropped: %+v", got)
		}
	})

	t.Run("expired usage with expired token stats clears both", func(t *testing.T) {
		in := base()
		in.Collected = now.Add(-time.Hour)
		in.TokenStatsCollected = now.Add(-time.Hour)
		got := snapshotWithExpiredUsageCleared(in, now, maxAge)
		f := got.Frame
		if !f.UsageUnavailable || f.Session != 0 {
			t.Fatalf("usage not cleared: %+v", f)
		}
		if f.SessionTokens != 0 || f.WeekTokens != 0 || f.TotalTokens != 0 || f.TokenTotalsKnown {
			t.Fatalf("stale token totals kept: %+v", f)
		}
		if got.Meta.Cost != nil || !got.TokenStatsCollected.IsZero() || got.TokenHistorySettled {
			t.Fatalf("stale token metadata kept: cost=%v collected=%v settled=%t",
				got.Meta.Cost, got.TokenStatsCollected, got.TokenHistorySettled)
		}
	})

	t.Run("missing collected time counts as expired usage", func(t *testing.T) {
		in := base()
		in.TokenStatsCollected = now.Add(-time.Minute)
		got := snapshotWithExpiredUsageCleared(in, now, maxAge)
		if !got.Frame.UsageUnavailable || got.Frame.Session != 0 {
			t.Fatalf("snapshot without collected time kept usage: %+v", got.Frame)
		}
	})
}
