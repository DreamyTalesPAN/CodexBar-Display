package codexbar

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// serveFixtureServer answers serve the way the recorded CodexBar build did:
// the snapshot and the usage answer of one testdata/cli directory.
func serveFixtureServer(t *testing.T, dir string) *httptest.Server {
	t.Helper()
	read := func(name string) []byte {
		raw, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		return raw
	}
	snapshot := read("serve-snapshot.json")
	usage := read("serve-usage.json")
	mux := http.NewServeMux()
	mux.HandleFunc(dashboardSnapshotPath, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(snapshot)
	})
	mux.HandleFunc(dashboardUsagePath, func(w http.ResponseWriter, r *http.Request) {
		// Windows asks per provider (?provider=...); the answer is the whole
		// list either way, as in newDashboardFetchTestServer.
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(usage)
	})
	return httptest.NewServer(mux)
}

func fetchFixtureProviders(t *testing.T, dir string) map[string]ParsedFrame {
	t.Helper()
	server := serveFixtureServer(t, dir)
	t.Cleanup(server.Close)
	providers, err := FetchDashboardProviders(context.Background(), dashboardFetchTestInfo(server), time.Date(2026, 10, 14, 8, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("fetch from %s: %v", filepath.Base(dir), err)
	}
	byID := map[string]ParsedFrame{}
	for _, provider := range providers {
		byID[provider.Provider] = provider
	}
	return byID
}

// CodexBar 0.80 sends the plan name and the extra-usage cap through serve.
// Claude has a EUR 100 monthly cap, Codex a cap of 0 (no cap), and the
// companion passes on only what CodexBar sends.
func TestPlanAndSpendFromCodexBar080Serve(t *testing.T) {
	byID := fetchFixtureProviders(t, filepath.Join("testdata", "cli", "codexbar-macos-0.80.0"))

	claude := byID["claude"]
	if claude.Meta.Plan != "Max 20x" {
		t.Fatalf("claude plan = %q, want %q", claude.Meta.Plan, "Max 20x")
	}
	if claude.Meta.Spend == nil {
		t.Fatal("claude spend missing, want the EUR 100 monthly cap")
	}
	want := ProviderSpend{Limit: 100, Used: 0, Currency: "EUR", Period: "Monthly cap"}
	if *claude.Meta.Spend != want {
		t.Fatalf("claude spend = %+v, want %+v", *claude.Meta.Spend, want)
	}

	codex := byID["codex"]
	if codex.Meta.Plan != "Pro 20x" {
		t.Fatalf("codex plan = %q, want %q", codex.Meta.Plan, "Pro 20x")
	}
	if codex.Meta.Spend != nil {
		t.Fatalf("codex spend = %+v, want none: its cap is 0", *codex.Meta.Spend)
	}
}

// The same cap in the CLI answer (usage --json) reaches the frame too.
func TestPlanAndSpendFromCodexBar080Cli(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "cli", "codexbar-macos-0.80.0", "usage-all.json"))
	if err != nil {
		t.Fatal(err)
	}
	frames, err := parseAllProviders(raw)
	if err != nil {
		t.Fatalf("parseAllProviders: %v", err)
	}
	for _, frame := range frames {
		if frame.Provider == "claude" && (frame.Meta.Spend == nil || frame.Meta.Spend.Limit != 100 || frame.Meta.Spend.Currency != "EUR") {
			t.Fatalf("claude spend from CLI = %+v, want EUR 100", frame.Meta.Spend)
		}
		if frame.Provider == "codex" && frame.Meta.Spend != nil {
			t.Fatalf("codex spend from CLI = %+v, want none", *frame.Meta.Spend)
		}
	}
}

// Win-CodexBar 0.55 sends no cap, so no spend is passed on. Its snapshot does
// name a plan for Codex, which is passed on as CodexBar sent it.
func TestPlanAndSpendOmittedOnWindowsCodexBar055(t *testing.T) {
	byID := fetchFixtureProviders(t, filepath.Join("testdata", "cli", "win-codexbar-0.55.0"))
	for id, frame := range byID {
		if frame.Meta.Spend != nil {
			t.Fatalf("%s spend = %+v, want none on Windows", id, *frame.Meta.Spend)
		}
	}
	if got := byID["codex"].Meta.Plan; got != "ChatGPT Free" {
		t.Fatalf("codex plan on Windows = %q, want the plan CodexBar sent", got)
	}
	if got := byID["claude"].Meta.Plan; got != "" {
		t.Fatalf("claude plan on Windows = %q, want none: CodexBar sent identity null", got)
	}
}

func TestProviderSpendOmittedWithoutCapOrCurrency(t *testing.T) {
	cases := map[string]map[string]any{
		"no cost":         {"usage": map[string]any{}},
		"zero limit":      {"usage": map[string]any{"providerCost": map[string]any{"limit": 0.0, "used": 0.0, "currencyCode": "EUR"}}},
		"no currency":     {"usage": map[string]any{"providerCost": map[string]any{"limit": 100.0, "used": 0.0}}},
		"limit missing":   {"usage": map[string]any{"providerCost": map[string]any{"used": 0.0, "currencyCode": "EUR"}}},
		"used missing":    {"usage": map[string]any{"providerCost": map[string]any{"limit": 100.0, "currencyCode": "EUR"}}},
		"limit NaN":       {"usage": map[string]any{"providerCost": map[string]any{"limit": "NaN", "used": 0.0, "currencyCode": "EUR"}}},
		"used Inf":        {"usage": map[string]any{"providerCost": map[string]any{"limit": 100.0, "used": "Inf", "currencyCode": "EUR"}}},
		"used unreadable": {"usage": map[string]any{"providerCost": map[string]any{"limit": 100.0, "used": "n/a", "currencyCode": "EUR"}}},
		"cost not a map":  {"usage": map[string]any{"providerCost": "EUR 100"}},
	}
	for name, payload := range cases {
		if spend, ok := parseProviderSpend(payload); ok {
			t.Fatalf("%s: spend = %+v, want none", name, spend)
		}
	}
}
