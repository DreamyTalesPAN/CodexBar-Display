package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/companionapi"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/health"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/setup"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themeinstall"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themepack"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themespec"
	transportlayer "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/transport"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
)

const defaultThemeCatalogURL = themeinstall.DefaultCatalogURL

var themePackUploadSettleDelay = 750 * time.Millisecond
var themePackInstallFetchLiveFrameFn = codexbar.FetchFirstFrame
var displayWorkerRestartDelay = 5 * time.Second
var openControlCenterStartLaunchAgentFn = startLaunchAgent
var openControlCenterOpenURLFn = openURLWithMacOpen
var openControlCenterHTTPClient = &http.Client{}

var displayStreamSensitiveQueryPattern = regexp.MustCompile(`(?i)([?&](?:token|auth|key|secret)=)[^&\s"]+`)
var displayStreamSensitiveUserInfoPattern = regexp.MustCompile(`(?i)(https?://)[^/@\s]+@`)

func main() {
	args := os.Args[1:]
	if len(args) == 0 && launchedFromAppBundle() {
		args = []string{"open-control-center"}
	}
	if len(args) < 1 {
		printUsage()
		os.Exit(2)
	}

	var err error
	switch args[0] {
	case "daemon":
		err = runDaemon(args[1:])
	case "api":
		err = runCompanionAPI(args[1:])
	case "doctor":
		err = runDoctor()
	case "health":
		err = health.Run(context.Background())
	case "open-control-center":
		err = runOpenControlCenter(args[1:])
	case "service":
		err = runService(args[1:])
	case "version":
		err = runVersion(args[1:])
	case "upgrade":
		err = runUpgrade(args[1:])
	case "install-update":
		err = runInstallUpdate(args[1:])
	case "rollback":
		err = runRollback(args[1:])
	case "restore-known-good":
		err = runRestoreKnownGood(args[1:])
	case "theme-validate":
		err = runThemeValidate(args[1:])
	case "theme-apply":
		err = runThemeApply(args[1:])
	case "theme-pack":
		err = runThemePack(args[1:])
	case "setup":
		err = runSetup(args[1:])
	default:
		printUsage()
		os.Exit(2)
	}

	if err != nil {
		if code := errcode.Of(err); code != "" {
			fmt.Fprintf(os.Stderr, "error code=%s\n", code)
		}
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		recovery := strings.TrimSpace(errcode.Recovery(err))
		if recovery != "" && !strings.Contains(err.Error(), "recovery:") {
			fmt.Fprintf(os.Stderr, "recovery: %s\n", recovery)
		}
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Println("codexbar-display commands:")
	fmt.Println("  codexbar-display api [--addr 127.0.0.1:47832] [--dev-origin http://localhost:3000]")
	fmt.Println("  codexbar-display daemon [--transport wifi|usb] [--target http://vibetv.local] [--port /dev/cu.usbserial-10] [--interval 30s] [--once] [--theme classic|crt|mini] [--api-addr 127.0.0.1:47832]")
	fmt.Println("  codexbar-display doctor")
	fmt.Println("  codexbar-display health")
	fmt.Println("  codexbar-display open-control-center [--addr 127.0.0.1:47832] [--path /control-center] [--no-open]")
	fmt.Println("  codexbar-display service <start|stop|status>")
	fmt.Println("  codexbar-display version [--short] [--json]")
	fmt.Println("  codexbar-display upgrade [--port /dev/cu.usbserial-10] [--firmware-env env] [--target-firmware-version x.y.z] [--repo owner/name] [--skip-version-guard]")
	fmt.Println("  codexbar-display install-update [--target http://vibetv.local] [--manifest-url url] [--confirm-live-update] [--force] [--verbose]")
	fmt.Println("  codexbar-display rollback [--port /dev/cu.usbserial-10] [--skip-companion] [--skip-firmware] [--image path/to/backup.bin] [--manifest path/to/backup.manifest] [--backup-dir <dir>] [--script-path <path>] [--skip-verify]")
	fmt.Println("  codexbar-display restore-known-good [--port /dev/cu.usbserial-10] [--image path/to/backup.bin] [--backup-dir <dir>] [--script-path <path>] [--manifest <path>] [--skip-verify]")
	fmt.Println("  codexbar-display theme-validate --spec path/to/theme-spec.json [--transport wifi|usb] [--target http://vibetv.local] [--port /dev/cu.usbserial-10] [--allow-unknown-capabilities]")
	fmt.Println("  codexbar-display theme-apply --spec path/to/theme-spec.json [--transport wifi|usb] [--target http://vibetv.local] [--port /dev/cu.usbserial-10] [--allow-unknown-capabilities]")
	fmt.Println("  codexbar-display theme-pack catalog [--catalog https://raw.githubusercontent.com/DreamyTalesPAN/CodexBar-Display/main/dist/theme-packs/vibetv-theme-packs.json]")
	fmt.Println("  codexbar-display theme-pack validate --pack path/to/theme-pack-dir-or.zip-or-url")
	fmt.Println("  codexbar-display theme-pack install (--pack path/to/theme-pack-dir-or.zip-or-url | --catalog url --theme theme-id) [--target http://vibetv.local] [--firmware-manifest-url url] [--skip-firmware-update] [--allow-unknown-capabilities] [--verbose]")
	fmt.Println("  codexbar-display setup [--transport wifi|usb] [--target http://vibetv.local] [--port /dev/cu.usbserial-10] [--yes] [--skip-flash] [--pin-port] [--firmware-env env] [--theme classic|crt|mini|none] [--validate-only] [--dry-run]")
}

func launchedFromAppBundle() bool {
	executable, err := os.Executable()
	if err != nil {
		executable = os.Args[0]
	}
	executable = filepath.ToSlash(filepath.Clean(executable))
	return strings.Contains(executable, ".app/Contents/MacOS/")
}

func runCompanionAPI(args []string) error {
	fs := flag.NewFlagSet("api", flag.ContinueOnError)
	addr := fs.String("addr", companionapi.DefaultAddr, "local companion API bind address")
	devOrigin := fs.String("dev-origin", "http://localhost:3000", "additional allowed local dev origin")
	if err := fs.Parse(args); err != nil {
		return err
	}
	server, err := companionapi.New(companionapi.Options{
		Addr:           strings.TrimSpace(*addr),
		AllowedOrigins: []string{strings.TrimSpace(*devOrigin)},
	})
	if err != nil {
		return err
	}
	fmt.Printf("VibeTV companion API listening on http://%s\n", strings.TrimSpace(*addr))
	return server.ListenAndServe(context.Background())
}

func runDaemon(args []string) error {
	opts, err := parseDaemonCommandOptions(args)
	if err != nil {
		return err
	}
	if opts.APIAddr == "" {
		return daemon.Run(context.Background(), opts.Daemon)
	}
	return runDaemonWithCompanionAPI(context.Background(), opts)
}

func runOpenControlCenter(args []string) error {
	fs := flag.NewFlagSet("open-control-center", flag.ContinueOnError)
	addr := fs.String("addr", companionapi.DefaultAddr, "local companion API address")
	path := fs.String("path", "/control-center", "local Control Center path")
	timeout := fs.Duration("timeout", 15*time.Second, "maximum time to wait for the local Control Center")
	noOpen := fs.Bool("no-open", false, "verify the local Control Center without opening the browser")
	if err := fs.Parse(args); err != nil {
		return err
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("resolve home directory: %w", err)
	}
	if err := openControlCenterStartLaunchAgentFn(home); err != nil {
		return fmt.Errorf("start local Control Center service: %w", err)
	}

	url := localControlCenterURL(strings.TrimSpace(*addr), strings.TrimSpace(*path))
	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	if err := waitForLocalControlCenter(ctx, url); err != nil {
		return err
	}
	if *noOpen {
		fmt.Printf("Control Center ready: %s\n", url)
		return nil
	}
	if err := openControlCenterOpenURLFn(url); err != nil {
		return fmt.Errorf("open local Control Center: %w", err)
	}
	fmt.Printf("Control Center opened: %s\n", url)
	return nil
}

func localControlCenterURL(addr, path string) string {
	if addr == "" {
		addr = companionapi.DefaultAddr
	}
	if path == "" {
		path = "/control-center"
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return "http://" + addr + path
}

func waitForLocalControlCenter(ctx context.Context, url string) error {
	var lastStatus int
	for {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return fmt.Errorf("prepare local Control Center request: %w", err)
		}
		resp, err := openControlCenterHTTPClient.Do(req)
		if err == nil {
			lastStatus = resp.StatusCode
			_ = resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				return nil
			}
		}

		select {
		case <-ctx.Done():
			if lastStatus > 0 {
				return fmt.Errorf("local Control Center did not become ready at %s (last HTTP %d)", url, lastStatus)
			}
			return fmt.Errorf("local Control Center did not become ready at %s: %w", url, ctx.Err())
		case <-time.After(500 * time.Millisecond):
		}
	}
}

func openURLWithMacOpen(url string) error {
	return exec.Command("open", url).Run()
}

type daemonCommandOptions struct {
	Daemon       daemon.Options
	APIAddr      string
	APIDevOrigin string
}

func parseDaemonOptions(args []string) (daemon.Options, error) {
	opts, err := parseDaemonCommandOptions(args)
	return opts.Daemon, err
}

func parseDaemonCommandOptions(args []string) (daemonCommandOptions, error) {
	fs := flag.NewFlagSet("daemon", flag.ContinueOnError)
	port := fs.String("port", "", "serial port (auto-detect when empty)")
	transportName := fs.String("transport", setup.DefaultTransport(), "device transport: wifi|usb")
	target := fs.String("target", "", "WiFi target base URL, for example http://vibetv.local")
	interval := fs.Duration("interval", 0, "poll interval")
	once := fs.Bool("once", false, "run one cycle and exit")
	theme := fs.String("theme", "", "optional runtime theme override: classic|crt|mini")
	apiAddr := fs.String("api-addr", "", "optional local companion API bind address")
	apiDevOrigin := fs.String("api-dev-origin", "http://localhost:3000", "additional allowed local dev origin for --api-addr")
	if err := fs.Parse(args); err != nil {
		return daemonCommandOptions{}, err
	}

	normalizedTransport := strings.TrimSpace(strings.ToLower(*transportName))
	if normalizedTransport == "" {
		normalizedTransport = setup.DefaultTransport()
	}
	if normalizedTransport != "usb" && normalizedTransport != "wifi" {
		return daemonCommandOptions{}, fmt.Errorf("unsupported transport %q", *transportName)
	}

	return daemonCommandOptions{
		Daemon: daemon.Options{
			Port:      strings.TrimSpace(*port),
			Transport: normalizedTransport,
			Target:    strings.TrimSpace(*target),
			Interval:  *interval,
			Once:      *once,
			Theme:     strings.TrimSpace(*theme),
		},
		APIAddr:      strings.TrimSpace(*apiAddr),
		APIDevOrigin: strings.TrimSpace(*apiDevOrigin),
	}, nil
}

func runDaemonWithCompanionAPI(ctx context.Context, opts daemonCommandOptions) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("resolve home directory for display stream log: %w", err)
	}
	logger, _, err := newDisplayStreamFileLogger(home)
	if err != nil {
		return err
	}
	if err := logger.startRuntimeSession(runtimepaths.DisplayStreamLaunchAgentLabel()); err != nil {
		return err
	}
	logf := logger.logf

	wake := make(chan struct{}, 1)
	var firmwareUpdateActive atomic.Bool
	wakeDisplayWorker := func() {
		select {
		case wake <- struct{}{}:
		default:
		}
	}
	server, err := companionapi.New(companionapi.Options{
		Addr:           opts.APIAddr,
		AllowedOrigins: []string{opts.APIDevOrigin},
		RefreshDisplayStream: func(context.Context, string) error {
			wakeDisplayWorker()
			return nil
		},
		PauseDisplayStream: func(paused bool) {
			firmwareUpdateActive.Store(paused)
			wakeDisplayWorker()
		},
	})
	if err != nil {
		return err
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	daemonOpts := opts.Daemon
	daemonOpts.Wake = wake
	daemonOpts.PauseDeviceWrites = firmwareUpdateActive.Load

	errc := make(chan error, 1)
	go func() {
		errc <- server.ListenAndServe(ctx)
	}()
	workerRun := func(ctx context.Context, opts daemon.Options) error {
		return daemon.RunWithLogger(ctx, opts, logf)
	}
	go superviseDisplayWorker(ctx, daemonOpts, workerRun, time.After, logf)

	logf("VibeTV companion API listening on http://%s", opts.APIAddr)
	err = <-errc
	cancel()
	return err
}

type displayStreamLogWriter struct {
	mu               sync.Mutex
	path             string
	maxBytes         int64
	now              func() time.Time
	sessionMarker    []byte
	activeFileInfo   os.FileInfo
	lastObservedSize int64
	lastMarkerSize   int64
}

func newDisplayStreamFileLogger(home string) (*displayStreamLogWriter, string, error) {
	logPath := runtimepaths.DisplayStreamOutLog(home)
	if strings.TrimSpace(logPath) == "" {
		return nil, "", errors.New("resolve display stream log: home directory is empty")
	}
	logger := &displayStreamLogWriter{
		path:     logPath,
		maxBytes: runtimepaths.DisplayStreamLogMaxBytes,
		now:      time.Now,
	}
	if err := logger.ensureWritable(); err != nil {
		return nil, "", err
	}
	return logger, logPath, nil
}

func (l *displayStreamLogWriter) ensureWritable() error {
	file, err := l.openForAppend()
	if err != nil {
		return err
	}
	return file.Close()
}

func (l *displayStreamLogWriter) openForAppend() (*os.File, error) {
	if l == nil || strings.TrimSpace(l.path) == "" {
		return nil, errors.New("open display stream log: path is empty")
	}
	if err := os.MkdirAll(filepath.Dir(l.path), 0o700); err != nil {
		return nil, fmt.Errorf("create display stream log directory: %w", err)
	}
	file, err := os.OpenFile(l.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open display stream log: %w", err)
	}
	if err := file.Chmod(0o600); err != nil {
		_ = file.Close()
		return nil, fmt.Errorf("protect display stream log: %w", err)
	}
	return file, nil
}

func (l *displayStreamLogWriter) startRuntimeSession(label string) error {
	if l == nil {
		return errors.New("start display stream runtime session: logger is nil")
	}
	label = strings.TrimSpace(label)
	if label == "" {
		return errors.New("start display stream runtime session: LaunchAgent label is empty")
	}
	now := l.now
	if now == nil {
		now = time.Now
	}
	marker := fmt.Sprintf(
		"%s runtime event=stream-start label=%q\n",
		now().UTC().Format(time.RFC3339Nano),
		label,
	)

	l.mu.Lock()
	defer l.mu.Unlock()
	l.sessionMarker = []byte(marker)
	l.activeFileInfo = nil
	l.lastObservedSize = 0
	l.lastMarkerSize = 0
	return l.append(nil)
}

func (l *displayStreamLogWriter) logf(format string, args ...any) {
	if l == nil || strings.TrimSpace(l.path) == "" {
		return
	}
	message := sanitizeDisplayStreamLogMessage(fmt.Sprintf(format, args...))
	message = strings.TrimSpace(message)
	if message == "" {
		return
	}

	now := l.now
	if now == nil {
		now = time.Now
	}
	timestamp := now().UTC().Format(time.RFC3339Nano)
	var payload strings.Builder
	for _, rawLine := range strings.Split(message, "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" {
			continue
		}
		_, _ = fmt.Fprintf(&payload, "%s %s\n", timestamp, line)
	}
	if payload.Len() == 0 {
		return
	}

	l.mu.Lock()
	defer l.mu.Unlock()
	_ = l.append([]byte(payload.String()))
}

func (l *displayStreamLogWriter) append(payload []byte) error {
	maxBytes := l.maxBytes
	if maxBytes <= 0 {
		maxBytes = runtimepaths.DisplayStreamLogMaxBytes
	}
	maxRecordBytes := runtimepaths.DisplayStreamLogRecordMaxBytes
	if maxRecordBytes <= 0 || maxRecordBytes > maxBytes {
		maxRecordBytes = maxBytes
	}
	if markerBytes := int64(len(l.sessionMarker)); markerBytes > 0 && maxRecordBytes > maxBytes-markerBytes {
		maxRecordBytes = maxBytes - markerBytes
	}
	if maxRecordBytes < 0 {
		maxRecordBytes = 0
	}
	if int64(len(payload)) > maxRecordBytes {
		payload = payload[int64(len(payload))-maxRecordBytes:]
	}

	info, err := os.Stat(l.path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("stat display stream log: %w", err)
	}
	markerNeeded := l.runtimeSessionMarkerNeeded(info, err)
	record := payload
	if markerNeeded {
		record = append(append([]byte(nil), l.sessionMarker...), payload...)
	}
	if err == nil && info.Size()+int64(len(record)) > maxBytes {
		if err := rotateDisplayStreamLog(l.path, maxBytes); err != nil {
			return err
		}
		if len(l.sessionMarker) > 0 && !markerNeeded {
			record = append(append([]byte(nil), l.sessionMarker...), payload...)
			markerNeeded = true
		}
	}
	file, err := l.openForAppend()
	if err != nil {
		return err
	}
	defer file.Close()
	if _, err := file.Write(record); err != nil {
		return fmt.Errorf("append display stream log: %w", err)
	}
	updated, err := file.Stat()
	if err != nil {
		return fmt.Errorf("stat appended display stream log: %w", err)
	}
	l.activeFileInfo = updated
	l.lastObservedSize = updated.Size()
	if markerNeeded {
		l.lastMarkerSize = updated.Size()
	}
	return nil
}

func (l *displayStreamLogWriter) runtimeSessionMarkerNeeded(info os.FileInfo, statErr error) bool {
	if l == nil || len(l.sessionMarker) == 0 {
		return false
	}
	if errors.Is(statErr, os.ErrNotExist) || info == nil || l.activeFileInfo == nil {
		return true
	}
	if !os.SameFile(info, l.activeFileInfo) || info.Size() < l.lastObservedSize {
		return true
	}
	return info.Size()-l.lastMarkerSize >= runtimepaths.DisplayStreamMarkerRepeatBytes
}

func rotateDisplayStreamLog(logPath string, maxBytes int64) error {
	archivePath := runtimepaths.DisplayStreamOutLogArchive(logPath)
	if archivePath == "" {
		return errors.New("rotate display stream log: archive path is empty")
	}
	if err := os.Remove(archivePath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove old display stream log archive: %w", err)
	}

	info, err := os.Stat(logPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("stat display stream log for rotation: %w", err)
	}
	if info.Size() <= maxBytes {
		if err := os.Rename(logPath, archivePath); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("rotate display stream log: %w", err)
		}
		return nil
	}

	tail, err := readFileTail(logPath, maxBytes)
	if err != nil {
		return fmt.Errorf("read oversized display stream log tail: %w", err)
	}
	if err := os.WriteFile(archivePath, tail, 0o600); err != nil {
		return fmt.Errorf("write bounded display stream log archive: %w", err)
	}
	if err := os.Remove(logPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("replace oversized display stream log: %w", err)
	}
	return nil
}

func readFileTail(path string, maxBytes int64) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	start := info.Size() - maxBytes
	if start < 0 {
		start = 0
	}
	if _, err := file.Seek(start, io.SeekStart); err != nil {
		return nil, err
	}
	return io.ReadAll(io.LimitReader(file, maxBytes))
}

func sanitizeDisplayStreamLogMessage(message string) string {
	message = displayStreamSensitiveUserInfoPattern.ReplaceAllString(message, "${1}<redacted>@")
	return displayStreamSensitiveQueryPattern.ReplaceAllString(message, "${1}<redacted>")
}

type displayWorkerRunFunc func(context.Context, daemon.Options) error
type displayWorkerAfterFunc func(time.Duration) <-chan time.Time
type displayWorkerLogFunc func(string, ...any)

func superviseDisplayWorker(ctx context.Context, opts daemon.Options, run displayWorkerRunFunc, after displayWorkerAfterFunc, logf displayWorkerLogFunc) {
	if run == nil {
		run = daemon.Run
	}
	if after == nil {
		after = time.After
	}
	if logf == nil {
		logf = func(string, ...any) {}
	}

	for {
		if ctx.Err() != nil {
			return
		}
		err := runDisplayWorkerOnce(ctx, opts, run)
		if ctx.Err() != nil || errors.Is(err, context.Canceled) {
			return
		}
		if err == nil {
			if opts.Once {
				return
			}
			logf("VibeTV display worker exited; restarting in %s\n", displayWorkerRestartDelay)
		} else {
			logf("VibeTV display worker stopped; restarting in %s: %v\n", displayWorkerRestartDelay, err)
		}
		select {
		case <-ctx.Done():
			return
		case <-after(displayWorkerRestartDelay):
		}
	}
}

func runDisplayWorkerOnce(ctx context.Context, opts daemon.Options, run displayWorkerRunFunc) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("display worker panic: %v", recovered)
		}
	}()
	return run(ctx, opts)
}

func runDoctor() error {
	var doctorErrs []error

	bin, err := codexbar.FindBinary()
	if err != nil {
		fmt.Printf("CodexBar CLI: not found (%v)\n", err)
		doctorErrs = append(doctorErrs, errors.New("CodexBar CLI not found"))
	} else {
		fmt.Printf("CodexBar CLI: %s\n", bin)
		versionCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		version, versionErr := codexbar.InstalledVersion(versionCtx, bin)
		if versionErr != nil {
			fmt.Printf("CodexBar version: failed (%v)\n", versionErr)
			doctorErrs = append(doctorErrs, fmt.Errorf("CodexBar version check failed: %w", versionErr))
		} else if versionCheckErr := codexbar.CheckMinimumVersion(versionCtx, bin); versionCheckErr != nil {
			fmt.Printf("CodexBar version: %s (too old, need >= %s)\n", version, codexbar.MinimumSupportedVersion())
			doctorErrs = append(doctorErrs, versionCheckErr)
		} else {
			fmt.Printf("CodexBar version: %s (ok, need >= %s)\n", version, codexbar.MinimumSupportedVersion())
		}
	}

	ports, err := usb.ListPorts()
	if err != nil {
		return fmt.Errorf("list serial ports: %w", err)
	}

	fmt.Println("Serial ports:")
	if len(ports) == 0 {
		fmt.Println("  (none)")
	} else {
		for _, p := range ports {
			fmt.Printf("  %s\n", p)
		}
	}

	if runtimeErr := runDoctorRuntimeChecks(ports); runtimeErr != nil {
		doctorErrs = append(doctorErrs, runtimeErr)
	}

	if bin != "" {
		checkCtx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()

		frame, fetchErr := codexbar.FetchFirstFrame(checkCtx)
		if fetchErr != nil {
			fmt.Printf("Provider preview: failed (%v)\n", fetchErr)
			doctorErrs = append(doctorErrs, fmt.Errorf("provider preview failed: %w", fetchErr))
		} else {
			fmt.Printf("Provider preview: %s session=%d%% weekly=%d%% reset=%ds\n",
				frame.Label, frame.Session, frame.Weekly, frame.ResetSec)
		}
	}

	if len(doctorErrs) > 0 {
		return errors.Join(doctorErrs...)
	}
	return nil
}

func runDoctorRuntimeChecks(ports []string) error {
	fmt.Println("Runtime checks:")
	fmt.Printf("  codexbar timeout: %s\n", codexbar.CommandTimeout())
	fmt.Printf("  last-good max age: %s\n", daemon.LastGoodMaxAge())
	fmt.Printf("  sleep/wake threshold (@60s interval): %s\n", daemon.SleepWakeGapThreshold(60*time.Second))

	port, err := usb.ResolvePort("")
	if err != nil {
		fmt.Printf("  serial resolve: failed (%v)\n", err)
		return fmt.Errorf("runtime serial resolve failed: %w", err)
	}
	fmt.Printf("  serial resolve: ok (%s)\n", port)

	if err := usb.ProbePort(port); err != nil {
		if errcode.Of(err) == errcode.TransportSerialCloseTimeout {
			fmt.Printf("  serial probe: warning (%v)\n", err)
		} else {
			fmt.Printf("  serial probe: failed (%v)\n", err)
			return fmt.Errorf("runtime serial probe failed: %w", err)
		}
	} else {
		fmt.Printf("  serial probe: ok (%s)\n", port)
	}

	pinnedPort, err := doctorPinnedLaunchAgentPort()
	if err != nil {
		fmt.Printf("  launchagent port affinity: failed (%v)\n", err)
		return fmt.Errorf("runtime launchagent affinity check failed: %w", err)
	}
	if pinnedPort == "" {
		fmt.Println("  launchagent port affinity: auto-detect")
		if len(ports) > 1 {
			return fmt.Errorf(
				"runtime port affinity check failed: %d serial ports detected while LaunchAgent is unpinned; rerun setup with --pin-port",
				len(ports),
			)
		}
	} else {
		fmt.Printf("  launchagent port affinity: pinned (%s)\n", pinnedPort)
		if len(ports) > 0 && !containsPort(ports, pinnedPort) {
			return fmt.Errorf(
				"runtime port affinity check failed: pinned LaunchAgent port %q is not currently available",
				pinnedPort,
			)
		}
	}

	hello, err := usb.ReadDeviceHello(port)
	if err != nil {
		fmt.Printf("  device hello: warning (%v)\n", err)
		fmt.Println("  warning: capability handshake unavailable; runtime will use optimistic theme send fallback")
		return nil
	}

	caps := protocol.CapabilitiesFromHello(hello)
	fmt.Printf("  device hello: ok board=%s protocol=%d negotiated=%d firmware=%s theme=%t themeSpecV1=%t maxFrameBytes=%d\n",
		caps.Board,
		caps.ProtocolVersion,
		caps.NegotiatedProtocolVersion,
		hello.Firmware,
		caps.SupportsTheme,
		caps.SupportsThemeSpecV1,
		caps.MaxFrameBytes)
	if len(caps.SupportedProtocolVersions) > 0 {
		fmt.Printf("  device hello protocols: %v (preferred=%d)\n", caps.SupportedProtocolVersions, caps.PreferredProtocolVersion)
	}
	if !caps.Known {
		fmt.Println("  warning: device capabilities are unknown; skipping strict hardware/theme contract checks")
		return nil
	}

	switch caps.Board {
	case "esp8266-smalltv-st7789":
		if caps.Known && !caps.SupportsTheme {
			return fmt.Errorf("runtime capability check failed: board %q does not advertise theme support", caps.Board)
		}
	case "esp32-lilygo-t-display-s3":
		fmt.Println("  warning: esp32 fallback board detected (non-blocking)")
	default:
		return fmt.Errorf("runtime hardware contract failed: unsupported board %q", caps.Board)
	}

	if !protocol.IsSupportedProtocolVersion(caps.NegotiatedProtocolVersion) {
		return fmt.Errorf(
			"runtime protocol contract failed: negotiated protocol version %d unsupported by companion",
			caps.NegotiatedProtocolVersion,
		)
	}

	return nil
}

func runSetup(args []string) error {
	fs := flag.NewFlagSet("setup", flag.ContinueOnError)
	port := fs.String("port", "", "serial port (auto-detect when empty)")
	transportName := fs.String("transport", setup.DefaultTransport(), "device transport for LaunchAgent: wifi|usb")
	target := fs.String("target", setup.DefaultWiFiTarget(), "WiFi target base URL, for example http://vibetv.local")
	yes := fs.Bool("yes", false, "auto-select defaults without prompts")
	skipFlash := fs.Bool("skip-flash", false, "skip firmware flashing")
	pinPort := fs.Bool("pin-port", false, "pin daemon to selected --port in LaunchAgent (default: auto-detect)")
	firmwareEnv := fs.String("firmware-env", setup.DefaultFirmwareEnvironment(), "release firmware environment to flash (examples: esp8266_smalltv_st7789, lilygo_t_display_s3)")
	theme := fs.String("theme", "", "optional runtime theme override: classic|crt|mini|none (empty keeps existing setting, defaults new installs to mini)")
	validateOnly := fs.Bool("validate-only", false, "validate setup prerequisites only; do not change system state")
	dryRun := fs.Bool("dry-run", false, "show setup actions without applying changes")
	if err := fs.Parse(args); err != nil {
		return err
	}

	return setup.Run(context.Background(), setup.Options{
		Port:          strings.TrimSpace(*port),
		Transport:     strings.TrimSpace(*transportName),
		Target:        strings.TrimSpace(*target),
		AssumeYes:     *yes,
		SkipFlash:     *skipFlash,
		PinDaemonPort: *pinPort,
		FirmwareEnv:   strings.TrimSpace(*firmwareEnv),
		Theme:         strings.TrimSpace(*theme),
		ValidateOnly:  *validateOnly,
		DryRun:        *dryRun,
	})
}

func runService(args []string) error {
	if len(args) == 0 {
		return errors.New("missing service subcommand: expected start, stop, or status")
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("resolve home directory: %w", err)
	}

	switch strings.TrimSpace(strings.ToLower(args[0])) {
	case "start":
		if err := startLaunchAgent(home); err != nil {
			return err
		}
		fmt.Println("launchagent: enabled and started")
		return nil
	case "stop":
		if err := stopLaunchAgent(true); err != nil {
			return err
		}
		fmt.Println("launchagent: stopped and disabled")
		return nil
	case "status":
		status, err := queryLaunchAgentStatus()
		if err != nil {
			return err
		}
		fmt.Println("codexbar-display service")
		if status.Enabled {
			fmt.Println("enabled: yes")
		} else {
			fmt.Println("enabled: no")
		}
		fmt.Printf("state: %s\n", status.State)
		if status.PID != "" {
			fmt.Printf("pid: %s\n", status.PID)
		}
		fmt.Printf("plist: %s\n", filepath.Join(home, "Library", "LaunchAgents", launchAgentLabel))
		return nil
	default:
		return fmt.Errorf("unknown service subcommand %q: expected start, stop, or status", args[0])
	}
}

func runThemeValidate(args []string) error {
	fs := flag.NewFlagSet("theme-validate", flag.ContinueOnError)
	specPath := fs.String("spec", "", "path to ThemeSpec v1 JSON")
	port := fs.String("port", "", "serial port (auto-detect when empty)")
	transportName := fs.String("transport", setup.DefaultTransport(), "device transport: wifi|usb")
	target := fs.String("target", setup.DefaultWiFiTarget(), "WiFi target base URL, for example http://vibetv.local")
	allowUnknown := fs.Bool(
		"allow-unknown-capabilities",
		false,
		"allow local fallback profile when device capabilities are unavailable",
	)
	if err := fs.Parse(args); err != nil {
		return err
	}

	selectedTransport, requestedTarget, err := resolveThemeSpecTransport(
		resolveThemeSpecTransportName(*transportName, strings.TrimSpace(*port), flagWasSet(fs, "transport")),
		strings.TrimSpace(*target),
		strings.TrimSpace(*port),
	)
	if err != nil {
		return err
	}

	_, _, resolvedTarget, caps, err := loadAndValidateThemeSpec(
		strings.TrimSpace(*specPath),
		selectedTransport,
		requestedTarget,
		*allowUnknown,
	)
	if err != nil {
		return err
	}

	fmt.Printf(
		"theme-spec valid: transport=%s protocol=%d board=%s target=%s maxBytes=%d maxPrimitives=%d\n",
		selectedTransport.Name(),
		caps.NegotiatedProtocolVersion,
		caps.Board,
		resolvedTarget,
		caps.MaxThemeSpecBytes,
		caps.MaxThemePrimitives,
	)
	return nil
}

func runThemeApply(args []string) error {
	fs := flag.NewFlagSet("theme-apply", flag.ContinueOnError)
	specPath := fs.String("spec", "", "path to ThemeSpec v1 JSON")
	port := fs.String("port", "", "serial port (auto-detect when empty)")
	transportName := fs.String("transport", setup.DefaultTransport(), "device transport: wifi|usb")
	target := fs.String("target", setup.DefaultWiFiTarget(), "WiFi target base URL, for example http://vibetv.local")
	allowUnknown := fs.Bool(
		"allow-unknown-capabilities",
		false,
		"allow local fallback profile when device capabilities are unavailable",
	)
	if err := fs.Parse(args); err != nil {
		return err
	}

	selectedTransport, requestedTarget, err := resolveThemeSpecTransport(
		resolveThemeSpecTransportName(*transportName, strings.TrimSpace(*port), flagWasSet(fs, "transport")),
		strings.TrimSpace(*target),
		strings.TrimSpace(*port),
	)
	if err != nil {
		return err
	}

	spec, raw, resolvedTarget, caps, err := loadAndValidateThemeSpec(
		strings.TrimSpace(*specPath),
		selectedTransport,
		requestedTarget,
		*allowUnknown,
	)
	if err != nil {
		return err
	}

	frame := protocol.Frame{
		V:         protocol.NormalizeProtocolVersion(caps.NegotiatedProtocolVersion),
		ThemeSpec: raw,
	}
	if spec.FallbackTheme != "" {
		frame.Theme = spec.FallbackTheme
	}
	line, err := frame.MarshalLine()
	if err != nil {
		return &commandError{
			Op:   "theme-apply/marshal-frame",
			Code: errcode.ProtocolFrameEncode,
			Err:  err,
		}
	}
	if caps.MaxFrameBytes > 0 && len(line) > caps.MaxFrameBytes {
		return &commandError{
			Op:   "theme-apply/frame-size",
			Code: errcode.ProtocolThemeSpecIncompatible,
			Err: fmt.Errorf(
				"encoded frame exceeds maxFrameBytes: frame=%d limit=%d",
				len(line),
				caps.MaxFrameBytes,
			),
		}
	}
	if err := selectedTransport.SendLine(resolvedTarget, line); err != nil {
		return err
	}

	fmt.Printf(
		"theme-spec applied: id=%s rev=%d transport=%s protocol=%d board=%s target=%s\n",
		spec.ThemeID,
		spec.ThemeRev,
		selectedTransport.Name(),
		frame.V,
		caps.Board,
		resolvedTarget,
	)
	return nil
}

func runThemePack(args []string) error {
	if len(args) == 0 {
		return errors.New("theme-pack subcommand required: validate or install")
	}
	switch args[0] {
	case "catalog":
		return runThemePackCatalog(args[1:])
	case "validate":
		return runThemePackValidate(args[1:])
	case "install":
		return runThemePackInstall(args[1:])
	default:
		return fmt.Errorf("unknown theme-pack subcommand %q: expected catalog, validate, or install", args[0])
	}
}

func runThemePackCatalog(args []string) error {
	fs := flag.NewFlagSet("theme-pack catalog", flag.ContinueOnError)
	catalogRef := fs.String("catalog", defaultThemeCatalogURL, "path or HTTP(S) URL to VibeTV theme catalog JSON")
	if err := fs.Parse(args); err != nil {
		return err
	}
	catalog, err := themepack.LoadCatalog(strings.TrimSpace(*catalogRef))
	if err != nil {
		return err
	}
	fmt.Printf("theme catalog: themes=%d source=%s\n", len(catalog.Themes), strings.TrimSpace(*catalogRef))
	for _, theme := range catalog.Themes {
		title := strings.TrimSpace(theme.Title)
		if title == "" {
			title = theme.ID
		}
		fmt.Printf("- %s: %s", theme.ID, title)
		if theme.ThemeRev > 0 {
			fmt.Printf(" rev=%d", theme.ThemeRev)
		}
		if theme.Bytes > 0 {
			fmt.Printf(" bytes=%d", theme.Bytes)
		}
		fmt.Println()
		if description := strings.TrimSpace(theme.Description); description != "" {
			fmt.Printf("  %s\n", description)
		}
	}
	return nil
}

func runThemePackValidate(args []string) error {
	fs := flag.NewFlagSet("theme-pack validate", flag.ContinueOnError)
	packPath := fs.String("pack", "", "path or HTTP(S) URL to VibeTV theme pack directory or zip")
	if err := fs.Parse(args); err != nil {
		return err
	}
	pack, err := themepack.Load(strings.TrimSpace(*packPath))
	if err != nil {
		return err
	}
	fmt.Printf(
		"theme-pack valid: id=%s name=%q themeId=%s rev=%d assets=%d themeSpecBytes=%d\n",
		pack.Manifest.ID,
		pack.Manifest.Name,
		pack.ThemeSpec.ThemeID,
		pack.ThemeSpec.ThemeRev,
		len(pack.Assets),
		len(pack.ThemeSpecRaw),
	)
	return nil
}

func runThemePackInstall(args []string) error {
	fs := flag.NewFlagSet("theme-pack install", flag.ContinueOnError)
	packPath := fs.String("pack", "", "path or HTTP(S) URL to VibeTV theme pack directory or zip")
	catalogRef := fs.String("catalog", "", "path or HTTP(S) URL to VibeTV theme catalog JSON")
	themeID := fs.String("theme", "", "theme id from catalog")
	target := fs.String("target", setup.DefaultWiFiTarget(), "WiFi target base URL, for example http://vibetv.local")
	firmwareManifestURL := fs.String("firmware-manifest-url", themeinstall.DefaultFirmwareManifestURL, "firmware manifest URL checked before installing the theme pack")
	skipFirmwareUpdate := fs.Bool("skip-firmware-update", false, "skip the firmware update preflight before installing the theme pack")
	verbose := fs.Bool("verbose", false, "show detailed theme install paths and byte counts")
	allowUnknown := fs.Bool(
		"allow-unknown-capabilities",
		false,
		"allow local fallback profile when device capabilities are unavailable",
	)
	if err := fs.Parse(args); err != nil {
		return err
	}
	installTarget := resolveThemePackInstallTarget(fs, strings.TrimSpace(*target))
	_, err := themeinstall.Install(context.Background(), themeinstall.Options{
		PackURL:             strings.TrimSpace(*packPath),
		CatalogURL:          strings.TrimSpace(*catalogRef),
		ThemeID:             strings.TrimSpace(*themeID),
		Target:              installTarget,
		FirmwareManifestURL: strings.TrimSpace(*firmwareManifestURL),
		SkipFirmwareUpdate:  *skipFirmwareUpdate,
		AllowUnknown:        *allowUnknown,
		Verbose:             *verbose,
		Out:                 os.Stdout,
		UploadSettleDelay:   themePackUploadSettleDelay,
		PairTokenStore:      saveThemeInstallPairingToken,
		FetchLiveFrame:      themePackInstallFetchLiveFrameFn,
		FirmwareUpdater: func(ctx context.Context, target, manifestURL string) error {
			return themePackInstallFirmwareUpdateFn(target, manifestURL)
		},
	})
	return err
}

func resolveThemePackInstallTarget(fs *flag.FlagSet, requested string) string {
	cfg, ok := loadRuntimeConfigForCommand()
	if ok && !flagWasSet(fs, "target") && strings.TrimSpace(cfg.DeviceTarget) != "" {
		requested = strings.TrimSpace(cfg.DeviceTarget)
	}
	if ok && strings.TrimSpace(cfg.DeviceToken) != "" {
		return targetWithQueryToken(requested, cfg.DeviceToken)
	}
	return requested
}

func saveThemeInstallPairingToken(target, token string) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	cfg, err := runtimeconfig.Load(home)
	if err != nil {
		return err
	}
	if publicTarget := publicDeviceTargetForConfig(target); publicTarget != "" {
		cfg.DeviceTarget = publicTarget
	}
	cfg.DeviceToken = token
	return runtimeconfig.Save(home, cfg)
}

func loadRuntimeConfigForCommand() (runtimeconfig.Config, bool) {
	home, err := os.UserHomeDir()
	if err != nil {
		return runtimeconfig.Config{}, false
	}
	cfg, err := runtimeconfig.Load(home)
	if err != nil {
		return runtimeconfig.Config{}, false
	}
	return cfg, true
}

func targetWithQueryToken(target, token string) string {
	token = strings.TrimSpace(token)
	if token == "" {
		return strings.TrimSpace(target)
	}
	parsed, ok := parseCommandDeviceTarget(target)
	if !ok {
		return strings.TrimSpace(target)
	}
	query := parsed.Query()
	if strings.TrimSpace(query.Get("token")) != "" {
		return parsed.String()
	}
	query.Set("token", token)
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func publicDeviceTargetForConfig(target string) string {
	parsed, ok := parseCommandDeviceTarget(target)
	if !ok {
		return strings.TrimSpace(target)
	}
	query := parsed.Query()
	query.Del("token")
	parsed.RawQuery = query.Encode()
	parsed.Fragment = ""
	return strings.TrimRight(parsed.String(), "/")
}

func parseCommandDeviceTarget(target string) (*url.URL, bool) {
	target = strings.TrimSpace(target)
	if target == "" {
		return nil, false
	}
	if !strings.Contains(target, "://") {
		target = "http://" + target
	}
	parsed, err := url.Parse(target)
	if err != nil || strings.TrimSpace(parsed.Scheme) == "" || strings.TrimSpace(parsed.Host) == "" {
		return nil, false
	}
	return parsed, true
}

var themePackInstallFirmwareUpdateFn = runThemePackInstallFirmwareUpdate

func runThemePackInstallFirmwareUpdate(target, manifestURL string) error {
	args := []string{"--target", target, "--confirm-live-update"}
	if strings.TrimSpace(manifestURL) != "" {
		args = append(args, "--manifest-url", strings.TrimSpace(manifestURL))
	}
	return runInstallUpdate(args)
}

func resolveThemeSpecTransport(transportName, target, port string) (transportlayer.DeviceTransport, string, error) {
	normalizedTransport := strings.TrimSpace(strings.ToLower(transportName))
	if normalizedTransport == "" {
		normalizedTransport = setup.DefaultTransport()
	}
	switch normalizedTransport {
	case "wifi":
		return transportlayer.NewWiFiTransport(), strings.TrimSpace(target), nil
	case "usb":
		return transportlayer.NewUSBTransport(), strings.TrimSpace(port), nil
	default:
		return nil, "", fmt.Errorf("unsupported transport %q", transportName)
	}
}

func resolveThemeSpecTransportName(transportName, port string, transportExplicit bool) string {
	if !transportExplicit && strings.TrimSpace(port) != "" {
		return "usb"
	}
	return strings.TrimSpace(transportName)
}

func flagWasSet(fs *flag.FlagSet, name string) bool {
	wasSet := false
	fs.Visit(func(f *flag.Flag) {
		if f.Name == name {
			wasSet = true
		}
	})
	return wasSet
}

func loadAndValidateThemeSpec(
	specPath string,
	deviceTransport transportlayer.DeviceTransport,
	requestedTarget string,
	allowUnknown bool,
) (themespec.Spec, []byte, string, protocol.DeviceCapabilities, error) {
	if strings.TrimSpace(specPath) == "" {
		return themespec.Spec{}, nil, "", protocol.DeviceCapabilities{}, &commandError{
			Op:   "theme-spec/load",
			Code: errcode.ProtocolThemeSpecInvalid,
			Err:  errors.New("missing required --spec path"),
		}
	}
	if deviceTransport == nil {
		return themespec.Spec{}, nil, "", protocol.DeviceCapabilities{}, errors.New("device transport is required")
	}

	spec, raw, err := themespec.Load(specPath)
	if err != nil {
		return themespec.Spec{}, nil, "", protocol.DeviceCapabilities{}, &commandError{
			Op:   "theme-spec/load",
			Code: errcode.ProtocolThemeSpecInvalid,
			Err:  err,
		}
	}
	if err := themespec.Validate(spec); err != nil {
		return themespec.Spec{}, nil, "", protocol.DeviceCapabilities{}, &commandError{
			Op:   "theme-spec/validate",
			Code: errcode.ProtocolThemeSpecInvalid,
			Err:  err,
		}
	}

	resolvedTarget, err := deviceTransport.ResolvePort(requestedTarget)
	if err != nil {
		return themespec.Spec{}, nil, "", protocol.DeviceCapabilities{}, err
	}
	caps, err := deviceTransport.DeviceCapabilities(resolvedTarget)
	if err != nil {
		if allowUnknown && errcode.Of(err) == errcode.ProtocolDeviceHelloUnavailable {
			caps = fallbackThemeSpecCapabilities()
			caps.ActiveTransport = deviceTransport.Name()
			fmt.Printf("warning: device hello unavailable; using local fallback capabilities for validation on %s\n", resolvedTarget)
		} else {
			return themespec.Spec{}, nil, "", protocol.DeviceCapabilities{}, err
		}
	}
	if allowUnknown && !caps.Known {
		caps = fallbackThemeSpecCapabilities()
		caps.ActiveTransport = deviceTransport.Name()
		fmt.Printf("warning: capabilities unknown; using local fallback profile on %s\n", resolvedTarget)
	}
	if !allowUnknown && !caps.Known {
		return themespec.Spec{}, nil, "", protocol.DeviceCapabilities{}, &commandError{
			Op:   "theme-spec/capabilities",
			Code: errcode.ProtocolThemeSpecIncompatible,
			Err:  errors.New("device capabilities unavailable; connect device and retry"),
		}
	}
	if err := themespec.ValidateAgainstCapabilities(spec, raw, caps); err != nil {
		return themespec.Spec{}, nil, "", protocol.DeviceCapabilities{}, &commandError{
			Op:   "theme-spec/capabilities",
			Code: errcode.ProtocolThemeSpecIncompatible,
			Err:  err,
		}
	}

	return spec, raw, resolvedTarget, caps, nil
}

func fallbackThemeSpecCapabilities() protocol.DeviceCapabilities {
	return themeinstall.FallbackThemeSpecCapabilities()
}

func runRestoreKnownGood(args []string) error {
	fs := flag.NewFlagSet("restore-known-good", flag.ContinueOnError)
	port := fs.String("port", "", "serial port (auto-detect when empty)")
	image := fs.String("image", "", "backup image path (auto-select newest known-good backup when empty)")
	baud := fs.Int("baud", 460800, "esptool serial baud rate")
	scriptPath := fs.String("script-path", "", "path to esp8266-restore.sh (auto-detect when empty)")
	manifest := fs.String("manifest", "", "manifest path (default: <image>.manifest)")
	skipVerify := fs.Bool("skip-verify", false, "skip manifest/device verification (unsafe, legacy fallback)")
	var backupDirs stringListFlag
	fs.Var(&backupDirs, "backup-dir", "backup directory to search when --image is empty (repeatable)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *baud <= 0 {
		return fmt.Errorf("invalid --baud: %d", *baud)
	}

	resolvedPort, err := usb.ResolvePort(strings.TrimSpace(*port))
	if err != nil {
		return fmt.Errorf("resolve serial port: %w", err)
	}

	resolvedScriptPath, err := resolveRestoreScriptPath(strings.TrimSpace(*scriptPath))
	if err != nil {
		return err
	}

	searchDirs, err := resolveBackupSearchDirs(backupDirs)
	if err != nil {
		return err
	}

	restoreImage, err := resolveRestoreImage(strings.TrimSpace(*image), searchDirs)
	if err != nil {
		return err
	}

	manifestPath, err := resolveRestoreManifestPath(restoreImage, strings.TrimSpace(*manifest), *skipVerify)
	if err != nil {
		return err
	}

	if _, err := exec.LookPath("pio"); err != nil {
		return fmt.Errorf("platformio CLI not found in PATH (needed by restore script): %w", err)
	}

	fmt.Printf("restore script: %s\n", resolvedScriptPath)
	fmt.Printf("restore image: %s\n", restoreImage)
	if *skipVerify {
		fmt.Println("manifest verification: skipped (--skip-verify)")
	} else {
		fmt.Printf("manifest: %s\n", manifestPath)
	}
	fmt.Printf("serial port: %s\n", resolvedPort)
	fmt.Printf("baud: %d\n", *baud)

	cmd := exec.Command(
		resolvedScriptPath,
		resolvedPort,
		restoreImage,
	)
	env := append(
		os.Environ(),
		"BAUD="+strconv.Itoa(*baud),
		"SKIP_VERIFY="+boolAsShellValue(*skipVerify),
	)
	if manifestPath != "" {
		env = append(env, "MANIFEST="+manifestPath)
	}
	cmd.Env = env
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Dir = filepath.Dir(resolvedScriptPath)

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("restore-known-good failed: %w", err)
	}
	return nil
}

func resolveRestoreImage(requested string, searchDirs []string) (string, error) {
	if requested != "" {
		path, err := resolvePathFromCwd(requested)
		if err != nil {
			return "", err
		}
		if !fileExists(path) {
			return "", fmt.Errorf("restore image not found: %s", path)
		}
		return path, nil
	}

	candidates := make([]string, 0, 8)
	for _, dir := range searchDirs {
		patterns := []string{
			filepath.Join(dir, "backup_chunks_*", "weather_backup_full.bin"),
			filepath.Join(dir, "weather_backup_*.bin"),
			filepath.Join(dir, "*.bin"),
		}
		for _, pattern := range patterns {
			matches, _ := filepath.Glob(pattern)
			for _, match := range matches {
				if fileExists(match) {
					candidates = append(candidates, match)
				}
			}
		}
	}
	if len(candidates) == 0 {
		return "", errors.New("no known-good backup image found; pass --image <path/to/backup.bin> or add --backup-dir <dir>")
	}

	sort.Slice(candidates, func(i, j int) bool {
		si, errI := os.Stat(candidates[i])
		sj, errJ := os.Stat(candidates[j])
		if errI == nil && errJ == nil {
			ti := si.ModTime()
			tj := sj.ModTime()
			if !ti.Equal(tj) {
				return ti.After(tj)
			}
		}
		return candidates[i] < candidates[j]
	})

	return candidates[0], nil
}

func resolveRestoreScriptPath(requested string) (string, error) {
	if strings.TrimSpace(requested) != "" {
		path, err := resolvePathFromCwd(requested)
		if err != nil {
			return "", err
		}
		if !fileExists(path) {
			return "", fmt.Errorf("restore script not found: %s", path)
		}
		return path, nil
	}

	candidates := make([]string, 0, 4)
	if appSupport, err := runtimeSupportDir(); err == nil {
		candidates = append(candidates, filepath.Join(appSupport, "scripts", "esp8266-restore.sh"))
	}

	if execPath, err := os.Executable(); err == nil {
		binDir := filepath.Dir(execPath)
		candidates = append(candidates, filepath.Join(filepath.Dir(binDir), "scripts", "esp8266-restore.sh"))
	}

	if repoRoot, ok := findRepositoryRootFromWorkingDir(); ok {
		candidates = append(candidates, filepath.Join(repoRoot, "scripts", "esp8266-restore.sh"))
	}

	seen := make(map[string]struct{}, len(candidates))
	for _, candidate := range candidates {
		candidate = filepath.Clean(candidate)
		if _, ok := seen[candidate]; ok {
			continue
		}
		seen[candidate] = struct{}{}
		if fileExists(candidate) {
			return candidate, nil
		}
	}

	return "", errors.New("restore script not found; run `codexbar-display setup` first or pass --script-path /path/to/esp8266-restore.sh")
}

func resolveBackupSearchDirs(extraDirs []string) ([]string, error) {
	candidateDirs := make([]string, 0, len(extraDirs)+4)
	candidateDirs = append(candidateDirs, extraDirs...)

	if appSupport, err := runtimeSupportDir(); err == nil {
		candidateDirs = append(candidateDirs, filepath.Join(appSupport, "backups"))
		candidateDirs = append(candidateDirs, filepath.Join(appSupport, "known-good"))
	}

	if repoRoot, ok := findRepositoryRootFromWorkingDir(); ok {
		candidateDirs = append(candidateDirs, filepath.Join(repoRoot, "tmp"))
		candidateDirs = append(candidateDirs, filepath.Join(repoRoot, "known-good"))
	}

	if cwd, err := os.Getwd(); err == nil {
		candidateDirs = append(candidateDirs, filepath.Join(cwd, "tmp"))
	}

	seen := make(map[string]struct{}, len(candidateDirs))
	resolved := make([]string, 0, len(candidateDirs))
	for _, dir := range candidateDirs {
		if strings.TrimSpace(dir) == "" {
			continue
		}
		abs, err := resolvePathFromCwd(dir)
		if err != nil {
			return nil, err
		}
		if _, ok := seen[abs]; ok {
			continue
		}
		seen[abs] = struct{}{}
		resolved = append(resolved, abs)
	}
	return resolved, nil
}

func resolveRestoreManifestPath(imagePath, requested string, skipVerify bool) (string, error) {
	if skipVerify {
		return "", nil
	}

	if strings.TrimSpace(requested) != "" {
		path, err := resolvePathFromCwd(requested)
		if err != nil {
			return "", err
		}
		if !fileExists(path) {
			return "", fmt.Errorf("manifest not found: %s", path)
		}
		return path, nil
	}

	candidates := []string{
		imagePath + ".manifest",
		imagePath + ".manifest.json",
	}
	for _, candidate := range candidates {
		if fileExists(candidate) {
			return candidate, nil
		}
	}

	return "", fmt.Errorf("manifest not found for %s; run backup again or pass --manifest <path> (or use --skip-verify)", imagePath)
}

func findRepositoryRootFromWorkingDir() (string, bool) {
	start, err := os.Getwd()
	if err != nil {
		return "", false
	}
	dir := filepath.Clean(start)
	for {
		if fileExists(filepath.Join(dir, "companion", "go.mod")) && fileExists(filepath.Join(dir, "scripts", "esp8266-restore.sh")) {
			return dir, true
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "", false
}

func runtimeSupportDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Library", "Application Support", "codexbar-display"), nil
}

func resolvePathFromCwd(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", errors.New("empty path")
	}
	if filepath.IsAbs(path) {
		return filepath.Clean(path), nil
	}
	cwd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	return filepath.Clean(filepath.Join(cwd, path)), nil
}

func boolAsShellValue(v bool) string {
	if v {
		return "1"
	}
	return "0"
}

type stringListFlag []string

func (f *stringListFlag) String() string {
	if f == nil {
		return ""
	}
	return strings.Join(*f, ",")
}

func (f *stringListFlag) Set(value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return errors.New("backup dir cannot be empty")
	}
	*f = append(*f, value)
	return nil
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return !info.IsDir()
}

func containsPort(ports []string, target string) bool {
	target = strings.TrimSpace(target)
	if target == "" {
		return false
	}
	for _, port := range ports {
		if strings.TrimSpace(port) == target {
			return true
		}
	}
	return false
}

func doctorPinnedLaunchAgentPort() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	plistPath := filepath.Join(home, "Library", "LaunchAgents", "com.codexbar-display.daemon.plist")
	data, err := os.ReadFile(plistPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", nil
		}
		return "", err
	}
	return parsePinnedPortFromLaunchAgentPlist(string(data)), nil
}

func parsePinnedPortFromLaunchAgentPlist(plist string) string {
	const marker = "<string>--port</string>"
	idx := strings.Index(plist, marker)
	if idx < 0 {
		return ""
	}
	rest := plist[idx+len(marker):]
	start := strings.Index(rest, "<string>")
	if start < 0 {
		return ""
	}
	rest = rest[start+len("<string>"):]
	end := strings.Index(rest, "</string>")
	if end < 0 {
		return ""
	}
	return strings.TrimSpace(rest[:end])
}
