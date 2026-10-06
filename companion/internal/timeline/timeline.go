// Package timeline is the one bounded history of reliability transitions on
// this computer. Support reads it in the support report to see the order in
// which things happened: when the runtime started, when the VibeTV stopped
// answering, which update ran before the stream failed.
//
// It holds states, not text. Every field is a short identifier or an error
// code, so a token, a prompt, a command line, a file path or a payload cannot
// be stored: a value of any other shape is replaced by "redacted".
package timeline

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	// Version is the format of the saved file and of the support report entry.
	Version = 1

	// Retention: at most maxEvents events, none older than maxAge. With every
	// field capped at maxFieldLen the file stays below 200 KB.
	maxEvents   = 400
	maxAge      = 30 * 24 * time.Hour
	maxFieldLen = 64

	redacted = "redacted"
)

// Event is one transition: Component entered State, because of Reason.
type Event struct {
	// ID rises by one per event and never repeats in a file. It, not At, is the
	// order of events: the computer's clock can be set back.
	ID int64  `json:"id"`
	At string `json:"at"`
	// Component is the part that changed, e.g. "device", "stream",
	// "firmware_update".
	Component string `json:"component"`
	DeviceID  string `json:"deviceId,omitempty"`
	// State is what the component is now, e.g. "unreachable", "started", or
	// for "theme", "provider" and "firmware" the value now in use.
	State string `json:"state"`
	// Reason is the error code or cause of the transition.
	Reason string `json:"reason,omitempty"`
	// CorrelationID groups events that belong together: one run of the
	// background service, or one setup session.
	CorrelationID string `json:"correlationId,omitempty"`
}

// Log is the saved file and the support report entry.
type Log struct {
	Version int     `json:"version"`
	Events  []Event `json:"events"`
}

// Store owns the timeline file. One process writes it: the runtime, which
// holds the display writer lock. A nil Store records nothing.
type Store struct {
	mu     sync.Mutex
	path   string
	loaded bool
	events []Event
	nextID int64
}

// Open returns the store saved at path. The file is read on first use; an
// empty path keeps the timeline in memory.
func Open(path string) *Store {
	return &Store{path: path}
}

// Record adds a transition at the given time. An event that repeats the latest
// event of its component is not a transition and is dropped, so a caller may
// report its state on every poll.
func (s *Store) Record(at time.Time, event Event) {
	if s == nil {
		return
	}
	event.Component = cleanField(event.Component)
	event.State = cleanField(event.State)
	if event.Component == "" || event.State == "" {
		return
	}
	event.DeviceID = cleanField(event.DeviceID)
	event.Reason = cleanField(event.Reason)
	event.CorrelationID = cleanField(event.CorrelationID)
	event.At = at.UTC().Format(time.RFC3339)

	s.mu.Lock()
	defer s.mu.Unlock()
	s.loadLocked()
	for i := len(s.events) - 1; i >= 0; i-- {
		last := s.events[i]
		if last.Component != event.Component {
			continue
		}
		if last.DeviceID == event.DeviceID && last.State == event.State &&
			last.Reason == event.Reason && last.CorrelationID == event.CorrelationID {
			return
		}
		break
	}
	s.nextID++
	event.ID = s.nextID
	s.events = prune(append(s.events, event), at)
	s.saveLocked()
}

// Snapshot returns the retained events, oldest first.
func (s *Store) Snapshot(now time.Time) Log {
	out := Log{Version: Version, Events: []Event{}}
	if s == nil {
		return out
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.loadLocked()
	out.Events = append(out.Events, prune(s.events, now)...)
	return out
}

// loadLocked reads the saved file once. A missing, unreadable or damaged file,
// or one written in another format version, starts an empty timeline: history
// that cannot be trusted is not shown to support.
func (s *Store) loadLocked() {
	if s.loaded {
		return
	}
	s.loaded = true
	if s.path == "" {
		return
	}
	raw, err := os.ReadFile(s.path)
	if err != nil {
		return
	}
	var saved Log
	if err := json.Unmarshal(raw, &saved); err != nil || saved.Version != Version {
		return
	}
	for _, event := range saved.Events {
		if event.ID <= s.nextID || event.Component == "" || event.State == "" {
			// IDs only rise in a file this package wrote.
			s.events, s.nextID = nil, 0
			return
		}
		if _, err := time.Parse(time.RFC3339, event.At); err != nil {
			s.events, s.nextID = nil, 0
			return
		}
		s.nextID = event.ID
		s.events = append(s.events, event)
	}
}

// saveLocked replaces the file in one step, so a reader never sees half of it.
// A timeline that cannot be saved still works for this run.
func (s *Store) saveLocked() {
	if s.path == "" {
		return
	}
	raw, err := json.Marshal(Log{Version: Version, Events: s.events})
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return
	}
	if err := os.Rename(tmp, s.path); err != nil {
		_ = os.Remove(tmp)
	}
}

// prune drops events older than maxAge, then the oldest beyond maxEvents. An
// event dated after now (the clock was set back since) is kept: only the
// count bound removes it.
func prune(events []Event, now time.Time) []Event {
	cutoff := now.Add(-maxAge)
	kept := events[:0:0]
	for _, event := range events {
		if at, err := time.Parse(time.RFC3339, event.At); err == nil && at.Before(cutoff) {
			continue
		}
		kept = append(kept, event)
	}
	if len(kept) > maxEvents {
		kept = kept[len(kept)-maxEvents:]
	}
	return kept
}

var (
	// An identifier, a version, or an error code such as "runtime/serial-write".
	fieldPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9._-]+)?$`)
	// A long unbroken run of letters and digits is a token or a key.
	secretPattern = regexp.MustCompile(`[A-Za-z0-9]{24,}`)
)

func cleanField(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if len(value) > maxFieldLen || !fieldPattern.MatchString(value) || secretPattern.MatchString(value) {
		return redacted
	}
	return value
}
