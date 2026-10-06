package companionapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/timeline"
)

func incompatibleEngineSetup() codexbar.ProviderSetup {
	return codexbar.ProviderSetup{
		Status: "setup_required",
		Engine: codexbar.EngineReadiness{
			Status: codexbar.ProviderEngineIncompatible, Version: "0.17", MinimumVersion: "0.23",
			Path: "/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI", Source: "system",
		},
		Providers: []codexbar.ProviderReadiness{{
			ID: "codexbar", Label: "Usage service", Status: codexbar.ProviderEngineIncompatible,
			Detail:     "Usage engine 0.17 is too old. Version 0.23 or newer is required.",
			NextAction: "Repair the usage engine, then check again.",
		}},
	}
}

func getSetupLog(t *testing.T, server *Server) setupLog {
	t.Helper()
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/setup/events", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("setup events: %d %s", rec.Code, rec.Body.String())
	}
	var got setupLog
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	return got
}

func assertNoEngineName(t *testing.T, log setupLog) {
	t.Helper()
	for _, event := range log.Events {
		if strings.Contains(event.Message+event.NextAction, "CodexBar") {
			t.Fatalf("setup event leaked the engine name: %+v", event)
		}
	}
}

func TestSetupEventLogBoundsAndCountsDroppedEvents(t *testing.T) {
	var log setupEventLog
	now := time.Date(2026, 9, 24, 10, 0, 0, 0, time.UTC)
	for i := 1; i <= setupEventLimit+5; i++ {
		log.record(now, setupEvent{Stage: "device_search", Status: "failed", Message: fmt.Sprintf("Attempt %d failed.", i)})
	}
	got := log.snapshot(now)
	if len(got.Events) != setupEventLimit || !got.Truncated || got.Dropped != 5 {
		t.Fatalf("unexpected bounds: len=%d truncated=%v dropped=%d", len(got.Events), got.Truncated, got.Dropped)
	}
	if got.Events[0].Seq != 6 || got.Events[len(got.Events)-1].Seq != setupEventLimit+5 {
		t.Fatalf("events must stay oldest to newest: first=%d last=%d", got.Events[0].Seq, got.Events[len(got.Events)-1].Seq)
	}
}

func TestSetupEventLogCompactsRepeats(t *testing.T) {
	var log setupEventLog
	start := time.Date(2026, 9, 24, 10, 0, 0, 0, time.UTC)
	started := setupEvent{Stage: "device_search", Status: "started", Message: "Searching for VibeTV."}
	failed := setupEvent{Stage: "device_search", Status: "failed", Message: "No VibeTV found.", Code: "vibetv_not_found"}
	for i := 0; i < 3; i++ {
		log.record(start.Add(time.Duration(i)*time.Minute), started)
		log.record(start.Add(time.Duration(i)*time.Minute), failed)
	}
	log.record(start.Add(5*time.Minute), failed)
	got := log.snapshot(start)
	if len(got.Events) != 2 || got.Events[0].Count != 3 || got.Events[1].Count != 4 {
		t.Fatalf("repeats were not compacted: %+v", got.Events)
	}
	if got.Events[1].At != start.Add(5*time.Minute).Format(time.RFC3339) {
		t.Fatalf("compaction must move at forward: %+v", got.Events[1])
	}
}

func TestSetupEventLogRedactsSecrets(t *testing.T) {
	var log setupEventLog
	log.record(time.Now(), setupEvent{Stage: "device_pair", Status: "failed", Message: "GET http://user:pw@192.168.1.5/health?token=s3cr3t-token failed"})
	got := log.snapshot(time.Now())
	if strings.Contains(got.Events[0].Message, "s3cr3t-token") || strings.Contains(got.Events[0].Message, "user:pw") {
		t.Fatalf("secret leaked: %q", got.Events[0].Message)
	}
}

func TestSetupEventsEndpointShapeAndSessionReset(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/setup/events", nil))
	var raw map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"ok", "sessionId", "startedAt", "events", "truncated", "dropped"} {
		if _, ok := raw[key]; !ok {
			t.Fatalf("missing %q in %s", key, rec.Body.String())
		}
	}
	if events, ok := raw["events"].([]any); !ok || len(events) != 0 {
		t.Fatalf("a fresh session must return an empty list: %s", rec.Body.String())
	}

	server.recordSetupEvent(setupEvent{Stage: "device_search", Status: "started", Message: "Searching for VibeTV."})
	before := getSetupLog(t, server)
	reset := httptest.NewRecorder()
	server.Handler().ServeHTTP(reset, httptest.NewRequest(http.MethodPost, "/v1/setup/reset", nil))
	if reset.Code != http.StatusOK {
		t.Fatalf("reset: %d %s", reset.Code, reset.Body.String())
	}
	after := getSetupLog(t, server)
	if after.SessionID == "" || after.SessionID == before.SessionID {
		t.Fatalf("reset must start a new session: before=%q after=%q", before.SessionID, after.SessionID)
	}
	if len(after.Events) != 1 || after.Events[0].Stage != "setup_reset" || after.Events[0].Status != "started" ||
		after.Events[0].Message != "New setup session started." || after.Events[0].Seq != 1 {
		t.Fatalf("unexpected reset session: %+v", after.Events)
	}
	if _, err := time.Parse(time.RFC3339, after.Events[0].At); err != nil {
		t.Fatalf("event time is not RFC3339: %v", err)
	}
}

func TestSetupEventsRecordFailedStepWithApiErrorCode(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/device/search", strings.NewReader(`{"target":"http://user:pw@bad/path?token=abc"}`)))
	got := getSetupLog(t, server)
	if len(got.Events) != 2 || got.Events[0].Status != "started" || got.Events[1].Status != "failed" ||
		got.Events[1].Code != "invalid_device_target" || got.Events[1].NextAction == "" {
		t.Fatalf("unexpected search events: %+v (%s)", got.Events, rec.Body.String())
	}
	if strings.Contains(fmt.Sprint(got.Events), "pw@") || strings.Contains(fmt.Sprint(got.Events), "token=abc") {
		t.Fatalf("request data leaked into the setup log: %+v", got.Events)
	}

	// Status polls are never logged.
	server.Handler().ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/v1/status", nil))
	if again := getSetupLog(t, server); len(again.Events) != 2 {
		t.Fatalf("a status poll was logged: %+v", again.Events)
	}
}

func TestProviderRetryLogsIncompatibleEngineOnce(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.probeProviderSetup = func(context.Context, string) codexbar.ProviderSetup { return incompatibleEngineSetup() }
	for i := 0; i < 2; i++ {
		rec := httptest.NewRecorder()
		server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/providers/retry", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("retry: %d %s", rec.Code, rec.Body.String())
		}
	}
	got := getSetupLog(t, server)
	if len(got.Events) != 2 {
		t.Fatalf("expected one engine and one compacted provider event: %+v", got.Events)
	}
	engine, provider := got.Events[0], got.Events[1]
	if engine.Stage != "usage_engine" || engine.Status != "failed" || engine.Code != codexbar.ProviderEngineIncompatible ||
		engine.Message != "Usage engine 0.17 is too old. Version 0.23 or newer is required." ||
		engine.NextAction != "Repair the usage engine, then check again." {
		t.Fatalf("unexpected engine event: %+v", engine)
	}
	if provider.Stage != "provider_check" || provider.Code != codexbar.ProviderEngineIncompatible || provider.Count != 2 {
		t.Fatalf("unexpected provider event: %+v", provider)
	}
	assertNoEngineName(t, got)
}

// The setup log names every customer choice on the provider steps: each
// switch, the check that follows turning a provider on, and the display mode.
func TestSetupLogRecordsProviderChoicesChecksAndDisplayMode(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	enabled := map[string]bool{"codex": true, "claude": false}
	server.providerPreferences.load = func(context.Context) ([]codexbar.ProviderSetting, error) {
		return []codexbar.ProviderSetting{
			{ID: "codex", Label: "Codex", Enabled: enabled["codex"], Health: codexbar.ProviderHealthHealthy},
			{ID: "claude", Label: "Claude", Enabled: enabled["claude"], Health: codexbar.ProviderHealthChecking},
		}, nil
	}
	server.providerPreferences.set = func(_ context.Context, id string, value bool) error {
		enabled[id] = value
		return nil
	}
	probeDone := make(chan struct{})
	server.probeExactProvider = func(_ context.Context, _ string, id string) codexbar.ProviderSetup {
		defer close(probeDone)
		return codexbar.ProviderSetup{Status: "setup_required", Providers: []codexbar.ProviderReadiness{{
			ID: id, Label: "Claude", Status: codexbar.ProviderAuthRequired,
			Detail: "This provider needs an active sign-in.", NextAction: "Open provider setup, sign in again, then check this provider.",
		}}}
	}
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) { return daemon.PersistedUsage{}, false }

	patch := func(path, body string) int {
		rec := httptest.NewRecorder()
		server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPatch, path, strings.NewReader(body)))
		return rec.Code
	}
	if code := patch("/v1/preferences/codexbar.providers.claude.enabled", `{"value":true}`); code != http.StatusOK {
		t.Fatalf("turn on: %d", code)
	}
	select {
	case <-probeDone:
	case <-time.After(time.Second):
		t.Fatal("provider check did not run")
	}
	deadline := time.Now().Add(time.Second)
	for len(getSetupLog(t, server).Events) < 2 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if code := patch("/v1/provider-display", `{"mode":"fixed","providerIds":["claude","codex"]}`); code != http.StatusConflict {
		t.Fatalf("invalid display: %d", code)
	}
	if code := patch("/v1/provider-display", `{"mode":"fixed","providerIds":["codex"]}`); code != http.StatusOK {
		t.Fatalf("fixed display: %d", code)
	}
	if code := patch("/v1/preferences/codexbar.providers.claude.enabled", `{"value":false}`); code != http.StatusOK {
		t.Fatalf("turn off: %d", code)
	}
	if code := patch("/v1/provider-display", `{"mode":"automatic","providerIds":["codex"]}`); code != http.StatusOK {
		t.Fatalf("automatic display: %d", code)
	}

	want := []setupEvent{
		{Stage: "provider_choice", Status: "succeeded", Message: "Claude turned on."},
		{Stage: "provider_check", Status: "failed", Message: "Claude: This provider needs an active sign-in.", Code: codexbar.ProviderAuthRequired, NextAction: "Open provider setup, sign in again, then check this provider."},
		{Stage: "display_mode", Status: "failed", Message: "Always show needs one provider.", Code: "provider_display_fixed_invalid", NextAction: "Choose exactly one provider to show."},
		{Stage: "display_mode", Status: "succeeded", Message: "Always show Codex."},
		{Stage: "provider_choice", Status: "succeeded", Message: "Claude turned off."},
		{Stage: "display_mode", Status: "succeeded", Message: "Automatic: VibeTV switches between your providers."},
	}
	got := getSetupLog(t, server).Events
	if len(got) != len(want) {
		t.Fatalf("unexpected setup log: %+v", got)
	}
	for i := range want {
		g := got[i]
		if g.Stage != want[i].Stage || g.Status != want[i].Status || g.Message != want[i].Message || g.Code != want[i].Code || g.NextAction != want[i].NextAction {
			t.Fatalf("event %d: got %+v want %+v", i, g, want[i])
		}
	}
}

func TestProviderCheckLogsReadyProviderByName(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.recordProviderSetupEvents(codexbar.ProviderSetup{Status: codexbar.ProviderReady, Providers: []codexbar.ProviderReadiness{{ID: "codex", Label: "Codex", Status: codexbar.ProviderReady}}}, "Codex")
	got := getSetupLog(t, server).Events
	if len(got) != 1 || got[0].Stage != "provider_check" || got[0].Status != "succeeded" || got[0].Message != "Codex is ready." {
		t.Fatalf("unexpected ready event: %+v", got)
	}
}

func TestRepairIsLoggedAsDoneOnlyWhenPaired(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.recordRepairResult(deviceInfo{Paired: false})
	server.recordRepairResult(deviceInfo{Paired: true})
	got := getSetupLog(t, server).Events
	if len(got) != 2 || got[0].Status != "started" || got[0].Message != "Waiting for VibeTV to finish pairing." ||
		got[1].Status != "succeeded" || got[1].Message != "VibeTV connection repaired." {
		t.Fatalf("unexpected repair events: %+v", got)
	}
}

// A too-old engine puts its own row first; the check still names the provider
// the customer asked about.
func TestProviderRetryNamesRequestedProviderWhenEngineIsTooOld(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.probeExactProvider = func(_ context.Context, _ string, id string) codexbar.ProviderSetup {
		setup := incompatibleEngineSetup()
		exact := setup.Providers[0]
		exact.ID, exact.Label = id, "Claude"
		setup.Providers = append(setup.Providers, exact)
		return setup
	}
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/providers/retry?provider=claude", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("retry: %d %s", rec.Code, rec.Body.String())
	}
	got := getSetupLog(t, server).Events
	if len(got) != 2 || got[1].Stage != "provider_check" || !strings.HasPrefix(got[1].Message, "Claude: ") {
		t.Fatalf("provider check lost the requested provider: %+v", got)
	}
	assertNoEngineName(t, getSetupLog(t, server))
}

func TestDiagnosticsIncludesUsageEngineAndSetupLog(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.probeProviderSetup = func(context.Context, string) codexbar.ProviderSetup { return incompatibleEngineSetup() }
	server.recordSetupEvent(setupEvent{Stage: "device_search", Status: "succeeded", Message: "Found 1 VibeTV."})
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/diagnostics", nil))
	var got diagnosticsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	want := diagnosticsUsageEngine{
		Name: "CodexBar", Status: codexbar.ProviderEngineIncompatible, Version: "0.17", MinimumVersion: "0.23",
		Source: "system", Path: "/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI",
	}
	if got.SchemaVersion != 2 || got.UsageEngine != want {
		t.Fatalf("unexpected usageEngine: %+v", got.UsageEngine)
	}
	if got.SetupLog.SessionID == "" || len(got.SetupLog.Events) != 1 || got.SetupLog.Events[0].Message != "Found 1 VibeTV." {
		t.Fatalf("unexpected setupLog: %+v", got.SetupLog)
	}
	var engineCheck *diagnosticCheck
	for i := range got.Checks {
		if got.Checks[i].Name == "usage_engine" {
			engineCheck = &got.Checks[i]
		}
	}
	if engineCheck == nil || engineCheck.Status != "fail" || engineCheck.ErrorCode != codexbar.ProviderEngineIncompatible ||
		engineCheck.NextAction == "" || strings.Contains(engineCheck.Detail+engineCheck.NextAction, "CodexBar") {
		t.Fatalf("unexpected usage_engine check: %+v", engineCheck)
	}
	if !hasDiagnosticCheck(got.Checks, "provider_setup", "attention") {
		t.Fatalf("provider_setup check must stay: %+v", got.Checks)
	}
}

// The support report's timeline is the setup steps, update phases and resets
// as bare transitions: codes and states, never the customer-facing wording.
func TestDiagnosticsTimelineHoldsSetupAndUpdateTransitions(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.probeProviderSetup = func(context.Context, string) codexbar.ProviderSetup { return incompatibleEngineSetup() }
	server.recordSetupEvent(setupEvent{Stage: "device_pair", Status: "started", Message: "Pairing with VibeTV."})
	for i := 0; i < 3; i++ {
		server.recordSetupEvent(setupEvent{Stage: "device_pair", Status: "failed", Message: "http://192.168.178.40/pair?token=abc123 refused", Code: "pairing_token_rejected", NextAction: "Pair again."})
	}
	server.recordSetupEvent(setupEvent{Stage: "device_pair", Status: "succeeded", Message: "VibeTV paired."})
	for _, stage := range []string{"validating_artifact", "uploading", "uploading", "rebooting"} {
		server.applyFirmwareUpdateEvent("job-1", firmwareUpdateEvent{Stage: stage, DeviceID: "vibetv-8caab5", Target: "http://192.168.178.40/?token=abc123"})
	}
	server.applyFirmwareUpdateEvent("job-1", firmwareUpdateEvent{Stage: "verified", Outcome: "updated", DeviceID: "vibetv-8caab5"})
	job := server.createMacAppUpdateJob(macAppUpdateRequest{Version: "2.0.0"})
	server.updateMacAppUpdateJob(job.ID, func(job *macAppUpdateJob) { job.Progress = 40 })
	server.updateMacAppUpdateJob(job.ID, func(job *macAppUpdateJob) { job.Progress = 60 })
	server.updateMacAppUpdateJob(job.ID, func(job *macAppUpdateJob) {
		job.Phase = "error"
		job.Error = &apiError{Code: "mac_app_update_failed", Message: "open /Users/paul/Downloads/VibeTV.dmg: denied"}
	})

	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/diagnostics", nil))
	var got diagnosticsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	var lines []string
	for _, event := range got.Timeline.Events {
		if event.CorrelationID != got.SetupLog.SessionID || event.ID == 0 || event.At == "" {
			t.Fatalf("event is not tied to the setup session: %+v", event)
		}
		lines = append(lines, strings.TrimRight(event.Component+" "+event.State+" "+event.Reason+" "+event.DeviceID, " "))
	}
	want := []string{
		"device_pair started",
		"device_pair failed pairing_token_rejected",
		"device_pair succeeded",
		"firmware_update validating_artifact  vibetv-8caab5",
		"firmware_update uploading  vibetv-8caab5",
		"firmware_update rebooting  vibetv-8caab5",
		"firmware_update verified updated vibetv-8caab5",
		"mac_app_update installing",
		"mac_app_update error mac_app_update_failed",
	}
	if got.Timeline.Version != timeline.Version || strings.Join(lines, "\n") != strings.Join(want, "\n") {
		t.Fatalf("timeline v%d:\n%s\nwant:\n%s", got.Timeline.Version, strings.Join(lines, "\n"), strings.Join(want, "\n"))
	}
	raw, _ := json.Marshal(got.Timeline)
	for _, secret := range []string{"abc123", "192.168", "paul", "Pairing with"} {
		if strings.Contains(string(raw), secret) {
			t.Fatalf("timeline leaks %q: %s", secret, raw)
		}
	}
	// The setup log beside it is unchanged by the timeline.
	if len(got.SetupLog.Events) != 3 || got.SetupLog.Events[1].Count != 3 {
		t.Fatalf("setupLog = %+v", got.SetupLog.Events)
	}
}

func TestTimelineIsSavedBesideTheSetupLogAndSurvivesARestart(t *testing.T) {
	home := t.TempDir()
	first, err := New(Options{Home: home})
	if err != nil {
		t.Fatal(err)
	}
	first.recordSetupEvent(setupEvent{Stage: "theme_install", Status: "started", Message: "Installing theme."})
	if _, err := os.Stat(runtimepaths.Path(home, "timeline.json")); err != nil {
		t.Fatalf("timeline file: %v", err)
	}
	second, err := New(Options{Home: home})
	if err != nil {
		t.Fatal(err)
	}
	second.recordSetupEvent(setupEvent{Stage: "theme_install", Status: "succeeded", Message: "Theme installed."})
	events := second.Timeline().Snapshot(time.Now()).Events
	if len(events) != 2 || events[0].State != "started" || events[1].State != "succeeded" || events[1].ID != 2 ||
		events[0].CorrelationID != events[1].CorrelationID {
		t.Fatalf("timeline after restart = %+v", events)
	}
}

func TestUsageEngineDiagnosticCheckStates(t *testing.T) {
	for status, want := range map[string]string{
		codexbar.ProviderReady:              "",
		codexbar.ProviderEngineIncompatible: "engine_incompatible",
		codexbar.ProviderEngineError:        "engine_error",
		codexbar.ProviderNotConfigured:      "engine_missing",
		codexbar.ProviderConfigError:        "config_error",
	} {
		check := usageEngineDiagnosticCheck(codexbar.EngineReadiness{Status: status, Version: "0.46", MinimumVersion: "0.23"})
		if check.ErrorCode != want || (want == "") != (check.Status == "pass") {
			t.Fatalf("%s: unexpected check %+v", status, check)
		}
		if strings.Contains(check.Detail+check.NextAction, "CodexBar") {
			t.Fatalf("%s: check leaked the engine name: %+v", status, check)
		}
	}
	if got := usageEngineDiagnosticCheck(codexbar.EngineReadiness{Status: codexbar.ProviderReady, Version: "0.46"}); got.Detail != "Usage engine 0.46 is ready." {
		t.Fatalf("unexpected pass detail: %q", got.Detail)
	}
}

func TestIncompatibleEngineWinsOverCachedUsage(t *testing.T) {
	now := time.Date(2026, 9, 24, 10, 0, 0, 0, time.UTC)
	ready := []codexbar.ProviderReadiness{{ID: "codex", Label: "Codex", Enabled: providerEnabled(true), Status: codexbar.ProviderReady}}
	for _, fn := range []func(codexbar.ProviderSetup, []codexbar.ProviderReadiness, time.Time) codexbar.ProviderSetup{
		reconcileProviderSetupWithUsage, reconcileProviderSetupWithTokenEvidence,
	} {
		got := fn(incompatibleEngineSetup(), ready, now)
		if got.Status == codexbar.ProviderReady || got.Engine.Status != codexbar.ProviderEngineIncompatible || providerByID(got.Providers, "codexbar") == nil {
			t.Fatalf("cached usage hid the incompatible engine: %+v", got)
		}
	}
	if providerReadinessHealthState(codexbar.ProviderEngineIncompatible) != "engine_incompatible" ||
		providerReadinessNextAction(codexbar.ProviderEngineIncompatible) == "" ||
		strings.Contains(providerReadinessMessage(codexbar.ProviderEngineIncompatible), "CodexBar") {
		t.Fatal("engine_incompatible is not mapped like an engine failure")
	}
}

func TestSetupEventLogSurvivesARuntimeRestart(t *testing.T) {
	path := t.TempDir() + "/setup-log.json"
	start := time.Date(2026, 10, 5, 14, 27, 0, 0, time.UTC)

	first := &setupEventLog{path: path}
	first.record(start, setupEvent{Stage: "device_search", Status: "succeeded", Message: "Found 1 VibeTV."})
	first.record(start.Add(time.Minute), setupEvent{Stage: "firmware_update", Status: "succeeded", Message: "VibeTV update complete."})
	session := first.snapshot(start).SessionID

	// The usage engine repair unregisters the runtime; the next one starts empty.
	second := &setupEventLog{path: path}
	second.record(start.Add(2*time.Minute), setupEvent{Stage: "provider_check", Status: "succeeded", Message: "Codex is ready."})
	got := second.snapshot(start.Add(2 * time.Minute))

	if got.SessionID != session {
		t.Fatalf("session = %q, want the one from before the restart %q", got.SessionID, session)
	}
	stages := []string{}
	for i, event := range got.Events {
		stages = append(stages, event.Stage)
		if event.Seq != i+1 {
			t.Fatalf("event %d has seq %d, want %d", i, event.Seq, i+1)
		}
	}
	want := "device_search firmware_update service_restart provider_check"
	if strings.Join(stages, " ") != want {
		t.Fatalf("stages = %v, want %s", stages, want)
	}
}

func TestSetupEventLogStartsFreshAfterAnOldSessionOrAReset(t *testing.T) {
	path := t.TempDir() + "/setup-log.json"
	start := time.Date(2026, 10, 5, 14, 27, 0, 0, time.UTC)

	old := &setupEventLog{path: path}
	old.record(start, setupEvent{Stage: "device_search", Status: "succeeded", Message: "Found 1 VibeTV."})

	later := &setupEventLog{path: path}
	if got := later.snapshot(start.Add(setupLogMaxAge + time.Minute)); len(got.Events) != 0 {
		t.Fatalf("a finished setup came back: %+v", got.Events)
	}

	reset := &setupEventLog{path: path}
	reset.reset(start.Add(time.Minute))
	next := &setupEventLog{path: path}
	got := next.snapshot(start.Add(2 * time.Minute))
	if len(got.Events) != 2 || got.Events[0].Stage != "setup_reset" || got.Events[1].Stage != "service_restart" {
		t.Fatalf("events after a reset and a restart = %+v", got.Events)
	}
}

func TestSetupLogDoesNotCallACableRescueAFailedSearch(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	step := server.setupStep("device_search", "Searching for VibeTV.", "", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusConflict, errorResponse{Error: apiError{
			Code:       "cable_firmware_too_old",
			Message:    "Your VibeTV needs a firmware update before it can use USB-C.",
			NextAction: "Connect VibeTV to WiFi, install the update, then reconnect the cable.",
		}})
	})
	step(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/v1/device/search", nil))

	got := getSetupLog(t, server)
	if len(got.Events) != 2 {
		t.Fatalf("events = %+v", got.Events)
	}
	found := got.Events[1]
	if found.Status != "succeeded" || found.Code != "cable_firmware_too_old" || found.NextAction != "" || strings.Contains(found.Message, "WiFi") {
		t.Fatalf("the VibeTV setup is about to update over the cable was logged as %+v", found)
	}
}
