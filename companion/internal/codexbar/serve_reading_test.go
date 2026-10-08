package codexbar

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	dashboardusage "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar/dashboard"
)

// serveReadingEngine is a Windows engine whose inventory has Claude and Codex
// switched on. It returns the command line of every CLI process a check
// starts; each usage probe answers with a healthy provider.
func serveReadingEngine(t *testing.T, perProvider bool, inventory string) *[]string {
	t.Helper()
	settledEngine(t)
	setExistingConfig(t)
	forgetServeUsage()
	t.Cleanup(forgetServeUsage)
	originalMode := providerProbePerProvider
	originalProvider, originalUsage := runProviderCommandFn, runUsageCommandFn
	t.Cleanup(func() {
		providerProbePerProvider = originalMode
		runProviderCommandFn, runUsageCommandFn = originalProvider, originalUsage
	})
	providerProbePerProvider = perProvider
	var mu sync.Mutex
	var started []string
	run := func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		mu.Lock()
		started = append(started, strings.Join(args, " "))
		mu.Unlock()
		if args[0] == "config" {
			return []byte(inventory), nil
		}
		return []byte(`[{"provider":"claude","usage":{"primary":{"usedPercent":8}}},{"provider":"codex","usage":{"primary":{"usedPercent":3}}}]`), nil
	}
	runProviderCommandFn, runUsageCommandFn = run, run
	return &started
}

const claudeAndCodexOn = `[
	{"provider":"claude","displayName":"Claude","enabled":true},
	{"provider":"codex","displayName":"Codex","enabled":true},
	{"provider":"gemini","displayName":"Gemini","enabled":false}
]`

// collectFromServe is one collection: serve lists Claude with a reading and
// Codex with the failure the engine reported for it.
func collectFromServe(t *testing.T) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case dashboardSnapshotPath:
			_, _ = w.Write([]byte(`{"schemaVersion":1,"providers":[
				{"id":"claude","name":"Claude","windows":[{"kind":"session","label":"Session","usedPercent":8}],"error":null},
				{"id":"codex","name":"Codex","windows":[],"error":{"message":"authentication expired"}}
			]}`))
		case dashboardUsagePath:
			_, _ = w.Write([]byte(`[
				{"provider":"claude","source":"oauth","usage":{"primary":{"usedPercent":8,"windowMinutes":300}}},
				{"provider":"codex","error":"authentication expired for someone@example.com"}
			]`))
		}
	}))
	defer server.Close()
	frames, err := FetchDashboardProviders(context.Background(), dashboardFetchTestInfo(server), time.Now())
	if err != nil || len(frames) != 2 || frames[0].Frame.UsageUnavailable || !frames[1].Frame.UsageUnavailable {
		t.Fatalf("collection: frames=%+v err=%v", frames, err)
	}
}

func usageProbes(started []string) []string {
	var probes []string
	for _, line := range started {
		if strings.HasPrefix(line, "usage ") {
			probes = append(probes, line)
		}
	}
	return probes
}

// With the window open the status poll and the settings poll each started a
// usage call for every switched-on provider every 30 s, next to the reading
// serve had just delivered for the same providers (#555). Each of those calls
// counted against the provider's rate limit like the real one.
func TestOpenWindowPollsStartNoUsageProbeWhileServeDelivers(t *testing.T) {
	for name, perProvider := range map[string]bool{"Windows": true, "Mac": false} {
		t.Run(name, func(t *testing.T) {
			started := serveReadingEngine(t, perProvider, claudeAndCodexOn)
			collectFromServe(t)
			poll := WithServeReading(context.Background())

			for range 5 {
				settings, err := FetchProviderSettings(poll)
				if err != nil || len(settings) != 3 {
					t.Fatalf("settings=%+v err=%v", settings, err)
				}
				if settings[0].Health != ProviderHealthHealthy {
					t.Fatalf("a provider serve reads must be healthy: %+v", settings[0])
				}
				// The failure serve reported is the row's state, with the
				// engine's own sentence.
				if settings[1].Health != ProviderHealthAuthRequired || !strings.Contains(settings[1].Reported, "authentication expired") {
					t.Fatalf("a provider serve cannot read must show its failure: %+v", settings[1])
				}
				setup := ProbeProviderSetup(poll, t.TempDir())
				if setup.Status != ProviderReady || len(setup.Providers) != 2 ||
					setup.Providers[0].ID != "claude" || setup.Providers[0].Status != ProviderReady ||
					setup.Providers[1].ID != "codex" || setup.Providers[1].Status != ProviderAuthRequired {
					t.Fatalf("setup status from serve's reading: %+v", setup)
				}
			}
			if probes := usageProbes(*started); len(probes) != 0 {
				t.Fatalf("five polls started %d usage probes, want 0: %q", len(probes), probes)
			}
			// Windows keeps the inventory too, so nothing is left to start.
			if perProvider && len(*started) != 1 {
				t.Fatalf("five polls started %d engine processes, want the one inventory read: %q", len(*started), *started)
			}
		})
	}
}

func TestProviderCheckAsksTheCLIWheneverServeDoesNotAnswerForIt(t *testing.T) {
	poll := WithServeReading(context.Background())
	checks := func(t *testing.T, ctx context.Context, started *[]string, why string) {
		t.Helper()
		*started = nil
		if _, err := FetchProviderSettings(ctx); err != nil {
			t.Fatal(err)
		}
		if len(usageProbes(*started)) == 0 {
			t.Fatalf("%s: the settings check started no usage probe", why)
		}
		*started = nil
		ProbeProviderSetup(ctx, t.TempDir())
		if len(usageProbes(*started)) == 0 {
			t.Fatalf("%s: the setup check started no usage probe", why)
		}
	}
	for name, perProvider := range map[string]bool{"Windows": true, "Mac": false} {
		t.Run(name, func(t *testing.T) {
			started := serveReadingEngine(t, perProvider, claudeAndCodexOn)
			checks(t, poll, started, "before serve was read")

			collectFromServe(t)
			checks(t, context.Background(), started, "a check the customer started")

			serveUsage.mu.Lock()
			serveUsage.at = time.Now().Add(-serveUsage.maxAge - time.Second)
			serveUsage.mu.Unlock()
			checks(t, poll, started, "a reading serve has not renewed")

			collectFromServe(t)
			down := DashboardServeInfo{Endpoint: "http://127.0.0.1:1", Token: "t"}
			if _, err := FetchDashboardProviders(context.Background(), down, time.Now()); err == nil {
				t.Fatal("a stopped serve was read")
			}
			checks(t, poll, started, "after a serve read that failed")

			collectFromServe(t)
			if err := SetProviderEnabled(context.Background(), "gemini", true); err != nil {
				t.Fatal(err)
			}
			checks(t, poll, started, "after a provider was switched")
		})
	}
}

// The item serve gives must say what the collector made of it; otherwise it
// is no reading and the CLI is asked.
func TestServeItemThatContradictsTheCollectorIsNoReading(t *testing.T) {
	claude := dashboardusage.DashboardProvider{ID: "claude"}
	// The collector read windows; the probe parser would call this "no usage".
	if item, ok := serveUsageItem(claude, map[string]any{"provider": "claude", "usage": map[string]any{}}, true); ok {
		t.Fatalf("an item without the usage the collector read became a reading: %s", item)
	}
	if item, ok := serveUsageItem(claude, nil, false); ok {
		t.Fatalf("a provider serve gave no item for became a reading: %s", item)
	}
}

// Serve may still list the providers from before a switch: its own settings
// read comes later, and a collection can be under way while the customer
// switches. The setup check then lacked the new provider and started no probe
// for it on the Mac, where it took serve's list for the switched-on set.
func TestProviderSwitchedOnIsProbedWhileServeStillListsTheOldSet(t *testing.T) {
	geminiOn := strings.Replace(claudeAndCodexOn, `"Gemini","enabled":false`, `"Gemini","enabled":true`, 1)
	for name, perProvider := range map[string]bool{"Windows": true, "Mac": false} {
		t.Run(name, func(t *testing.T) {
			started := serveReadingEngine(t, perProvider, geminiOn)
			collectFromServe(t)
			poll := WithServeReading(context.Background())

			if _, err := FetchProviderSettings(poll); err != nil {
				t.Fatal(err)
			}
			if len(usageProbes(*started)) == 0 {
				t.Fatal("the provider rows were answered without the provider that was switched on")
			}
			*started = nil
			ProbeProviderSetup(poll, t.TempDir())
			if len(usageProbes(*started)) == 0 {
				t.Fatal("the setup status was answered without the provider that was switched on")
			}
		})
	}
}

// A serve read that began before a provider switch ends after it and must not
// bring back the answer the switch ended.
func TestServeReadUnderWayDuringAProviderSwitchIsNoReading(t *testing.T) {
	serveReadingEngine(t, true, claudeAndCodexOn)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == dashboardSnapshotPath {
			_, _ = w.Write([]byte(`{"schemaVersion":1,"providers":[{"id":"claude","windows":[{"kind":"session","label":"Session","usedPercent":8}]}]}`))
			return
		}
		forgetServeUsage() // the switch, while serve is answering
		_, _ = w.Write([]byte(`[{"provider":"claude","usage":{"primary":{"usedPercent":8,"windowMinutes":300}}}]`))
	}))
	defer server.Close()
	if _, err := FetchDashboardProviders(context.Background(), dashboardFetchTestInfo(server), time.Now()); err != nil {
		t.Fatal(err)
	}
	if answer, ok := serveUsageAnswer(WithServeReading(context.Background()), []ProviderSetting{{ID: "claude", Enabled: true}}); ok {
		t.Fatalf("a reading from before the switch stood in for a probe: %s", answer)
	}
}

// A serve that still answers while its data stopped refreshing hours ago said
// "ready" for as long as it was read: the reading was dated by the read, not
// by the snapshot.
func TestSnapshotServeNoLongerRefreshesIsNoReading(t *testing.T) {
	started := serveReadingEngine(t, false, `[{"provider":"claude","displayName":"Claude","enabled":true}]`)
	generated := time.Now().Add(-3 * time.Hour).UTC().Format(time.RFC3339)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == dashboardSnapshotPath {
			_, _ = w.Write([]byte(`{"schemaVersion":1,"generatedAt":"` + generated + `","staleAfterSeconds":180,"providers":[
				{"id":"claude","windows":[{"kind":"session","label":"Session","usedPercent":8}]}]}`))
			return
		}
		_, _ = w.Write([]byte(`[{"provider":"claude","usage":{"primary":{"usedPercent":8,"windowMinutes":300}}}]`))
	}))
	defer server.Close()
	if _, err := FetchDashboardProviders(context.Background(), dashboardFetchTestInfo(server), time.Now()); err != nil {
		t.Fatal(err)
	}
	ProbeProviderSetup(WithServeReading(context.Background()), t.TempDir())
	if len(usageProbes(*started)) == 0 {
		t.Fatal("a snapshot generated three hours ago answered the setup check without a probe")
	}
}

// The age of a reading is wall-clock time. Go's monotonic clock stands still
// while the Mac sleeps, so a reading from before the sleep counted as current
// after waking up.
func TestServeReadingAgeCountsTheTimeTheComputerSlept(t *testing.T) {
	serveReadingEngine(t, true, claudeAndCodexOn)
	collectFromServe(t) // its snapshot names no time, so the read dates it
	serveUsage.mu.Lock()
	defer serveUsage.mu.Unlock()
	if serveUsage.at.IsZero() || serveUsage.at != serveUsage.at.Round(0) {
		t.Fatalf("the reading is dated on the monotonic clock: %v", serveUsage.at)
	}
}

// The collector does not read a serve that is not running, so nothing ended
// the reading when serve stopped or the engine was repaired: it answered the
// checks for up to its full age.
func TestStoppedServeLeavesNoReading(t *testing.T) {
	serveReadingEngine(t, true, claudeAndCodexOn)
	supervisor, err := NewDashboardServeSupervisor(DashboardServeConfig{Binary: "codexbar-cli"})
	if err != nil {
		t.Fatal(err)
	}
	collectFromServe(t)
	supervisor.setStopped("", errors.New("exit status 1"))
	if answer, ok := serveUsageAnswer(WithServeReading(context.Background()), []ProviderSetting{{ID: "claude", Enabled: true}}); ok {
		t.Fatalf("the reading of a stopped serve stood in for a probe: %s", answer)
	}
}
