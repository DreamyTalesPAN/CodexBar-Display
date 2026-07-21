package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/writerlock"
)

func TestDisplayWriterLockAllowsOnlyOneDaemon(t *testing.T) {
	lockPath := filepath.Join(t.TempDir(), "display-writer.lock")
	first, err := writerlock.AcquireAt(lockPath)
	if err != nil {
		t.Fatalf("acquire first writer lock: %v", err)
	}
	defer first.Release()

	second, err := writerlock.AcquireAt(lockPath)
	if err == nil {
		second.Release()
		t.Fatal("second daemon acquired the same display writer lock")
	}
	if got := errcode.Of(err); got != errcode.RuntimeWriterLocked {
		t.Fatalf("second lock error code=%q want %q: %v", got, errcode.RuntimeWriterLocked, err)
	}

	first.Release()
	third, err := writerlock.AcquireAt(lockPath)
	if err != nil {
		t.Fatalf("lock stayed unavailable after owner exited: %v", err)
	}
	third.Release()
}

func TestParseDaemonOptionsWiFiTarget(t *testing.T) {
	opts, err := parseDaemonOptions([]string{
		"--transport", "wifi",
		"--target", "http://192.168.178.123",
		"--once",
	})
	if err != nil {
		t.Fatalf("parseDaemonOptions returned error: %v", err)
	}
	if opts.Transport != "wifi" {
		t.Fatalf("expected wifi transport, got %q", opts.Transport)
	}
	if opts.Target != "http://192.168.178.123" {
		t.Fatalf("unexpected target %q", opts.Target)
	}
	if !opts.Once {
		t.Fatalf("expected once option")
	}
}

func TestDeviceWriteCoordinatorDrainsActiveWriteAndBlocksNewWrites(t *testing.T) {
	coordinator := &deviceWriteCoordinator{}
	releaseActiveWrite := coordinator.beginWrite()
	pauseComplete := make(chan struct{})
	go func() {
		coordinator.setPaused(true)
		close(pauseComplete)
	}()

	select {
	case <-pauseComplete:
		t.Fatal("pause completed while a device write was still active")
	case <-time.After(25 * time.Millisecond):
	}
	if !coordinator.isPaused() {
		t.Fatal("coordinator did not reject new daemon cycles while draining")
	}

	releaseActiveWrite()
	select {
	case <-pauseComplete:
	case <-time.After(time.Second):
		t.Fatal("pause did not complete after active device write finished")
	}

	newWriteStarted := make(chan struct{})
	newWriteFinished := make(chan struct{})
	go func() {
		release := coordinator.beginWrite()
		close(newWriteStarted)
		release()
		close(newWriteFinished)
	}()
	select {
	case <-newWriteStarted:
		t.Fatal("new device write started during exclusive maintenance")
	case <-time.After(25 * time.Millisecond):
	}

	coordinator.setPaused(false)
	select {
	case <-newWriteFinished:
	case <-time.After(time.Second):
		t.Fatal("new device write stayed blocked after maintenance resumed")
	}
}

func TestParseDaemonOptionsDefaultsToWiFi(t *testing.T) {
	opts, err := parseDaemonOptions(nil)
	if err != nil {
		t.Fatalf("parseDaemonOptions returned error: %v", err)
	}
	if opts.Transport != "wifi" {
		t.Fatalf("expected wifi transport default, got %q", opts.Transport)
	}
	if opts.Target != "" {
		t.Fatalf("expected empty default WiFi target, got %q", opts.Target)
	}
	if opts.Interval != 0 {
		t.Fatalf("expected daemon runtime to choose default interval, got %s", opts.Interval)
	}
}

func TestParseDaemonCommandOptionsSupportsEmbeddedAPI(t *testing.T) {
	opts, err := parseDaemonCommandOptions([]string{
		"--transport", "wifi",
		"--api-addr", "127.0.0.1:47832",
		"--api-dev-origin", "http://localhost:3002",
	})
	if err != nil {
		t.Fatalf("parseDaemonCommandOptions returned error: %v", err)
	}
	if opts.Daemon.Transport != "wifi" {
		t.Fatalf("expected wifi transport, got %q", opts.Daemon.Transport)
	}
	if opts.APIAddr != "127.0.0.1:47832" {
		t.Fatalf("unexpected api addr %q", opts.APIAddr)
	}
	if opts.APIDevOrigin != "http://localhost:3002" {
		t.Fatalf("unexpected dev origin %q", opts.APIDevOrigin)
	}
}

func TestDisplayStreamLogUsesSharedApplicationSupportPathAndAppends(t *testing.T) {
	t.Setenv("CODEXBAR_DISPLAY_STREAM_OUT_LOG", "")
	home := t.TempDir()

	first, path, err := newDisplayStreamFileLogger(home)
	if err != nil {
		t.Fatalf("create first display stream logger: %v", err)
	}
	wantPath := filepath.Join(home, "Library", "Application Support", "codexbar-display", "logs", "daemon.out.log")
	if path != wantPath {
		t.Fatalf("expected display stream log %q, got %q", wantPath, path)
	}
	first.now = func() time.Time { return time.Date(2026, 7, 12, 10, 11, 12, 123456789, time.UTC) }
	first.logf("sent frame -> http://192.168.1.42 provider=codex session=12 weekly=34")

	second, secondPath, err := newDisplayStreamFileLogger(home)
	if err != nil {
		t.Fatalf("create second display stream logger: %v", err)
	}
	if secondPath != path {
		t.Fatalf("expected logger reopen at %q, got %q", path, secondPath)
	}
	second.now = func() time.Time { return time.Date(2026, 7, 12, 10, 11, 12, 987654321, time.UTC) }
	second.logf("cycle error: code=runtime_serial_write op=send-line")

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat display stream log: %v", err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("expected private display stream log mode 0600, got %04o", got)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read display stream log: %v", err)
	}
	content := string(raw)
	for _, want := range []string{"sent frame -> http://192.168.1.42", "cycle error: code=runtime_serial_write"} {
		if !strings.Contains(content, want) {
			t.Fatalf("expected appended log to contain %q, got %q", want, content)
		}
	}
	lines := strings.Split(strings.TrimSpace(content), "\n")
	if len(lines) != 2 {
		t.Fatalf("expected two timestamped log lines, got %q", content)
	}
	for _, line := range lines {
		parts := strings.Fields(line)
		if len(parts) < 2 {
			t.Fatalf("expected timestamped log line, got %q", line)
		}
		if _, err := time.Parse(time.RFC3339Nano, parts[0]); err != nil {
			t.Fatalf("expected RFC3339Nano timestamp in %q: %v", line, err)
		}
	}
	if !strings.HasPrefix(lines[0], "2026-07-12T10:11:12.123456789Z ") ||
		!strings.HasPrefix(lines[1], "2026-07-12T10:11:12.987654321Z ") {
		t.Fatalf("expected ordered subsecond timestamps, got %q", content)
	}
}

func TestDisplayStreamLoggerRedactsCredentials(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "daemon.out.log")
	t.Setenv("CODEXBAR_DISPLAY_STREAM_OUT_LOG", logPath)
	logger, _, err := newDisplayStreamFileLogger(t.TempDir())
	if err != nil {
		t.Fatalf("create display stream logger: %v", err)
	}
	logger.logf("request failed: GET http://user:password@192.168.1.42/frame?token=pair-secret&key=api-secret")

	raw, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("read display stream log: %v", err)
	}
	got := string(raw)
	for _, secret := range []string{"user:password", "pair-secret", "api-secret"} {
		if strings.Contains(got, secret) {
			t.Fatalf("display stream log leaked %q in %q", secret, got)
		}
	}
	for _, want := range []string{"http://<redacted>@192.168.1.42", "token=<redacted>", "key=<redacted>"} {
		if !strings.Contains(got, want) {
			t.Fatalf("expected redacted marker %q in %q", want, got)
		}
	}
}

func TestDisplayStreamLoggerRotatesToOneBoundedArchive(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "daemon.out.log")
	t.Setenv("CODEXBAR_DISPLAY_STREAM_OUT_LOG", logPath)
	logger, _, err := newDisplayStreamFileLogger(t.TempDir())
	if err != nil {
		t.Fatalf("create display stream logger: %v", err)
	}
	logger.maxBytes = 200
	logger.now = func() time.Time { return time.Date(2026, 7, 12, 10, 11, 12, 123456789, time.UTC) }

	logger.logf("first=%s", strings.Repeat("a", 80))
	logger.logf("second=%s", strings.Repeat("b", 80))
	logger.logf("third=%s", strings.Repeat("c", 80))

	archivePath := logPath + ".1"
	current, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("read current display stream log: %v", err)
	}
	archive, err := os.ReadFile(archivePath)
	if err != nil {
		t.Fatalf("read display stream log archive: %v", err)
	}
	if !bytes.Contains(current, []byte("third=")) || bytes.Contains(current, []byte("second=")) {
		t.Fatalf("expected only newest entry in current log, got %q", current)
	}
	if !bytes.Contains(archive, []byte("second=")) || bytes.Contains(archive, []byte("first=")) {
		t.Fatalf("expected one replaced archive, got %q", archive)
	}
	for name, data := range map[string][]byte{"current": current, "archive": archive} {
		if int64(len(data)) > logger.maxBytes {
			t.Fatalf("expected %s log <= %d bytes, got %d", name, logger.maxBytes, len(data))
		}
	}
}

func TestDisplayStreamLoggerBoundsOversizedExistingLog(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "daemon.out.log")
	t.Setenv("CODEXBAR_DISPLAY_STREAM_OUT_LOG", logPath)
	logger, _, err := newDisplayStreamFileLogger(t.TempDir())
	if err != nil {
		t.Fatalf("create display stream logger: %v", err)
	}
	logger.maxBytes = 200
	if err := os.WriteFile(logPath, []byte(strings.Repeat("legacy-data\n", 100)), 0o600); err != nil {
		t.Fatalf("write oversized legacy display stream log: %v", err)
	}

	logger.logf("fresh bounded entry")

	for _, path := range []string{logPath, logPath + ".1"} {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatalf("stat bounded display stream log %q: %v", path, err)
		}
		if info.Size() > logger.maxBytes {
			t.Fatalf("expected %q <= %d bytes, got %d", path, logger.maxBytes, info.Size())
		}
	}
	current, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("read bounded current display stream log: %v", err)
	}
	if !bytes.Contains(current, []byte("fresh bounded entry")) {
		t.Fatalf("new entry missing after bounding oversized log: %q", current)
	}
}

func TestDisplayStreamLoggerReopensAfterExternalRotation(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "daemon.out.log")
	t.Setenv("CODEXBAR_DISPLAY_STREAM_OUT_LOG", logPath)
	logger, _, err := newDisplayStreamFileLogger(t.TempDir())
	if err != nil {
		t.Fatalf("create display stream logger: %v", err)
	}
	if err := logger.startRuntimeSession("shop.vibetv.control-center.runtime"); err != nil {
		t.Fatalf("start display stream runtime session: %v", err)
	}
	logger.logf("before external rotation")

	externalPath := logPath + ".external"
	if err := os.Rename(logPath, externalPath); err != nil {
		t.Fatalf("externally rotate display stream log: %v", err)
	}
	logger.logf("after external rotation")

	oldData, err := os.ReadFile(externalPath)
	if err != nil {
		t.Fatalf("read externally rotated log: %v", err)
	}
	newData, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("read reopened display stream log: %v", err)
	}
	if !bytes.Contains(oldData, []byte("before external rotation")) || bytes.Contains(oldData, []byte("after external rotation")) {
		t.Fatalf("writer remained attached to externally rotated inode: %q", oldData)
	}
	if !bytes.Contains(newData, []byte("after external rotation")) {
		t.Fatalf("writer did not reopen current log path: %q", newData)
	}
	if !bytes.Contains(newData, []byte(`runtime event=stream-start label="shop.vibetv.control-center.runtime"`)) {
		t.Fatalf("reopened log is missing runtime start marker: %q", newData)
	}
}

func TestDisplayStreamLoggerWritesPreciseRuntimeStartMarker(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "daemon.out.log")
	t.Setenv("CODEXBAR_DISPLAY_STREAM_OUT_LOG", logPath)
	logger, _, err := newDisplayStreamFileLogger(t.TempDir())
	if err != nil {
		t.Fatalf("create display stream logger: %v", err)
	}
	logger.now = func() time.Time { return time.Date(2026, 7, 12, 10, 11, 12, 123456789, time.UTC) }
	if err := logger.startRuntimeSession("shop.vibetv.control-center.runtime"); err != nil {
		t.Fatalf("start display stream runtime session: %v", err)
	}

	raw, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("read display stream log: %v", err)
	}
	want := `2026-07-12T10:11:12.123456789Z runtime event=stream-start label="shop.vibetv.control-center.runtime"`
	if !bytes.Contains(raw, []byte(want)) {
		t.Fatalf("expected precise runtime start marker %q in %q", want, raw)
	}
}

func TestDisplayStreamLoggerPreservesRuntimeMarkerAcrossRotation(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "daemon.out.log")
	t.Setenv("CODEXBAR_DISPLAY_STREAM_OUT_LOG", logPath)
	logger, _, err := newDisplayStreamFileLogger(t.TempDir())
	if err != nil {
		t.Fatalf("create display stream logger: %v", err)
	}
	logger.maxBytes = 260
	logger.now = func() time.Time { return time.Date(2026, 7, 12, 10, 11, 12, 123456789, time.UTC) }
	if err := logger.startRuntimeSession("shop.vibetv.control-center.runtime"); err != nil {
		t.Fatalf("start display stream runtime session: %v", err)
	}
	logger.logf("first=%s", strings.Repeat("a", 80))
	logger.logf("second=%s", strings.Repeat("b", 80))

	marker := []byte(`runtime event=stream-start label="shop.vibetv.control-center.runtime"`)
	for _, path := range []string{logPath, logPath + ".1"} {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read rotated runtime log %q: %v", path, err)
		}
		if !bytes.Contains(raw, marker) {
			t.Fatalf("rotated runtime log %q is missing session marker: %q", path, raw)
		}
	}
}

func TestDisplayStreamLoggerRepeatsRuntimeMarkerWithinTailWindow(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "daemon.out.log")
	t.Setenv("CODEXBAR_DISPLAY_STREAM_OUT_LOG", logPath)
	logger, _, err := newDisplayStreamFileLogger(t.TempDir())
	if err != nil {
		t.Fatalf("create display stream logger: %v", err)
	}
	if err := logger.startRuntimeSession("shop.vibetv.control-center.runtime"); err != nil {
		t.Fatalf("start display stream runtime session: %v", err)
	}
	for index := 0; index < 6; index++ {
		logger.logf("record-%d=%s", index, strings.Repeat("x", 8000))
	}

	raw, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("read display stream log: %v", err)
	}
	marker := []byte(`runtime event=stream-start label="shop.vibetv.control-center.runtime"`)
	if count := bytes.Count(raw, marker); count < 2 {
		t.Fatalf("expected runtime marker repetition within bounded tail window, count=%d", count)
	}
}

func TestRunOpenControlCenterStartsServiceAndOpensLocalURL(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	var requestedPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestedPath = r.URL.Path
		if r.URL.Path != "/control-center" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte("ok"))
	}))
	defer server.Close()

	oldStart := openControlCenterStartLaunchAgentFn
	oldOpen := openControlCenterOpenURLFn
	oldClient := openControlCenterHTTPClient
	t.Cleanup(func() {
		openControlCenterStartLaunchAgentFn = oldStart
		openControlCenterOpenURLFn = oldOpen
		openControlCenterHTTPClient = oldClient
	})

	var startedHome string
	openControlCenterStartLaunchAgentFn = func(home string) error {
		startedHome = home
		return nil
	}
	var openedURL string
	openControlCenterOpenURLFn = func(url string) error {
		openedURL = url
		return nil
	}
	openControlCenterHTTPClient = server.Client()

	addr := strings.TrimPrefix(server.URL, "http://")
	if err := runOpenControlCenter([]string{"--addr", addr, "--path", "/control-center"}); err != nil {
		t.Fatalf("runOpenControlCenter returned error: %v", err)
	}
	if startedHome != home {
		t.Fatalf("expected startLaunchAgent home %q, got %q", home, startedHome)
	}
	if requestedPath != "/control-center" {
		t.Fatalf("expected /control-center probe, got %q", requestedPath)
	}
	wantURL := server.URL + "/control-center"
	if openedURL != wantURL {
		t.Fatalf("expected opened URL %q, got %q", wantURL, openedURL)
	}
}

func TestRunOpenControlCenterFailsWhenLocalControlCenterUnavailable(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	server := httptest.NewServer(http.NotFoundHandler())
	defer server.Close()

	oldStart := openControlCenterStartLaunchAgentFn
	oldOpen := openControlCenterOpenURLFn
	oldClient := openControlCenterHTTPClient
	t.Cleanup(func() {
		openControlCenterStartLaunchAgentFn = oldStart
		openControlCenterOpenURLFn = oldOpen
		openControlCenterHTTPClient = oldClient
	})

	openControlCenterStartLaunchAgentFn = func(string) error { return nil }
	openControlCenterOpenURLFn = func(url string) error {
		t.Fatalf("browser should not open when Control Center is unavailable: %s", url)
		return nil
	}
	openControlCenterHTTPClient = server.Client()

	addr := strings.TrimPrefix(server.URL, "http://")
	err := runOpenControlCenter([]string{"--addr", addr, "--path", "/control-center", "--timeout", "20ms"})
	if err == nil {
		t.Fatalf("expected unavailable Control Center error")
	}
	if !strings.Contains(err.Error(), "last HTTP 404") {
		t.Fatalf("expected last HTTP 404 error, got %v", err)
	}
}

func TestSuperviseDisplayWorkerRestartsAfterError(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var logs bytes.Buffer
	calls := 0
	afterCalls := 0
	superviseDisplayWorker(ctx, daemon.Options{}, func(ctx context.Context, _ daemon.Options) error {
		calls++
		if calls == 1 {
			return errors.New("display offline")
		}
		cancel()
		<-ctx.Done()
		return ctx.Err()
	}, func(time.Duration) <-chan time.Time {
		afterCalls++
		ch := make(chan time.Time, 1)
		ch <- time.Now()
		return ch
	}, func(format string, args ...any) {
		_, _ = fmt.Fprintf(&logs, format, args...)
	})

	if calls != 2 {
		t.Fatalf("expected worker restart after error, got %d calls", calls)
	}
	if afterCalls != 1 {
		t.Fatalf("expected one restart delay, got %d", afterCalls)
	}
	if !strings.Contains(logs.String(), "display offline") {
		t.Fatalf("expected restart log to include worker error, got %q", logs.String())
	}
}

func TestSuperviseDisplayWorkerRestartsAfterPanic(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var logs bytes.Buffer
	calls := 0
	superviseDisplayWorker(ctx, daemon.Options{}, func(ctx context.Context, _ daemon.Options) error {
		calls++
		if calls == 1 {
			panic("bad frame sender")
		}
		cancel()
		<-ctx.Done()
		return ctx.Err()
	}, func(time.Duration) <-chan time.Time {
		ch := make(chan time.Time, 1)
		ch <- time.Now()
		return ch
	}, func(format string, args ...any) {
		_, _ = fmt.Fprintf(&logs, format, args...)
	})

	if calls != 2 {
		t.Fatalf("expected worker restart after panic, got %d calls", calls)
	}
	if !strings.Contains(logs.String(), "display worker panic") {
		t.Fatalf("expected restart log to include panic, got %q", logs.String())
	}
}

func TestSuperviseDisplayWorkerRestartsAfterUnexpectedExit(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	calls := 0
	superviseDisplayWorker(ctx, daemon.Options{}, func(ctx context.Context, _ daemon.Options) error {
		calls++
		if calls == 1 {
			return nil
		}
		cancel()
		<-ctx.Done()
		return ctx.Err()
	}, func(time.Duration) <-chan time.Time {
		ch := make(chan time.Time, 1)
		ch <- time.Now()
		return ch
	}, func(string, ...any) {})

	if calls != 2 {
		t.Fatalf("expected worker restart after unexpected exit, got %d calls", calls)
	}
}

func TestSuperviseDisplayWorkerLetsOnceModeExit(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	calls := 0
	superviseDisplayWorker(ctx, daemon.Options{Once: true}, func(context.Context, daemon.Options) error {
		calls++
		return nil
	}, func(time.Duration) <-chan time.Time {
		t.Fatalf("once mode should not wait for restart")
		return nil
	}, func(string, ...any) {})

	if calls != 1 {
		t.Fatalf("expected once mode to exit after one call, got %d calls", calls)
	}
}

func TestResolveThemeSpecTransportNamePreservesPortOnlyUSBFlow(t *testing.T) {
	got := resolveThemeSpecTransportName("wifi", "/dev/cu.usbserial-10", false)
	if got != "usb" {
		t.Fatalf("expected port-only theme command to use usb, got %q", got)
	}

	got = resolveThemeSpecTransportName("wifi", "/dev/cu.usbserial-10", true)
	if got != "wifi" {
		t.Fatalf("expected explicit transport to win, got %q", got)
	}
}

func TestThemeApplySupportsWiFiTransport(t *testing.T) {
	specPath := writeTestThemeSpec(t)
	var gotFrame struct {
		V         int             `json:"v"`
		Theme     string          `json:"theme"`
		ThemeSpec json.RawMessage `json:"themeSpec"`
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme","theme-spec-v1"],"maxFrameBytes":1024,"capabilities":{"theme":{"supportsThemeSpecV1":true,"maxThemeSpecBytes":900,"maxThemePrimitives":8,"builtinThemes":["mini","classic"]},"transport":{"active":"wifi","supported":["wifi","usb"]}}}`))
		case "/frame":
			body, err := io.ReadAll(r.Body)
			if err != nil {
				t.Fatalf("read frame body: %v", err)
			}
			if err := json.Unmarshal(body, &gotFrame); err != nil {
				t.Fatalf("decode frame body %q: %v", string(body), err)
			}
			w.WriteHeader(http.StatusOK)
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	err := runThemeApply([]string{
		"--transport", "wifi",
		"--target", server.URL,
		"--spec", specPath,
	})
	if err != nil {
		t.Fatalf("runThemeApply returned error: %v", err)
	}
	if gotFrame.V != 2 {
		t.Fatalf("expected v2 frame, got %d", gotFrame.V)
	}
	if gotFrame.Theme != "mini" {
		t.Fatalf("expected fallback mini theme, got %q", gotFrame.Theme)
	}
	if !strings.Contains(string(gotFrame.ThemeSpec), `"themeId":"codex-test"`) {
		t.Fatalf("expected themeSpec payload, got %s", string(gotFrame.ThemeSpec))
	}
}

func TestThemeValidateSupportsWiFiTransport(t *testing.T) {
	specPath := writeTestThemeSpec(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/hello" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme-spec-v1"],"maxFrameBytes":1024,"capabilities":{"theme":{"supportsThemeSpecV1":true,"maxThemeSpecBytes":900,"maxThemePrimitives":8,"builtinThemes":["mini"]},"transport":{"active":"wifi","supported":["wifi"]}}}`))
	}))
	defer server.Close()

	err := runThemeValidate([]string{
		"--transport", "wifi",
		"--target", server.URL,
		"--spec", specPath,
	})
	if err != nil {
		t.Fatalf("runThemeValidate returned error: %v", err)
	}
}

func TestThemePackInstallSupportsVerifiedPackMetadata(t *testing.T) {
	disableThemePackUploadSettleDelay(t)
	packZip := buildTestThemePackZip(t)
	packPath, packSHA256, packSizeBytes := writeTestThemePackZip(t, packZip)
	firmwareUpdated := false
	uploaded := map[string]int{}
	activated := false
	previousFirmwareUpdate := themePackInstallFirmwareUpdateFn
	t.Cleanup(func() {
		themePackInstallFirmwareUpdateFn = previousFirmwareUpdate
	})
	themePackInstallFirmwareUpdateFn = func(target, manifestURL string) error {
		firmwareUpdated = true
		return nil
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme","theme-spec-v1"],"maxFrameBytes":2048,"capabilities":{"theme":{"supportsThemeSpecV1":true,"maxThemeSpecBytes":1200,"maxThemePrimitives":8,"builtinThemes":["mini","classic"]},"transport":{"active":"wifi","supported":["wifi","usb"]}}}`))
		case "/frame":
			handleThemePackFrame(t, w, r)
		case "/assets":
			if !firmwareUpdated {
				t.Fatalf("expected firmware update before theme asset upload")
			}
			if len(uploaded) == 0 {
				time.Sleep(6 * time.Second)
			}
			handleTestThemePackAssets(t, w, r, uploaded)
		case "/theme/active":
			body, err := io.ReadAll(r.Body)
			if err != nil {
				t.Fatalf("read activation body: %v", err)
			}
			if !strings.Contains(string(body), `"/themes/u/cm.json"`) {
				t.Fatalf("unexpected activation body %s", string(body))
			}
			activated = true
			w.WriteHeader(http.StatusOK)
		case "/health":
			writeHealthyThemePackHealth(w)
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	output, err := captureStdout(t, func() error {
		return runThemePackInstall([]string{
			"--pack", packPath,
			"--pack-sha256", packSHA256,
			"--pack-size-bytes", strconv.FormatInt(packSizeBytes, 10),
			"--target", server.URL,
		})
	})
	if err != nil {
		t.Fatalf("runThemePackInstall returned error: %v", err)
	}
	for _, want := range []string{
		"Preparing theme: Cozy Meadow",
		"Checking device...",
		"Uploading theme files...",
		"Activating theme...",
		"Done: theme cozy-meadow installed on " + server.URL,
	} {
		if !strings.Contains(output, want) {
			t.Fatalf("expected output to contain %q, got:\n%s", want, output)
		}
	}
	for _, noisy := range []string{"uploaded asset:", "uploaded theme spec:", "activePath="} {
		if strings.Contains(output, noisy) {
			t.Fatalf("expected quiet install output not to contain %q, got:\n%s", noisy, output)
		}
	}

	if !firmwareUpdated {
		t.Fatalf("expected firmware update before theme pack install")
	}
	if uploaded["/themes/u/cm.cbi"] == 0 || uploaded["/themes/u/cm.json"] == 0 {
		t.Fatalf("expected asset and theme spec uploads, got %#v", uploaded)
	}
	if !activated {
		t.Fatalf("expected stored theme activation")
	}
}

func TestThemePackInstallLogsConciseRetry(t *testing.T) {
	disableThemePackUploadSettleDelay(t)
	packZip := buildTestThemePackZip(t)
	packPath, _, _ := writeTestThemePackZip(t, packZip)
	assetAttempts := 0
	uploaded := map[string]int{}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/cozy-meadow.zip":
			w.Header().Set("Content-Type", "application/zip")
			_, _ = w.Write(packZip)
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme","theme-spec-v1"],"maxFrameBytes":2048,"capabilities":{"theme":{"supportsThemeSpecV1":true,"maxThemeSpecBytes":1200,"maxThemePrimitives":8,"builtinThemes":["mini","classic"]},"transport":{"active":"wifi","supported":["wifi","usb"]}}}`))
		case "/frame":
			handleThemePackFrame(t, w, r)
		case "/assets":
			if r.Method == http.MethodPost && r.URL.Query().Get("path") == "/themes/u/cm.cbi" {
				assetAttempts++
				if assetAttempts == 1 {
					w.WriteHeader(http.StatusServiceUnavailable)
					_, _ = w.Write([]byte("upload busy"))
					return
				}
			}
			handleTestThemePackAssets(t, w, r, uploaded)
		case "/theme/active":
			w.WriteHeader(http.StatusOK)
		case "/health":
			writeHealthyThemePackHealth(w)
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	output, err := captureStdout(t, func() error {
		return runThemePackInstall([]string{
			"--pack", packPath,
			"--target", server.URL,
			"--skip-firmware-update",
		})
	})
	if err != nil {
		t.Fatalf("runThemePackInstall returned error: %v", err)
	}
	if assetAttempts != 2 {
		t.Fatalf("expected one retry for asset upload, got %d attempts", assetAttempts)
	}
	if got := strings.Count(output, "Upload interrupted, retrying..."); got != 1 {
		t.Fatalf("expected one concise retry line, got %d in:\n%s", got, output)
	}
	if strings.Contains(output, "status=503") || strings.Contains(output, "upload busy") {
		t.Fatalf("expected quiet retry output to hide raw server details, got:\n%s", output)
	}
	if !strings.Contains(output, "Done: theme cozy-meadow installed on "+server.URL) {
		t.Fatalf("expected done line, got:\n%s", output)
	}
}

func TestThemePackInstallWrapsUploadFailureForCustomers(t *testing.T) {
	disableThemePackUploadSettleDelay(t)
	packZip := buildTestThemePackZip(t)
	packPath, _, _ := writeTestThemePackZip(t, packZip)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/cozy-meadow.zip":
			w.Header().Set("Content-Type", "application/zip")
			_, _ = w.Write(packZip)
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme","theme-spec-v1"],"maxFrameBytes":2048,"capabilities":{"theme":{"supportsThemeSpecV1":true,"maxThemeSpecBytes":1200,"maxThemePrimitives":8,"builtinThemes":["mini","classic"]},"transport":{"active":"wifi","supported":["wifi","usb"]}}}`))
		case "/frame":
			handleThemePackFrame(t, w, r)
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"installing","themeSpec":{"active":true,"path":"","renderOk":true}}}`))
		case "/assets":
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte("raw device failure"))
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	output, err := captureStdout(t, func() error {
		return runThemePackInstall([]string{
			"--pack", packPath,
			"--target", server.URL,
			"--skip-firmware-update",
		})
	})
	if err == nil {
		t.Fatalf("expected upload failure")
	}
	if !strings.Contains(output, "Upload interrupted, retrying...") {
		t.Fatalf("expected concise retry output, got:\n%s", output)
	}
	msg := err.Error()
	if !strings.Contains(msg, "theme-pack/upload: theme upload did not finish for /themes/u/cm.cbi") {
		t.Fatalf("expected customer-friendly upload error, got %q", msg)
	}
	for _, raw := range []string{"status=503", "raw device failure", "post asset"} {
		if strings.Contains(msg, raw) {
			t.Fatalf("expected non-verbose error to hide raw %q detail, got %q", raw, msg)
		}
	}
}

func TestThemePackInstallVerboseShowsDetails(t *testing.T) {
	disableThemePackUploadSettleDelay(t)
	packZip := buildTestThemePackZip(t)
	packPath, _, _ := writeTestThemePackZip(t, packZip)
	uploaded := map[string]int{}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/cozy-meadow.zip":
			w.Header().Set("Content-Type", "application/zip")
			_, _ = w.Write(packZip)
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme","theme-spec-v1"],"maxFrameBytes":2048,"capabilities":{"theme":{"supportsThemeSpecV1":true,"maxThemeSpecBytes":1200,"maxThemePrimitives":8,"builtinThemes":["mini","classic"]},"transport":{"active":"wifi","supported":["wifi","usb"]}}}`))
		case "/frame":
			handleThemePackFrame(t, w, r)
		case "/assets":
			handleTestThemePackAssets(t, w, r, uploaded)
		case "/theme/active":
			w.WriteHeader(http.StatusOK)
		case "/health":
			writeHealthyThemePackHealth(w)
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	output, err := captureStdout(t, func() error {
		return runThemePackInstall([]string{
			"--pack", packPath,
			"--target", server.URL,
			"--skip-firmware-update",
			"--verbose",
		})
	})
	if err != nil {
		t.Fatalf("runThemePackInstall returned error: %v", err)
	}
	for _, want := range []string{
		"Theme source:",
		"Firmware check: skipped",
		"Device: board=esp8266-smalltv-st7789",
		"Uploaded asset: /themes/u/cm.cbi",
		"Upload verified: /themes/u/cm.cbi",
		"Uploaded theme spec: /themes/u/cm.json",
		"Upload verified: /themes/u/cm.json",
		"Active theme path: /themes/u/cm.json themeId=cozy-meadow rev=1",
	} {
		if !strings.Contains(output, want) {
			t.Fatalf("expected verbose output to contain %q, got:\n%s", want, output)
		}
	}
}

func TestThemePackInstallSupportsCatalogTheme(t *testing.T) {
	disableThemePackUploadSettleDelay(t)
	packZip := buildTestThemePackZip(t)
	packPath, packSHA256, packSizeBytes := writeTestThemePackZip(t, packZip)
	catalogPath := filepath.Join(filepath.Dir(packPath), "catalog.json")
	catalog := fmt.Sprintf(`{"schemaVersion":1,"themes":[{"id":"cozy-meadow","title":"Cozy Meadow","themeRev":1,"downloadAsset":"cozy-meadow.zip","sha256":"%s","bytes":%d}]}`, packSHA256, packSizeBytes)
	if err := os.WriteFile(catalogPath, []byte(catalog), 0o600); err != nil {
		t.Fatal(err)
	}
	firmwareUpdated := false
	uploaded := map[string]int{}
	activated := false
	previousFirmwareUpdate := themePackInstallFirmwareUpdateFn
	t.Cleanup(func() {
		themePackInstallFirmwareUpdateFn = previousFirmwareUpdate
	})
	themePackInstallFirmwareUpdateFn = func(target, manifestURL string) error {
		firmwareUpdated = true
		return nil
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme","theme-spec-v1"],"maxFrameBytes":2048,"capabilities":{"theme":{"supportsThemeSpecV1":true,"maxThemeSpecBytes":1200,"maxThemePrimitives":8,"builtinThemes":["mini","classic"]},"transport":{"active":"wifi","supported":["wifi","usb"]}}}`))
		case "/frame":
			handleThemePackFrame(t, w, r)
		case "/assets":
			if !firmwareUpdated {
				t.Fatalf("expected firmware update before theme asset upload")
			}
			handleTestThemePackAssets(t, w, r, uploaded)
		case "/theme/active":
			activated = true
			w.WriteHeader(http.StatusOK)
		case "/health":
			writeHealthyThemePackHealth(w)
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	err := runThemePackInstall([]string{
		"--catalog", catalogPath,
		"--theme", "cozy-meadow",
		"--target", server.URL,
	})
	if err != nil {
		t.Fatalf("runThemePackInstall returned error: %v", err)
	}
	if !firmwareUpdated {
		t.Fatalf("expected firmware update before theme pack install")
	}
	if uploaded["/themes/u/cm.cbi"] == 0 || uploaded["/themes/u/cm.json"] == 0 {
		t.Fatalf("expected asset and theme spec uploads, got %#v", uploaded)
	}
	if !activated {
		t.Fatalf("expected activation")
	}
}

func TestThemePackInstallFailsBeforeActivationWhenUploadHealthFails(t *testing.T) {
	disableThemePackUploadSettleDelay(t)
	packZip := buildTestThemePackZip(t)
	packPath, _, _ := writeTestThemePackZip(t, packZip)
	activated := false

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/cozy-meadow.zip":
			w.Header().Set("Content-Type", "application/zip")
			_, _ = w.Write(packZip)
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme","theme-spec-v1"],"maxFrameBytes":2048,"capabilities":{"theme":{"supportsThemeSpecV1":true,"maxThemeSpecBytes":1200,"maxThemePrimitives":8,"builtinThemes":["mini","classic"]},"transport":{"active":"wifi","supported":["wifi","usb"]}}}`))
		case "/frame":
			handleThemePackFrame(t, w, r)
		case "/assets":
			w.WriteHeader(http.StatusOK)
		case "/health":
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte("device busy"))
		case "/theme/active":
			activated = true
			w.WriteHeader(http.StatusOK)
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	_, err := captureStdout(t, func() error {
		return runThemePackInstall([]string{
			"--pack", packPath,
			"--target", server.URL,
			"--skip-firmware-update",
		})
	})
	if err == nil {
		t.Fatalf("expected upload health failure")
	}
	if activated {
		t.Fatalf("activation should not run after upload health failure")
	}
	if !strings.Contains(err.Error(), "theme-pack/upload: theme upload did not finish for /themes/u/cm.cbi: device health check failed after upload") {
		t.Fatalf("expected upload-scoped error, got %q", err.Error())
	}
}

func writeTestThemeSpec(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "theme.json")
	spec := `{
  "themeSpecVersion": 1,
  "themeId": "codex-test",
  "themeRev": 1,
  "fallbackTheme": "mini",
  "primitives": [
    {"type": "rect", "x": 0, "y": 0, "width": 240, "height": 240, "color": "#000000"},
    {"type": "text", "x": 8, "y": 8, "text": "{label}", "fontSize": 2, "color": "#CCFF00"}
  ]
}`
	if err := os.WriteFile(path, []byte(spec), 0o644); err != nil {
		t.Fatalf("write test theme spec: %v", err)
	}
	return path
}

func buildTestThemePackZip(t *testing.T) []byte {
	t.Helper()
	spec := `{"v":1,"id":"cozy-meadow","rev":1,"fb":"mini","p":[{"t":"sp","x":0,"y":0,"w":24,"h":24,"a":"/themes/u/cm.cbi"}]}`
	asset := "CBI1\n1 1\n1\n#FFFFFF\na\n"
	manifest := `{"kind":"vibetv-theme-pack","schemaVersion":1,"id":"cozy-meadow","name":"Cozy Meadow","themeSpec":{"path":"/themes/u/cm.json","file":"theme.json"},"assets":[{"path":"/themes/u/cm.cbi","file":"assets/cm.cbi"}]}`

	var buf bytes.Buffer
	writer := zip.NewWriter(&buf)
	for _, file := range []struct {
		name string
		data string
	}{
		{name: "manifest.json", data: manifest},
		{name: "theme.json", data: spec},
		{name: "assets/cm.cbi", data: asset},
	} {
		part, err := writer.Create(file.name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write([]byte(file.data)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func writeTestThemePackZip(t *testing.T, data []byte) (string, string, int64) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "cozy-meadow.zip")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(data)
	return path, hex.EncodeToString(digest[:]), int64(len(data))
}

func disableThemePackUploadSettleDelay(t *testing.T) {
	t.Helper()
	previous := themePackUploadSettleDelay
	previousFetchLiveFrame := themePackInstallFetchLiveFrameFn
	themePackUploadSettleDelay = -1
	themePackInstallFetchLiveFrameFn = func(context.Context) (protocol.Frame, error) {
		return protocol.Frame{
			Provider:  "codex",
			Label:     "Codex",
			Session:   12,
			Weekly:    30,
			ResetSec:  3600,
			UsageMode: "remaining",
		}, nil
	}
	t.Cleanup(func() {
		themePackUploadSettleDelay = previous
		themePackInstallFetchLiveFrameFn = previousFetchLiveFrame
	})
}

func handleThemePackFrame(t *testing.T, w http.ResponseWriter, r *http.Request) {
	t.Helper()
	if r.Method != http.MethodPost {
		t.Fatalf("expected POST /frame, got %s", r.Method)
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		t.Fatalf("read frame body: %v", err)
	}
	if !bytes.Contains(bytes.TrimSpace(body), []byte(`"provider"`)) {
		t.Fatalf("unexpected frame body %q", string(body))
	}
	w.WriteHeader(http.StatusOK)
}

func handleTestThemePackAssets(t *testing.T, w http.ResponseWriter, r *http.Request, uploaded map[string]int) {
	t.Helper()
	switch r.Method {
	case http.MethodGet:
		writeTestThemePackAssetList(t, w, uploaded)
	case http.MethodPost:
		devicePath := r.URL.Query().Get("path")
		if devicePath == "" {
			t.Fatalf("missing asset path query")
		}
		uploaded[devicePath] = readTestThemePackUploadedAssetSize(t, r)
		w.WriteHeader(http.StatusOK)
	default:
		t.Fatalf("unexpected assets method %s", r.Method)
	}
}

func writeTestThemePackAssetList(t *testing.T, w http.ResponseWriter, uploaded map[string]int) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	var out strings.Builder
	out.WriteString(`{"assets":[`)
	first := true
	for path, size := range uploaded {
		if !first {
			out.WriteByte(',')
		}
		first = false
		encoded, err := json.Marshal(path)
		if err != nil {
			t.Fatalf("encode asset path: %v", err)
		}
		out.WriteString(`{"path":`)
		out.Write(encoded)
		out.WriteString(`,"sizeBytes":`)
		out.WriteString(strconv.Itoa(size))
		out.WriteByte('}')
	}
	out.WriteString(`]}`)
	_, _ = w.Write([]byte(out.String()))
}

func readTestThemePackUploadedAssetSize(t *testing.T, r *http.Request) int {
	t.Helper()
	reader, err := r.MultipartReader()
	if err != nil {
		t.Fatalf("MultipartReader returned error: %v", err)
	}
	part, err := reader.NextPart()
	if err != nil {
		t.Fatalf("NextPart returned error: %v", err)
	}
	if part.FormName() != "asset" {
		t.Fatalf("unexpected form field %s", part.FormName())
	}
	body, err := io.ReadAll(part)
	if err != nil {
		t.Fatalf("read uploaded asset: %v", err)
	}
	return len(body)
}

func writeHealthyThemePackHealth(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"cozy-meadow","themeSpec":{"active":true,"path":"/themes/u/cm.json","renderOk":true},"gif":{"activePath":"","filePresent":false,"decoderAllocated":true,"decoderOpen":false,"lastError":null}}}`))
}

func captureStdout(t *testing.T, fn func() error) (string, error) {
	t.Helper()
	old := os.Stdout
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatalf("create stdout pipe: %v", err)
	}
	os.Stdout = writer
	defer func() {
		os.Stdout = old
	}()

	runErr := fn()
	if closeErr := writer.Close(); closeErr != nil {
		t.Fatalf("close stdout pipe: %v", closeErr)
	}
	out, readErr := io.ReadAll(reader)
	if readErr != nil {
		t.Fatalf("read stdout pipe: %v", readErr)
	}
	return string(out), runErr
}
