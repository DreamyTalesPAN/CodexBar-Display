package agentstatus

import (
	"encoding/json"
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
