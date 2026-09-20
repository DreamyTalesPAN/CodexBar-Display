package agentstatus

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func validSnapshot(now time.Time) Snapshot {
	return Snapshot{SchemaVersion: 1, EngineVersion: "0.1.0", Instance: "fixture", GeneratedAt: now.UnixMilli(), Health: "ready", Phase: "working", Sessions: []Session{{ID: "0123456789abcdef0123456789abcdef", Source: "codex", Phase: "working", ObservedAt: now.UnixMilli()}}}
}
func TestRejectInvalidContract(t *testing.T) {
	now := time.Now()
	for _, mutate := range []func(*Snapshot){func(s *Snapshot) { s.SchemaVersion = 2 }, func(s *Snapshot) { s.Phase = "invented" }, func(s *Snapshot) { s.Sessions[0].ID = "private/path" }, func(s *Snapshot) { s.GeneratedAt = now.Add(time.Minute).UnixMilli() }, func(s *Snapshot) { s.Sessions = make([]Session, 21) }} {
		s := validSnapshot(now)
		mutate(&s)
		data, _ := json.Marshal(s)
		if _, err := decode(data, now); err == nil {
			t.Fatalf("accepted %+v", s)
		}
	}
}
func TestCollectorLossDoesNotKeepWorking(t *testing.T) {
	now := time.Now()
	e := &Engine{}
	e.accept(validSnapshot(now), now)
	if got := e.snapshotAt(now); got.Phase != "working" {
		t.Fatal(got)
	}
	if got := e.snapshotAt(now.Add(16 * time.Second)); got.Health != "stale" || got.Phase != "unavailable" || len(got.Sessions) != 0 {
		t.Fatal(got)
	}
	e.unavailable("failed")
	if got := e.snapshotAt(now); got.Phase != "unavailable" {
		t.Fatal(got)
	}
}
func TestSnapshotCopiesSlices(t *testing.T) {
	now := time.Now()
	e := &Engine{}
	e.accept(validSnapshot(now), now)
	first := e.snapshotAt(now)
	first.Sessions[0].Phase = "error"
	if e.snapshotAt(now).Sessions[0].Phase != "working" {
		t.Fatal("shared mutable state")
	}
}

func TestSessionChangesWakeWithUnchangedAggregate(t *testing.T) {
	now := time.Now()
	wakes := 0
	e := &Engine{wake: func() { wakes++ }}
	s := validSnapshot(now)
	e.accept(s, now)
	s.GeneratedAt++
	e.accept(s, now)
	if wakes != 1 {
		t.Fatal("heartbeat triggered redundant render", wakes)
	}
	changed := s
	changed.Sessions = append([]Session{}, s.Sessions...)
	changed.Sessions[0].Phase = "waiting_for_answer"
	e.accept(changed, now)
	if wakes != 2 {
		t.Fatal("session transition failed to wake", wakes)
	}
}

func TestConfigureUsesAuthenticatedLocalEngineAndReturnsItsSnapshot(t *testing.T) {
	token := strings.Repeat("a", 64)
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if r.URL.Path != "/integrations" || r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer "+token {
			t.Error("invalid engine request")
		}
		var payload struct {
			Source  string
			Enabled bool
		}
		if json.NewDecoder(r.Body).Decode(&payload) != nil || payload.Source != "claude-code" || !payload.Enabled {
			t.Error("wrong choice")
		}
		_ = json.NewEncoder(w).Encode(validSnapshot(time.Now()))
	}))
	defer server.Close()
	dir := t.TempDir()
	data, _ := json.Marshal(map[string]string{"url": server.URL, "token": token})
	if err := os.WriteFile(filepath.Join(dir, "endpoint.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	engine := &Engine{runtimeDir: dir}
	got, err := engine.Configure(context.Background(), "claude-code", true)
	if err != nil || !called || got.Phase != "working" {
		t.Fatalf("%+v %v", got, err)
	}
	if engine.Snapshot().Health == "ready" {
		t.Fatal("command response replaced the authoritative observation stream")
	}
	// A tampered discovery file must never leak the bearer token off-machine.
	data, _ = json.Marshal(map[string]string{"url": "https://example.invalid", "token": token})
	_ = os.WriteFile(filepath.Join(dir, "endpoint.json"), data, 0600)
	if _, err := engine.Configure(context.Background(), "claude-code", true); err == nil {
		t.Fatal("external endpoint accepted")
	}
}

func TestDisplayNameFollowsObservedSourceNotQuota(t *testing.T) {
	s := Snapshot{Phase: "working", Sources: []Source{{ID: "codex", Name: "Codex"}, {ID: "claude-code", Name: "Claude Code"}}, Sessions: []Session{{Source: "codex", Phase: "working"}, {Source: "claude-code", Phase: "idle"}}}
	if got := s.DisplayName(); got != "Codex" {
		t.Fatal(got)
	}
	s.Sessions[1].Phase = "working"
	if got := s.DisplayName(); got != "Agent" {
		t.Fatal(got)
	}
	s.Sessions = s.Sessions[1:]
	if got := s.DisplayName(); got != "Claude Code" {
		t.Fatal(got)
	}
	s.Sources = nil
	if got := s.DisplayName(); got != "Agent" {
		t.Fatal(got)
	}
}
