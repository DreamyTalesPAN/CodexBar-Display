package companionapi

import (
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Pins the job routes that read the firmware-update and theme-install job
// stores: create, get by id, status transitions, unknown id, latest job.
func TestJobStatusRoutes(t *testing.T) {
	type store struct {
		route      string
		missingErr string
		unknownErr string
		idPrefix   string
		create     func(*Server) string
		advance    func(*Server, string)
		wantNew    string
		wantDone   string
	}
	stores := map[string]store{
		"firmware update": {
			route:      "/v1/updates/install/status",
			missingErr: `"code":"missing_update_job"`,
			unknownErr: `"code":"update_job_not_found"`,
			idPrefix:   "firmware-update-",
			create:     func(s *Server) string { return s.createFirmwareUpdateJob().ID },
			advance: func(s *Server, id string) {
				s.updateJobs.update(id, func(j *firmwareUpdateJob) { j.Phase = "complete"; j.Progress = 100 })
			},
			wantNew:  `"phase":"installing","stage":"validating_artifact","message":"Preparing VibeTV update.","progress":5`,
			wantDone: `"phase":"complete","stage":"validating_artifact","message":"Preparing VibeTV update.","progress":100`,
		},
		"theme install": {
			route:      "/v1/themes/install/status",
			missingErr: `"code":"missing_install_job"`,
			unknownErr: `"code":"install_job_not_found"`,
			idPrefix:   "theme-install-",
			create:     func(s *Server) string { return s.createThemeInstallJob(themeInstallRequest{ThemeID: "mini"}).ID },
			advance: func(s *Server, id string) {
				s.installJobs.update(id, func(j *themeInstallJob) { j.Phase = "complete"; j.Progress = 100 })
			},
			wantNew:  `"phase":"installing","message":"Preparing theme install.","progress":5`,
			wantDone: `"phase":"complete","message":"Preparing theme install.","progress":100`,
		},
	}
	get := func(s *Server, url string) (int, string) {
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, url, nil))
		return rec.Code, rec.Body.String()
	}
	for name, st := range stores {
		t.Run(name, func(t *testing.T) {
			server := newTestServer(t, runtimeconfig.Config{})
			if code, body := get(server, st.route); code != http.StatusBadRequest || !strings.Contains(body, st.missingErr) {
				t.Fatalf("missing id: %d %s", code, body)
			}
			if code, body := get(server, st.route+"?jobId=nope"); code != http.StatusNotFound || !strings.Contains(body, st.unknownErr) {
				t.Fatalf("unknown id: %d %s", code, body)
			}
			first := st.create(server)
			time.Sleep(2 * time.Millisecond)
			second := st.create(server)
			if first == second || !strings.HasPrefix(first, st.idPrefix) || !strings.HasPrefix(second, st.idPrefix) {
				t.Fatalf("ids: %q %q", first, second)
			}
			code, body := get(server, st.route+"?jobId="+first)
			if code != http.StatusOK || !strings.Contains(body, `"ok":true,"job":{"id":"`+first+`",`) || !strings.Contains(body, st.wantNew) {
				t.Fatalf("new job: %d %s", code, body)
			}
			st.advance(server, first)
			if _, body = get(server, st.route+"?jobId="+first); !strings.Contains(body, st.wantDone) {
				t.Fatalf("advanced job: %s", body)
			}
			if _, body = get(server, st.route+"?jobId="+second); !strings.Contains(body, st.wantNew) {
				t.Fatalf("second job changed: %s", body)
			}
			// Jobs are never evicted: the first one is still readable.
			if code, _ = get(server, st.route+"?jobId="+first); code != http.StatusOK {
				t.Fatalf("first job gone: %d", code)
			}
		})
	}
}

func TestJobStoreLatestAndActive(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	if _, ok := server.updateJobs.latest(); ok {
		t.Fatal("empty store reported a latest update job")
	}
	if _, ok := server.installJobs.latest(); ok {
		t.Fatal("empty store reported a latest install job")
	}
	first := server.createFirmwareUpdateJob()
	time.Sleep(2 * time.Millisecond)
	second := server.createFirmwareUpdateJob()
	if got, ok := server.updateJobs.latest(); !ok || got.ID != second.ID {
		t.Fatalf("latest update job = %q, want %q", got.ID, second.ID)
	}
	server.updateJobs.update(second.ID, func(j *firmwareUpdateJob) { j.Phase = "complete" })
	if got, ok := server.activeFirmwareUpdateJob(); !ok || got.ID != first.ID {
		t.Fatalf("active update job = %q, want %q", got.ID, first.ID)
	}
	server.updateJobs.update(first.ID, func(j *firmwareUpdateJob) { j.Phase = "error" })
	if _, ok := server.activeFirmwareUpdateJob(); ok {
		t.Fatal("no job is installing, yet one is active")
	}
	themeFirst := server.createThemeInstallJob(themeInstallRequest{ThemeID: "a"})
	time.Sleep(2 * time.Millisecond)
	themeSecond := server.createThemeInstallJob(themeInstallRequest{ThemeID: "b", Slot: "screensaver"})
	if got, ok := server.installJobs.latest(); !ok || got.ID != themeSecond.ID || got.Slot != "screensaver" || themeFirst.Slot != "live" {
		t.Fatalf("latest install job = %+v first slot %q", got, themeFirst.Slot)
	}
	// A snapshot is a copy: editing it never reaches the stored job.
	snap, _ := server.updateJobs.snapshot(first.ID)
	snap.Logs = append(snap.Logs, "x")
	snap.Phase = "mutated"
	if again, _ := server.updateJobs.snapshot(first.ID); again.Phase != "error" || len(again.Logs) != 1 {
		t.Fatalf("snapshot aliases the stored job: %+v", again)
	}
}
