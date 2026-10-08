package companionapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themeinstall"
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

	// The timeline keeps one state per provider: a check that failed does not
	// stand for the other providers, and not for a provider turned off since.
	current := map[string]string{}
	for _, event := range server.Timeline().Snapshot(server.currentTime()).Current {
		current[event.Component] = strings.TrimSuffix(event.State+" "+event.Reason, " ")
	}
	if _, shared := current["provider_check"]; shared || current["provider_check/claude"] != "off" {
		t.Fatalf("current provider states = %v, want provider_check/claude off", current)
	}
	var claude []string
	for _, event := range server.Timeline().Snapshot(server.currentTime()).Events {
		if event.Component == "provider_check/claude" {
			claude = append(claude, strings.TrimSuffix(event.State+" "+event.Reason, " "))
		}
	}
	if want := "failed " + codexbar.ProviderAuthRequired + ",off"; strings.Join(claude, ",") != want {
		t.Fatalf("claude in the timeline = %v, want %s", claude, want)
	}
}

func TestProviderCheckLogsReadyProviderByName(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.recordProviderSetupEvents(codexbar.ProviderSetup{Status: codexbar.ProviderReady, Providers: []codexbar.ProviderReadiness{{ID: "codex", Label: "Codex", Status: codexbar.ProviderReady}}}, "codex", "Codex")
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
	first, err := New(Options{Home: home, PauseDisplayStream: func(bool) {}})
	if err != nil {
		t.Fatal(err)
	}
	first.recordSetupEvent(setupEvent{Stage: "theme_install", Status: "started", Message: "Installing theme."})
	if _, err := os.Stat(runtimepaths.Path(home, "timeline.json")); err != nil {
		t.Fatalf("timeline file: %v", err)
	}
	second, err := New(Options{Home: home, PauseDisplayStream: func(bool) {}})
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

// Issue #581: an API server beside the runtime shares its home folder. Each
// saved the whole setup log and timeline from its own memory, so the last
// writer erased the other's entries. Only the runtime that owns the display
// stream saves them now; the other one shows what is saved.
func TestOnlyTheDisplayWriterSavesTheSetupLogAndTheTimeline(t *testing.T) {
	home := t.TempDir()
	files := []string{runtimepaths.Path(home, "setup-log.json"), runtimepaths.Path(home, "timeline.json")}
	read := func() string {
		t.Helper()
		out := ""
		for _, file := range files {
			raw, err := os.ReadFile(file)
			if err != nil && !os.IsNotExist(err) {
				t.Fatal(err)
			}
			out += string(raw) + "\n"
		}
		return out
	}
	// The answer of a server on these files. It is a test server, so the
	// request searches no network and no cable; its stores are the ones a
	// runtime beside the display writer gets.
	reader := newTestServer(t, runtimeconfig.Config{})
	reader.setupEvents.path, reader.setupEvents.readOnly = files[0], true
	reader.timeline = timeline.OpenReadOnly(files[1])
	diagnostics := func() diagnosticsResponse {
		t.Helper()
		rec := httptest.NewRecorder()
		reader.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/diagnostics", nil))
		var got diagnosticsResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("diagnostics: %v: %s", err, rec.Body.String())
		}
		return got
	}

	beside, err := New(Options{Home: home})
	if err != nil {
		t.Fatal(err)
	}
	if !beside.setupEvents.readOnly {
		t.Fatal("a runtime without a display stream must not own the setup log")
	}
	beside.recordSetupEvent(setupEvent{Stage: "device_search", Status: "succeeded", Message: "Found 1 VibeTV."})
	if got := read(); got != "\n\n" {
		t.Fatalf("a runtime that is not the display writer saved: %s", got)
	}

	writer, err := New(Options{Home: home, PauseDisplayStream: func(bool) {}})
	if err != nil {
		t.Fatal(err)
	}
	writer.recordSetupEvent(setupEvent{Stage: "theme_install", Status: "started", Message: "Installing theme."})
	saved := read()
	if !strings.Contains(saved, "Installing theme.") || !strings.Contains(saved, `"component":"theme_install"`) {
		t.Fatalf("the display writer saved: %s", saved)
	}

	beside.recordSetupEvent(setupEvent{Stage: "device_search", Status: "failed", Message: "No VibeTV found.", Code: "device_not_found"})
	beside.setupEvents.reset(beside.currentTime())
	got := diagnostics()
	if after := read(); after != saved {
		t.Fatalf("the other runtime changed the files:\n%s\n%s", saved, after)
	}
	// It still answers the support report, with what the writer saved.
	if len(got.SetupLog.Events) != 1 || got.SetupLog.Events[0].Message != "Installing theme." ||
		got.SetupLog.SessionID != writer.setupEvents.sessionID(writer.currentTime()) {
		t.Fatalf("setupLog of the other runtime = %+v", got.SetupLog)
	}
	if len(got.Timeline.Events) != 1 || got.Timeline.Events[0].Component != "theme_install" || got.Timeline.Events[0].State != "started" {
		t.Fatalf("timeline of the other runtime = %+v", got.Timeline.Events)
	}

	// And what the writer saves afterwards.
	writer.recordSetupEvent(setupEvent{Stage: "theme_install", Status: "succeeded", Message: "Theme installed."})
	got = diagnostics()
	if len(got.SetupLog.Events) != 2 || len(got.Timeline.Events) != 2 || got.Timeline.Events[1].ID != 2 {
		t.Fatalf("after the writer went on: %+v %+v", got.SetupLog.Events, got.Timeline.Events)
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

// Issue #558: the setup log filed a screensaver install under "Theme install"
// and opened it with "Installing theme." Only the request names the slot.
func TestSetupLogFilesAScreensaverInstallUnderItsOwnStage(t *testing.T) {
	device := newThemeInstallReadyDeviceServer(t)
	defer device.Close()

	install := func(slot string, installErr error) []setupEvent {
		t.Helper()
		server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
		server.installTheme = func(_ context.Context, opts themeinstall.Options) (themeinstall.Result, error) {
			return themeinstall.Result{ThemeID: opts.ThemeID, Slot: opts.Slot}, installErr
		}
		req := httptest.NewRequest(http.MethodPost, "/v1/themes/install", strings.NewReader(`{"themeId":"x","packUrl":"https://example.com/x.zip","slot":"`+slot+`","async":true}`))
		req.Header.Set("Content-Type", "application/json")
		server.Handler().ServeHTTP(httptest.NewRecorder(), req)
		var events []setupEvent
		for attempt := 0; attempt < 100 && len(events) < 2; attempt++ {
			time.Sleep(10 * time.Millisecond)
			events = getSetupLog(t, server).Events
		}
		if len(events) != 2 {
			t.Fatalf("expected a start and a result for the %s slot, got %+v", slot, events)
		}
		return events
	}
	filed := func(events []setupEvent) string {
		return fmt.Sprintf("%s/%s/%s | %s/%s", events[0].Stage, events[0].Status, events[0].Message, events[1].Stage, events[1].Status)
	}

	done := install("screensaver", nil)
	if got := filed(done); got != "screensaver_install/started/Installing screensaver. | screensaver_install/succeeded" || done[1].Message != "Screensaver is ready on VibeTV." {
		t.Fatalf("screensaver install was filed as %s: %+v", got, done)
	}
	if got := filed(install("screensaver", errors.New("upload failed"))); got != "screensaver_install/started/Installing screensaver. | screensaver_install/failed" {
		t.Fatalf("failed screensaver install was filed as %s", got)
	}
	// A theme install keeps its stage and its lines.
	theme := install("live", nil)
	if got := filed(theme); got != "theme_install/started/Installing theme. | theme_install/succeeded" || theme[1].Message != "Theme is active on VibeTV." {
		t.Fatalf("theme install was filed as %s: %+v", got, theme)
	}

	// A refusal the route itself logs, after the request named the slot.
	t.Setenv(themeInstallDisableEnv, "1")
	if got := filed(install("screensaver", nil)); got != "screensaver_install/started/Installing screensaver. | screensaver_install/failed" {
		t.Fatalf("refused screensaver install was filed as %s", got)
	}
}

// Issue #579: two different screensavers installed one after the other stood
// as one "Started 2 times" and one "Done 2 times". Only the same install made
// again is a repeat.
func TestSetupLogFoldsOnlyRepeatsOfTheSameInstall(t *testing.T) {
	device := newThemeInstallReadyDeviceServer(t)
	defer device.Close()
	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	server.installTheme = func(_ context.Context, opts themeinstall.Options) (themeinstall.Result, error) {
		return themeinstall.Result{ThemeID: opts.ThemeID, Slot: opts.Slot}, nil
	}
	// Installs themeID and returns the log once the install has ended.
	send := func(themeID string, req *http.Request, done func([]setupEvent) bool) []setupEvent {
		t.Helper()
		rec := httptest.NewRecorder()
		server.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusAccepted {
			t.Fatalf("install of %s answered %d: %s", themeID, rec.Code, rec.Body.String())
		}
		var events []setupEvent
		for attempt := 0; attempt < 100; attempt++ {
			time.Sleep(10 * time.Millisecond)
			if events = getSetupLog(t, server).Events; done(events) {
				// The job frees the install only after it has logged its end.
				time.Sleep(20 * time.Millisecond)
				return events
			}
		}
		t.Fatalf("install of %s did not end: %+v", themeID, events)
		return nil
	}
	install := func(themeID string, done func([]setupEvent) bool) []setupEvent {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/v1/themes/install", strings.NewReader(`{"themeId":"`+themeID+`","packUrl":"https://example.com/`+themeID+`.zip","slot":"screensaver","async":true}`))
		req.Header.Set("Content-Type", "application/json")
		return send(themeID, req, done)
	}
	// The customer's own theme comes as a file, without an address and here
	// without an id: the file itself tells two of them apart.
	upload := func(name string, pack []byte, done func([]setupEvent) bool) []setupEvent {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/v1/themes/install?async=true", strings.NewReader(string(pack)))
		req.Header.Set("Content-Type", "application/zip")
		return send(name, req, done)
	}
	counts := func(events []setupEvent) string {
		var out []string
		for _, event := range events {
			out = append(out, fmt.Sprintf("%s %d", event.Status, event.Count))
		}
		return strings.Join(out, ", ")
	}

	install("retro-3d", func(events []setupEvent) bool { return len(events) == 2 })
	again := install("retro-3d", func(events []setupEvent) bool { return len(events) == 2 && events[1].Count == 2 })
	if got := counts(again); got != "started 2, succeeded 2" {
		t.Fatalf("the same screensaver installed twice was logged as %s", got)
	}
	other := install("night-clock", func(events []setupEvent) bool { return len(events) == 4 || events[1].Count == 3 })
	if got := counts(other); got != "started 2, succeeded 2, started 1, succeeded 1" {
		t.Fatalf("another screensaver was logged as %s", got)
	}

	first := testThemePackZipRevision(t, "mine", "/themes/u/mine.json", 1, "first")
	second := testThemePackZipRevision(t, "mine", "/themes/u/mine.json", 1, "second")
	upload("first file", first, func(events []setupEvent) bool { return len(events) == 6 || events[3].Count == 2 })
	upload("first file again", first, func(events []setupEvent) bool { return len(events) == 6 && events[5].Count == 2 })
	uploads := upload("second file", second, func(events []setupEvent) bool { return len(events) == 8 || events[5].Count == 3 })
	if got := counts(uploads[4:]); got != "started 2, succeeded 2, started 1, succeeded 1" {
		t.Fatalf("two different uploaded themes were logged as %s", got)
	}
}

// The customer's own screensaver is uploaded with its slot in the URL. A file
// the Mac App refuses while reading it was still filed under "Theme install".
func TestSetupLogFilesARefusedScreensaverUploadUnderItsOwnStage(t *testing.T) {
	refused := func(target string) setupEvent {
		t.Helper()
		server := newTestServer(t, runtimeconfig.Config{})
		req := httptest.NewRequest(http.MethodPost, target, strings.NewReader("not a zip"))
		req.Header.Set("Content-Type", "application/zip")
		server.Handler().ServeHTTP(httptest.NewRecorder(), req)
		events := getSetupLog(t, server).Events
		if len(events) != 1 || events[0].Status != "failed" || events[0].Code != "invalid_theme_pack" {
			t.Fatalf("expected one refusal of the file for %s, got %+v", target, events)
		}
		return events[0]
	}

	screensaver := refused("/v1/themes/install?slot=screensaver&themeId=mine")
	if got := screensaver.Stage; got != "screensaver_install" {
		t.Fatalf("refused screensaver upload was filed under %q", got)
	}
	// And in its words (issue #558).
	if screensaver.Message != "Screensaver file is invalid." || screensaver.NextAction != "Export the screensaver again, then retry." {
		t.Fatalf("refused screensaver upload reads %+v", screensaver)
	}
	// A theme upload keeps its stage.
	for _, target := range []string{"/v1/themes/install?slot=live&themeId=mine", "/v1/themes/install?themeId=mine"} {
		theme := refused(target)
		if got := theme.Stage; got != "theme_install" {
			t.Fatalf("refused theme upload %s was filed under %q", target, got)
		}
		if theme.Message != "Theme file is invalid." {
			t.Fatalf("refused theme upload %s reads %+v", target, theme)
		}
	}
}

// A search retried all night must not push the rest of the history out of the
// timeline: the setup log folds the repeated pair, and the timeline follows it.
func TestARetriedSetupStepDoesNotFloodTheTimeline(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	for i := 0; i < 50; i++ {
		server.recordSetupEvent(setupEvent{Stage: "device_search", Status: "started", Message: "Searching for VibeTV."})
		server.recordSetupEvent(setupEvent{Stage: "device_search", Status: "failed", Message: "No VibeTV found.", Code: "vibetv_not_found"})
	}
	server.recordSetupEvent(setupEvent{Stage: "device_search", Status: "succeeded", Message: "Found VibeTV."})

	var got []string
	for _, event := range server.Timeline().Snapshot(server.currentTime()).Events {
		got = append(got, event.State)
	}
	if want := "failed,succeeded"; strings.Join(got, ",") != want {
		t.Fatalf("timeline states = %v, want %s", got, want)
	}
}

// The timeline is part of the support report. Whatever a caller hands over,
// the report gets identifiers only: a private value in any field the server
// forwards is replaced, never copied.
func TestDiagnosticsTimelineNeverCarriesPrivateValues(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	private := []string{
		"/Users/paul/Library/Application Support/codexbar-display/config.json", // path with the user name
		`C:\Users\paul\AppData\Roaming\codexbar-display`,                       // the same on Windows
		"paul@example.com",                                  // provider account
		"FRITZ!Box 7590 Paul",                               // WiFi name
		"wifi password: hunter2",                            // WiFi password
		"Bearer 0123456789abcdef0123456789abcdef",           // pairing token
		"sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789", // API key
		"http://192.168.178.40/frame?token=abc123",          // VibeTV address with token
	}
	for i, value := range private {
		server.recordSetupEvent(setupEvent{Stage: value, Status: fmt.Sprintf("s%d", i), Message: value, Code: value, NextAction: value})
		server.recordSetupEvent(setupEvent{Stage: "wifi_setup", Status: value, Message: value, Code: value, NextAction: value})
		server.applyFirmwareUpdateEvent("job-1", firmwareUpdateEvent{Stage: value, Outcome: value, DeviceID: value, Phase: value, Firmware: value})
		job := server.createMacAppUpdateJob(macAppUpdateRequest{Version: "2.0.0"})
		server.updateMacAppUpdateJob(job.ID, func(job *macAppUpdateJob) {
			job.Phase = value
			job.Message = value
			job.Error = &apiError{Code: value, Message: value, NextAction: value}
		})
	}

	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/diagnostics", nil))
	var got struct {
		Timeline json.RawMessage `json:"timeline"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	var parsed timeline.Log
	if err := json.Unmarshal(got.Timeline, &parsed); err != nil || len(parsed.Events) == 0 {
		t.Fatalf("timeline = %s (%v)", got.Timeline, err)
	}
	for _, fragment := range append(private, "paul", "Paul", "FRITZ", "hunter2", "abc123", "192.168", "example.com", "0123456789abcdef", "AbCdEf") {
		if strings.Contains(string(got.Timeline), fragment) {
			t.Fatalf("timeline in the support report leaks %q:\n%s", fragment, got.Timeline)
		}
	}
	identifier := regexp.MustCompile(`^[A-Za-z0-9._/-]{0,64}$`)
	for _, event := range parsed.Events {
		for _, field := range []string{event.Component, event.DeviceID, event.State, event.Reason, event.CorrelationID} {
			if !identifier.MatchString(field) {
				t.Fatalf("field %q of %+v is not an identifier", field, event)
			}
		}
	}
}

// Found in the Mac app: a screensaver installed twice had "started" as its
// last entry for good, because the setup log folds the second run into the
// first. A run that really happened has its own start and its own end.
func TestASecondRunOfAStepRecordsItsOwnStartAndEnd(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	for i := 0; i < 2; i++ {
		server.recordSetupEvent(setupEvent{Stage: "screensaver_install", Status: "started", Message: "Installing Night Clock."})
		server.recordSetupEvent(setupEvent{Stage: "screensaver_install", Status: "succeeded", Message: "Night Clock installed."})
	}
	if log := getSetupLog(t, server); len(log.Events) != 2 || log.Events[1].Count != 2 {
		t.Fatalf("the setup log should still fold the second run: %+v", log.Events)
	}

	log := server.Timeline().Snapshot(server.currentTime())
	var got []string
	for _, event := range log.Events {
		got = append(got, event.State)
	}
	if want := "started,succeeded,started,succeeded"; strings.Join(got, ",") != want {
		t.Fatalf("timeline states = %v, want %s", got, want)
	}
	if len(log.Current) != 1 || log.Current[0].State != "succeeded" {
		t.Fatalf("current = %+v, want the install as succeeded", log.Current)
	}
}

func timelineStatesOf(server *Server, component string) string {
	var got []string
	for _, event := range server.Timeline().Snapshot(server.currentTime().Add(100 * time.Hour)).Events {
		if event.Component == component {
			got = append(got, event.State)
		}
	}
	return strings.Join(got, ",")
}

// Fourth review: a failure in an earlier setup session must not swallow the
// start of the same step in a new session.
func TestAStartAfterAFailureOfAnEarlierSessionIsRecorded(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.recordSetupEvent(setupEvent{Stage: "firmware_install", Status: "started", Message: "Installing."})
	server.recordSetupEvent(setupEvent{Stage: "firmware_install", Status: "failed", Message: "Failed.", Code: "firmware_update_failed"})
	// The retry in the same session waits for its result.
	server.recordSetupEvent(setupEvent{Stage: "firmware_install", Status: "started", Message: "Installing."})
	if got, want := timelineStatesOf(server, "firmware_install"), "started,failed"; got != want {
		t.Fatalf("same session = %s, want %s", got, want)
	}

	server.setupEvents.reset(server.currentTime().Add(72 * time.Hour))
	server.recordSetupEvent(setupEvent{Stage: "firmware_install", Status: "started", Message: "Installing."})
	if got, want := timelineStatesOf(server, "firmware_install"), "started,failed,started"; got != want {
		t.Fatalf("new session = %s, want %s", got, want)
	}
}

// Fourth review: the app searches and checks providers on its own, also
// while nothing changes. A check has no start worth recording, and a result
// that repeats the last one is no transition. A job the customer starts
// twice (TestASecondRunOfAStepRecordsItsOwnStartAndEnd) keeps both runs.
func TestARepeatedCheckWithTheSameResultIsRecordedOnce(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	for i := 0; i < 10; i++ {
		server.recordSetupEvent(setupEvent{Stage: "device_search", Status: "started", Message: "Searching for VibeTV."})
		server.recordSetupEvent(setupEvent{Stage: "device_search", Status: "succeeded", Message: "Found 1 VibeTV."})
	}
	if got := timelineStatesOf(server, "device_search"); got != "succeeded" {
		t.Fatalf("ten searches that found the same VibeTV = %s, want succeeded once", got)
	}
	server.recordSetupEvent(setupEvent{Stage: "device_search", Status: "started", Message: "Searching for VibeTV."})
	server.recordSetupEvent(setupEvent{Stage: "device_search", Status: "failed", Message: "No VibeTV found.", Code: "vibetv_not_found"})
	if got := timelineStatesOf(server, "device_search"); got != "succeeded,failed" {
		t.Fatalf("a search with a new result = %s, want succeeded,failed", got)
	}

	ready := codexbar.ProviderSetup{Status: codexbar.ProviderReady, Providers: []codexbar.ProviderReadiness{{ID: "codex", Label: "Codex", Status: codexbar.ProviderReady}}}
	for i := 0; i < 10; i++ {
		server.recordProviderSetupEvents(ready, "codex", "Codex")
	}
	if got := timelineStatesOf(server, "provider_check/codex"); got != "succeeded" {
		t.Fatalf("ten provider checks with the same result = %s, want succeeded once", got)
	}
}
