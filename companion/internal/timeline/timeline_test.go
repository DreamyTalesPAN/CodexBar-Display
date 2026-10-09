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
			// Eight components, so the bound per component is not the one tested.
			Component: fmt.Sprintf("%s%d", long[:maxFieldLen-1], i%8), DeviceID: long, State: fmt.Sprintf("%s%04d", long[:maxFieldLen-4], i), Reason: long, CorrelationID: long,
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

// Issue #581: a second process on the same home folder wrote the whole file
// from its own memory and erased the first one's events.
func TestAReadOnlyStoreLeavesTheFileToItsWriter(t *testing.T) {
	path := filepath.Join(t.TempDir(), "timeline.json")
	reader := OpenReadOnly(path)
	reader.Record(t0, Event{Component: "device", State: "unreachable"})
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("a read-only store created the file: %v", err)
	}
	if log := reader.Snapshot(t0); len(log.Events) != 0 || len(log.Current) != 0 {
		t.Fatalf("a read-only store kept its own event: %+v", log)
	}

	writer := Open(path)
	writer.Record(t0, Event{Component: "companion", State: "started"})
	reader.Record(t0.Add(time.Second), Event{Component: "device", State: "unreachable"})
	writer.Record(t0.Add(time.Minute), Event{Component: "device", State: "reachable"})
	saved, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	// The reader shows what the writer saved, also what came after its first look.
	log := reader.Snapshot(t0.Add(time.Hour))
	if got := strings.Join(states(log), " "); got != "companion=started device=reachable" || log.Events[1].ID != 2 || len(log.Current) != 2 {
		t.Fatalf("reader = %q %+v", got, log)
	}
	if latest, ok := reader.Latest("device"); !ok || latest.State != "reachable" {
		t.Fatalf("reader latest = %+v", latest)
	}
	if after, _ := os.ReadFile(path); string(after) != string(saved) {
		t.Fatalf("reading changed the file:\n%s\n%s", saved, after)
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

// Review of the port: with two providers shown in turn every 30 seconds the
// provider changes 960 times in eight hours. That must not push the start of
// the runtime, the VibeTV's state or an update out of the timeline.
func TestOneBusyComponentCannotPushOutTheRest(t *testing.T) {
	store := Open("")
	store.Record(t0, Event{Component: "companion", State: "started"})
	store.Record(t0, Event{Component: "device", State: "reachable"})
	store.Record(t0, Event{Component: "firmware", State: "1.14.2"})
	for i := 0; i < 960; i++ {
		provider := []string{"codex", "claude"}[i%2]
		store.Record(t0.Add(time.Duration(i)*30*time.Second), Event{Component: "provider", State: provider})
	}
	at := t0.Add(8 * time.Hour)
	store.Record(at, Event{Component: "device", State: "unreachable", Reason: "runtime/serial-write"})

	log := store.Snapshot(at)
	got := strings.Join(states(log), " ")
	for _, want := range []string{"companion=started", "device=reachable", "firmware=1.14.2", "device=unreachable"} {
		if !strings.Contains(got, want) {
			t.Fatalf("%s was pushed out by %d provider changes", want, strings.Count(got, "provider="))
		}
	}
	if n := strings.Count(got, "provider="); n != maxPerComponent {
		t.Fatalf("provider events kept = %d, want the newest %d", n, maxPerComponent)
	}
	// Which provider was shown when the VibeTV stopped answering.
	if before := log.Events[len(log.Events)-2]; before.Component != "provider" || before.State != "claude" {
		t.Fatalf("event before the failure = %+v", before)
	}
}

// Review of the port: once retention had dropped the event that said "device
// reachable", the next report of the same state was recorded as a new event
// with the current time. The latest state of every component is kept, and
// saved, apart from the list retention shortens.
func TestAnUnchangedStateIsNotRecordedAgainAfterItsEventWasDropped(t *testing.T) {
	path := filepath.Join(t.TempDir(), "timeline.json")
	store := Open(path)
	store.Record(t0, Event{Component: "device", DeviceID: "vibetv-1", State: "reachable"})
	for i := 0; i < maxEvents+50; i++ {
		store.Record(t0.Add(time.Duration(i)*time.Second), Event{Component: fmt.Sprintf("c%d", i%6), State: fmt.Sprintf("s%d", i)})
	}
	later := t0.Add(5 * time.Hour)
	if got := strings.Join(states(store.Snapshot(later)), " "); strings.Contains(got, "device=") {
		t.Fatalf("the test needs the device event dropped: %s", got)
	}

	for _, s := range []*Store{store, Open(path)} {
		s.Record(later, Event{Component: "device", DeviceID: "vibetv-1", State: "reachable"})
		log := s.Snapshot(later)
		if got := strings.Join(states(log), " "); strings.Contains(got, "device=") {
			t.Fatalf("an unchanged state was recorded again: %s", got)
		}
		var current []string
		for _, event := range log.Current {
			if event.Component == "device" {
				current = append(current, event.State+"@"+event.At)
			}
		}
		if strings.Join(current, " ") != "reachable@2026-10-06T08:00:00Z" {
			t.Fatalf("current device state = %v, want reachable since the first report", current)
		}
	}

	// The same after the event aged out, and a real change is still recorded.
	old := t0.Add(maxAge + time.Hour)
	store.Record(old, Event{Component: "device", DeviceID: "vibetv-1", State: "reachable"})
	if got := len(store.Snapshot(old).Events); got != 0 {
		t.Fatalf("an aged-out state was recorded again: %d events", got)
	}
	store.Record(old, Event{Component: "device", State: "unreachable"})
	if got := states(store.Snapshot(old)); len(got) != 1 || got[0] != "device=unreachable" {
		t.Fatalf("a change after eviction = %v", got)
	}
}

func TestTheCurrentStatesAreBounded(t *testing.T) {
	store := Open("")
	for i := 0; i < maxComponents+20; i++ {
		store.Record(t0, Event{Component: fmt.Sprintf("c%d", i), State: "x"})
	}
	if got := len(store.Snapshot(t0).Current); got != maxComponents {
		t.Fatalf("current states = %d, want at most %d", got, maxComponents)
	}
}
