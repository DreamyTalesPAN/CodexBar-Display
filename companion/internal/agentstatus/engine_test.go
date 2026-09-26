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

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

func validSnapshot(now time.Time) Snapshot {
	return Snapshot{SchemaVersion: 1, EngineVersion: "0.1.0", Instance: "fixture", GeneratedAt: now.UnixMilli(), Health: "ready", Phase: "working", Sessions: []Session{{ID: "0123456789abcdef0123456789abcdef", Source: "codex", Phase: "working", ObservedAt: now.UnixMilli()}}}
}
func TestRejectInvalidContract(t *testing.T) {
	now := time.Now()
	for _, mutate := range []func(*Snapshot){func(s *Snapshot) { s.ProviderPhases = map[string]string{"codex": "invented"} }, func(s *Snapshot) { s.ProviderPhases = map[string]string{"../invalid": "working"} }, func(s *Snapshot) { s.SchemaVersion = 2 }, func(s *Snapshot) { s.Phase = "invented" }, func(s *Snapshot) { s.Sessions[0].ID = "private/path" }, func(s *Snapshot) { s.GeneratedAt = now.Add(time.Minute).UnixMilli() }, func(s *Snapshot) { s.Sessions = make([]Session, 21) }} {
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
	value := validSnapshot(now)
	value.ProviderPhases = map[string]string{"codex": "working"}
	e.accept(value, now)
	first := e.snapshotAt(now)
	first.Sessions[0].Phase = "error"
	first.ProviderPhases["codex"] = "error"
	if e.snapshotAt(now).ProviderPhases["codex"] != "working" {
		t.Fatal("shared provider phases")
	}
	if e.snapshotAt(now).Sessions[0].Phase != "working" {
		t.Fatal("shared mutable state")
	}
}

func TestSessionChangesWakeWithUnchangedAggregate(t *testing.T) {
	now := time.Now()
	wakes := 0
	e := &Engine{wake: func() { wakes++ }, settings: func() runtimeconfig.AgentActivitySettings { return runtimeconfig.AgentActivitySettings{Enabled: true} }}
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
			Enabled bool
		}
		if json.NewDecoder(r.Body).Decode(&payload) != nil || !payload.Enabled {
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
	got, err := engine.Configure(context.Background(), true)
	if err != nil || !called || got.Phase != "working" {
		t.Fatalf("%+v %v", got, err)
	}
	if engine.Snapshot().Health == "ready" {
		t.Fatal("command response replaced the authoritative observation stream")
	}
	// A tampered discovery file must never leak the bearer token off-machine.
	data, _ = json.Marshal(map[string]string{"url": "https://example.invalid", "token": token})
	_ = os.WriteFile(filepath.Join(dir, "endpoint.json"), data, 0600)
	if _, err := engine.Configure(context.Background(), true); err == nil {
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

func TestSteadyHeartbeatsRenewDeviceLeaseWithoutWakingEverySecond(t *testing.T) {
	now := time.Now()
	wakes := 0
	e := &Engine{wake: func() { wakes++ }, settings: func() runtimeconfig.AgentActivitySettings { return runtimeconfig.AgentActivitySettings{Enabled: true} }}
	s := validSnapshot(now)
	for second := 0; second <= 45; second++ {
		current := now.Add(time.Duration(second) * time.Second)
		s.GeneratedAt = current.UnixMilli()
		e.accept(s, current)
		if wakes != second/5+1 {
			t.Fatalf("second %d: %d render wakes", second, wakes)
		}
	}
	// A phase change is immediate, even just after the previous renewal.
	s.Phase = "waiting_for_answer"
	e.accept(s, now.Add(46*time.Second))
	if wakes != 11 {
		t.Fatal("phase change waited for renewal")
	}
}

func TestLeaseRenewalStopsWhenDisabledOrUnavailable(t *testing.T) {
	for _, phase := range []string{"working", "idle", "done", "stale", "unavailable", "invalid"} {
		for _, health := range []string{"ready", "stale"} {
			t.Run(phase+"/"+health, func(t *testing.T) {
				enabled := true
				wakes := 0
				e := &Engine{wake: func() { wakes++ }, settings: func() runtimeconfig.AgentActivitySettings {
					return runtimeconfig.AgentActivitySettings{Enabled: enabled}
				}}
				now := time.Now()
				s := validSnapshot(now)
				s.Phase, s.Health = phase, health
				e.accept(s, now)
				e.accept(s, now.Add(5*time.Second))
				want := 1
				if health == "ready" && phase != "stale" && phase != "unavailable" && phase != "invalid" {
					want = 2
				}
				if wakes != want {
					t.Fatalf("enabled wakes=%d want=%d", wakes, want)
				}
				enabled = false
				e.accept(s, now.Add(10*time.Second))
				if wakes != want {
					t.Fatal("disabled activity renewed the lease")
				}
				s.Health = "stopped"
				e.accept(s, now.Add(11*time.Second))
				if wakes != want+1 {
					t.Fatal("health change did not clear previous presentation")
				}
			})
		}
	}
}

func TestActiveProvidersFollowAggregatePhaseAndRecency(t *testing.T) {
	s := Snapshot{Health: "ready", Phase: "waiting_for_answer", Sources: []Source{
		{ID: "codex", UsageProvider: "codex"}, {ID: "claude-code", UsageProvider: "claude"},
	}, Sessions: []Session{
		{ID: "a", Source: "codex", Phase: "working", ObservedAt: 99},
		{ID: "b", Source: "claude-code", Phase: "waiting_for_answer", ObservedAt: 10},
		{ID: "c", Source: "unknown", Phase: "waiting_for_answer", ObservedAt: 100},
	}}
	if got := s.ActiveProviders(); len(got) != 1 || got[0] != "claude" {
		t.Fatalf("wait lost priority: %v", got)
	}
	s.Sessions[0].Phase = "waiting_for_answer"
	if got := s.ActiveProviders(); len(got) != 2 || got[0] != "codex" {
		t.Fatalf("recency lost: %v", got)
	}
	s.Sessions[1].ObservedAt = 99
	if got := s.ActiveProviders(); got[0] != "codex" {
		t.Fatalf("tie unstable: %v", got)
	}
	for _, phase := range []string{"idle", "stale", "unavailable", "invalid"} {
		s.Phase = phase
		if got := s.ActiveProviders(); len(got) != 0 {
			t.Fatalf("passive %s selected %v", phase, got)
		}
	}
	s.Phase = "waiting_for_answer"
	s.Health = "stale"
	if got := s.ActiveProviders(); len(got) != 0 {
		t.Fatalf("stale engine selected %v", got)
	}
}

func TestConfigureFencesBufferedPreToggleObservations(t *testing.T) {
	now := time.Now()
	old := validSnapshot(now)
	old.Phase = "waiting_for_answer"
	cleared := old
	cleared.ObservationEpoch = 1
	cleared.Phase = "unavailable"
	cleared.Sessions = nil
	token := strings.Repeat("a", 64)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { json.NewEncoder(w).Encode(cleared) }))
	defer server.Close()
	dir := t.TempDir()
	endpoint, _ := json.Marshal(map[string]string{"url": server.URL, "token": token})
	if err := os.WriteFile(filepath.Join(dir, "endpoint.json"), endpoint, 0600); err != nil {
		t.Fatal(err)
	}
	engine := &Engine{runtimeDir: dir}
	engine.accept(old, now)
	if _, err := engine.Configure(context.Background(), false); err != nil {
		t.Fatal(err)
	}
	if engine.Snapshot().Phase != "unavailable" {
		t.Fatal("old wait escaped after toggle acknowledgment")
	}
	engine.accept(old, time.Now()) // A buffered pre-toggle stdout line arrives late.
	if engine.Snapshot().Phase != "unavailable" {
		t.Fatal("buffered wait escaped the generation fence")
	}
	engine.accept(cleared, time.Now())
	if engine.Snapshot().Health != "ready" {
		t.Fatal("current stream generation was not accepted")
	}
	newer := cleared
	newer.Instance = "restarted"
	newer.ObservationEpoch = 0
	newer.Phase = "working"
	engine.accept(newer, time.Now())
	if engine.Snapshot().Phase != "working" {
		t.Fatal("old generation blocked the restarted engine")
	}
}
