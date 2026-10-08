package codexbar

import "testing"

// Win-CodexBar 0.56.8 emits the absent Codex session as an informational
// zero-percent window. It is not a quota, even though it has a duration.
func TestInformationalSessionDoesNotBecomeQuota(t *testing.T) {
	for _, flag := range []string{"is_informational", "isInformational"} {
		t.Run(flag, func(t *testing.T) {
			primary := map[string]any{flag: true, "used_percent": float64(0), "window_minutes": float64(300), "reset_description": "No active 5h session"}
			payload := map[string]any{"provider": "codex", "usage": map[string]any{
				"primary":   primary,
				"secondary": map[string]any{"used_percent": float64(25), "window_minutes": float64(10080)},
			}}
			if _, known := knownUsagePercentAtPaths(payload, "usage.primary"); known {
				t.Fatal("informational session must not be a known quota")
			}
			parsed, err := parseProviderPayload(payload)
			if err != nil {
				t.Fatal(err)
			}
			if parsed.Frame.UsageUnavailable || len(parsed.Meta.Windows) != 1 || len(parsed.Frame.UsageWindows) != 1 {
				t.Fatalf("only the real weekly quota should remain: %+v", parsed)
			}
			window := parsed.Frame.UsageWindows[0]
			if window.ID != "secondary" || window.Label != "Weekly" || window.Percent != 25 {
				t.Fatalf("weekly identity/value lost: %+v", window)
			}
			delete(payload["usage"].(map[string]any), "secondary")
			parsed, err = parseProviderPayload(payload)
			if err != nil {
				t.Fatal(err)
			}
			if !parsed.Frame.UsageUnavailable || providerPayloadHasUsage(payload) {
				t.Fatalf("informational-only provider must not look healthy: %+v", parsed)
			}
		})
	}
}

func TestInformationalExtraWindowIsNotQuota(t *testing.T) {
	windows := parseExtraUsageWindows([]any{
		map[string]any{"id": "notice", "window": map[string]any{"usedPercent": float64(12), "isInformational": true}},
		map[string]any{"id": "real-zero", "window": map[string]any{"usedPercent": float64(0), "isInformational": false}},
		map[string]any{"id": "legacy-zero", "window": map[string]any{"usedPercent": float64(0)}},
	})
	if len(windows) != 2 || windows[0].ID != "real-zero" || windows[1].ID != "legacy-zero" {
		t.Fatalf("keep genuine zeros, not informational values: %+v", windows)
	}
}
