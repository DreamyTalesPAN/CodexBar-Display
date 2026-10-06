package timeline

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

var t0 = time.Date(2026, 10, 6, 8, 0, 0, 0, time.UTC)

func states(log Log) []string {
	out := []string{}
	for _, event := range log.Events {
		out = append(out, event.Component+"="+event.State)
	}
	return out
}

func TestRecordKeepsTransitionsNotPolls(t *testing.T) {
	store := Open("")
	for i := 0; i < 50; i++ {
		store.Record(t0.Add(time.Duration(i)*time.Second), Event{Component: "device", DeviceID: "vibetv-1", State: "reachable"})
		store.Record(t0.Add(time.Duration(i)*time.Second), Event{Component: "stream", DeviceID: "vibetv-1", State: "sending"})
	}
	store.Record(t0.Add(time.Minute), Event{Component: "device", State: "unreachable", Reason: "runtime/serial-write"})
	store.Record(t0.Add(2*time.Minute), Event{Component: "device", State: "unreachable", Reason: "runtime/serial-write"})
	store.Record(t0.Add(3*time.Minute), Event{Component: "device", DeviceID: "vibetv-1", State: "reachable"})

	log := store.Snapshot(t0.Add(time.Hour))
	want := "device=reachable stream=sending device=unreachable device=reachable"
	if got := strings.Join(states(log), " "); got != want {
		t.Fatalf("events = %q, want %q", got, want)
	}
	if log.Version != Version {
		t.Fatalf("version = %d", log.Version)
	}
	if first := log.Events[0]; first.ID != 1 || first.At != "2026-10-06T08:00:00Z" {
		t.Fatalf("first event = %+v", first)
	}
	if log.Events[2].Reason != "runtime/serial-write" || log.Events[2].ID != 3 {
		t.Fatalf("failure event = %+v", log.Events[2])
	}
}

func TestANewRunOrSetupSessionRecordsItsStateAgain(t *testing.T) {
	store := Open("")
	store.Record(t0, Event{Component: "stream", State: "started", CorrelationID: "run-1"})
	store.Record(t0, Event{Component: "stream", State: "started", CorrelationID: "run-1"})
	store.Record(t0, Event{Component: "stream", State: "started", CorrelationID: "run-2"})
	if got := len(store.Snapshot(t0).Events); got != 2 {
		t.Fatalf("events = %d, want one per run", got)
	}
}

func TestRecordRedactsEverythingThatIsNotAnIdentifier(t *testing.T) {
	path := filepath.Join(t.TempDir(), "timeline.json")
	store := Open(path)
	secrets := []string{
		"http://192.168.178.40/frame?token=abc123",                // device URL with pairing token
		"0123456789abcdef0123456789abcdef",                        // pairing token
		"sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",       // API key
		"/Users/paul/Library/Application Support/VibeTV/cfg.json", // private path
		`C:\Users\paul\AppData\Local\VibeTV`,                      // private path
		"Write a poem about my quarterly numbers",                 // prompt
		"codexbar usage --json --provider codex",                  // command
		`{"v":2,"provider":"codex","session":41}`,                 // raw payload
		strings.Repeat("a-", 40),                                  // over the field limit
	}
	for i, secret := range secrets {
		store.Record(t0.Add(time.Duration(i)*time.Second), Event{
			Component: "device", DeviceID: secret, State: fmt.Sprintf("s%d", i), Reason: secret, CorrelationID: secret,
		})
		store.Record(t0, Event{Component: secret, State: "x"})
		store.Record(t0, Event{Component: fmt.Sprintf("c%d", i), State: secret})
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range secrets {
		for _, fragment := range []string{secret, "abc123", "paul", "poem", "--json", "0123456789abcdef0123"} {
			if strings.Contains(string(raw), fragment) {
				t.Fatalf("saved timeline leaks %q:\n%s", fragment, raw)
			}
		}
	}
	for _, event := range store.Snapshot(t0).Events {
		if event.Component == "device" && (event.DeviceID != redacted || event.Reason != redacted || event.CorrelationID != redacted) {
			t.Fatalf("event kept a secret: %+v", event)
		}
	}

	// What the product really records passes unchanged.
	for _, value := range []string{"vibetv-8caab5", "esp8266-123abc", "runtime/serial-write", "vibetv_not_found", "1.14.2", "mini-classic", "9f3c2b1a5d6e7f80"} {
		if got := cleanField(value); got != value {
			t.Fatalf("cleanField(%q) = %q", value, got)
		}
	}
}

func TestRetentionIsBoundedByCountAgeAndSize(t *testing.T) {
	path := filepath.Join(t.TempDir(), "timeline.json")
	store := Open(path)
	long := strings.Repeat("x-", maxFieldLen/2)
	for i := 0; i < maxEvents+150; i++ {
		store.Record(t0.Add(time.Duration(i)*time.Second), Event{
			Component: long, DeviceID: long, State: fmt.Sprintf("%s%04d", long[:maxFieldLen-4], i), Reason: long, CorrelationID: long,
		})
	}
	log := store.Snapshot(t0.Add(time.Hour))
	if len(log.Events) != maxEvents {
		t.Fatalf("events = %d, want %d", len(log.Events), maxEvents)
	}
	if log.Events[0].ID != 151 || log.Events[maxEvents-1].ID != maxEvents+150 {
		t.Fatalf("kept IDs %d..%d, want the newest", log.Events[0].ID, log.Events[maxEvents-1].ID)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Size() > 200*1024 {
		t.Fatalf("a full timeline of longest fields is %d bytes, want at most 200 KB", info.Size())
	}

	// Age: the next event a month later leaves only itself.
	later := t0.Add(maxAge + 2*time.Hour)
	store.Record(later, Event{Component: "companion", State: "started"})
	if got := states(store.Snapshot(later)); len(got) != 1 || got[0] != "companion=started" {
		t.Fatalf("after %s: %v", maxAge, got)
	}
	// Reading alone also hides what has aged out.
	if got := len(store.Snapshot(later.Add(maxAge + time.Hour)).Events); got != 0 {
		t.Fatalf("aged-out events still reported: %d", got)
	}
}

func TestHistorySurvivesARestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "timeline.json")
	first := Open(path)
	first.Record(t0, Event{Component: "companion", State: "started", CorrelationID: "run-1"})
	first.Record(t0, Event{Component: "device", DeviceID: "vibetv-1", State: "reachable", CorrelationID: "run-1"})

	second := Open(path)
	second.Record(t0.Add(time.Hour), Event{Component: "companion", State: "started", CorrelationID: "run-2"})
	log := second.Snapshot(t0.Add(time.Hour))
	if len(log.Events) != 3 || log.Events[2].ID != 3 || log.Events[2].CorrelationID != "run-2" {
		t.Fatalf("restarted timeline = %+v", log.Events)
	}
}

func TestCorruptedHistoryStartsAnEmptyTimeline(t *testing.T) {
	for name, content := range map[string]string{
		"truncated":       `{"version":1,"events":[{"id":1,"at":"2026-10-06T08:00:00Z","compon`,
		"not json":        "\x00\x00\x00garbage",
		"empty":           "",
		"other version":   `{"version":99,"events":[{"id":1,"at":"2026-10-06T08:00:00Z","component":"device","state":"reachable"}]}`,
		"ids not rising":  `{"version":1,"events":[{"id":5,"at":"2026-10-06T08:00:00Z","component":"a","state":"b"},{"id":5,"at":"2026-10-06T08:00:00Z","component":"c","state":"d"}]}`,
		"bad timestamp":   `{"version":1,"events":[{"id":1,"at":"yesterday","component":"a","state":"b"}]}`,
		"missing state":   `{"version":1,"events":[{"id":1,"at":"2026-10-06T08:00:00Z","component":"a"}]}`,
		"events not list": `{"version":1,"events":"none"}`,
	} {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "timeline.json")
			if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
				t.Fatal(err)
			}
			store := Open(path)
			if got := len(store.Snapshot(t0).Events); got != 0 {
				t.Fatalf("damaged history reported %d events", got)
			}
			store.Record(t0, Event{Component: "companion", State: "started"})
			reopened := Open(path).Snapshot(t0)
			if len(reopened.Events) != 1 || reopened.Events[0].ID != 1 {
				t.Fatalf("timeline after damage = %+v", reopened.Events)
			}
		})
	}
}

func TestAnUnwritableLocationStillRecordsForThisRun(t *testing.T) {
	blocker := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(blocker, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	store := Open(filepath.Join(blocker, "timeline.json"))
	store.Record(t0, Event{Component: "companion", State: "started"})
	if got := len(store.Snapshot(t0).Events); got != 1 {
		t.Fatalf("events = %d", got)
	}
}

func TestClockChangesKeepOrderAndHistory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "timeline.json")
	store := Open(path)
	store.Record(t0, Event{Component: "device", State: "reachable"})
	// The clock is set back two days: the event is newer but dated earlier.
	back := t0.Add(-48 * time.Hour)
	store.Record(back, Event{Component: "device", State: "unreachable"})
	store.Record(back.Add(time.Minute), Event{Component: "device", State: "reachable"})

	log := Open(path).Snapshot(back.Add(time.Hour))
	if len(log.Events) != 3 {
		t.Fatalf("a clock set back lost history: %+v", log.Events)
	}
	for i, event := range log.Events {
		if event.ID != int64(i+1) {
			t.Fatalf("event %d has ID %d; IDs must follow the order of recording", i, event.ID)
		}
	}
	if log.Events[1].At >= log.Events[0].At {
		t.Fatalf("test did not set the clock back: %+v", log.Events)
	}

	// The clock jumps far ahead: old events age out, the timeline stays usable.
	ahead := t0.Add(400 * 24 * time.Hour)
	store.Record(ahead, Event{Component: "device", State: "unreachable"})
	log = store.Snapshot(ahead)
	if len(log.Events) != 1 || log.Events[0].ID != 4 {
		t.Fatalf("after a jump ahead = %+v", log.Events)
	}
	// And back again: the future-dated event is kept, and bounded by count.
	store.Record(t0, Event{Component: "device", State: "reachable"})
	if got := len(store.Snapshot(t0).Events); got != 2 {
		t.Fatalf("after the clock returned = %d events", got)
	}
}

func TestConcurrentWritersAndReaders(t *testing.T) {
	path := filepath.Join(t.TempDir(), "timeline.json")
	store := Open(path)
	const writers, perWriter = 8, 60
	var wg sync.WaitGroup
	for w := 0; w < writers; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			for i := 0; i < perWriter; i++ {
				store.Record(t0, Event{Component: fmt.Sprintf("writer-%d", w), State: fmt.Sprintf("state-%d", i)})
				_ = store.Snapshot(t0)
			}
		}(w)
	}
	wg.Wait()

	log := Open(path).Snapshot(t0)
	if len(log.Events) != maxEvents {
		t.Fatalf("events = %d, want the %d newest of %d", len(log.Events), maxEvents, writers*perWriter)
	}
	lastState := map[string]int{}
	for i, event := range log.Events {
		if i > 0 && event.ID != log.Events[i-1].ID+1 {
			t.Fatalf("IDs %d then %d: an event was lost or written twice", log.Events[i-1].ID, event.ID)
		}
		var n int
		if _, err := fmt.Sscanf(event.State, "state-%d", &n); err != nil {
			t.Fatal(err)
		}
		if previous, ok := lastState[event.Component]; ok && n != previous+1 {
			t.Fatalf("%s went from state-%d to state-%d", event.Component, previous, n)
		}
		lastState[event.Component] = n
	}
	if log.Events[len(log.Events)-1].ID != writers*perWriter {
		t.Fatalf("last ID = %d", log.Events[len(log.Events)-1].ID)
	}
}

func TestANilStoreRecordsNothing(t *testing.T) {
	var store *Store
	store.Record(t0, Event{Component: "device", State: "reachable"})
	if log := store.Snapshot(t0); log.Version != Version || len(log.Events) != 0 {
		t.Fatalf("nil store = %+v", log)
	}
}
