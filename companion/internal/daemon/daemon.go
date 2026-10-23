package daemon

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/systemload"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/timeline"
	transportlayer "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/transport"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
)

type Options struct {
	// FirmwareUpdates shares the stream cache with API previews.
	FirmwareUpdates        *FirmwareUpdateCache
	Port                   string
	Transport              string
	Target                 string
	Interval               time.Duration
	Once                   bool
	Theme                  string
	DisableStartupFastPoll bool
	Wake                   <-chan struct{}
	PauseDeviceWrites      func() bool
	BeginDeviceWrite       func() func()
	// Dashboard belongs to the app runtime, across display transport restarts.
	Dashboard codexbar.DashboardServe
	// RenderWake reselects from existing collector snapshots without a provider fetch.
	RenderWake <-chan struct{}
	// RecordEvent receives the worker's state for the support timeline. It is
	// called on every cycle; the timeline keeps only the transitions.
	RecordEvent func(timeline.Event)
	// ReportSystemBusy receives the collector's busy-computer verdict after
	// every collection: nil while usage arrives or the computer has memory
	// to spare (issue #606).
	ReportSystemBusy func(*SystemBusy)
	// CurrentSystemBusy is the verdict last reported, also by a worker that
	// has since been replaced: a restart of the worker does not end the
	// incident.
	CurrentSystemBusy func() *SystemBusy
}

// SystemBusyLabel replaces the provider name on VibeTV while the computer is
// too starved for the usage engine to answer. "Computer busy" ran into the
// window buttons of Clippy's title bar on the bench VibeTV; "Busy" fits the
// title line of every catalog theme.
const SystemBusyLabel = "Busy"

// SystemBusy is the condition of issue #606: the usage engine is running but
// has not answered for several collections, and the computer is low on
// memory. Since is when the collector first saw both.
type SystemBusy struct {
	Since time.Time `json:"since"`
	systemload.Figures
}

const (
	// Firmware confirms or rolls back a WiFi switch within one minute of its
	// reboot (no setup AP since #489), plus join/reboot time.
	wifiTransitionQuietPeriod  = 2 * time.Minute
	defaultInterval            = 2 * time.Second
	defaultWiFiInterval        = 30 * time.Second
	defaultCycleTimeout        = 180 * time.Second
	startupFastPollWindow      = 2 * time.Minute
	startupFastPollInterval    = 5 * time.Second
	failureRetryInterval       = 5 * time.Second
	lastGoodPersistInterval    = 1 * time.Minute
	themeEnvVar                = "CODEXBAR_DISPLAY_THEME"
	coldStartTimeoutEnvVar     = "CODEXBAR_DISPLAY_COLDSTART_TIMEOUT_SECS"
	cycleTimeoutEnvVar         = "CODEXBAR_DISPLAY_CYCLE_TIMEOUT_SECS"
	collectorIntervalEnvVar    = "CODEXBAR_DISPLAY_COLLECTOR_INTERVAL_SECS"
	activityPollEnvVar         = "CODEXBAR_DISPLAY_ACTIVITY_POLL_SECS"
	activityHoldEnvVar         = "CODEXBAR_DISPLAY_ACTIVITY_HOLD_SECS"
	activityCodingMaxAgeEnvVar = "CODEXBAR_DISPLAY_ACTIVITY_MAX_SECS"
	activityIdleEvidenceEnvVar = "CODEXBAR_DISPLAY_ACTIVITY_IDLE_EVIDENCE"
	collectorTimeoutEnvVar     = "CODEXBAR_DISPLAY_FETCH_TIMEOUT_SECS"
	collectorOrderEnvVar       = "CODEXBAR_DISPLAY_PROVIDER_ORDER"
	providerMaxAgeEnvVar       = "CODEXBAR_DISPLAY_PROVIDER_LAST_GOOD_MAX_AGE"
	collectorWarmupEnvVar      = "CODEXBAR_DISPLAY_COLLECTOR_WARMUP_MAX_AGE"
	defaultProviderMaxAge      = 10 * time.Minute
	firmwareManifestEnvVar     = "CODEXBAR_DISPLAY_FIRMWARE_MANIFEST_URL"
	firmwareManifestURL        = "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/firmware-manifest.json"
	firmwareUpdateCheckGap     = 6 * time.Hour
	firmwareManifestTimeout    = 5 * time.Second
)

func Run(ctx context.Context, opts Options) error {
	return RunWithLogger(ctx, opts, nil)
}

// RunWithLogger runs the display worker with an optional injected logger. A
// nil logger preserves the legacy stdout behavior used by standalone daemons.
func RunWithLogger(ctx context.Context, opts Options, logf func(string, ...any)) error {
	transportName := configuredConnectionMode(opts.Transport)
	if transportName == "" {
		transportName = "usb"
	}
	if transportName != "usb" && transportName != "wifi" {
		return fmt.Errorf("unsupported transport %q", opts.Transport)
	}
	opts.Transport = transportName
	if transportName == "wifi" {
		return runWithDeps(ctx, opts, runtimeDeps{
			transport:         transportlayer.NewWiFiTransport(),
			transportName:     "wifi",
			usageBarsShowUsed: codexbar.UsageBarsShowUsed,
			startDashboard:    codexbar.StartDashboardServe,
			logf:              logf,
		})
	}

	defer usb.CloseDefaultSender()
	return runWithDeps(ctx, opts, runtimeDeps{
		deviceCaps:        usb.GetDeviceCapabilities,
		resolveUSBDevice:  usb.ResolveVibeTVPort,
		sendLine:          usb.SendLine,
		transportName:     "usb",
		usageBarsShowUsed: codexbar.UsageBarsShowUsed,
		startDashboard:    codexbar.StartDashboardServe,
		logf:              logf,
	})
}

func runWithDeps(ctx context.Context, opts Options, deps runtimeDeps) error {
	if opts.Interval <= 0 {
		opts.Interval = defaultIntervalForTransport(deps.transportName)
	}
	deps.beginDeviceWrite = opts.BeginDeviceWrite
	deps.interval = opts.Interval
	if opts.RecordEvent != nil {
		deps.record = opts.RecordEvent
	}
	if opts.ReportSystemBusy != nil {
		deps.reportSystemBusy = opts.ReportSystemBusy
	}
	if opts.CurrentSystemBusy != nil {
		deps.currentSystemBusy = opts.CurrentSystemBusy
	}
	syncCycleMode := deps.fetchProviders != nil && deps.fetchProvider == nil
	deps = deps.withDefaults()
	trackDeviceWriteWait(&deps)

	state := initializeRuntimeState(deps.now(), opts, deps)
	if opts.Dashboard != nil {
		deps.dashboard = opts.Dashboard
	} else if !opts.Once && deps.startDashboard != nil {
		// Standalone workers own their serve; the app runtime supplies one above.
		dashboardCtx, cancelDashboard := context.WithCancel(ctx)
		defer cancelDashboard()
		deps.dashboard = deps.startDashboard(dashboardCtx, deps.logf)
		if deps.dashboard != nil {
			info := deps.dashboard.Info()
			deps.logf("codexbar-dashboard event=supervisor-started refreshInterval=%s\n", info.RefreshInterval)
		}
	}
	var collectorWake <-chan struct{}
	var wakeAfterCollect func()
	if !syncCycleMode {
		collectorWakeCh := make(chan struct{}, 1)
		cycleWakeCh := make(chan struct{}, 1)
		if opts.Wake != nil {
			go forwardWake(ctx, opts.Wake, collectorWakeCh)
		}
		collectorWake = collectorWakeCh
		wakeAfterCollect = func() {
			signalWake(cycleWakeCh)
		}
		opts.Wake = cycleWakeCh
	}
	collector, collectorCancel := startProviderCollector(ctx, opts, deps, syncCycleMode, collectorWake, wakeAfterCollect)
	if collectorCancel != nil {
		defer collectorCancel()
	}
	if collector != nil {
		opts.DisableStartupFastPoll = true
	}

	runCycle := func(cycleCtx context.Context) error {
		requestedTarget := requestedDeviceTarget(opts)
		if collector != nil {
			return runCycleFromCollector(cycleCtx, requestedTarget, state, collector, deps)
		}
		return runCycleWithDeps(cycleCtx, requestedTarget, state, deps)
	}

	deps.recordEvent(timeline.Event{Component: "stream", State: "started", Reason: deps.transportName})
	err := runDaemonLoop(ctx, opts, deps, runCycle)
	stopped := timeline.Event{Component: "stream", State: "stopped"}
	if errors.Is(err, ErrConnectionModeChanged) {
		stopped.Reason = "connection-mode-changed"
	} else if err != nil && ctx.Err() == nil {
		stopped.Reason = string(asRuntimeError(err).ErrorCode())
	}
	deps.recordEvent(stopped)
	return err
}

func forwardWake(ctx context.Context, input <-chan struct{}, output chan<- struct{}) {
	for {
		select {
		case <-ctx.Done():
			return
		case _, ok := <-input:
			if !ok {
				return
			}
			signalWake(output)
		}
	}
}

func signalWake(output chan<- struct{}) {
	if output == nil {
		return
	}
	select {
	case output <- struct{}{}:
	default:
	}
}

func initializeRuntimeState(now time.Time, opts Options, deps runtimeDeps) *runtimeState {
	state := &runtimeState{
		selector:        deps.newSelector(),
		cliTheme:        opts.Theme,
		firmwareUpdates: opts.FirmwareUpdates,
	}
	bootstrapStateFromPersistedLastGood(state, now, deps)
	return state
}

func bootstrapStateFromPersistedLastGood(state *runtimeState, now time.Time, deps runtimeDeps) {
	if state == nil {
		return
	}

	if frame, savedAt, ok := loadPersistedLastGood(now); ok {
		state.lastGood = frame
		state.lastGoodAt = savedAt
		state.hasLastGood = true
		state.lastPersistedGood = frame
		state.lastPersistedAt = savedAt
		state.hasPersistedGood = true
	} else if frame, savedAt, ok := loadPersistedLastGoodAnyAge(); ok {
		state.lastGood = frame
		state.lastGoodAt = savedAt
		state.hasLastGood = true
		state.lastPersistedGood = frame
		state.lastPersistedAt = savedAt
		state.hasPersistedGood = true
		age := now.Sub(savedAt)
		if age < 0 {
			age = 0
		}
		deps.logf(
			"runtime event=last-good-bootstrap-stale saved_at=%s age=%s\n",
			savedAt.UTC().Format(time.RFC3339),
			age.Round(time.Second),
		)
	}

	if state.hasLastGood && state.selector != nil {
		state.selector.SetCurrentProvider(state.lastGood.Provider)
	}
}

func startProviderCollector(ctx context.Context, opts Options, deps runtimeDeps, syncCycleMode bool, wake <-chan struct{}, afterWakeCollect func()) (*providerCollector, context.CancelFunc) {
	if syncCycleMode {
		// Deterministic unit tests can run synchronous cycle fetches without a
		// background collector goroutine by injecting only fetchProviders.
		return nil, nil
	}

	collector := newProviderCollector(deps, opts)
	collector.wake = wake
	collector.afterWakeCollect = afterWakeCollect
	collector.afterFirstCollect = afterWakeCollect
	collectorCtx, cancel := context.WithCancel(ctx)
	collector.start(collectorCtx)
	deps.logf("collector started transport=%s interval=%s timeout=%s providers=%s mode=fetch-all\n",
		deps.transportName,
		collector.interval,
		collector.timeout,
		strings.Join(collector.order, ","),
	)
	return collector, cancel
}

// cableFirmwareTooOldRetryInterval is how long the loop leaves a Cable VibeTV
// alone whose firmware predates USB-C (issue #616). Each resolve opens its
// port, which restarts it, so the short retry restarted it every two seconds
// next to a setup about to update it. Setup connects the updated VibeTV by
// Cable, which wakes the loop at once.
const cableFirmwareTooOldRetryInterval = time.Minute

func runDaemonLoop(ctx context.Context, opts Options, deps runtimeDeps, runCycle func(context.Context) error) error {
	cycleTimeout := cycleRunTimeout()
	var lastCycleStart time.Time
	var startedAt time.Time
	var wifiQuietSince time.Time
	deviceWritesPaused := false

	for {
		// Joining WiFi must leave USB alone, including discovery: reopening the
		// serial port can reset the board before it finishes joining.
		waitingForWiFi := false
		if deps.transportName == "usb" {
			cfg, ok := loadRuntimeConfig(deps)
			if ok && cfg.WiFiTransitionPending() {
				now := deps.now()
				if started := time.Unix(cfg.WiFiTransitionStartedAt, 0); cfg.WiFiTransitionStartedAt > 0 && !started.After(now) &&
					(wifiQuietSince.IsZero() || started.After(wifiQuietSince)) {
					wifiQuietSince = started
				}
				if wifiQuietSince.IsZero() {
					wifiQuietSince = now
				}
				waitingForWiFi = now.Sub(wifiQuietSince) < wifiTransitionQuietPeriod
				if !waitingForWiFi {
					// One bounded probe lets persistActiveCableIdentity observe rollback.
					// If the device is still absent/joining, leave another full quiet window.
					wifiQuietSince = now
				}
			} else {
				wifiQuietSince = time.Time{}
			}
		}
		if waitingForWiFi || (opts.PauseDeviceWrites != nil && opts.PauseDeviceWrites()) {
			// Issue #832: the pause must not keep the old worker's cable port
			// open once the target has left Cable.
			if deps.transportName == "usb" && connectionModeChanged(deps) {
				return ErrConnectionModeChanged
			}
			if !deviceWritesPaused {
				deps.logf("runtime event=device-writes-paused reason=device-maintenance\n")
				deps.recordEvent(timeline.Event{Component: "stream", State: "paused", Reason: "device-maintenance"})
				deviceWritesPaused = true
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-opts.Wake:
			case <-opts.RenderWake:
			case <-deps.after(opts.Interval):
			}
			continue
		}
		if deviceWritesPaused {
			deps.logf("runtime event=device-writes-resumed reason=device-maintenance-complete\n")
			deps.recordEvent(timeline.Event{Component: "stream", State: "resumed"})
			deviceWritesPaused = false
			// Issue #536: the pause is not a sleep, so its length must not be
			// logged as a sleep-wake gap.
			lastCycleStart = time.Time{}
		}
		cycleStart := deps.now()
		if startedAt.IsZero() {
			startedAt = cycleStart
		}
		if detectSleepWakeGap(lastCycleStart, cycleStart, opts.Interval) {
			deps.logf("runtime event=sleep-wake gap=%s threshold=%s\n",
				cycleStart.Sub(lastCycleStart),
				sleepWakeGapThreshold(opts.Interval),
			)
		}
		lastCycleStart = cycleStart

		err := runCycleWithTimeout(ctx, cycleTimeout, runCycle)
		if deps.deviceWriteWaited != nil && deps.deviceWriteWaited.Swap(false) {
			// Issue #826: a cycle that was already running when a firmware
			// update took the device waits at the write gate until the update
			// ends. That wait is not a sleep either, so the next gap is
			// measured from the end of the cycle, not from its start.
			lastCycleStart = deps.now()
		}
		if opts.Once {
			return err
		}
		if errors.Is(err, ErrConnectionModeChanged) {
			return err
		}

		waitFor := opts.Interval
		if err != nil {
			runtimeErr := asRuntimeError(err)
			if ctx.Err() == nil {
				recordCycleFailure(deps, runtimeErr)
			}
			// A device-unreachable cycle must not wait a full WiFi interval
			// before the next attempt: after a device cold start or Mac wake
			// this turns into 30-90s of "reconnecting" although everything is
			// healthy again. While the device is down these quick probes are
			// cheap; the first successful cycle returns to the normal cadence.
			// Non-device errors (provider fetch, frame encoding, timeouts)
			// keep the normal interval - retrying those faster fixes nothing.
			if deviceUnreachableError(runtimeErr) && failureRetryInterval < waitFor {
				waitFor = failureRetryInterval
			}
			if errcode.Of(runtimeErr.Err) == errcode.TransportCableFirmwareTooOld {
				waitFor = cableFirmwareTooOldRetryInterval
			}
			if runtimeErr.Kind == runtimeErrorCycleTimeout {
				deps.logf("cycle timeout: code=%s op=%s retry=%s recovery=%q err=%v\n",
					runtimeErr.ErrorCode(),
					runtimeErr.Op,
					waitFor,
					runtimeErr.RecoveryAction(),
					err,
				)
			} else {
				deps.logf("cycle error: code=%s op=%s retry=%s cause=%s recovery=%q err=%v\n",
					runtimeErr.ErrorCode(),
					runtimeErr.Op,
					waitFor,
					errcode.Of(runtimeErr.Err),
					runtimeErr.RecoveryAction(),
					err,
				)
			}
		} else {
			uptime := cycleStart.Sub(startedAt)
			if !opts.DisableStartupFastPoll {
				waitFor = startupInterval(waitFor, uptime)
			}
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-opts.Wake:
		case <-opts.RenderWake:
		case <-deps.after(waitFor):
		}
	}
}

// recordCycleFailure attributes a failed cycle to the part that failed: the
// VibeTV when it did not answer or refused the pairing, otherwise the stream.
func recordCycleFailure(deps runtimeDeps, runtimeErr *RuntimeError) {
	if runtimeErr.Op == "fetch-usage" || runtimeErr.Op == "select-provider" {
		// The frame was sent; its usage entry already names this failure.
		return
	}
	event := timeline.Event{Component: "stream", State: "failed", Reason: string(runtimeErr.ErrorCode())}
	if deviceUnreachableError(runtimeErr) {
		event.Component, event.State = "device", "unreachable"
	} else if runtimeErr.Kind == runtimeErrorPairingRequired {
		event.Component, event.State = "device", "pairing_required"
	}
	deps.recordEvent(event)
}

func runCycleWithTimeout(parent context.Context, timeout time.Duration, runCycle func(context.Context) error) error {
	if timeout <= 0 {
		return runCycle(parent)
	}

	cycleCtx, cancel := context.WithCancel(parent)
	defer cancel()

	done := make(chan error, 1)
	go func() {
		done <- runCycle(cycleCtx)
	}()

	timer := time.NewTimer(timeout)
	defer timer.Stop()

	select {
	case err := <-done:
		return err
	case <-timer.C:
		cancel()
		return &RuntimeError{
			Kind: runtimeErrorCycleTimeout,
			Op:   "run-cycle-timeout",
			Err:  fmt.Errorf("cycle exceeded timeout %s", timeout),
			Hint: errcode.DefaultRecovery(errcode.RuntimeCycleTimeout),
		}
	case <-parent.Done():
		cancel()
		select {
		case err := <-done:
			return err
		default:
		}
		return parent.Err()
	}
}

func startupInterval(normal, uptime time.Duration) time.Duration {
	if normal <= 0 {
		normal = defaultInterval
	}
	if uptime < 0 || uptime >= startupFastPollWindow {
		return normal
	}
	if startupFastPollInterval < normal {
		return startupFastPollInterval
	}
	return normal
}

func detectSleepWakeGap(previous, current time.Time, interval time.Duration) bool {
	if previous.IsZero() || current.IsZero() {
		return false
	}
	if !current.After(previous) {
		return false
	}
	return current.Sub(previous) > sleepWakeGapThreshold(interval)
}

func sleepWakeGapThreshold(interval time.Duration) time.Duration {
	if interval <= 0 {
		interval = defaultInterval
	}
	threshold := interval + 30*time.Second
	if threshold < 45*time.Second {
		return 45 * time.Second
	}
	return threshold
}

func SleepWakeGapThreshold(interval time.Duration) time.Duration {
	return sleepWakeGapThreshold(interval)
}

// deviceWriteWaitThreshold is how long a cycle may wait at the device write
// gate before the wait counts as a pause (a firmware update holds the gate).
const deviceWriteWaitThreshold = time.Second

// trackDeviceWriteWait notes when a cycle had to wait at the device write gate,
// so the loop does not read that wait as a sleep (issue #826).
func trackDeviceWriteWait(deps *runtimeDeps) {
	if deps.beginDeviceWrite == nil {
		return
	}
	waited := &atomic.Bool{}
	deps.deviceWriteWaited = waited
	inner := deps.beginDeviceWrite
	now := deps.now
	if now == nil {
		now = wallClockNow
	}
	deps.beginDeviceWrite = func() func() {
		started := now()
		release := inner()
		if now().Sub(started) >= deviceWriteWaitThreshold {
			waited.Store(true)
		}
		return release
	}
}
