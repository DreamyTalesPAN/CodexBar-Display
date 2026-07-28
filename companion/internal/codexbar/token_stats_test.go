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
			"currencyCode":"USD",
			"updatedAt":"2026-03-07T15:53:03Z",
			"sessionTokens":1437166,
			"sessionCostUSD":12.34,
			"last30DaysCostUSD":456.78,
			"last30DaysTokens":1078397605,
			"daily":[
				{"date":"2026-02-28","totalTokens":183838686},
				{"date":"2026-03-01","totalTokens":180438698},
				{"date":"2026-03-02","totalTokens":87387409},
				{"date":"2026-03-03","totalTokens":48306362},
				{"date":"2026-03-04","totalTokens":56780749},
				{"date":"2026-03-05","totalTokens":426535},
				{"date":"2026-03-06","totalTokens":9535091},
				{"date":"2026-03-07","totalTokens":1437166,"totalCost":12.34,"modelBreakdowns":[{"modelName":"gpt-5.5","totalTokens":1437166,"cost":12.34}]}
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
	if codex.Cost == nil {
		t.Fatalf("expected cost usage metadata")
	}
	if codex.Cost.TodayCostUSD != 12.34 || codex.Cost.Last30DaysCostUSD != 456.78 {
		t.Fatalf("unexpected cost summary: %+v", codex.Cost)
	}
	if codex.Cost.Last30DaysTokens != 1078397605 || codex.Cost.LatestTokens != 1437166 {
		t.Fatalf("unexpected cost tokens: %+v", codex.Cost)
	}
	if codex.Cost.TopModel != "gpt-5.5" {
		t.Fatalf("expected top model gpt-5.5, got %+v", codex.Cost)
	}
	if len(codex.Cost.Daily) != 8 || codex.Cost.Daily[7].Day != "2026-03-07" || codex.Cost.Daily[7].TotalCostUSD != 12.34 {
		t.Fatalf("unexpected daily cost history: %+v", codex.Cost.Daily)
	}
}

func TestParseProviderTokenStatsKeepsSuccessfulZeroResult(t *testing.T) {
	stats, err := parseProviderTokenStats([]byte(`[
		{
			"provider":"codex",
			"updatedAt":"2026-07-27T12:00:00Z",
			"daily":[],
			"totals":{"totalTokens":0}
		}
	]`))
	if err != nil {
		t.Fatalf("parse zero token stats: %v", err)
	}

	codex, ok := stats["codex"]
	if !ok || codex.Cost == nil {
		t.Fatalf("expected successful zero result to remain available, got %#v", stats)
	}
	if codex.SessionTokens != 0 || codex.WeekTokens != 0 || codex.TotalTokens != 0 {
		t.Fatalf("expected zero token counters, got %+v", codex)
	}
	if codex.Cost.Last30DaysTokens != 0 || len(codex.Cost.Daily) != 0 {
		t.Fatalf("expected an explicit empty cost result, got %+v", codex.Cost)
	}
}

func TestMergeTokenStatsAddsFrameFields(t *testing.T) {
	runCostCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
		return []byte(`[
			{
				"provider":"codex",
				"currencyCode":"USD",
				"updatedAt":"2026-03-07T15:53:03Z",
				"sessionTokens":1437166,
				"last30DaysCostUSD":456.78,
				"daily":[
					{"date":"2026-03-01","totalTokens":180438698},
					{"date":"2026-03-02","totalTokens":87387409},
					{"date":"2026-03-03","totalTokens":48306362},
					{"date":"2026-03-04","totalTokens":56780749},
					{"date":"2026-03-05","totalTokens":426535},
					{"date":"2026-03-06","totalTokens":9535091},
					{"date":"2026-03-07","totalTokens":1437166,"totalCost":12.34,"modelBreakdowns":[{"modelName":"gpt-5.5","totalTokens":1437166,"cost":12.34}]}
				],
				"totals":{"totalTokens":1078397605}
			}
			]`), nil
	}
	t.Cleanup(func() { runCostCommandFn = runUsageCommand })

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
	if merged[0].ActivityObservedAt.IsZero() || !merged[0].ActivityObservedAt.Equal(time.Date(2026, 3, 7, 15, 53, 3, 0, time.UTC)) {
		t.Fatalf("expected codex activity observed timestamp from cost updatedAt, got %s", merged[0].ActivityObservedAt)
	}
	if merged[0].Meta.Cost == nil || merged[0].Meta.Cost.TopModel != "gpt-5.5" {
		t.Fatalf("expected cost usage metadata to merge into frame, got %+v", merged[0].Meta.Cost)
	}
	if merged[1].Frame.SessionTokens != 0 || merged[1].Frame.WeekTokens != 0 || merged[1].Frame.TotalTokens != 0 {
		t.Fatalf("expected unmatched provider to remain unchanged, got %+v", merged[1].Frame)
	}
}

func TestMergeTokenStatsReplacesPreviousValuesWithZero(t *testing.T) {
	runCostCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
		return []byte(`[
			{
				"provider":"codex",
				"updatedAt":"2026-07-28T12:00:00Z",
				"daily":[],
				"totals":{"totalTokens":0}
			}
		]`), nil
	}
	t.Cleanup(func() { runCostCommandFn = runUsageCommand })

	merged := mergeTokenStats(context.Background(), []ParsedFrame{{
		Provider: "codex",
		Frame: protocol.Frame{
			Provider:      "codex",
			Label:         "Codex",
			SessionTokens: 10,
			WeekTokens:    20,
			TotalTokens:   30,
		},
	}}, "/opt/homebrew/bin/codexbar")

	if len(merged) != 1 || merged[0].Frame.SessionTokens != 0 || merged[0].Frame.WeekTokens != 0 || merged[0].Frame.TotalTokens != 0 {
		t.Fatalf("successful zero token stats did not replace previous counters: %+v", merged)
	}
	if merged[0].Meta.Cost == nil {
		t.Fatalf("successful zero token result should keep cost result provenance: %+v", merged[0].Meta)
	}
}

func TestFetchProviderTokenStatsReadsCodexBarCostWithoutRefresh(t *testing.T) {
	var gotBin string
	var gotArgs []string
	runCostCommandFn = func(_ context.Context, timeout time.Duration, bin string, args ...string) ([]byte, error) {
		if timeout != tokenStatsCommandTimeout {
			t.Fatalf("unexpected token stats timeout %s", timeout)
		}
		gotBin = bin
		gotArgs = append([]string(nil), args...)
		return []byte(`[{
			"provider":"codex",
			"source":"local",
			"updatedAt":"2026-07-22T18:00:00Z",
			"sessionTokens":120,
			"last30DaysTokens":120,
			"daily":[{"date":"2026-07-22","totalTokens":120}],
			"totals":{"totalTokens":120}
		}]`), nil
	}
	t.Cleanup(func() { runCostCommandFn = runUsageCommand })

	stats, ok := fetchProviderTokenStats(context.Background(), "/tmp/CodexBarCLI")
	if !ok || stats["codex"].Source != "local" || stats["codex"].TotalTokens != 120 {
		t.Fatalf("expected direct cost stats, got %#v", stats)
	}
	if gotBin != "/tmp/CodexBarCLI" {
		t.Fatalf("unexpected binary %q", gotBin)
	}
	if len(gotArgs) != 2 || gotArgs[0] != "cost" || gotArgs[1] != "--json" {
		t.Fatalf("expected codexbar cost --json without refresh, got %#v", gotArgs)
	}
}
