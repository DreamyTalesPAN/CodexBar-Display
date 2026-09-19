// Package agentstatus supervises the bundled Clawd observer. It contains no
// provider parsing or lifecycle inference; those belong to the engine.
package agentstatus

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/childproc"
)

type Session struct {
	ID           string `json:"id"`
	ParentID     string `json:"parentId,omitempty"`
	Source       string `json:"source"`
	Phase        string `json:"phase"`
	Reason       string `json:"reason"`
	ObservedAt   int64  `json:"observedAt"`
	CompletionID string `json:"completionId,omitempty"`
	ErrorKind    string `json:"errorKind,omitempty"`
}
type Source struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	Transport        string `json:"transport"`
	CapabilityLevel  string `json:"capabilityLevel"`
	ExplicitThinking bool   `json:"explicitThinking"`
	Connection       string `json:"connection"`
}
type Snapshot struct {
	SchemaVersion    int       `json:"schemaVersion"`
	EngineVersion    string    `json:"engineVersion"`
	UpstreamRevision string    `json:"upstreamRevision"`
	Instance         string    `json:"instance"`
	GeneratedAt      int64     `json:"generatedAt"`
	Health           string    `json:"health"`
	Phase            string    `json:"phase"`
	Sessions         []Session `json:"sessions"`
	Sources          []Source  `json:"sources"`
}

func ValidPhase(value string) bool {
	switch value {
	case "idle", "working", "thinking", "tool_use", "compacting", "waiting_for_permission", "waiting_for_answer", "waiting_for_review", "done", "error", "stale", "unavailable":
		return true
	}
	return false
}

var idPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)
var sourcePattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,47}$`)

func decode(data []byte, now time.Time) (Snapshot, error) {
	var s Snapshot
	if len(data) > 65536 || json.Unmarshal(data, &s) != nil {
		return s, errors.New("invalid engine output")
	}
	if s.SchemaVersion != 1 || s.Health != "ready" || !ValidPhase(s.Phase) || len(s.Sessions) > 20 || len(s.Sources) > 64 || len(s.Instance) > 64 || s.Instance == "" || len(s.EngineVersion) > 32 || len(s.UpstreamRevision) > 64 || s.GeneratedAt > now.Add(5*time.Second).UnixMilli() || s.GeneratedAt < now.Add(-15*time.Second).UnixMilli() {
		return s, errors.New("invalid engine contract")
	}
	seen := map[string]bool{}
	for _, row := range s.Sessions {
		if (row.ParentID != "" && !idPattern.MatchString(row.ParentID)) || !idPattern.MatchString(row.ID) || seen[row.ID] || !sourcePattern.MatchString(row.Source) || !ValidPhase(row.Phase) || len(row.Reason) > 64 || len(row.ErrorKind) > 16 || row.ObservedAt > s.GeneratedAt || row.ObservedAt < 0 || (row.CompletionID != "" && !idPattern.MatchString(row.CompletionID)) {
			return s, errors.New("invalid engine session")
		}
		seen[row.ID] = true
	}
	for _, source := range s.Sources {
		if !sourcePattern.MatchString(source.ID) || len(source.Name) > 80 || len(source.Transport) > 32 || len(source.CapabilityLevel) > 32 || len(source.Connection) > 24 {
			return s, errors.New("invalid engine source")
		}
	}
	return s, nil
}

type Engine struct {
	mu         sync.RWMutex
	value      Snapshot
	received   time.Time
	wake       func()
	runtimeDir string
}

func (e *Engine) accept(value Snapshot, now time.Time) {
	e.mu.Lock()
	changed := e.value.Phase != value.Phase || e.value.Health != value.Health || !slices.Equal(e.value.Sessions, value.Sessions) || !slices.Equal(e.value.Sources, value.Sources)
	e.value = value
	e.received = now
	e.mu.Unlock()
	if changed && e.wake != nil {
		e.wake()
	}
}
func (e *Engine) unavailable(reason string) {
	e.accept(Snapshot{SchemaVersion: 1, Health: reason, Phase: "unavailable", Sessions: []Session{}, Sources: []Source{}}, time.Now())
}
func (e *Engine) Snapshot() Snapshot { return e.snapshotAt(time.Now()) }
func (e *Engine) snapshotAt(now time.Time) Snapshot {
	e.mu.RLock()
	defer e.mu.RUnlock()
	s := e.value
	if e.received.IsZero() || now.Sub(e.received) > 15*time.Second || now.Before(e.received) {
		return Snapshot{SchemaVersion: 1, Health: "stale", Phase: "unavailable", Sessions: []Session{}, Sources: []Source{}}
	}
	s.Sessions = append([]Session{}, s.Sessions...)
	s.Sources = append([]Source{}, s.Sources...)
	return s
}

// BundledDirectory has the same relative layout in Mac Contents/Helpers and the
// Windows installation folder. The normal app updater replaces the whole unit.
func BundledDirectory() string {
	executable, err := os.Executable()
	if err != nil {
		return ""
	}
	return filepath.Join(filepath.Dir(executable), "agent-engine")
}
func Start(ctx context.Context, directory, runtimeDir string, wake func()) *Engine {
	e := &Engine{wake: wake, runtimeDir: runtimeDir}
	e.unavailable("starting")
	go func() {
		for ctx.Err() == nil {
			e.run(ctx, directory, runtimeDir)
			if ctx.Err() != nil {
				break
			}
			e.unavailable("unavailable")
			select {
			case <-ctx.Done():
			case <-time.After(5 * time.Second):
			}
		}
		e.unavailable("stopped")
	}()
	return e
}
func (e *Engine) run(ctx context.Context, directory, runtimeDir string) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	binary := "node"
	if runtime.GOOS == "windows" {
		binary = "node.exe"
	}
	cmd := childproc.Hide(exec.CommandContext(ctx, filepath.Join(directory, binary), filepath.Join(directory, "src", "main.cjs"), runtimeDir))
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return
	}
	defer stdin.Close()
	cmd.Stderr = io.Discard
	if cmd.Start() != nil {
		return
	}
	// A live process with no heartbeats must be restarted, too.
	watchdog := time.AfterFunc(15*time.Second, cancel)
	defer watchdog.Stop()
	defer cmd.Wait()
	defer cmd.Process.Kill()
	reader := bufio.NewScanner(stdout)
	reader.Buffer(make([]byte, 4096), 65536)
	for reader.Scan() {
		value, err := decode(reader.Bytes(), time.Now())
		if err != nil {
			return
		}
		watchdog.Reset(15 * time.Second)
		e.accept(value, time.Now())
	}
}

// Configure forwards an explicit user choice to Clawd. Source-specific paths,
// settings formats and hook ownership stay entirely inside the engine.
func (e *Engine) Configure(ctx context.Context, source string, enabled bool) (Snapshot, error) {
	if !sourcePattern.MatchString(source) {
		return Snapshot{}, errors.New("invalid agent source")
	}
	data, err := os.ReadFile(filepath.Join(e.runtimeDir, "endpoint.json"))
	if err != nil {
		return Snapshot{}, err
	}
	var endpoint struct {
		URL   string `json:"url"`
		Token string `json:"token"`
	}
	if len(data) > 4096 || json.Unmarshal(data, &endpoint) != nil {
		return Snapshot{}, errors.New("invalid engine endpoint")
	}
	parsed, err := url.Parse(endpoint.URL)
	if err != nil || parsed.Scheme != "http" || parsed.Hostname() != "127.0.0.1" || parsed.Port() == "" || parsed.User != nil || len(endpoint.Token) != 64 || strings.Trim(endpoint.Token, "abcdef0123456789") != "" {
		return Snapshot{}, errors.New("invalid engine endpoint")
	}
	payload, _ := json.Marshal(map[string]any{"source": source, "enabled": enabled})
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, parsed.Scheme+"://"+parsed.Host+"/integrations", bytes.NewReader(payload))
	if err != nil {
		return Snapshot{}, err
	}
	req.Header.Set("Authorization", "Bearer "+endpoint.Token)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	defer client.CloseIdleConnections()
	response, err := client.Do(req)
	if err != nil {
		return Snapshot{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return Snapshot{}, errors.New("agent integration could not be saved")
	}
	data, err = io.ReadAll(io.LimitReader(response.Body, 65537))
	if err != nil {
		return Snapshot{}, err
	}
	// Only the supervised stream owns the current snapshot. A delayed command
	// response must not overwrite a newer lifecycle event from that stream.
	return decode(data, time.Now())
}
