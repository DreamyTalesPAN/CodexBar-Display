package protocol

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
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

func TestUsageSlotsFixtureRemainsReadableByLegacyFrame(t *testing.T) {
	type legacyFrame struct {
		V         int    `json:"v"`
		Provider  string `json:"provider"`
		Label     string `json:"label"`
		Session   int    `json:"session"`
		Weekly    int    `json:"weekly"`
		ResetSecs int64  `json:"resetSecs"`
	}
	type fixture struct {
		NewFrame       json.RawMessage `json:"newFrame"`
		LegacyExpected legacyFrame     `json:"legacyExpected"`
	}
	path := filepath.Join("..", "..", "..", "protocol", "fixtures", "v1", "usage_slots_compatibility.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read compatibility fixture: %v", err)
	}
	var data fixture
	if err := json.Unmarshal(raw, &data); err != nil {
		t.Fatalf("parse compatibility fixture: %v", err)
	}
	var got legacyFrame
	if err := json.Unmarshal(data.NewFrame, &got); err != nil {
		t.Fatalf("legacy parser rejected additive usageSlots: %v", err)
	}
	if got != data.LegacyExpected {
		t.Fatalf("legacy projection mismatch: got=%+v want=%+v", got, data.LegacyExpected)
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

func TestFrameNormalizeKeepsOnlyTwoValidUsageSlots(t *testing.T) {
	frame := Frame{UsageSlots: []UsageSlot{
		{ID: "", Label: "Missing", Percent: 99},
		{ID: " Weekly ", Label: "Weekly", Percent: 36, ResetSec: 10},
		{ID: "spark-window-id-that-is-longer-than-thirty-two-characters", Label: "Codex Spark Wöchentliche Nutzung", Percent: 120, ResetSec: -1},
		{ID: "third", Label: "Third", Percent: 10},
	}}

	normalized := frame.Normalize()
	if len(normalized.UsageSlots) != 2 {
		t.Fatalf("expected two valid slots, got %+v", normalized.UsageSlots)
	}
	if normalized.UsageSlots[0].ID != "weekly" || normalized.UsageSlots[0].Percent != 36 || normalized.UsageSlots[0].ResetSec != 10 {
		t.Fatalf("expected weekly slot preserved, got %+v", normalized.UsageSlots[0])
	}
	if normalized.UsageSlots[1].Percent != 100 ||
		normalized.UsageSlots[1].ResetSec != 0 ||
		len(normalized.UsageSlots[1].ID) > 32 ||
		len(normalized.UsageSlots[1].Label) > 24 ||
		!utf8.ValidString(normalized.UsageSlots[1].Label) {
		t.Fatalf("expected clamped spark slot, got %+v", normalized.UsageSlots[1])
	}

	line, err := normalized.MarshalLine()
	if err != nil {
		t.Fatalf("marshal normalized frame: %v", err)
	}
	if strings.Contains(string(line), `"available"`) {
		t.Fatalf("available=true must not consume wire bytes: %s", line)
	}
}

func TestMaximumUsageSlotFrameStaysInsideDocumentedBudget(t *testing.T) {
	frame := Frame{
		V:         2,
		Provider:  "antigravity",
		Label:     "Antigravity",
		Session:   100,
		Weekly:    100,
		ResetSec:  604800,
		UsageMode: "remaining",
		UsageSlots: []UsageSlot{
			{ID: strings.Repeat("a", 32), Label: strings.Repeat("ä", 12), Percent: 100, ResetSec: 604800},
			{ID: strings.Repeat("b", 32), Label: strings.Repeat("Z", 24), Percent: 100, ResetSec: 604800},
		},
	}
	line, err := frame.MarshalLine()
	if err != nil {
		t.Fatalf("marshal max usage slot frame: %v", err)
	}
	if len(line) > 512 {
		t.Fatalf("usage slot frame exceeds 512-byte budget: bytes=%d frame=%s", len(line), line)
	}
}

func TestUsageSlotZeroValuesRemainExplicitOnWire(t *testing.T) {
	frame := Frame{
		V:        2,
		Provider: "codex",
		UsageSlots: []UsageSlot{
			{ID: "primary", Label: "Session", Percent: 0, ResetSec: 0},
		},
	}
	line, err := frame.MarshalLine()
	if err != nil {
		t.Fatalf("marshal zero-value slot: %v", err)
	}
	if !strings.Contains(string(line), `"percent":0`) ||
		!strings.Contains(string(line), `"resetSecs":0`) {
		t.Fatalf("required zero values disappeared from wire frame: %s", line)
	}
}
