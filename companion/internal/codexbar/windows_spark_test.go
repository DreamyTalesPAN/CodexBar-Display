package codexbar

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

// Recorded from bundled Win-CodexBar 0.56.8 on the Windows VM (2026-09-10).
// The dashboard uses camelCase while /usage uses snake_case, including extras.
func TestWindowsSparkDashboardPreservesNamedZeroWindow(t *testing.T) {
	snapshot := windowsSparkFixture(t, "snapshot")
	usage := windowsSparkFixture(t, "usage")
	for _, metadataReset := range []bool{false, true} {
		name := "dashboard-reset"
		body := string(snapshot)
		wantReset := int64(5 * 60 * 60)
		if metadataReset {
			name = "usage-reset-fallback"
			body = strings.ReplaceAll(body, `"resetAt": "2026-09-10T12:44:31Z"`, `"resetAt": null`)
			wantReset++
		}
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer test-token" {
					http.Error(w, "unauthorized", http.StatusUnauthorized)
					return
				}
				switch r.URL.Path {
				case dashboardSnapshotPath:
					_, _ = w.Write([]byte(body))
				case dashboardUsagePath:
					_, _ = w.Write(usage)
				default:
					http.NotFound(w, r)
				}
			}))
			defer server.Close()
			parsed, err := FetchDashboardProviders(context.Background(), dashboardFetchTestInfo(server), time.Date(2026, 9, 10, 7, 44, 31, 0, time.UTC))
			if err != nil || len(parsed) != 1 {
				t.Fatalf("fetch: providers=%d err=%v", len(parsed), err)
			}
			assertWindowsSpark(t, parsed[0])
			if got := parsed[0].Frame.UsageWindows[1].ResetSec; got != wantReset {
				t.Fatalf("Spark reset = %d, want %d", got, wantReset)
			}
		})
	}
}

func TestWindowsSparkCLIUsagePreservesNamedZeroWindow(t *testing.T) {
	parsed, err := parseAllProviders(windowsSparkFixture(t, "usage"))
	if err != nil || len(parsed) != 1 {
		t.Fatalf("parse: providers=%d err=%v", len(parsed), err)
	}
	assertWindowsSpark(t, parsed[0])
}

func windowsSparkFixture(t *testing.T, kind string) []byte {
	t.Helper()
	raw, err := os.ReadFile("testdata/windows-spark-" + kind + ".json")
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func assertWindowsSpark(t *testing.T, parsed ParsedFrame) {
	t.Helper()
	meta, frame := parsed.Meta.Windows, parsed.Frame.UsageWindows
	if parsed.Frame.UsageUnavailable || len(meta) != 2 || len(frame) != 2 {
		t.Fatalf("expected only Weekly and Spark, metadata=%+v frame=%+v", meta, frame)
	}
	if meta[0].Label != "Weekly" || meta[0].UsedPercent != 32 || meta[0].WindowMinutes != 10080 ||
		meta[1].ID != "codex-spark" || meta[1].Label != "Codex Spark 5-hour" || meta[1].UsedPercent != 0 || meta[1].WindowMinutes != 300 {
		t.Fatalf("quota identity/value/duration changed: %+v", meta)
	}
	if frame[0].Label != "Weekly" || frame[0].Percent != 32 || frame[1].ID != "codex-spark" || frame[1].Percent != 0 {
		t.Fatalf("display windows differ: %+v", frame)
	}
}
