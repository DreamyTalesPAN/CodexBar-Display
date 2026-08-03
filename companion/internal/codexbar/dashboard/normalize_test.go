package dashboard

import (
	"encoding/json"
	"testing"
	"time"
)

func TestNormalizeCodexWindowsKeepsWeeklyAndNamedExtra(t *testing.T) {
	result := normalizeFixture(t, codexDashboardFixture, codexUsageFixture, "codex")

	if result.Unavailable {
		t.Fatalf("expected available provider, got unavailable")
	}
	assertWindowLabels(t, result.Windows, "Weekly", "Codex Spark Weekly")
	if result.Windows[1].UsedPercent != 0 {
		t.Fatalf("expected genuine zero-percent named window, got %+v", result.Windows[1])
	}
}

func TestNormalizeClaudeWindowsPreservesEveryValidOrderedWindow(t *testing.T) {
	result := normalizeFixture(t, claudeDashboardFixture, claudeUsageFixture, "claude")

	assertWindowLabels(t, result.Windows, "Session", "Weekly", "Daily Routines")
	if result.Windows[2].UsedPercent != 0 {
		t.Fatalf("expected genuine zero-percent extra window, got %+v", result.Windows[2])
	}
}

func TestNormalizeAntigravityWindowsDeduplicatesStructuralAliases(t *testing.T) {
	result := normalizeFixture(t, antigravityDashboardFixture, antigravityUsageFixture, "antigravity")

	assertWindowLabels(t, result.Windows, "Gemini weekly", "Claude/GPT weekly")
	if result.Windows[0].UsedPercent != 18.97 || result.Windows[1].UsedPercent != 0 {
		t.Fatalf("expected named extra percentages, got %+v", result.Windows)
	}
}

func TestNormalizeDropsUnknownUsageSyntheticPlaceholderAndUsageUnknown(t *testing.T) {
	result := normalizeFixture(t, filteringDashboardFixture, filteringUsageFixture, "mixed")

	assertWindowLabels(t, result.Windows, "Known extra")
}

func TestNormalizeDropsMissingDashboardValues(t *testing.T) {
	result := normalizeFixture(t, missingValuesDashboardFixture, missingValuesUsageFixture, "missing-values")

	assertWindowLabels(t, result.Windows, "Complete")
}

func TestNormalizeKeepsGenuineZeroWindow(t *testing.T) {
	result := normalizeFixture(t, zeroDashboardFixture, zeroUsageFixture, "zero")

	assertWindowLabels(t, result.Windows, "Daily")
	if result.Windows[0].UsedPercent != 0 {
		t.Fatalf("expected zero percent to remain present, got %+v", result.Windows[0])
	}
}

func TestNormalizeMarksProviderWithOnlyFilteredWindowsUnavailable(t *testing.T) {
	zero := 0.0
	unknown := false
	result := NormalizeProvider(
		DashboardProvider{
			ID: "codex",
			Windows: []DashboardWindow{
				{Kind: "session", Label: "Session", UsedPercent: &zero},
			},
		},
		UsageProvider{
			Provider: "codex",
			Usage: UsageMetadata{
				Primary: &RateWindow{UsageKnown: &unknown},
			},
		},
	)

	if !result.Unavailable || len(result.Windows) != 0 {
		t.Fatalf("expected filtered provider windows to remain unavailable, got %+v", result)
	}
}

func TestNormalizeDeduplicatesWhenOnlyOneWindowHasWindowMinutes(t *testing.T) {
	result := normalizeFixture(t, missingWindowMinutesDashboardFixture, missingWindowMinutesUsageFixture, "missing-minutes")

	assertWindowLabels(t, result.Windows, "Named weekly")
}

func TestNormalizeDoesNotDeduplicateWhenBothWindowMinutesDisagree(t *testing.T) {
	result := normalizeFixture(t, mismatchedWindowMinutesDashboardFixture, mismatchedWindowMinutesUsageFixture, "mismatched-minutes")

	assertWindowLabels(t, result.Windows, "Weekly", "Named weekly")
}

func TestNormalizeProviderErrorIsUnavailable(t *testing.T) {
	result := normalizeFixture(t, providerErrorDashboardFixture, providerErrorUsageFixture, "provider-error")

	if !result.Unavailable || len(result.Windows) != 0 {
		t.Fatalf("expected provider error to hide windows, got %+v", result)
	}
}

func TestNormalizeUsageProviderErrorIsUnavailable(t *testing.T) {
	result := normalizeFixture(t, usageProviderErrorDashboardFixture, usageProviderErrorUsageFixture, "usage-provider-error")

	if !result.Unavailable || len(result.Windows) != 0 {
		t.Fatalf("expected usage provider error to hide windows, got %+v", result)
	}
}

func TestDecodeUsageAcceptsWrappedAndSingleProviderPayloads(t *testing.T) {
	wrapped, err := DecodeUsage([]byte(`{"providers":[{"provider":"codex","usage":{"secondary":{"usedPercent":1}}}]}`))
	if err != nil || len(wrapped) != 1 || wrapped[0].Provider != "codex" {
		t.Fatalf("expected wrapped provider payload, got providers=%+v err=%v", wrapped, err)
	}

	single, err := DecodeUsage([]byte(`{"provider":"claude","usage":{"primary":{"usedPercent":1}}}`))
	if err != nil || len(single) != 1 || single[0].Provider != "claude" {
		t.Fatalf("expected single provider payload, got providers=%+v err=%v", single, err)
	}
}

func normalizeFixture(t *testing.T, dashboardRaw string, usageRaw string, providerID string) ProviderWindows {
	t.Helper()

	snapshot, err := DecodeSnapshot([]byte(dashboardRaw))
	if err != nil {
		t.Fatalf("DecodeSnapshot failed: %v", err)
	}
	usageProviders, err := DecodeUsage([]byte(usageRaw))
	if err != nil {
		t.Fatalf("DecodeUsage failed: %v", err)
	}
	usage, ok := UsageForProvider(usageProviders, providerID)
	if !ok {
		t.Fatalf("provider %q missing from usage fixture", providerID)
	}
	for _, provider := range snapshot.Providers {
		if provider.ID == providerID {
			return NormalizeProvider(provider, usage)
		}
	}
	t.Fatalf("provider %q missing from dashboard fixture", providerID)
	return ProviderWindows{}
}

func assertWindowLabels(t *testing.T, windows []UsageWindow, labels ...string) {
	t.Helper()
	if len(windows) != len(labels) {
		t.Fatalf("expected %d windows %v, got %+v", len(labels), labels, windows)
	}
	for i, label := range labels {
		if windows[i].Label != label {
			t.Fatalf("expected window %d label %q, got %+v", i, label, windows)
		}
	}
}

func TestOptionalTimeParsing(t *testing.T) {
	var window DashboardWindow
	if err := json.Unmarshal([]byte(`{"kind":"weekly","label":"Weekly","usedPercent":0,"resetAt":"2026-08-01T00:00:00Z"}`), &window); err != nil {
		t.Fatalf("unmarshal dashboard window: %v", err)
	}
	if window.ResetAt == nil || !window.ResetAt.Equal(time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("expected RFC3339 resetAt parse, got %+v", window.ResetAt)
	}
}

const codexDashboardFixture = `{
  "schemaVersion": 1,
  "providers": [{
    "id": "codex",
    "windows": [
      {"kind": "weekly", "label": "Weekly", "usedPercent": 68, "remainingPercent": 32, "resetAt": "2026-08-01T00:00:00Z"},
      {"kind": "codex-spark-weekly", "label": "Codex Spark Weekly", "usedPercent": 0, "remainingPercent": 100, "resetAt": "2026-08-01T00:00:00Z"}
    ],
    "error": null,
    "updatedAt": "2026-07-28T08:00:00Z"
  }]
}`

const codexUsageFixture = `[{
  "provider": "codex",
  "usage": {
    "primary": null,
    "secondary": {"usedPercent": 68, "windowMinutes": 10080, "resetsAt": "2026-08-01T00:00:00Z"},
    "extraRateWindows": [{
      "id": "codex-spark-weekly",
      "title": "Codex Spark Weekly",
      "usageKnown": true,
      "window": {"usedPercent": 0, "windowMinutes": 10080, "resetsAt": "2026-08-01T00:00:00Z"}
    }]
  }
}]`

const claudeDashboardFixture = `{
  "schemaVersion": 1,
  "providers": [{
    "id": "claude",
    "windows": [
      {"kind": "session", "label": "Session", "usedPercent": 1, "remainingPercent": 99, "resetAt": "2026-07-28T13:00:00Z"},
      {"kind": "weekly", "label": "Weekly", "usedPercent": 11, "remainingPercent": 89, "resetAt": "2026-08-03T00:00:00Z"},
      {"kind": "daily-routines", "label": "Daily Routines", "usedPercent": 0, "remainingPercent": 100, "resetAt": "2026-07-29T00:00:00Z"}
    ],
    "error": null,
    "updatedAt": "2026-07-28T08:01:00Z"
  }]
}`

const claudeUsageFixture = `[{
  "provider": "claude",
  "usage": {
    "primary": {"usedPercent": 1, "windowMinutes": 300, "resetsAt": "2026-07-28T13:00:00Z"},
    "secondary": {"usedPercent": 11, "windowMinutes": 10080, "resetsAt": "2026-08-03T00:00:00Z"},
    "extraRateWindows": [{
      "id": "daily-routines",
      "title": "Daily Routines",
      "usageKnown": true,
      "window": {"usedPercent": 0, "windowMinutes": 1440, "resetsAt": "2026-07-29T00:00:00Z"}
    }]
  }
}]`

const antigravityDashboardFixture = `{
  "schemaVersion": 1,
  "providers": [{
    "id": "antigravity",
    "windows": [
      {"kind": "session", "label": "Gemini Models", "usedPercent": 18.97, "remainingPercent": 81.03, "resetAt": "2026-08-03T00:00:00Z"},
      {"kind": "weekly", "label": "Claude and GPT", "usedPercent": 0, "remainingPercent": 100, "resetAt": "2026-08-03T00:00:00Z"},
      {"kind": "gemini-weekly", "label": "Gemini weekly", "usedPercent": 18.97, "remainingPercent": 81.03, "resetAt": "2026-08-03T00:00:00Z"},
      {"kind": "claude-gpt-weekly", "label": "Claude/GPT weekly", "usedPercent": 0, "remainingPercent": 100, "resetAt": "2026-08-03T00:00:00Z"}
    ],
    "error": null,
    "updatedAt": "2026-07-28T08:02:00Z"
  }]
}`

const antigravityUsageFixture = `[{
  "provider": "antigravity",
  "usage": {
    "primary": {"usedPercent": 18.97, "windowMinutes": 10080, "resetsAt": "2026-08-03T00:00:00Z"},
    "secondary": {"usedPercent": 0, "windowMinutes": 10080, "resetsAt": "2026-08-03T00:00:00Z"},
    "extraRateWindows": [
      {"id": "gemini-weekly", "title": "Gemini weekly", "usageKnown": true, "window": {"usedPercent": 18.97, "windowMinutes": 10080, "resetsAt": "2026-08-03T00:00:00Z"}},
      {"id": "claude-gpt-weekly", "title": "Claude/GPT weekly", "usageKnown": true, "window": {"usedPercent": 0, "windowMinutes": 10080, "resetsAt": "2026-08-03T00:00:00Z"}}
    ]
  }
}]`

const filteringDashboardFixture = `{
  "schemaVersion": 1,
  "providers": [{
    "id": "mixed",
    "windows": [
      {"kind": "session", "label": "Synthetic session", "usedPercent": 0, "resetAt": "2026-07-28T13:00:00Z"},
      {"kind": "weekly", "label": "Known false weekly", "usedPercent": 44, "resetAt": "2026-08-03T00:00:00Z"},
      {"kind": "unknown-extra", "label": "No metadata", "usedPercent": 12, "resetAt": "2026-08-03T00:00:00Z"},
      {"kind": "known-false-extra", "label": "Known false extra", "usedPercent": 88, "resetAt": "2026-08-03T00:00:00Z"},
      {"kind": "known-extra", "label": "Known extra", "usedPercent": 23, "resetAt": "2026-08-03T00:00:00Z"}
    ],
    "error": null,
    "updatedAt": "2026-07-28T08:03:00Z"
  }]
}`

const filteringUsageFixture = `[{
  "provider": "mixed",
  "usage": {
    "primary": {"usedPercent": 0, "windowMinutes": 300, "resetsAt": "2026-07-28T13:00:00Z", "isSyntheticPlaceholder": true},
    "secondary": {"usedPercent": 44, "windowMinutes": 10080, "resetsAt": "2026-08-03T00:00:00Z", "usageKnown": false},
    "extraRateWindows": [
      {
        "id": "known-false-extra",
        "title": "Known false extra",
        "usageKnown": false,
        "window": {"usedPercent": 88, "windowMinutes": 10080, "resetsAt": "2026-08-03T00:00:00Z"}
      },
      {
        "id": "known-extra",
        "title": "Known extra",
        "usageKnown": true,
        "window": {"usedPercent": 23, "windowMinutes": 10080, "resetsAt": "2026-08-03T00:00:00Z"}
      }
    ]
  }
}]`

const missingValuesDashboardFixture = `{
  "schemaVersion": 1,
  "providers": [{
    "id": "missing-values",
    "windows": [
      {"kind": "", "label": "Missing kind", "usedPercent": 1, "resetAt": "2026-08-03T00:00:00Z"},
      {"kind": "no-label", "label": "", "usedPercent": 2, "resetAt": "2026-08-03T00:00:00Z"},
      {"kind": "no-percent", "label": "No percent", "resetAt": "2026-08-03T00:00:00Z"},
      {"kind": "complete", "label": "Complete", "usedPercent": 3, "resetAt": "2026-08-03T00:00:00Z"}
    ],
    "error": null,
    "updatedAt": "2026-07-28T08:03:30Z"
  }]
}`

const missingValuesUsageFixture = `[{
  "provider": "missing-values",
  "usage": {
    "extraRateWindows": [
      {"id": "no-label", "title": "No label", "usageKnown": true, "window": {"usedPercent": 2, "windowMinutes": 10080, "resetsAt": "2026-08-03T00:00:00Z"}},
      {"id": "no-percent", "title": "No percent", "usageKnown": true, "window": {"usedPercent": 0, "windowMinutes": 10080, "resetsAt": "2026-08-03T00:00:00Z"}},
      {"id": "complete", "title": "Complete", "usageKnown": true, "window": {"usedPercent": 3, "windowMinutes": 10080, "resetsAt": "2026-08-03T00:00:00Z"}}
    ]
  }
}]`

const zeroDashboardFixture = `{
  "schemaVersion": 1,
  "providers": [{
    "id": "zero",
    "windows": [{"kind": "daily", "label": "Daily", "usedPercent": 0, "remainingPercent": 100, "resetAt": "2026-07-29T00:00:00Z"}],
    "error": null,
    "updatedAt": "2026-07-28T08:04:00Z"
  }]
}`

const zeroUsageFixture = `[{
  "provider": "zero",
  "usage": {
    "extraRateWindows": [{
      "id": "daily",
      "title": "Daily",
      "usageKnown": true,
      "window": {"usedPercent": 0, "windowMinutes": 1440, "resetsAt": "2026-07-29T00:00:00Z"}
    }]
  }
}]`

const missingWindowMinutesDashboardFixture = `{
  "schemaVersion": 1,
  "providers": [{
    "id": "missing-minutes",
    "windows": [
      {"kind": "weekly", "label": "Weekly", "usedPercent": 52, "resetAt": "2026-08-03T00:00:00Z"},
      {"kind": "named-weekly", "label": "Named weekly", "usedPercent": 52, "resetAt": "2026-08-03T00:00:00Z"}
    ],
    "error": null,
    "updatedAt": "2026-07-28T08:05:00Z"
  }]
}`

const missingWindowMinutesUsageFixture = `[{
  "provider": "missing-minutes",
  "usage": {
    "secondary": {"usedPercent": 52, "windowMinutes": 10080, "resetsAt": "2026-08-03T00:00:00Z"},
    "extraRateWindows": [{
      "id": "named-weekly",
      "title": "Named weekly",
      "usageKnown": true,
      "window": {"usedPercent": 52, "resetsAt": "2026-08-03T00:00:00Z"}
    }]
  }
}]`

const mismatchedWindowMinutesDashboardFixture = `{
  "schemaVersion": 1,
  "providers": [{
    "id": "mismatched-minutes",
    "windows": [
      {"kind": "weekly", "label": "Weekly", "usedPercent": 52, "resetAt": "2026-08-03T00:00:00Z"},
      {"kind": "named-weekly", "label": "Named weekly", "usedPercent": 52, "resetAt": "2026-08-03T00:00:00Z"}
    ],
    "error": null,
    "updatedAt": "2026-07-28T08:06:00Z"
  }]
}`

const mismatchedWindowMinutesUsageFixture = `[{
  "provider": "mismatched-minutes",
  "usage": {
    "secondary": {"usedPercent": 52, "windowMinutes": 10080, "resetsAt": "2026-08-03T00:00:00Z"},
    "extraRateWindows": [{
      "id": "named-weekly",
      "title": "Named weekly",
      "usageKnown": true,
      "window": {"usedPercent": 52, "windowMinutes": 1440, "resetsAt": "2026-08-03T00:00:00Z"}
    }]
  }
}]`

const providerErrorDashboardFixture = `{
  "schemaVersion": 1,
  "providers": [{
    "id": "provider-error",
    "windows": [{"kind": "weekly", "label": "Weekly", "usedPercent": 0, "resetAt": "2026-08-03T00:00:00Z"}],
    "error": {"kind": "runtime", "message": "failed"},
    "updatedAt": "2026-07-28T08:07:00Z"
  }]
}`

const providerErrorUsageFixture = `[{
  "provider": "provider-error",
  "usage": {
    "secondary": {"usedPercent": 0, "windowMinutes": 10080, "resetsAt": "2026-08-03T00:00:00Z"}
  }
}]`

const usageProviderErrorDashboardFixture = `{
  "schemaVersion": 1,
  "providers": [{
    "id": "usage-provider-error",
    "windows": [{"kind": "weekly", "label": "Weekly", "usedPercent": 0, "resetAt": "2026-08-03T00:00:00Z"}],
    "error": null,
    "updatedAt": "2026-07-28T08:08:00Z"
  }]
}`

const usageProviderErrorUsageFixture = `[{
  "provider": "usage-provider-error",
  "error": {"kind": "runtime", "message": "failed"},
  "usage": {
    "secondary": {"usedPercent": 0, "windowMinutes": 10080, "resetsAt": "2026-08-03T00:00:00Z"}
  }
}]`
