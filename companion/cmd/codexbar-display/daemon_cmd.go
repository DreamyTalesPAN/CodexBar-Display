package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/buildinfo"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/companionapi"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/setup"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/timeline"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/versioning"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/writerlock"
)

var displayWorkerRestartDelay = 5 * time.Second

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
	if opts.LastGoodMaxAge > 0 {
		if err := os.Setenv("CODEXBAR_DISPLAY_LAST_GOOD_MAX_AGE", opts.LastGoodMaxAge.String()); err != nil {
			return err
		}
	}
	// A native shell (Windows) registers the daemon as a Scheduled Task, which
	// cannot carry environment variables the way a LaunchAgent plist does, so
	// the shell passes the same settings as flags.
	for key, value := range map[string]string{
		"VIBETV_MAC_APP_VERSION":                      opts.AppVersion,
		"VIBETV_MAC_APP_BUILD":                        opts.AppBuild,
		runtimepaths.DisplayStreamLaunchAgentLabelEnv: opts.RuntimeLabel,
	} {
		if value == "" {
			continue
		}
		if err := os.Setenv(key, value); err != nil {
			return err
		}
	}
	if opts.NativeShell {
		if err := os.Setenv("VIBETV_DISABLE_MAC_APP_SELF_UPDATE", "1"); err != nil {
			return err
		}
	}
	if err := pinFirmwareManifestToAppRelease(); err != nil {
		return err
	}
	writerLock, err := writerlock.Acquire()
	if err != nil {
		return err
	}
	defer writerLock.Release()
	if err := protectDaemonProcessTree(); err != nil {
		return err
	}
	if opts.APIAddr == "" {
		return daemon.Run(context.Background(), opts.Daemon)
	}
	return runDaemonWithCompanionAPI(context.Background(), opts)
}

type daemonCommandOptions struct {
	LastGoodMaxAge time.Duration
	Daemon         daemon.Options
	APIAddr        string
	APIDevOrigin   string
	APIFallback    bool
	AppVersion     string
	AppBuild       string
	NativeShell    bool
	RuntimeLabel   string
}

// pinFirmwareManifestToAppRelease points a customer install (Mac App or
// Windows app) at the firmware manifest of its own release instead of the
// latest one. App and firmware of a release belong together, so an app only
// ever installs the firmware it shipped with, and publishing a newer release
// cannot strand an older app halfway through setup. An explicit manifest
// override (bench and rehearsal setups) wins. A build whose release is not
// published (CI builds, a candidate before its release) keeps the latest
// manifest, as before.
func pinFirmwareManifestToAppRelease() error {
	if os.Getenv("VIBETV_DISABLE_MAC_APP_SELF_UPDATE") != "1" ||
		strings.TrimSpace(os.Getenv("CODEXBAR_DISPLAY_FIRMWARE_MANIFEST_URL")) != "" {
		return nil
	}
	version, err := versioning.ParseSemVer(os.Getenv("VIBETV_MAC_APP_VERSION"))
	if err != nil {
		return nil
	}
	manifestURL := githubReleaseAssetURL(defaultReleaseRepo, "v"+version.String(), "firmware-manifest.json")
	if firmwareManifestMissing(manifestURL) {
		return nil
	}
	return os.Setenv("CODEXBAR_DISPLAY_FIRMWARE_MANIFEST_URL", manifestURL)
}

// firmwareManifestMissing reports only a definitive 404. Any other answer,
// including no network at startup, keeps the pin.
var firmwareManifestMissing = func(manifestURL string) bool {
	client := http.Client{Timeout: 3 * time.Second}
	resp, err := client.Head(manifestURL)
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == http.StatusNotFound
}

func parseDaemonCommandOptions(args []string) (daemonCommandOptions, error) {
	fs := flag.NewFlagSet("daemon", flag.ContinueOnError)
	port := fs.String("port", "", "legacy option; Cable runtime always resolves by device identity")
	transportName := fs.String("transport", setup.DefaultTransport(), "device transport: wifi|usb")
	target := fs.String("target", "", "WiFi target base URL, for example http://192.168.178.163")
	interval := fs.Duration("interval", 0, "poll interval")
	once := fs.Bool("once", false, "run one cycle and exit")
	theme := fs.String("theme", "", "optional runtime theme override: classic|crt|mini")
	apiAddr := fs.String("api-addr", "", "optional local companion API bind address")
	apiDevOrigin := fs.String("api-dev-origin", "http://localhost:3000", "additional allowed local dev origin for --api-addr")
	apiFallback := fs.Bool("api-fallback", false, "fall back to a free loopback port when --api-addr is in use")
	lastGoodMaxAge := fs.Duration("last-good-max-age", 0, "override last-good frame maximum age (otherwise use environment/default)")
	appVersion := fs.String("app-version", "", "native shell version reported as the Control Center app version")
	appBuild := fs.String("app-build", "", "native shell build number reported as the Control Center app build")
	nativeShell := fs.Bool("native-shell", false, "serve the Control Center only to the native shell (disables the browser UI and the in-runtime self update)")
	runtimeLabel := fs.String("runtime-label", "", "service label that owns this runtime (otherwise use environment/default)")
	if err := fs.Parse(args); err != nil {
		return daemonCommandOptions{}, err
	}
	if *lastGoodMaxAge < 0 {
		return daemonCommandOptions{}, errors.New("last-good-max-age must not be negative")
	}

	normalizedTransport := strings.TrimSpace(strings.ToLower(*transportName))
	if normalizedTransport == "" {
		normalizedTransport = setup.DefaultTransport()
	}
	if normalizedTransport != "usb" && normalizedTransport != "wifi" {
		return daemonCommandOptions{}, fmt.Errorf("unsupported transport %q", *transportName)
	}

	return daemonCommandOptions{
		LastGoodMaxAge: *lastGoodMaxAge,
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
		APIFallback:  *apiFallback,
		AppVersion:   strings.TrimSpace(*appVersion),
		AppBuild:     strings.TrimSpace(*appBuild),
		NativeShell:  *nativeShell,
		RuntimeLabel: strings.TrimSpace(*runtimeLabel),
	}, nil
}

const vibeTVServiceProbeTimeout = 12 * time.Second

func addressHostsVibeTVService(addr string) bool {
	statusURL := url.URL{
		Scheme: "http",
		Host:   addr,
		Path:   "/v1/status",
	}
	request, err := http.NewRequest(
		http.MethodGet,
		statusURL.String(),
		nil,
	)
	if err != nil {
		return false
	}
	client := &http.Client{
		Timeout: vibeTVServiceProbeTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	response, err := client.Do(request)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return false
	}

	var status struct {
		Companion struct {
			Status  string `json:"status"`
			Version string `json:"version"`
		} `json:"companion"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 64<<10)).Decode(&status); err != nil {
		return false
	}
	return strings.TrimSpace(status.Companion.Status) != "" &&
		strings.TrimSpace(status.Companion.Version) != ""
}

func listenCompanionAPI(addr string, allowFallback bool) (net.Listener, error) {
	listener, err := net.Listen("tcp", addr)
	if err == nil || !allowFallback || !isAddressInUse(err) {
		return listener, err
	}
	if addressHostsVibeTVService(addr) {
		return nil, fmt.Errorf(
			"another VibeTV service already owns %s: %w",
			addr,
			err,
		)
	}
	return net.Listen("tcp", "127.0.0.1:0")
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
	renderWake := make(chan struct{}, 1)
	deviceWrites := &deviceWriteCoordinator{}
	wakeDisplayWorker := func() {
		select {
		case wake <- struct{}{}:
		default:
		}
	}
	listener, err := listenCompanionAPI(opts.APIAddr, opts.APIFallback)
	if err != nil {
		return err
	}
	actualAddr := listener.Addr().String()
	if opts.APIFallback {
		endpointPath := runtimeEndpointPath(home)
		endpoint := runtimeEndpoint{
			Origin: "http://" + actualAddr,
			PID:    os.Getpid(),
		}
		if err := writeRuntimeEndpoint(endpointPath, endpoint); err != nil {
			if actualAddr != opts.APIAddr {
				listener.Close()
				return fmt.Errorf("write runtime endpoint: %w", err)
			}
			logf("VibeTV companion API kept the default endpoint because runtime discovery could not be written: %v", err)
		} else {
			defer removeRuntimeEndpoint(endpointPath, endpoint.PID)
		}
	}

	var workerRunning atomic.Bool
	var systemBusy atomic.Pointer[daemon.SystemBusy]
	firmwareUpdates := &daemon.FirmwareUpdateCache{}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var dashboard codexbar.DashboardServe
	var restartUsageService, replaceUsageService func(context.Context) error
	var usageServiceInfo func() codexbar.DashboardServeInfo
	if !opts.Daemon.Once {
		dashboard = codexbar.StartDashboardServe(ctx, logf)
		if supervisor, ok := dashboard.(*codexbar.DashboardServeSupervisor); ok {
			restartUsageService = supervisor.Restart
			replaceUsageService = supervisor.Replace
			usageServiceInfo = supervisor.Info
		}
	}
	server, err := companionapi.New(companionapi.Options{
		Logf:                 logf,
		AIThemeSecrets:       companionapi.NewDurableAIThemeSecrets(""),
		DisplayStreamRunning: workerRunning.Load,
		SystemBusy:           systemBusy.Load,
		FirmwareUpdates:      firmwareUpdates,
		RuntimeTheme:         opts.Daemon.Theme,
		Addr:                 actualAddr,
		AllowedOrigins:       []string{opts.APIDevOrigin},
		RefreshDisplayStream: func(context.Context, string) error {
			wakeDisplayWorker()
			return nil
		},
		PauseDisplayStream:  deviceWrites.setPaused,
		WakeDisplayStream:   wakeDisplayWorker,
		RestartUsageService: restartUsageService,
		ReplaceUsageService: replaceUsageService,
		UsageServiceInfo:    usageServiceInfo,
		RenderDisplayStream: func() {
			select {
			case renderWake <- struct{}{}:
			default:
			}
		},
	})
	if err != nil {
		listener.Close()
		return err
	}

	// Everything this run reports to the support timeline carries one ID, so
	// a restart is visible as a new group of events.
	runID := make([]byte, 8)
	_, _ = rand.Read(runID)
	record := func(event timeline.Event) {
		event.CorrelationID = hex.EncodeToString(runID)
		server.Timeline().Record(time.Now(), event)
	}
	record(timeline.Event{Component: "companion", State: "started"})
	record(timeline.Event{Component: "companion_version", State: buildinfo.NormalizedVersion()})
	// The service manager ends the runtime by killing it, which records
	// nothing; only a runtime that ends by itself reaches this line.
	defer record(timeline.Event{Component: "companion", State: "stopped"})

	daemonOpts := opts.Daemon
	daemonOpts.RecordEvent = record
	daemonOpts.Wake = wake
	daemonOpts.RenderWake = renderWake
	daemonOpts.PauseDeviceWrites = deviceWrites.isPaused
	daemonOpts.BeginDeviceWrite = deviceWrites.beginWrite
	daemonOpts.Dashboard = dashboard
	daemonOpts.ReportSystemBusy = systemBusy.Store
	daemonOpts.CurrentSystemBusy = systemBusy.Load
	daemonOpts.FirmwareUpdates = firmwareUpdates
	daemonOpts.SingleProviderTheme = server.SingleProviderTheme

	errc := make(chan error, 1)
	go func() {
		errc <- server.Serve(ctx, listener)
	}()
	workerRun := func(ctx context.Context, opts daemon.Options) error {
		workerRunning.Store(true)
		defer workerRunning.Store(false)
		return daemon.RunWithLogger(ctx, opts, logf)
	}
	go superviseDisplayWorker(ctx, daemonOpts, workerRun, time.After, logf)

	logf("VibeTV companion API listening on http://%s", actualAddr)
	err = <-errc
	cancel()
	return err
}

type deviceWriteCoordinator struct {
	paused  atomic.Bool
	gate    sync.RWMutex
	stateMu sync.Mutex
	locked  bool
}

func (c *deviceWriteCoordinator) isPaused() bool {
	return c.paused.Load()
}

func (c *deviceWriteCoordinator) setPaused(paused bool) {
	c.stateMu.Lock()
	defer c.stateMu.Unlock()

	if paused {
		if c.locked {
			return
		}
		c.paused.Store(true)
		c.gate.Lock()
		c.locked = true
		return
	}

	if !c.locked {
		c.paused.Store(false)
		return
	}
	c.paused.Store(false)
	c.locked = false
	c.gate.Unlock()
}

func (c *deviceWriteCoordinator) beginWrite() func() {
	c.gate.RLock()
	return c.gate.RUnlock
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
		} else if errors.Is(err, daemon.ErrConnectionModeChanged) {
			logf("VibeTV connection mode changed; restarting display worker now\n")
			continue
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
