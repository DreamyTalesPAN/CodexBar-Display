package codexbar

import "context"

// Short forms of production functions that only the tests call.

func parseUsageJSON(raw []byte) (ParsedFrame, error) {
	all, err := parseAllProviders(raw)
	if err != nil {
		return ParsedFrame{}, err
	}
	if len(all) == 0 {
		return ParsedFrame{}, ErrNoProviders
	}
	return all[0], nil
}

func fetchProviderTokenStats(ctx context.Context, bin string) (map[string]ProviderTokenStats, bool) {
	stats, report := fetchProviderTokenStatsWithReport(ctx, bin, ProviderTokenStatsReport{})
	return stats, report.OK
}

func parseProviderTokenStats(raw []byte) (map[string]ProviderTokenStats, error) {
	parsed, _, err := parseProviderTokenStatsWithFailures(raw)
	return parsed, err
}
