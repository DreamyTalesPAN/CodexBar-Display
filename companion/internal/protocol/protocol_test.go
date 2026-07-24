package protocol

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestFrameNormalizeDropsUnsupportedTheme(t *testing.T) {
	frame := Frame{
		Provider: "codex",
		Label:    "Codex",
		Session:  2,
		Weekly:   11,
		ResetSec: 15480,
		Theme:    "amber",
	}

	normalized := frame.Normalize()
	if normalized.Theme != "" {
		t.Fatalf("expected unsupported theme to be dropped, got %q", normalized.Theme)
	}
}

func TestFrameNormalizeKeepsSupportedUsageMode(t *testing.T) {
	frame := Frame{
		Provider:  "codex",
		Label:     "Codex",
		Session:   2,
		Weekly:    11,
		ResetSec:  15480,
		UsageMode: "remaining",
	}

	normalized := frame.Normalize()
	if normalized.UsageMode != "remaining" {
		t.Fatalf("expected remaining usage mode to stay, got %q", normalized.UsageMode)
	}
}

func TestFrameNormalizeDropsUnsupportedUsageMode(t *testing.T) {
	frame := Frame{
		Provider:  "codex",
		Label:     "Codex",
		Session:   2,
		Weekly:    11,
		ResetSec:  15480,
		UsageMode: "flipped",
	}

	normalized := frame.Normalize()
	if normalized.UsageMode != "" {
		t.Fatalf("expected unsupported usage mode to be dropped, got %q", normalized.UsageMode)
	}
}

func TestFrameNormalizeClampsNegativeTokenStats(t *testing.T) {
	frame := Frame{
		Provider:      "codex",
		Label:         "Codex",
		SessionTokens: -1,
		WeekTokens:    -7,
		TotalTokens:   -9,
	}

	normalized := frame.Normalize()
	if normalized.SessionTokens != 0 || normalized.WeekTokens != 0 || normalized.TotalTokens != 0 {
		t.Fatalf("expected negative token stats to clamp to zero, got %+v", normalized)
	}
}

func TestFrameNormalizeKeepsNegotiatedV2(t *testing.T) {
	frame := Frame{
		V:        2,
		Provider: "codex",
		Label:    "Codex",
	}

	normalized := frame.Normalize()
	if normalized.V != 2 {
		t.Fatalf("expected frame version 2, got %d", normalized.V)
	}
}

func TestFrameMarshalUsageUnavailableIsOptional(t *testing.T) {
	available, err := (Frame{V: 2, Provider: "gemini"}).MarshalLine()
	if err != nil {
		t.Fatalf("marshal available frame: %v", err)
	}
	if strings.Contains(string(available), "usageUnavailable") {
		t.Fatalf("expected false availability field to stay omitted, got %s", available)
	}

	unavailable, err := (Frame{V: 2, Provider: "gemini", UsageUnavailable: true}).MarshalLine()
	if err != nil {
		t.Fatalf("marshal unavailable frame: %v", err)
	}
	if !strings.Contains(string(unavailable), `"usageUnavailable":true`) {
		t.Fatalf("expected unavailable field, got %s", unavailable)
	}
}

func TestFrameNormalizeKeepsSafeActivity(t *testing.T) {
	frame := Frame{
		Provider: "codex",
		Label:    "Codex",
		Activity: " Coding ",
	}

	normalized := frame.Normalize()
	if normalized.Activity != "coding" {
		t.Fatalf("expected normalized activity coding, got %q", normalized.Activity)
	}
}

func TestFrameNormalizeDropsUnsafeActivity(t *testing.T) {
	frame := Frame{
		Provider: "codex",
		Label:    "Codex",
		Activity: "coding!",
	}

	normalized := frame.Normalize()
	if normalized.Activity != "" {
		t.Fatalf("expected unsafe activity to be dropped, got %q", normalized.Activity)
	}
}

func TestFrameNormalizeDropsUnconfirmedThemeSpecClear(t *testing.T) {
	frame := Frame{
		Provider:  "codex",
		Label:     "Codex",
		ThemeSpec: json.RawMessage("null"),
	}

	line, err := frame.MarshalLine()
	if err != nil {
		t.Fatalf("MarshalLine returned error: %v", err)
	}
	if strings.Contains(string(line), "themeSpec") {
		t.Fatalf("expected unconfirmed themeSpec null to be omitted, got %s", string(line))
	}
}

func TestFrameNormalizeKeepsConfirmedThemeSpecClear(t *testing.T) {
	frame := Frame{
		Provider:              "codex",
		Label:                 "Codex",
		ThemeSpec:             json.RawMessage("null"),
		ConfirmClearThemeSpec: true,
	}

	line, err := frame.MarshalLine()
	if err != nil {
		t.Fatalf("MarshalLine returned error: %v", err)
	}
	if !strings.Contains(string(line), `"themeSpec":null`) ||
		!strings.Contains(string(line), `"confirmClearThemeSpec":true`) {
		t.Fatalf("expected confirmed theme clear fields, got %s", string(line))
	}
}

func TestFrameNormalizeTrimsUpdateState(t *testing.T) {
	frame := Frame{
		Update: &UpdateState{
			Available:     true,
			LatestVersion: " 1.2.3 ",
			Status:        " update_available ",
			LastError:     " timeout ",
		},
	}

	normalized := frame.Normalize()
	if normalized.Update == nil {
		t.Fatalf("expected update state to remain")
	}
	if normalized.Update.LatestVersion != "1.2.3" ||
		normalized.Update.Status != "update_available" ||
		normalized.Update.LastError != "timeout" {
		t.Fatalf("unexpected normalized update state: %+v", normalized.Update)
	}
}

func TestFrameNormalizeKeepsOnlyFourAvailableUsageSlots(t *testing.T) {
	frame := Frame{UsageSlots: []UsageSlot{
		{ID: " Weekly ", Label: "Weekly", Percent: 36, ResetSec: 10, Available: true},
		{ID: "missing", Label: "Missing", Percent: 99, Available: false},
		{ID: "spark", Label: "Codex Spark Weekly Window Name", Percent: 120, ResetSec: -1, Available: true},
		{ID: "third", Label: "Third", Percent: 10, Available: true},
		{ID: "fourth", Label: "Fourth", Percent: 20, Available: true},
		{ID: "fifth", Label: "Fifth", Percent: 30, Available: true},
	}}

	normalized := frame.Normalize()
	if len(normalized.UsageSlots) != 4 {
		t.Fatalf("expected four available slots, got %+v", normalized.UsageSlots)
	}
	if normalized.UsageSlots[0].ID != "weekly" || normalized.UsageSlots[0].Percent != 36 || normalized.UsageSlots[0].ResetSec != 10 {
		t.Fatalf("expected weekly slot preserved, got %+v", normalized.UsageSlots[0])
	}
	if normalized.UsageSlots[1].ID != "spark" || normalized.UsageSlots[1].Percent != 100 || normalized.UsageSlots[1].ResetSec != 0 || len(normalized.UsageSlots[1].Label) > 24 {
		t.Fatalf("expected clamped spark slot, got %+v", normalized.UsageSlots[1])
	}
	if normalized.UsageSlots[3].ID != "fourth" {
		t.Fatalf("expected fourth available slot, got %+v", normalized.UsageSlots[3])
	}
}
