package codexbar

import (
	"slices"
	"strconv"
	"testing"
)

func TestTokenStatsArgsMatchPlatformContract(t *testing.T) {
	for _, tc := range []struct {
		platform string
		want     []string
	}{
		{"darwin", []string{"cost", "--json", "--refresh", "--days", "30"}},
		{"windows", []string{"cost", "--json", "--days", "30", "--provider", "all"}},
	} {
		if got := tokenStatsArgs(tc.platform); !slices.Equal(got, tc.want) {
			t.Fatalf("%s args = %v, want %v", tc.platform, got, tc.want)
		}
	}
}

func TestWindowsCostUnknownHistoryIsNotKnownZero(t *testing.T) {
	// Reduced from the pinned 0.56.8 VM output: padded daily zeroes do not
	// establish history coverage and must not become real zero consumption.
	raw := []byte(`[{"provider":"codex","supported":true,"spendContract":{"providerId":"codex","historyDays":30,"historyCoverageEstablished":false,"knownZero":false,"daily":[{"day":"2026-09-09","totalTokens":0,"costUsd":0}]}}]`)
	stats, err := parseProviderTokenStats(raw)
	if err != nil {
		t.Fatal(err)
	}
	got := stats["codex"]
	if !got.Unavailable || got.Cost != nil || got.TotalTokens != 0 {
		t.Fatalf("unknown history became a result: %+v", got)
	}
}

func TestWindowsCostMissingDailyTokensAreUnavailable(t *testing.T) {
	stats, err := parseProviderTokenStats([]byte(`[{"provider":"codex","supported":true,"spendContract":{"historyCoverageEstablished":true,"daily":[{"day":"2026-09-08","totalTokens":123},{"day":"2026-09-09","totalTokens":null}]}}]`))
	if err != nil {
		t.Fatal(err)
	}
	if !stats["codex"].Unavailable || stats["codex"].Cost != nil {
		t.Fatalf("missing tokens became a complete result: %+v", stats)
	}
}

func TestWindowsCostKnownHistoryUsesSpendContract(t *testing.T) {
	for _, tc := range []struct {
		name  string
		daily string
		total int64
	}{
		{"known-zero", `[]`, 0},
		{"recorded-history", `[{"day":"2026-09-09","totalTokens":123,"costUsd":0.25}]`, 123},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw := []byte(`[{"provider":"codex","supported":true,"spendContract":{"providerId":"codex","historyDays":30,"historyCoverageEstablished":true,"knownZero":` + strconv.FormatBool(tc.total == 0) + `,"daily":` + tc.daily + `}}]`)
			stats, err := parseProviderTokenStats(raw)
			if err != nil {
				t.Fatal(err)
			}
			got := stats["codex"]
			if got.Unavailable || got.Cost == nil || got.Cost.Last30DaysTokens != tc.total || got.TotalTokens != tc.total {
				t.Fatalf("known result lost: %+v", got)
			}
			if got.Cost.KnownZero != (tc.total == 0) {
				t.Fatalf("known-zero marker must follow the contract: %+v", got.Cost)
			}
		})
	}
}
