package companionapi

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/timeline"
)

// setupEventLimit bounds one setup session; older events are dropped.
const setupEventLimit = 200

// setupLogMaxAge is how long a saved session is still the setup someone is
// working on. An older one is a finished setup and a new session starts.
const setupLogMaxAge = 24 * time.Hour

type setupEvent struct {
	Seq        int    `json:"seq"`
	At         string `json:"at"`
	Stage      string `json:"stage"`
	Status     string `json:"status"`
	Message    string `json:"message"`
	Code       string `json:"code,omitempty"`
	NextAction string `json:"nextAction,omitempty"`
	Count      int    `json:"count,omitempty"`
}

// setupLog is both the GET /v1/setup/events body and the diagnostics setupLog.
type setupLog struct {
	OK        bool         `json:"ok"`
	SessionID string       `json:"sessionId"`
	StartedAt string       `json:"startedAt"`
	Events    []setupEvent `json:"events"`
	Truncated bool         `json:"truncated"`
	Dropped   int          `json:"dropped"`
}

// setupEventLog is the one owner of setup transitions shown live in Control
// Center and exported in support reports.
//
// The runtime restarts in the middle of a setup: the usage engine repair
// unregisters it on purpose, and a firmware or app update can too. The session
// is therefore saved on every change and picked up again by the next runtime,
// or the support report would lose the device search and the firmware update
// that came before the restart.
type setupEventLog struct {
	mu      sync.Mutex
	session setupLog
	nextSeq int
	// path is where the session is saved; empty keeps it in memory only.
	path     string
	restored bool
}

// openLocked makes sure a session exists: the saved one when this runtime has
// not looked yet and it is recent enough, otherwise a new one.
func (l *setupEventLog) openLocked(now time.Time) {
	if !l.restored {
		l.restored = true
		if l.restoreLocked(now) {
			return
		}
	}
	if l.session.SessionID == "" {
		l.startLocked(now)
	}
}

func (l *setupEventLog) restoreLocked(now time.Time) bool {
	if l.path == "" || l.session.SessionID != "" {
		return false
	}
	raw, err := os.ReadFile(l.path)
	if err != nil {
		return false
	}
	var saved setupLog
	if err := json.Unmarshal(raw, &saved); err != nil || saved.SessionID == "" || len(saved.Events) == 0 {
		return false
	}
	last, err := time.Parse(time.RFC3339, saved.Events[len(saved.Events)-1].At)
	if err != nil || now.Sub(last) > setupLogMaxAge {
		return false
	}
	saved.OK = true
	l.session = saved
	l.nextSeq = 0
	for _, event := range saved.Events {
		l.nextSeq = max(l.nextSeq, event.Seq)
	}
	l.appendLocked(setupEvent{
		At:      now.UTC().Format(time.RFC3339),
		Stage:   "service_restart",
		Status:  "succeeded",
		Message: "The Mac App's background service started again.",
	})
	l.saveLocked()
	return true
}

// saveLocked writes the session next to the runtime's other state. A log that
// cannot be saved still works for this runtime, so the error is not reported.
func (l *setupEventLog) saveLocked() {
	if l.path == "" {
		return
	}
	raw, err := json.Marshal(l.session)
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(l.path), 0o700); err != nil {
		return
	}
	tmp := l.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return
	}
	if err := os.Rename(tmp, l.path); err != nil {
		_ = os.Remove(tmp)
	}
}

func (l *setupEventLog) startLocked(now time.Time) {
	id := make([]byte, 8)
	_, _ = rand.Read(id)
	l.session = setupLog{OK: true, SessionID: hex.EncodeToString(id), StartedAt: now.UTC().Format(time.RFC3339), Events: []setupEvent{}}
	l.nextSeq = 0
}

func (l *setupEventLog) reset(now time.Time) {
	l.mu.Lock()
	l.restored = true
	l.startLocked(now)
	l.mu.Unlock()
	l.record(now, setupEvent{Stage: "setup_reset", Status: "started", Message: "New setup session started."})
}

// record logs one setup step and reports whether it became a new entry; a
// repeat folded into an earlier entry reports false.
func (l *setupEventLog) record(now time.Time, event setupEvent) bool {
	event.Message = sanitizeErrorDetail(errors.New(event.Message))
	event.At = now.UTC().Format(time.RFC3339)
	l.mu.Lock()
	defer l.mu.Unlock()
	l.openLocked(now)
	defer l.saveLocked()
	if n := len(l.session.Events); n > 0 {
		last := &l.session.Events[n-1]
		if sameSetupEvent(*last, event) {
			last.Count++
			last.At = event.At
			return false
		}
		// A repeated start/result pair (a retried search that found the same
		// nothing) folds into the previous pair instead of growing the list.
		if n >= 3 && last.Status == "started" && sameSetupEvent(l.session.Events[n-3], *last) && sameSetupEvent(l.session.Events[n-2], event) {
			l.session.Events = l.session.Events[:n-1]
			l.session.Events[n-3].Count++
			l.session.Events[n-2].Count++
			l.session.Events[n-2].At = event.At
			return false
		}
	}
	l.appendLocked(event)
	return true
}

func (l *setupEventLog) appendLocked(event setupEvent) {
	l.nextSeq++
	event.Seq = l.nextSeq
	event.Count = 1
	if len(l.session.Events) >= setupEventLimit {
		l.session.Events = append(l.session.Events[:0:0], l.session.Events[1:]...)
		l.session.Dropped++
		l.session.Truncated = true
	}
	l.session.Events = append(l.session.Events, event)
}

func sameSetupEvent(a, b setupEvent) bool {
	return a.Stage == b.Stage && a.Status == b.Status && a.Code == b.Code && a.Message == b.Message
}

func (l *setupEventLog) snapshot(now time.Time) setupLog {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.openLocked(now)
	out := l.session
	out.Events = append([]setupEvent{}, l.session.Events...)
	return out
}

// lastOfStage reports the newest event of a stage, so a repeated check that
// changed nothing is not logged again.
func (l *setupEventLog) lastOfStage(now time.Time, stage string) (setupEvent, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.openLocked(now)
	for i := len(l.session.Events) - 1; i >= 0; i-- {
		if l.session.Events[i].Stage == stage {
			return l.session.Events[i], true
		}
	}
	return setupEvent{}, false
}

// sessionID names the current setup session.
func (l *setupEventLog) sessionID(now time.Time) string {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.openLocked(now)
	return l.session.SessionID
}

// recordSetupEvent is the one place a setup step is logged: in the setup log
// the customer sees, and as a transition in the support timeline. A repeat the
// setup log folds (a search retried with the same result) is no transition.
func (s *Server) recordSetupEvent(event setupEvent) {
	if s.setupEvents.record(s.currentTime(), event) {
		s.recordTimeline(timeline.Event{Component: event.Stage, State: event.Status, Reason: event.Code})
	}
}

// Timeline is the support timeline. The runtime hands it to its display
// worker, so both write the one file through the one store.
func (s *Server) Timeline() *timeline.Store {
	return s.timeline
}

// recordTimeline adds a transition to the support timeline, tied to the setup
// session it happened in.
func (s *Server) recordTimeline(event timeline.Event) {
	now := s.currentTime()
	event.CorrelationID = s.setupEvents.sessionID(now)
	s.timeline.Record(now, event)
}

func (s *Server) handleSetupEvents(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	writeJSON(w, http.StatusOK, s.setupEvents.snapshot(s.currentTime()))
}

// setupStep logs one setup action: an optional start, then the customer-safe
// API error it answered with, or the success message when one is given.
func (s *Server) setupStep(stage, started, succeeded string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			next(w, r)
			return
		}
		if started != "" {
			s.recordSetupEvent(setupEvent{Stage: stage, Status: "started", Message: started})
		}
		rec := &setupStepRecorder{ResponseWriter: w, status: http.StatusOK, stage: stage}
		next(rec, r)
		if rec.status >= http.StatusBadRequest {
			var body errorResponse
			_ = json.Unmarshal(rec.body.Bytes(), &body)
			message := body.Error.Message
			if message == "" {
				message = "The step could not finish."
			}
			if stage == "device_search" && body.Error.Code == "cable_firmware_too_old" {
				// The search answers with an error so setup can carry the board
				// and firmware into the update it then starts over the cable by
				// itself. Logging that answer said "Failed" and sent the reader
				// to WiFi, right above a firmware update that went through.
				s.recordSetupEvent(setupEvent{Stage: stage, Status: "succeeded", Message: "Found a VibeTV on the cable that needs a firmware update.", Code: body.Error.Code})
				return
			}
			s.recordSetupEvent(setupEvent{Stage: rec.stage, Status: "failed", Message: message, Code: body.Error.Code, NextAction: body.Error.NextAction})
		} else if succeeded != "" {
			s.recordSetupEvent(setupEvent{Stage: rec.stage, Status: "succeeded", Message: succeeded})
		}
	}
}

type setupStepRecorder struct {
	http.ResponseWriter
	status int
	body   bytes.Buffer
	// stage is the stage the result is logged under. A step that learns it
	// from the request (theme or screensaver install) sets it.
	stage string
}

func (r *setupStepRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (r *setupStepRecorder) Write(p []byte) (int, error) {
	if r.status >= http.StatusBadRequest && r.body.Len() < 8<<10 {
		r.body.Write(p)
	}
	return r.ResponseWriter.Write(p)
}

func (r *setupStepRecorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }

// recordProviderSetupEvents logs one provider check: the engine result only
// when it changed, then the provider result.
func (s *Server) recordProviderSetupEvents(setup codexbar.ProviderSetup, label string) {
	provider := providerDiagnosticCheck(setup)
	if label != "" && provider.Status == "pass" {
		provider.Detail = label + " is ready."
	} else if label != "" {
		if provider.Detail == "" {
			provider.Detail = providerReadinessMessage(provider.ErrorCode)
		}
		provider.Detail = label + ": " + provider.Detail
	}
	checks := []diagnosticCheck{provider}
	if setup.Engine.Status != "" {
		checks = []diagnosticCheck{usageEngineDiagnosticCheck(setup.Engine), provider}
	}
	for _, check := range checks {
		stage := "provider_check"
		if check.Name == "usage_engine" {
			stage = "usage_engine"
		}
		event := setupEvent{Stage: stage, Status: "failed", Message: check.Detail, Code: check.ErrorCode, NextAction: check.NextAction}
		if check.Status == "pass" {
			event = setupEvent{Stage: stage, Status: "succeeded", Message: check.Detail}
		}
		if last, ok := s.setupEvents.lastOfStage(s.currentTime(), stage); stage == "usage_engine" && ok && sameSetupEvent(last, event) {
			continue
		}
		s.recordSetupEvent(event)
	}
}

type diagnosticsUsageEngine struct {
	Name           string `json:"name"`
	Status         string `json:"status"`
	Version        string `json:"version,omitempty"`
	MinimumVersion string `json:"minimumVersion,omitempty"`
	Source         string `json:"source,omitempty"`
	Path           string `json:"path,omitempty"`
}

func usageEngineDiagnostics(engine codexbar.EngineReadiness) diagnosticsUsageEngine {
	return diagnosticsUsageEngine{Name: "CodexBar", Status: engine.Status, Version: engine.Version, MinimumVersion: engine.MinimumVersion, Source: engine.Source, Path: engine.Path}
}

func usageEngineDiagnosticCheck(engine codexbar.EngineReadiness) diagnosticCheck {
	const repair = "Repair the usage engine, then check again."
	check := diagnosticCheck{Name: "usage_engine", Status: "fail", NextAction: repair}
	switch engine.Status {
	case codexbar.ProviderReady:
		detail := "Usage engine is ready."
		if engine.Version != "" {
			detail = "Usage engine " + engine.Version + " is ready."
		}
		return diagnosticCheck{Name: "usage_engine", Status: "pass", Detail: detail}
	case codexbar.ProviderEngineIncompatible:
		check.ErrorCode = codexbar.ProviderEngineIncompatible
		check.Detail = "Usage engine " + engine.Version + " is too old. Version " + engine.MinimumVersion + " or newer is required."
	case codexbar.ProviderNotConfigured:
		check.ErrorCode = "engine_missing"
		check.Detail = "The usage engine is not installed."
	case codexbar.ProviderConfigError:
		check.ErrorCode = codexbar.ProviderConfigError
		check.Detail = "The usage engine could not read or save its settings."
	case codexbar.ProviderEngineError:
		check.ErrorCode = codexbar.ProviderEngineError
		check.Detail = "The usage engine did not report a readable version."
	default:
		return diagnosticCheck{Name: "usage_engine", Status: "attention", Detail: "The usage engine has not been checked yet."}
	}
	return check
}

func engineUnusable(status string) bool {
	return status == codexbar.ProviderEngineError || status == codexbar.ProviderEngineIncompatible
}
