package protocol

import "testing"

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
