package companionapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themeinstall"
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
