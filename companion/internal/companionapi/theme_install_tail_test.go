package companionapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themeinstall"
)

// themeInstallTailServer is a Companion whose device install finishes at once
// and whose display stream refresh blocks until release is closed.
type themeInstallTailServer struct {
	server        *Server
	installCalls  atomic.Int32
	streamStarted chan struct{}
	release       chan struct{}
	releaseOnce   sync.Once
}

func newThemeInstallTailServer(t *testing.T, liveFrameShown bool) *themeInstallTailServer {
	t.Helper()
	device := newThemeInstallReadyDeviceServer(t)
	t.Cleanup(device.Close)
	tail := &themeInstallTailServer{
		server:        newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"}),
		streamStarted: make(chan struct{}, 4),
		release:       make(chan struct{}),
	}
	t.Cleanup(tail.finishFirstRefresh)
	tail.server.installTheme = func(_ context.Context, opts themeinstall.Options) (themeinstall.Result, error) {
		tail.installCalls.Add(1)
		return themeinstall.Result{ThemeID: opts.ThemeID, PackID: opts.ThemeID, Name: opts.ThemeID, LiveFrameShown: liveFrameShown}, nil
	}
	var refreshes atomic.Int32
	tail.server.refreshStream = func(context.Context, string) error {
		tail.streamStarted <- struct{}{}
		// Only the first install's refresh is held; later ones finish at once.
		if refreshes.Add(1) == 1 {
			<-tail.release
		}
		return nil
	}
	tail.server.waitStreamAfter = func(_ context.Context, target string, _ time.Time) displayStreamInfo {
		return displayStreamInfo{Healthy: true, Running: true, Target: target, LastTarget: target}
	}
	tail.server.waitRender = func(context.Context, string, string, deviceHealth) (deviceHealth, error) {
		return deviceHealth{OK: true}, nil
	}
	return tail
}

func (tail *themeInstallTailServer) finishFirstRefresh() {
	tail.releaseOnce.Do(func() { close(tail.release) })
}

func (tail *themeInstallTailServer) start(t *testing.T, themeID string) string {
	t.Helper()
	body := strings.NewReader(`{"themeId":"` + themeID + `","packUrl":"https://example.com/` + themeID + `.zip","async":true}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/themes/install", body)
	req.Header.Set("Content-Type", "application/json")
	tail.server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("start %s: expected 202, got %d body=%s", themeID, rec.Code, rec.Body.String())
	}
	var started themeInstallJobResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &started); err != nil {
		t.Fatalf("decode start response: %v", err)
	}
	return started.Job.ID
}

func (tail *themeInstallTailServer) waitForStream(t *testing.T) {
	t.Helper()
	select {
	case <-tail.streamStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("display stream refresh did not start")
	}
}

func (tail *themeInstallTailServer) waitForPhase(t *testing.T, jobID string, phase string) themeInstallJob {
	t.Helper()
	var job themeInstallJob
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); time.Sleep(5 * time.Millisecond) {
		job, _ = tail.server.installJobs.snapshot(jobID)
		if job.Phase == phase {
			return job
		}
	}
	t.Fatalf("job %s did not reach %q: %+v", jobID, phase, job)
	return job
}

// Issue #911: VibeTV showed the new theme with its usage several seconds
// before the app said Installed, because the job also waited for the display
// stream refresh. The job is complete once VibeTV confirmed the theme; the
// refresh still runs under the device lock.
func TestThemeInstallReportsInstalledOnceVibeTVShowsTheme(t *testing.T) {
	tail := newThemeInstallTailServer(t, true)
	jobID := tail.start(t, "clippy")
	tail.waitForStream(t)

	job := tail.waitForPhase(t, jobID, "complete")
	if job.Result == nil || job.Result.ThemeID != "clippy" || job.Message != "Theme is active on VibeTV." {
		t.Fatalf("unexpected completed job while the stream still refreshes: %+v", job)
	}
	if tail.server.deviceMaintenanceMu.TryLock() {
		tail.server.deviceMaintenanceMu.Unlock()
		t.Fatal("stream refresh after Installed must keep the device lock")
	}
	tail.server.firmwareUpdateStartMu.Lock()
	inFlight := tail.server.themeInstallInFlight()
	tail.server.firmwareUpdateStartMu.Unlock()
	if inFlight {
		t.Fatal("an install that reported Installed must not block other actions as still installing")
	}

	tail.finishFirstRefresh()
	for deadline := time.Now().Add(5 * time.Second); ; time.Sleep(5 * time.Millisecond) {
		if tail.server.deviceMaintenanceMu.TryLock() {
			tail.server.deviceMaintenanceMu.Unlock()
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("device lock was not released after the stream refresh")
		}
	}
	job, _ = tail.server.installJobs.snapshot(jobID)
	if job.Phase != "complete" || job.Message != "Theme is active on VibeTV." {
		t.Fatalf("stream refresh lines changed the finished job: %+v", job)
	}
}

// Without a usage frame VibeTV does not show the customer the theme with
// their usage yet, so the job keeps waiting for the stream as before.
func TestThemeInstallWithoutUsageFrameWaitsForStreamRefresh(t *testing.T) {
	tail := newThemeInstallTailServer(t, false)
	jobID := tail.start(t, "clippy")
	tail.waitForStream(t)
	time.Sleep(50 * time.Millisecond)
	if job, _ := tail.server.installJobs.snapshot(jobID); job.Phase != "installing" {
		t.Fatalf("install without a usage frame finished before the stream refresh: %+v", job)
	}
	tail.finishFirstRefresh()
	tail.waitForPhase(t, jobID, "complete")
}

// A second install pressed right after Installed waits for the first one's
// stream refresh instead of being refused.
func TestSecondThemeInstallWaitsForPreviousStreamRefresh(t *testing.T) {
	tail := newThemeInstallTailServer(t, true)
	first := tail.start(t, "clippy")
	tail.waitForStream(t)
	tail.waitForPhase(t, first, "complete")

	second := tail.start(t, "mini-classic")
	time.Sleep(50 * time.Millisecond)
	if calls := tail.installCalls.Load(); calls != 1 {
		t.Fatalf("second install reached VibeTV during the first one's stream refresh: calls=%d", calls)
	}
	if job, _ := tail.server.installJobs.snapshot(second); job.Phase != "installing" {
		t.Fatalf("waiting second install must stay installing: %+v", job)
	}

	tail.finishFirstRefresh()
	job := tail.waitForPhase(t, second, "complete")
	if job.Result == nil || job.Result.ThemeID != "mini-classic" || tail.installCalls.Load() != 2 {
		t.Fatalf("second install did not run after the wait: job=%+v calls=%d", job, tail.installCalls.Load())
	}
}

// The wait is bounded: after it the second install is refused with the same
// words as an install pressed while another one runs.
func TestSecondThemeInstallStopsWaitingAfterLimit(t *testing.T) {
	previous := themeInstallTailWaitTime
	themeInstallTailWaitTime = 50 * time.Millisecond
	t.Cleanup(func() { themeInstallTailWaitTime = previous })

	tail := newThemeInstallTailServer(t, true)
	first := tail.start(t, "clippy")
	tail.waitForStream(t)
	tail.waitForPhase(t, first, "complete")

	second := tail.start(t, "mini-classic")
	job := tail.waitForPhase(t, second, "error")
	if job.Error == nil || job.Error.Code != "theme_install_in_progress" ||
		job.Error.Message != "A theme or screensaver is already being installed." ||
		job.Error.NextAction != "Wait for it to finish, then try again." {
		t.Fatalf("unexpected refusal after the wait: %+v", job.Error)
	}
	if calls := tail.installCalls.Load(); calls != 1 {
		t.Fatalf("refused second install reached VibeTV: calls=%d", calls)
	}
}

// Issue #939: the setup log already says the theme is installed, so a stream
// refresh that fails afterwards must not add a "failed" line after it. Support
// still sees the failure in the timeline.
func TestStreamRefreshFailureAfterInstalledStaysOutOfSetupLog(t *testing.T) {
	tail := newThemeInstallTailServer(t, true)
	tail.server.refreshStream = func(context.Context, string) error {
		tail.streamStarted <- struct{}{}
		<-tail.release
		return errors.New("stream refresh failed")
	}
	jobID := tail.start(t, "clippy")
	tail.waitForStream(t)
	tail.waitForPhase(t, jobID, "complete")
	tail.finishFirstRefresh()

	for deadline := time.Now().Add(5 * time.Second); ; time.Sleep(5 * time.Millisecond) {
		if last, ok := tail.server.Timeline().Latest("theme_install"); ok && last.State == "failed" {
			if last.Reason != "display_stream_refresh_failed" {
				t.Fatalf("timeline keeps the wrong reason: %+v", last)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the failed stream refresh is missing from the support timeline")
		}
	}
	var statuses []string
	for _, event := range tail.server.setupEvents.snapshot(tail.server.currentTime()).Events {
		if event.Stage == "theme_install" {
			statuses = append(statuses, event.Status)
		}
	}
	if got := strings.Join(statuses, ","); got != "started,succeeded" {
		t.Fatalf("setup log theme_install = %s, want started,succeeded", got)
	}
	if job, _ := tail.server.installJobs.snapshot(jobID); job.Phase != "complete" || job.Error != nil {
		t.Fatalf("stream refresh failure changed the finished job: %+v", job)
	}
}
