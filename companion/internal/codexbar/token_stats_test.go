package codexbar

import (
	"context"
	"os"
	"path/filepath"
	"sync/atomic"
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

func TestMergeTokenStatsAddsFrameFields(t *testing.T) {
	resetTokenStatsTestGlobals()
	defer resetTokenStatsTestGlobals()
	loadProviderTokenStatsCacheFn = func(time.Time) (map[string]ProviderTokenStats, bool) {
		return nil, false
	}

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

func TestLoadProviderTokenStatsFromCostCacheCodexLayout(t *testing.T) {
	cacheRoot := t.TempDir()
	now := time.Date(2026, 7, 22, 18, 0, 0, 0, time.UTC)
	writeCostCacheFixture(t, filepath.Join(cacheRoot, "codex-v10.json"), `{
		"version":1,
		"lastScanUnixMs":1784743200000,
		"days":{
			"2026-07-21":{"gpt-5.5":[10,8,2]},
			"2026-07-22":{"gpt-5.6-sol":[100,80,20]}
		}
	}`)

	stats, ok := loadProviderTokenStatsFromCostCacheAt(cacheRoot, now)
	if !ok {
		t.Fatal("expected cached token stats")
	}
	codex := stats["codex"]
	if codex.SessionTokens != 120 || codex.WeekTokens != 132 || codex.TotalTokens != 132 {
		t.Fatalf("unexpected cached Codex totals: %+v", codex)
	}
	if codex.Cost == nil || len(codex.Cost.Daily) != 2 || codex.Cost.TopModel != "gpt-5.6-sol" {
		t.Fatalf("unexpected cached Codex history: %+v", codex.Cost)
	}

	cliStats, err := parseProviderTokenStats([]byte(`[{
		"provider":"codex",
		"source":"local",
		"updatedAt":"2026-07-22T18:00:00Z",
		"sessionTokens":120,
		"last30DaysTokens":132,
		"daily":[
			{"date":"2026-07-21","totalTokens":12},
			{"date":"2026-07-22","totalTokens":120}
		],
		"totals":{"totalTokens":132}
	}]`))
	if err != nil {
		t.Fatalf("parse CLI token stats: %v", err)
	}
	cliCodex := cliStats["codex"]
	if codex.SessionTokens != cliCodex.SessionTokens ||
		codex.WeekTokens != cliCodex.WeekTokens ||
		codex.TotalTokens != cliCodex.TotalTokens {
		t.Fatalf("disk-cache and CLI totals differ: cache=%+v cli=%+v", codex, cliCodex)
	}
	for i := range codex.Cost.Daily {
		if codex.Cost.Daily[i].Day != cliCodex.Cost.Daily[i].Day ||
			codex.Cost.Daily[i].TotalTokens != cliCodex.Cost.Daily[i].TotalTokens {
			t.Fatalf("disk-cache and CLI daily totals differ: cache=%+v cli=%+v",
				codex.Cost.Daily, cliCodex.Cost.Daily)
		}
	}
}

func TestLoadProviderTokenStatsFromCostCacheClaudeLayout(t *testing.T) {
	cacheRoot := t.TempDir()
	now := time.Date(2026, 7, 22, 18, 0, 0, 0, time.UTC)
	writeCostCacheFixture(t, filepath.Join(cacheRoot, "claude-v5.json"), `{
		"version":1,
		"lastScanUnixMs":1784743200000,
		"days":{"2026-07-22":{"claude-sonnet-4-6":[10,20,30,40,0,1,1,0]}}
	}`)

	stats, ok := loadProviderTokenStatsFromCostCacheAt(cacheRoot, now)
	if !ok {
		t.Fatal("expected cached token stats")
	}
	claude := stats["claude"]
	if claude.SessionTokens != 100 || claude.TotalTokens != 100 {
		t.Fatalf("unexpected cached Claude totals: %+v", claude)
	}
}

func TestLoadProviderTokenStatsFromCostCacheRejectsUnknownArtifactVersion(t *testing.T) {
	cacheRoot := t.TempDir()
	now := time.Date(2026, 7, 22, 18, 0, 0, 0, time.UTC)
	writeCostCacheFixture(t, filepath.Join(cacheRoot, "codex-v11.json"), `{
		"version":1,
		"lastScanUnixMs":1784743200000,
		"days":{"2026-07-22":{"gpt-5.6-sol":[100,80,20]}}
	}`)

	if stats, ok := loadProviderTokenStatsFromCostCacheAt(cacheRoot, now); ok {
		t.Fatalf("expected unknown Codex artifact version to be bypassed, got %#v", stats)
	}
}

func TestLoadProviderTokenStatsFromCostCacheRejectsUnknownPackedLayout(t *testing.T) {
	cacheRoot := t.TempDir()
	now := time.Date(2026, 7, 22, 18, 0, 0, 0, time.UTC)
	writeCostCacheFixture(t, filepath.Join(cacheRoot, "codex-v10.json"), `{
		"version":1,
		"lastScanUnixMs":1784743200000,
		"days":{"2026-07-22":{"gpt-5.6-sol":[100,80,20,5]}}
	}`)

	if stats, ok := loadProviderTokenStatsFromCostCacheAt(cacheRoot, now); ok {
		t.Fatalf("expected unknown Codex packed layout to be bypassed, got %#v", stats)
	}
}

func TestFetchProviderTokenStatsKeepsCostCacheAndCLIAtParity(t *testing.T) {
	resetTokenStatsTestGlobals()
	defer resetTokenStatsTestGlobals()

	diskStats := map[string]ProviderTokenStats{
		"codex": {
			SessionTokens: 120,
			WeekTokens:    120,
			TotalTokens:   120,
			Source:        "codexbar-cost-cache",
			Cost: &ProviderCostUsage{
				Last30DaysTokens: 120,
				LatestTokens:     120,
				Daily: []ProviderCostDay{
					{Day: "2026-07-22", TotalTokens: 120},
				},
			},
		},
	}
	loadProviderTokenStatsCacheFn = func(time.Time) (map[string]ProviderTokenStats, bool) {
		return copyProviderTokenStats(diskStats), true
	}

	backgroundFinished := make(chan struct{})
	runCostCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
		defer close(backgroundFinished)
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

	fromDisk, ok := fetchProviderTokenStats(context.Background(), "/tmp/CodexBarCLI")
	if !ok || fromDisk["codex"].TotalTokens != 120 {
		t.Fatalf("expected initial disk-cache total of 120, got %#v", fromDisk)
	}
	select {
	case <-backgroundFinished:
	case <-time.After(time.Second):
		t.Fatal("expected background CLI repair to finish")
	}

	var fromCLI map[string]ProviderTokenStats
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if fresh, freshOK := tokenStatsCache.loadFresh(time.Now().UTC()); freshOK &&
			fresh["codex"].Source == "local" {
			fromCLI = fresh
			break
		}
		time.Sleep(time.Millisecond)
	}
	if fromCLI["codex"].TotalTokens != fromDisk["codex"].TotalTokens {
		t.Fatalf("disk-cache and CLI totals differ: disk=%d cli=%d",
			fromDisk["codex"].TotalTokens, fromCLI["codex"].TotalTokens)
	}

	tokenStatsCache.mu.Lock()
	tokenStatsCache.fetched = time.Now().UTC().Add(-tokenStatsRefreshInterval - time.Second)
	tokenStatsCache.mu.Unlock()
	fromDiskAgain, ok := fetchProviderTokenStats(context.Background(), "/tmp/CodexBarCLI")
	if !ok || fromDiskAgain["codex"].TotalTokens != fromCLI["codex"].TotalTokens {
		t.Fatalf("expected refreshed disk-cache total to remain at CLI parity, got %#v", fromDiskAgain)
	}
}

func TestFetchProviderTokenStatsRepairsTimedOutCostScanInBackground(t *testing.T) {
	resetTokenStatsTestGlobals()
	defer resetTokenStatsTestGlobals()

	var cacheLoads atomic.Int32
	loadProviderTokenStatsCacheFn = func(time.Time) (map[string]ProviderTokenStats, bool) {
		if cacheLoads.Add(1) == 1 {
			return nil, false
		}
		return map[string]ProviderTokenStats{
			"codex": {TotalTokens: 100, Cost: &ProviderCostUsage{Last30DaysTokens: 100}},
		}, true
	}
	backgroundStarted := make(chan struct{})
	var calls atomic.Int32
	runCostCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
		if calls.Add(1) == 1 {
			return nil, context.DeadlineExceeded
		}
		close(backgroundStarted)
		return []byte(`[{"provider":"codex","updatedAt":"2026-07-22T18:00:00Z","last30DaysTokens":900,"daily":[{"date":"2026-07-22","totalTokens":900}],"totals":{"totalTokens":900}}]`), nil
	}

	stats, ok := fetchProviderTokenStats(context.Background(), "/tmp/CodexBarCLI")
	if !ok || stats["codex"].TotalTokens != 100 {
		t.Fatalf("expected immediate disk-cache fallback, got %#v", stats)
	}
	select {
	case <-backgroundStarted:
	case <-time.After(time.Second):
		t.Fatal("expected background cost repair to start")
	}

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if repaired, ok := tokenStatsCache.loadFresh(time.Now().UTC()); ok && repaired["codex"].TotalTokens == 900 {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("expected background cost repair to replace cached history")
}

func writeCostCacheFixture(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write cost cache fixture: %v", err)
	}
}

func resetTokenStatsTestGlobals() {
	runCostCommandFn = runUsageCommand
	loadProviderTokenStatsCacheFn = loadProviderTokenStatsFromCostCache
	tokenStatsCache = providerTokenStatsCache{}
	tokenStatsRepair.Lock()
	tokenStatsRepair.running = false
	tokenStatsRepair.nextAttempt = time.Time{}
	tokenStatsRepair.Unlock()
}
