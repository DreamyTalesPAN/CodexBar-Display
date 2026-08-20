package protocol

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
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

func TestFrameNormalizeKeepsValidClockSchedule(t *testing.T) {
	frame := Frame{
		NextClockTransition: &ClockSchedule{
			CurrentOffsetMinutes:     60,
			TransitionEpoch:          1792886400,
			OffsetMinutes:            120,
			FollowingTransitionEpoch: 1800000000,
			FollowingOffsetMinutes:   60,
		},
	}

	normalized := frame.Normalize()
	if normalized.NextClockTransition == nil ||
		normalized.NextClockTransition.CurrentOffsetMinutes != 60 ||
		normalized.NextClockTransition.FollowingTransitionEpoch != 1800000000 ||
		normalized.NextClockTransition.FollowingOffsetMinutes != 60 {
		t.Fatalf("expected valid clock schedule to stay, got %+v", normalized.NextClockTransition)
	}

	line, err := normalized.MarshalLine()
	if err != nil {
		t.Fatalf("marshal clock schedule: %v", err)
	}
	if !strings.Contains(string(line), `"currentOffsetMinutes":60`) ||
		!strings.Contains(string(line), `"offsetMinutes":120`) ||
		!strings.Contains(string(line), `"followingTransitionEpoch":1800000000`) ||
		!strings.Contains(string(line), `"followingOffsetMinutes":60`) {
		t.Fatalf("clock schedule missing from wire frame: %s", line)
	}
}

func TestFrameNormalizeDropsInvalidClockSchedule(t *testing.T) {
	frame := Frame{
		NextClockTransition: &ClockSchedule{CurrentOffsetMinutes: 7},
	}
	if normalized := frame.Normalize(); normalized.NextClockTransition != nil {
		t.Fatalf("expected invalid clock schedule to be dropped, got %+v", normalized.NextClockTransition)
	}
	frame = Frame{
		NextClockTransition: &ClockSchedule{
			CurrentOffsetMinutes:     60,
			TransitionEpoch:          1792886400,
			OffsetMinutes:            120,
			FollowingTransitionEpoch: 1792886399,
			FollowingOffsetMinutes:   60,
		},
	}
	if normalized := frame.Normalize(); normalized.NextClockTransition != nil {
		t.Fatalf("expected out-of-order clock schedule to be dropped, got %+v", normalized.NextClockTransition)
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

func TestFrameMarshalLaneUnavailableFieldsAreOptionalAndBackwardCompatible(t *testing.T) {
	known, err := (Frame{V: 2, Provider: "codex", Session: 12, Weekly: 57}).MarshalLine()
	if err != nil {
		t.Fatalf("marshal known frame: %v", err)
	}
	if strings.Contains(string(known), "sessionUnavailable") || strings.Contains(string(known), "weeklyUnavailable") {
		t.Fatalf("false optional lane fields must stay omitted for old readers, got %s", known)
	}

	partial, err := (Frame{
		V:                  2,
		Provider:           "codex",
		Weekly:             57,
		SessionUnavailable: true,
	}).MarshalLine()
	if err != nil {
		t.Fatalf("marshal partial frame: %v", err)
	}
	if !strings.Contains(string(partial), `"sessionUnavailable":true`) ||
		strings.Contains(string(partial), `"usageUnavailable":true`) {
		t.Fatalf("expected only the unknown lane to be marked, got %s", partial)
	}
}

func TestFrameMarshalEscapesUsageWindowIDsAndLabelsOnWire(t *testing.T) {
	line, err := (Frame{
		V:        ProtocolVersionV2,
		Provider: "generic",
		Label:    "Generic",
		UsageWindows: []UsageWindow{
			{ID: "&<>", Label: "&<>", Percent: 10},
			{ID: `"`, Label: `"`, Percent: 20},
			{ID: `\`, Label: `\`, Percent: 30},
		},
	}).MarshalLine()
	if err != nil {
		t.Fatalf("marshal frame: %v", err)
	}
	raw := string(line)
	for _, want := range []string{
		`"id":"\u0026\u003c\u003e","label":"\u0026\u003c\u003e"`,
		`"id":"\"","label":"\""`,
		`"id":"\\","label":"\\"`,
	} {
		if !strings.Contains(raw, want) {
			t.Fatalf("marshaled frame missing escaped usage-window text %s: %s", want, raw)
		}
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

func TestFrameNormalizeBoundsProviderText(t *testing.T) {
	frame := Frame{
		Provider: " " + strings.Repeat("provider", 8),
		Label:    " " + strings.Repeat("Wöchentlich", 8),
	}

	normalized := frame.Normalize()
	if len(normalized.Provider) > DefaultProviderBytes ||
		len(normalized.Label) > DefaultProviderLabelBytes ||
		!utf8.ValidString(normalized.Label) {
		t.Fatalf("expected bounded provider text, got provider=%q label=%q", normalized.Provider, normalized.Label)
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

func TestFrameJSONRejectsUsageWindowTextOverUTF8ByteLimit(t *testing.T) {
	cases := []struct {
		name    string
		version int
		field   string
		value   UsageWindow
	}{
		{
			name:    "v2 id",
			version: 2,
			field:   "usageWindows",
			value:   UsageWindow{ID: strings.Repeat("😀", 9), Label: "Session"},
		},
		{
			name:    "v2 label",
			version: 2,
			field:   "usageWindows",
			value:   UsageWindow{ID: "session", Label: strings.Repeat("😀", 24)},
		},
		{
			name:    "v1 id",
			version: 1,
			field:   "usageSlots",
			value:   UsageWindow{ID: strings.Repeat("😀", 9), Label: "Session"},
		},
		{
			name:    "v1 label",
			version: 1,
			field:   "usageSlots",
			value:   UsageWindow{ID: "session", Label: strings.Repeat("ä", 13)},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			data, err := json.Marshal(map[string]any{
				"v":      tc.version,
				tc.field: []UsageWindow{tc.value},
			})
			if err != nil {
				t.Fatalf("marshal test frame: %v", err)
			}

			var frame Frame
			if err := json.Unmarshal(data, &frame); err == nil {
				t.Fatalf("expected oversized UTF-8 text to be rejected: %s", data)
			}
		})
	}
}

func TestFrameJSONPreservesUsageWindowTextWithinUTF8ByteLimits(t *testing.T) {
	want := UsageWindow{ID: strings.Repeat("😀", 8), Label: strings.Repeat("ä", 12), Percent: 42}
	data, err := json.Marshal(map[string]any{
		"v":            ProtocolVersionV2,
		"usageWindows": []UsageWindow{want},
	})
	if err != nil {
		t.Fatalf("marshal test frame: %v", err)
	}

	var frame Frame
	if err := json.Unmarshal(data, &frame); err != nil {
		t.Fatalf("unmarshal valid UTF-8 frame: %v", err)
	}
	normalized := frame.Normalize()
	if len(normalized.UsageWindows) != 1 || normalized.UsageWindows[0] != want {
		t.Fatalf("valid UTF-8 usage text was changed: got %+v, want %+v", normalized.UsageWindows, []UsageWindow{want})
	}
}

func TestProtocolSchemaUsesSharedUTF8ByteLimits(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "protocol", "schema.json"))
	if err != nil {
		t.Fatalf("read frame schema: %v", err)
	}
	var schema struct {
		Defs struct {
			UsageWindow struct {
				Properties struct {
					ID struct {
						MaxUTF8Bytes int `json:"x-maxUtf8Bytes"`
					} `json:"id"`
					Label struct {
						MaxUTF8Bytes int `json:"x-maxUtf8Bytes"`
					} `json:"label"`
				} `json:"properties"`
			} `json:"usageWindow"`
		} `json:"$defs"`
		Properties map[string]struct {
			Items struct {
				Ref string `json:"$ref"`
			} `json:"items"`
		} `json:"properties"`
	}
	if err := json.Unmarshal(data, &schema); err != nil {
		t.Fatalf("parse frame schema: %v", err)
	}
	window := schema.Defs.UsageWindow
	if window.Properties.ID.MaxUTF8Bytes != DefaultUsageWindowIDBytes ||
		window.Properties.Label.MaxUTF8Bytes != DefaultUsageWindowLabelBytes {
		t.Fatalf("schema byte limits do not match runtime: id=%d label=%d", window.Properties.ID.MaxUTF8Bytes, window.Properties.Label.MaxUTF8Bytes)
	}
	for _, name := range []string{"usageSlots", "usageWindows"} {
		if got := schema.Properties[name].Items.Ref; got != "#/$defs/usageWindow" {
			t.Fatalf("%s must use the shared usage-window schema, got %q", name, got)
		}
	}
}

func TestFrameNormalizeV1OmitsUsageWindowsOnWire(t *testing.T) {
	frame := Frame{
		V:        ProtocolVersionV1,
		Provider: "codex",
		UsageWindows: []UsageWindow{
			{ID: "session", Label: "Session", Percent: 12, ResetSec: 60},
			{ID: "weekly", Label: "Weekly", Percent: 34, ResetSec: 120},
			{ID: "monthly", Label: "Monthly", Percent: 56, ResetSec: 180},
		},
	}

	normalized := frame.Normalize()
	if len(normalized.UsageWindows) != 0 {
		t.Fatalf("v1 frame must not retain usageWindows, got %+v", normalized.UsageWindows)
	}
	if len(normalized.UsageSlots) != 2 {
		t.Fatalf("expected two legacy slots, got %+v", normalized.UsageSlots)
	}
	if normalized.Session != 12 || normalized.Weekly != 34 || normalized.ResetSec != 60 {
		t.Fatalf("legacy projection mismatch: got session=%d weekly=%d reset=%d", normalized.Session, normalized.Weekly, normalized.ResetSec)
	}

	line, err := frame.MarshalLine()
	if err != nil {
		t.Fatalf("marshal v1 frame: %v", err)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(line, &raw); err != nil {
		t.Fatalf("parse v1 wire frame: %v", err)
	}
	if _, ok := raw["usageWindows"]; ok {
		t.Fatalf("usageWindows must be omitted from v1 wire frame: %s", line)
	}
	var wire Frame
	if err := json.Unmarshal(line, &wire); err != nil {
		t.Fatalf("parse typed v1 wire frame: %v", err)
	}
	if len(wire.UsageSlots) != 2 ||
		wire.UsageSlots[0].ID != "session" ||
		wire.UsageSlots[1].ID != "weekly" {
		t.Fatalf("expected first two usage windows as legacy slots, got %+v", wire.UsageSlots)
	}
	if wire.Session != 12 || wire.Weekly != 34 || wire.ResetSec != 60 {
		t.Fatalf("wire legacy projection mismatch: got session=%d weekly=%d reset=%d", wire.Session, wire.Weekly, wire.ResetSec)
	}
}

func TestApplyResetTrustReanchorsAllResetCountdowns(t *testing.T) {
	sendAt := time.Date(2026, 8, 3, 9, 0, 0, 0, time.UTC)
	collectedAt := sendAt.Add(-30 * time.Second)

	windows := (Frame{
		V:            ProtocolVersionV2,
		Provider:     "codex",
		ResetSec:     120,
		ResetSource:  "codex:primary",
		UsageWindows: []UsageWindow{{ID: "primary", Label: "Primary", ResetSec: 120}},
	}).ApplyResetTrust(collectedAt, sendAt, true)
	if windows.ResetSec != 90 || len(windows.UsageWindows) != 1 || windows.UsageWindows[0].ResetSec != 90 {
		t.Fatalf("expected root and usage window countdowns re-anchored to 90, got root=%d windows=%+v", windows.ResetSec, windows.UsageWindows)
	}

	laterWindow := (Frame{
		V:        ProtocolVersionV2,
		Provider: "codex",
		UsageWindows: []UsageWindow{
			{ID: "primary", Label: "Primary"},
			{ID: "secondary", Label: "Secondary", ResetSec: 120},
		},
	}).ApplyResetTrust(collectedAt, sendAt, true)
	if laterWindow.ResetTrust != ResetTrustLive || laterWindow.ResetSec != 90 ||
		laterWindow.UsageWindows[0].ResetSec != 0 || laterWindow.UsageWindows[1].ResetSec != 90 {
		t.Fatalf("expected later reset to anchor shared trust, got %+v", laterWindow)
	}

	slots := (Frame{
		V:           ProtocolVersionV1,
		Provider:    "codex",
		ResetSec:    120,
		ResetSource: "codex:primary",
		UsageSlots:  []UsageSlot{{ID: "primary", Label: "Primary", ResetSec: 120}},
	}).ApplyResetTrust(collectedAt, sendAt, true)
	if slots.ResetSec != 90 || len(slots.UsageSlots) != 1 || slots.UsageSlots[0].ResetSec != 90 {
		t.Fatalf("expected root and legacy slot countdowns re-anchored to 90, got root=%d slots=%+v", slots.ResetSec, slots.UsageSlots)
	}

	stale := (Frame{
		V:            ProtocolVersionV1,
		Provider:     "codex",
		ResetSec:     120,
		ResetSource:  "codex:primary",
		UsageWindows: []UsageWindow{{ID: "primary", Label: "Primary", ResetSec: 120}},
		UsageSlots:   []UsageSlot{{ID: "primary", Label: "Primary", ResetSec: 120}},
	}).ApplyResetTrust(time.Time{}, sendAt, true)
	if stale.ResetTrust != ResetTrustStale || stale.ResetSec != 0 || stale.ResetTrustSec != 0 ||
		len(stale.UsageSlots) != 1 || stale.UsageSlots[0].ResetSec != 0 {
		t.Fatalf("expected stale root and usage countdowns to be zero, got %+v", stale)
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

// Public firmware 1.0.39 is the baseline every existing customer runs, and its
// frame parser reads exactly three usage fields:
//
//	out.session   = ClampPct(doc["session"] | 0);
//	out.weekly    = ClampPct(doc["weekly"] | 0);
//	out.resetSecs = ClampNonNegativeInt64(doc["resetSecs"] | 0);
//
// (git show v1.0.39:firmware_shared/codexbar_display_core.h). It knows neither
// usageWindows nor usageSlots nor usageMode. Warm-start customers update the
// Mac App before the firmware, so the candidate Companion talks to that parser
// for as long as the customer waits before flashing. If the legacy projection
// ever stops riding along on a v2 frame, every one of those VibeTVs drops to
// 0% on both lanes with a frozen countdown.
func TestV2WireFrameStaysReadableByPublicFirmware1039(t *testing.T) {
	legacyFirmwareReader := func(t *testing.T, line []byte) (session, weekly int, reset int64) {
		t.Helper()
		var read struct {
			Session   int   `json:"session"`
			Weekly    int   `json:"weekly"`
			ResetSecs int64 `json:"resetSecs"`
		}
		if err := json.Unmarshal(line, &read); err != nil {
			t.Fatalf("firmware 1.0.39 parser rejected the v2 frame: %v", err)
		}
		return read.Session, read.Weekly, read.ResetSecs
	}

	frame := Frame{
		V:        ProtocolVersionV2,
		Provider: "codex",
		Label:    "Codex",
		UsageWindows: []UsageWindow{
			{ID: "secondary", Label: "Weekly", Percent: 42, ResetSec: 15480},
			{ID: "codex-spark-weekly", Label: "Codex Spark Weekly", Percent: 7, ResetSec: 604800},
		},
	}
	line, err := frame.Normalize().MarshalLine()
	if err != nil {
		t.Fatalf("marshal v2 frame: %v", err)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(line, &raw); err != nil {
		t.Fatalf("parse v2 wire frame: %v", err)
	}
	if _, ok := raw["usageWindows"]; !ok {
		t.Fatalf("v2 frame must carry usageWindows: %s", line)
	}
	session, weekly, reset := legacyFirmwareReader(t, line)
	if session != 42 || weekly != 7 || reset != 15480 {
		t.Fatalf("firmware 1.0.39 would render session=%d weekly=%d reset=%d from %s", session, weekly, reset, line)
	}
}

// The same projection has to survive the remaining-bars preference, because it
// is applied to usageWindows and the legacy lanes must agree with them. A
// firmware 1.0.39 device has no usageMode field, so whatever lands in session
// and weekly is what the customer reads off the screen.
func TestV2WireFrameLegacyLanesAgreeWithUsageWindows(t *testing.T) {
	frame := Frame{
		V:        ProtocolVersionV2,
		Provider: "claude",
		Label:    "Claude",
		Session:  99,
		Weekly:   98,
		ResetSec: 1,
		UsageWindows: []UsageWindow{
			{ID: "session", Label: "Session", Percent: 12, ResetSec: 3600},
			{ID: "weekly", Label: "Weekly", Percent: 34, ResetSec: 604800},
		},
	}
	normalized := frame.Normalize()
	if normalized.Session != normalized.UsageWindows[0].Percent ||
		normalized.ResetSec != normalized.UsageWindows[0].ResetSec ||
		normalized.Weekly != normalized.UsageWindows[1].Percent {
		t.Fatalf("legacy lanes drifted from usageWindows: %+v", normalized)
	}
	if normalized.SessionUnavailable || normalized.WeeklyUnavailable {
		t.Fatalf("two present windows must mark both legacy lanes available: %+v", normalized)
	}
}
