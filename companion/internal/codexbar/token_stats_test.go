package codexbar

import (
	"context"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

func TestParseProviderTokenStats(t *testing.T) {
	raw := []byte(`[
		{
			"provider":"codex",
			"source":"local",
			"updatedAt":"2026-03-07T15:53:03Z",
			"sessionTokens":1437166,
			"daily":[
				{"date":"2026-02-28","totalTokens":183838686},
				{"date":"2026-03-01","totalTokens":180438698},
				{"date":"2026-03-02","totalTokens":87387409},
				{"date":"2026-03-03","totalTokens":48306362},
				{"date":"2026-03-04","totalTokens":56780749},
				{"date":"2026-03-05","totalTokens":426535},
				{"date":"2026-03-06","totalTokens":9535091},
				{"date":"2026-03-07","totalTokens":1437166}
			],
			"totals":{"totalTokens":1078397605}
		}
	]`)

	stats, err := parseProviderTokenStats(raw)
	if err != nil {
		t.Fatalf("parse provider token stats: %v", err)
	}

	codex, ok := stats["codex"]
	if !ok {
		t.Fatalf("expected codex stats, got %#v", stats)
	}
	if codex.SessionTokens != 1437166 {
		t.Fatalf("unexpected session tokens %d", codex.SessionTokens)
	}
	if codex.WeekTokens != 384312010 {
		t.Fatalf("unexpected week tokens %d", codex.WeekTokens)
	}
	if codex.TotalTokens != 1078397605 {
		t.Fatalf("unexpected total tokens %d", codex.TotalTokens)
	}
	if codex.Source != "local" {
		t.Fatalf("unexpected source %q", codex.Source)
	}
}

func TestMergeTokenStatsAddsFrameFields(t *testing.T) {
	resetTokenStatsTestGlobals()
	defer resetTokenStatsTestGlobals()

	runCostCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
		return []byte(`[
			{
				"provider":"codex",
				"updatedAt":"2026-03-07T15:53:03Z",
				"sessionTokens":1437166,
				"daily":[
					{"date":"2026-03-01","totalTokens":180438698},
					{"date":"2026-03-02","totalTokens":87387409},
					{"date":"2026-03-03","totalTokens":48306362},
					{"date":"2026-03-04","totalTokens":56780749},
					{"date":"2026-03-05","totalTokens":426535},
					{"date":"2026-03-06","totalTokens":9535091},
					{"date":"2026-03-07","totalTokens":1437166}
				],
				"totals":{"totalTokens":1078397605}
			}
		]`), nil
	}

	frames := []ParsedFrame{
		{
			Provider: "codex",
			Frame: protocol.Frame{
				Provider: "codex",
				Label:    "Codex",
				Session:  17,
				Weekly:   42,
			},
		},
		{
			Provider: "claude",
			Frame: protocol.Frame{
				Provider: "claude",
				Label:    "Claude",
				Session:  5,
				Weekly:   8,
			},
		},
	}

	merged := mergeTokenStats(context.Background(), frames, "/opt/homebrew/bin/codexbar")
	if merged[0].Frame.SessionTokens != 1437166 {
		t.Fatalf("expected codex session tokens, got %d", merged[0].Frame.SessionTokens)
	}
	if merged[0].Frame.WeekTokens != 384312010 {
		t.Fatalf("expected codex week tokens, got %d", merged[0].Frame.WeekTokens)
	}
	if merged[0].Frame.TotalTokens != 1078397605 {
		t.Fatalf("expected codex total tokens, got %d", merged[0].Frame.TotalTokens)
	}
	if merged[1].Frame.SessionTokens != 0 || merged[1].Frame.WeekTokens != 0 || merged[1].Frame.TotalTokens != 0 {
		t.Fatalf("expected unmatched provider to remain unchanged, got %+v", merged[1].Frame)
	}
}

func resetTokenStatsTestGlobals() {
	runCostCommandFn = runUsageCommand
	tokenStatsCache = providerTokenStatsCache{}
}
