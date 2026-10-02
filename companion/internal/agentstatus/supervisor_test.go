package agentstatus

import (
	"bufio"
	"context"
	"encoding/json"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"sync/atomic"
	"testing"
	"time"
)

// The test executable substitutes for the bundled runtime so the process,
// pipe, watchdog and restart contract runs on Windows and Mac alike.
func TestMain(m *testing.M) {
	if mode := os.Getenv("VIBETV_TEST_ENGINE_PROCESS"); mode != "" {
		if expected := os.Getenv("VIBETV_TEST_ENGINE_ENABLED"); expected != "" && os.Args[len(os.Args)-2] != expected {
			os.Exit(2)
		}
		if expected := os.Getenv("VIBETV_TEST_ENGINE_DONE"); expected != "" && os.Args[len(os.Args)-1] != expected {
			os.Exit(3)
		}
		if mode == "duration" {
			go func() {
				ticker := time.NewTicker(50 * time.Millisecond)
				defer ticker.Stop()
				for range ticker.C {
					_ = json.NewEncoder(os.Stdout).Encode(validSnapshot(time.Now()))
				}
			}()
			reader := bufio.NewScanner(os.Stdin)
			for reader.Scan() {
				_ = os.WriteFile(os.Getenv("VIBETV_TEST_ENGINE_MARKER"), reader.Bytes(), 0600)
			}
			os.Exit(0)
		}
		if mode == "silent" {
			_, _ = io.Copy(io.Discard, os.Stdin)
			os.Exit(0)
		}
		marker := os.Getenv("VIBETV_TEST_ENGINE_MARKER")
		if _, err := os.Stat(marker); os.IsNotExist(err) {
			_ = os.WriteFile(marker, []byte("started"), 0600)
			_, _ = os.Stdout.WriteString("invalid snapshot\n")
			os.Exit(0)
		}
		encoder := json.NewEncoder(os.Stdout)
		_ = encoder.Encode(validSnapshot(time.Now()))
		_, _ = io.Copy(io.Discard, os.Stdin)
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func helperDirectory(t *testing.T, mode string) string {
	t.Helper()
	dir := t.TempDir()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(executable)
	if err != nil {
		t.Fatal(err)
	}
	name := "node"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	if err := os.WriteFile(filepath.Join(dir, name), data, 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VIBETV_TEST_ENGINE_PROCESS", mode)
	t.Setenv("VIBETV_TEST_ENGINE_MARKER", filepath.Join(dir, "first-start"))
	return dir
}

func waitHealth(t *testing.T, engine *Engine, expected string, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if engine.Snapshot().Health == expected {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("wanted %s, got %+v", expected, engine.Snapshot())
}

func TestSupervisorRestartsInvalidChildAndStopsOnCancellation(t *testing.T) {
	dir := helperDirectory(t, "restart")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	t.Setenv("VIBETV_TEST_ENGINE_ENABLED", "true")
	engine := Start(ctx, dir, t.TempDir(), func() runtimeconfig.AgentActivitySettings { return runtimeconfig.AgentActivitySettings{Enabled: true} }, nil)
	waitHealth(t, engine, "ready", 10*time.Second)
	cancel()
	waitHealth(t, engine, "stopped", 5*time.Second)
}

func TestSupervisorReapsSilentChild(t *testing.T) {
	dir := helperDirectory(t, "silent")
	t.Setenv("VIBETV_TEST_ENGINE_ENABLED", "false")
	engine := &Engine{}
	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	engine.run(ctx, dir, t.TempDir())
	if elapsed := time.Since(start); elapsed < 14*time.Second || elapsed >= 20*time.Second {
		t.Fatalf("heartbeat watchdog did not terminate the silent runtime: %s", elapsed)
	}
	if engine.Snapshot().Phase != "unavailable" {
		t.Fatal("silent process advertised activity")
	}
}

func TestSupervisorAppliesSavedDoneDurationWithoutRestart(t *testing.T) {
	dir := helperDirectory(t, "duration")
	t.Setenv("VIBETV_TEST_ENGINE_DONE", "120")
	var duration atomic.Int32
	duration.Store(120)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	engine := Start(ctx, dir, t.TempDir(), func() runtimeconfig.AgentActivitySettings {
		return runtimeconfig.AgentActivitySettings{DoneDuration: strconv.Itoa(int(duration.Load()))}
	}, nil)
	waitHealth(t, engine, "ready", 5*time.Second)
	duration.Store(300)
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		data, _ := os.ReadFile(os.Getenv("VIBETV_TEST_ENGINE_MARKER"))
		if string(data) == "300" {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("running engine did not receive the changed done duration")
}
