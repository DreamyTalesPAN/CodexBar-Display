package companionapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
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
