package coldwarm

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/virtualvibetv"
)

type deviceStatus struct {
	Active          bool   `json:"active"`
	Connected       bool   `json:"connected"`
	Ready           bool   `json:"ready"`
	ConnectionState string `json:"connectionState"`
}

// TestColdWarm runs actual daemon processes and the protocol-faithful virtual
// device, with isolated state and no service installation or physical hardware.
func TestColdWarm(t *testing.T) {
	if os.Getenv("VIBETV_COLDWARM_E2E") != "1" {
		t.Skip("set VIBETV_COLDWARM_E2E=1 to run the process-level simulation")
	}
	work := filepath.Join(t.TempDir(), "simulation with spaces")
	if err := os.Mkdir(work, 0700); err != nil {
		t.Fatal(err)
	}
	suffix := ""
	if runtime.GOOS == "windows" {
		suffix = ".exe"
	}
	build := func(name, pkg string) string {
		t.Helper()
		path := filepath.Join(work, name+suffix)
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		cmd := exec.CommandContext(ctx, "go", "build", "-o", path, pkg)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("build %s: %v\n%s", pkg, err, out)
		}
		return path
	}
	companion := build("codexbar-display", "../../cmd/codexbar-display")
	mock := build("mock-codexbar", "./testdata/mock-codexbar")
	isolatedHome := filepath.Join(work, "home")
	configHome := filepath.Join(isolatedHome, ".config")
	if runtime.GOOS == "darwin" {
		configHome = filepath.Join(isolatedHome, "Library", "Application Support")
	}
	if runtime.GOOS == "windows" {
		configHome = filepath.Join(isolatedHome, "AppData", "Roaming")
	}
	runtimeRoot := filepath.Join(configHome, "codexbar-display")
	if err := os.MkdirAll(runtimeRoot, 0700); err != nil {
		t.Fatal(err)
	}
	// Reserve distinct loopback ports while selecting them, then release each
	// immediately before its owner starts. Never use the installed API port.
	reserve := func() net.Listener {
		t.Helper()
		l, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = l.Close() })
		return l
	}
	apiPort, devicePort := reserve(), reserve()
	apiAddr, deviceAddr := apiPort.Addr().String(), devicePort.Addr().String()
	config := fmt.Sprintf(`{"deviceTarget":%q,"deviceToken":"virtual-pair-token","deviceId":"virtual-vibetv-001","knownDevices":[{"deviceId":"virtual-vibetv-001","target":%q,"deviceToken":"virtual-pair-token"}]}`, "http://"+deviceAddr, "http://"+deviceAddr)
	if err := os.WriteFile(filepath.Join(runtimeRoot, "config.json"), []byte(config), 0600); err != nil {
		t.Fatal(err)
	}
	// Change only the child environment, leaving Go's build cache and the user's
	// own environment/state intact. Explicitly redirect provider configuration.
	var env []string
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		key = strings.ToUpper(key)
		if !strings.HasPrefix(key, "CODEXBAR_") && !strings.HasPrefix(key, "VIBETV_") {
			env = append(env, entry)
		}
	}
	env = append(env, "HOME="+isolatedHome, "USERPROFILE="+isolatedHome,
		"APPDATA="+configHome, "LOCALAPPDATA="+filepath.Join(isolatedHome, "AppData", "Local"),
		"XDG_CONFIG_HOME="+configHome, "CODEXBAR_CONFIG="+filepath.Join(work, "codexbar.json"),
		"CODEXBAR_DISPLAY_STREAM_LAUNCH_AGENT_LABEL=com.vibetv.simulation."+strconv.Itoa(os.Getpid()),
		"CODEXBAR_BIN="+mock)
	var daemon *exec.Cmd
	var daemonDone chan error
	var lease string
	var logs []string
	stopRuntime := func() {
		if daemon == nil {
			return
		}
		if runtime.GOOS == "windows" {
			// Windows locks running executable files. Reap the complete test-owned
			// process tree before TempDir cleanup, including the dashboard child.
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			_ = exec.CommandContext(ctx, "taskkill.exe", "/PID", strconv.Itoa(daemon.Process.Pid), "/T", "/F").Run()
			cancel()
		}
		_ = daemon.Process.Kill()
		select {
		case <-daemonDone:
		case <-time.After(10 * time.Second):
			t.Error("daemon did not exit after kill")
		}
		_ = os.Remove(lease)
		daemon = nil
	}
	t.Cleanup(func() {
		stopRuntime()
		if t.Failed() {
			for _, path := range append(logs, filepath.Join(runtimeRoot, "logs", "daemon.out.log")) {
				if data, err := os.ReadFile(path); err == nil {
					t.Logf("%s:\n%s", filepath.Base(path), data)
				}
			}
		}
	})
	startRuntime := func() {
		t.Helper()
		lease = filepath.Join(work, fmt.Sprintf("lease-%d", len(logs)))
		if err := os.WriteFile(lease, nil, 0600); err != nil {
			t.Fatal(err)
		}
		logPath := filepath.Join(work, fmt.Sprintf("runtime-%d.log", len(logs)))
		log, err := os.Create(logPath)
		if err != nil {
			t.Fatal(err)
		}
		logs = append(logs, logPath)
		daemon = exec.Command(companion, "daemon", "--transport", "wifi", "--interval", "30s", "--api-addr", apiAddr)
		daemon.Env = append(env, "VIBETV_SIMULATION_LEASE="+lease)
		daemon.Stdout, daemon.Stderr = log, log
		if err := daemon.Start(); err != nil {
			_ = log.Close()
			daemon = nil
			t.Fatal(err)
		}
		daemonDone = make(chan error, 1)
		cmd, done := daemon, daemonDone
		go func() { err := cmd.Wait(); _ = log.Close(); done <- err; close(done) }()
	}
	var device *virtualvibetv.RunningServer
	t.Cleanup(func() {
		if device != nil {
			_ = device.Close()
		}
	})
	startDevice := func() {
		t.Helper()
		cfg := virtualvibetv.DefaultConfig()
		cfg.HTTPListenAddr, cfg.RawOTAListenAddr, cfg.Firmware = deviceAddr, "127.0.0.1:0", "1.0.39"
		var err error
		device, err = virtualvibetv.Start(cfg)
		if err != nil {
			t.Fatal(err)
		}
	}
	client := &http.Client{Timeout: 3 * time.Second}
	t.Cleanup(client.CloseIdleConnections)
	waitFor := func(label string, timeout time.Duration, predicate func(deviceStatus) bool, assertOffline bool) {
		t.Helper()
		started := time.Now()
		last := "no status response"
		for time.Since(started) < timeout {
			select {
			case err := <-daemonDone:
				t.Fatalf("%s: daemon exited: %v", label, err)
			default:
			}
			resp, err := client.Get("http://" + apiAddr + "/v1/status")
			if err == nil {
				data, readErr := io.ReadAll(resp.Body)
				_ = resp.Body.Close()
				last = string(data)
				var status struct {
					Device *deviceStatus `json:"device"`
				}
				if readErr == nil && resp.StatusCode == http.StatusOK && json.Unmarshal(data, &status) == nil && status.Device != nil {
					d := *status.Device
					if assertOffline && (d.Connected || d.Ready) {
						t.Fatalf("%s: powered-off device reported connected/ready: %s", label, data)
					}
					if predicate(d) {
						t.Logf("%s PASS (%s): %+v", label, time.Since(started).Round(time.Millisecond), d)
						return
					}
				}
			} else {
				last = err.Error()
			}
			time.Sleep(250 * time.Millisecond)
		}
		t.Fatalf("%s timed out after %s; last status: %s", label, timeout, last)
	}
	connected := func(d deviceStatus) bool { return d.Connected }
	ready := func(d deviceStatus) bool { return d.Connected && d.Ready && d.ConnectionState == "ready" }
	assertFrame := func(previous int) {
		t.Helper()
		snap := device.Snapshot()
		if snap.FramesAccepted <= previous || len(snap.Violations) != 0 {
			t.Fatalf("no new valid frame: %+v", snap)
		}
	}
	_ = apiPort.Close()
	_ = devicePort.Close()
	startRuntime()
	waitFor("S1 cold runtime / device OFF", 20*time.Second, func(d deviceStatus) bool { return d.Active && d.ConnectionState == "reconnecting" }, true)
	startDevice()
	waitFor("S2a device ON / connected", 30*time.Second, connected, false)
	waitFor("S2b device ON / ready", 60*time.Second, ready, false)
	assertFrame(0)
	frames := device.Snapshot().FramesAccepted
	stopRuntime()
	startRuntime()
	waitFor("S3a warm daemon restart / connected", 30*time.Second, connected, false)
	waitFor("S3b warm daemon restart / ready", 60*time.Second, ready, false)
	assertFrame(frames)
	if err := device.Close(); err != nil {
		t.Fatal(err)
	}
	device = nil
	waitFor("S4a power OFF / honest drop", 150*time.Second, func(d deviceStatus) bool { return !d.Connected && !d.Ready }, false)
	startDevice()
	waitFor("S4b power ON / connected", 30*time.Second, connected, false)
	waitFor("S4c power ON / ready", 60*time.Second, ready, false)
	assertFrame(0)
}
