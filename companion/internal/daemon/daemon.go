package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	transportlayer "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/transport"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/versioning"
)

type Options struct {
	Port                   string
	Transport              string
	Target                 string
	Interval               time.Duration
	Once                   bool
	Theme                  string
	DisableStartupFastPoll bool
	Wake                   <-chan struct{}
}

const (
	defaultInterval            = 2 * time.Second
	defaultWiFiInterval        = 30 * time.Second
	defaultCycleTimeout        = 180 * time.Second
	startupFastPollWindow      = 2 * time.Minute
	startupFastPollInterval    = 30 * time.Second
	defaultWiFiTarget          = "http://vibetv.local"
	lastGoodPersistInterval    = 1 * time.Minute
	directProviderProbeMax     = 3
	themeEnvVar                = "CODEXBAR_DISPLAY_THEME"
	coldStartTimeoutEnvVar     = "CODEXBAR_DISPLAY_COLDSTART_TIMEOUT_SECS"
	cycleTimeoutEnvVar         = "CODEXBAR_DISPLAY_CYCLE_TIMEOUT_SECS"
	collectorIntervalEnvVar    = "CODEXBAR_DISPLAY_COLLECTOR_INTERVAL_SECS"
	activityPollEnvVar         = "CODEXBAR_DISPLAY_ACTIVITY_POLL_SECS"
	activityHoldEnvVar         = "CODEXBAR_DISPLAY_ACTIVITY_HOLD_SECS"
	activityIdleEvidenceEnvVar = "CODEXBAR_DISPLAY_ACTIVITY_IDLE_EVIDENCE"
	collectorTimeoutEnvVar     = "CODEXBAR_DISPLAY_FETCH_TIMEOUT_SECS"
	collectorOrderEnvVar       = "CODEXBAR_DISPLAY_PROVIDER_ORDER"
	providerMaxAgeEnvVar       = "CODEXBAR_DISPLAY_PROVIDER_LAST_GOOD_MAX_AGE"
	firmwareManifestEnvVar     = "CODEXBAR_DISPLAY_FIRMWARE_MANIFEST_URL"
	firmwareManifestURL        = "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/firmware-manifest.json"
	firmwareUpdateCheckGap     = 6 * time.Hour
	firmwareManifestTimeout    = 5 * time.Second
)

var errMarshalFrameTooLarge = errors.New("frame exceeds max bytes")

type runtimeErrorKind errcode.Code

const (
	runtimeErrorUnknown         runtimeErrorKind = runtimeErrorKind(errcode.Unknown)
	runtimeErrorSerialResolve   runtimeErrorKind = runtimeErrorKind(errcode.RuntimeSerialResolve)
	runtimeErrorSerialWrite     runtimeErrorKind = runtimeErrorKind(errcode.RuntimeSerialWrite)
	runtimeErrorCycleTimeout    runtimeErrorKind = runtimeErrorKind(errcode.RuntimeCycleTimeout)
	runtimeErrorFrameEncode     runtimeErrorKind = runtimeErrorKind(errcode.RuntimeFrameEncode)
	runtimeErrorFrameTooLarge   runtimeErrorKind = runtimeErrorKind(errcode.RuntimeFrameTooLarge)
	runtimeErrorCodexbarBinary  runtimeErrorKind = runtimeErrorKind(errcode.RuntimeCodexbarBinary)
	runtimeErrorCodexbarVersion runtimeErrorKind = runtimeErrorKind(errcode.RuntimeCodexbarVersion)
	runtimeErrorCodexbarCmd     runtimeErrorKind = runtimeErrorKind(errcode.RuntimeCodexbarCmd)
	runtimeErrorCodexbarParse   runtimeErrorKind = runtimeErrorKind(errcode.RuntimeCodexbarParse)
	runtimeErrorNoProviders     runtimeErrorKind = runtimeErrorKind(errcode.RuntimeNoProviders)
)

type RuntimeError struct {
	Kind runtimeErrorKind
	Op   string
	Err  error
	Hint string
}

func (e *RuntimeError) Error() string {
	if e == nil {
		return ""
	}
	if e.Op == "" {
		return fmt.Sprintf("%s: %v", e.ErrorCode(), e.Err)
	}
	return fmt.Sprintf("%s (%s): %v", e.ErrorCode(), e.Op, e.Err)
}

func (e *RuntimeError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

func (e *RuntimeError) ErrorCode() errcode.Code {
	if e == nil || e.Kind == "" {
		return errcode.Unknown
	}
	return errcode.Code(e.Kind)
}

func (e *RuntimeError) RecoveryAction() string {
	if e == nil {
		return ""
	}
	if strings.TrimSpace(e.Hint) != "" {
		return strings.TrimSpace(e.Hint)
	}
	return errcode.DefaultRecovery(e.ErrorCode())
}

type runtimeDeps struct {
	transport         transportlayer.DeviceTransport
	now               func() time.Time
	after             func(time.Duration) <-chan time.Time
	resolvePort       func(string) (string, error)
	deviceCaps        func(string) (protocol.DeviceCapabilities, error)
	fetchProviders    func(context.Context) ([]codexbar.ParsedFrame, error)
	fetchProvider     func(context.Context, string) (codexbar.ParsedFrame, error)
	fetchTokenStats   func(context.Context) (map[string]codexbar.ProviderTokenStats, bool)
	usageBarsShowUsed func() bool
	sendLine          func(string, []byte) error
	fetchUpdateState  func(context.Context, protocol.DeviceCapabilities) (protocol.UpdateState, error)
	newSelector       func() *codexbar.ProviderSelector
	logf              func(string, ...any)
	homeDir           func() (string, error)
	loadConfig        func(string) (runtimeconfig.Config, error)
	saveConfig        func(string, runtimeconfig.Config) error
	discoverWiFi      func([]string) (transportlayer.WiFiDiscoveryResult, error)
	pairDevice        func(context.Context, string) (string, error)
	transportName     string
}

func (d runtimeDeps) withDefaults() runtimeDeps {
	if d.transport == nil {
		d.transport = transportlayer.NewUSBTransport()
	}
	if d.transportName == "" {
		d.transportName = d.transport.Name()
	}
	if d.now == nil {
		d.now = wallClockNow
	}
	if d.after == nil {
		d.after = time.After
	}
	if d.resolvePort == nil {
		d.resolvePort = d.transport.ResolvePort
	}
	if d.deviceCaps == nil {
		d.deviceCaps = d.transport.DeviceCapabilities
	}
	if d.fetchProviders == nil {
		d.fetchProviders = codexbar.FetchAllProviders
	}
	if d.fetchProvider == nil {
		d.fetchProvider = codexbar.FetchProvider
	}
	if d.fetchTokenStats == nil {
		d.fetchTokenStats = codexbar.FetchProviderTokenStats
	}
	if d.usageBarsShowUsed == nil {
		d.usageBarsShowUsed = func() bool { return true }
	}
	if d.sendLine == nil {
		d.sendLine = d.transport.SendLine
	}
	if d.fetchUpdateState == nil {
		d.fetchUpdateState = fetchFirmwareUpdateState
	}
	if d.newSelector == nil {
		d.newSelector = codexbar.NewProviderSelector
	}
	if d.logf == nil {
		d.logf = defaultRuntimeLogf
	}
	if d.homeDir == nil {
		d.homeDir = os.UserHomeDir
	}
	if d.loadConfig == nil {
		d.loadConfig = runtimeconfig.Load
	}
	if d.saveConfig == nil {
		d.saveConfig = runtimeconfig.Save
	}
	if d.discoverWiFi == nil {
		d.discoverWiFi = func(candidates []string) (transportlayer.WiFiDiscoveryResult, error) {
			return transportlayer.DiscoverWiFiDevice(context.Background(), transportlayer.WiFiDiscoveryOptions{
				Candidates:         candidates,
				IncludeNetworkScan: true,
			})
		}
	}
	if d.pairDevice == nil {
		d.pairDevice = pairWiFiDevice
	}
	return d
}

func defaultRuntimeLogf(format string, args ...any) {
	message := fmt.Sprintf(format, args...)
	message = strings.TrimRight(message, "\n")
	timestamp := time.Now().UTC().Format(time.RFC3339)
	_, _ = fmt.Printf("%s %s\n", timestamp, message)
}

type runtimeState struct {
	selector               *codexbar.ProviderSelector
	lastGood               protocol.Frame
	lastGoodAt             time.Time
	hasLastGood            bool
	lastPersistedGood      protocol.Frame
	lastPersistedAt        time.Time
	hasPersistedGood       bool
	lastPersistedDisplay   protocol.Frame
	lastDisplayPersistedAt time.Time
	hasPersistedDisplay    bool
	cliTheme               string
	firmwareUpdate         protocol.UpdateState
	hasFirmwareUpdate      bool
	updateCheckedAt        time.Time
	updateCheckedBoard     string
	updateCheckedFirmware  string
	lastActivityAt         time.Time
	lastActivityObservedAt time.Time
	lastIdleEvidenceAt     time.Time
	idleEvidenceCount      int
	lastCodingAt           time.Time
	lastActivity           string
	lastActivityCause      string
	deviceTarget           string
}

type cycleResult struct {
	frame           protocol.Frame
	selectionReason string
	selectionDetail string
	failureKind     runtimeErrorKind
	failureOp       string
	failureErr      error
	usedLastGood    bool
	errorSource     string
	usageSource     string
	usageFresh      bool
	activityDetail  string
}

type persistedLastGood struct {
	SavedAt time.Time      `json:"savedAt"`
	Frame   protocol.Frame `json:"frame"`
}

type persistedDisplayFrame struct {
	SavedAt time.Time      `json:"savedAt"`
	Frame   protocol.Frame `json:"frame"`
}

type PersistedUsage struct {
	SavedAt         time.Time
	CurrentProvider string
	Providers       []ProviderUsageSnapshot
}

type ProviderUsageSnapshot struct {
	Provider           string
	Frame              protocol.Frame
	Source             string
	Meta               codexbar.ProviderUsageMeta
	CollectedAt        time.Time
	ActivityObservedAt time.Time
	Stale              bool
}

func Run(ctx context.Context, opts Options) error {
	transportName := normalizeTransportName(opts.Transport)
	if transportName == "" {
		transportName = "usb"
	}
	if transportName != "usb" && transportName != "wifi" {
		return fmt.Errorf("unsupported transport %q", opts.Transport)
	}
	if transportName == "wifi" {
		return runWithDeps(ctx, opts, runtimeDeps{
			transport:         transportlayer.NewWiFiTransport(),
			transportName:     "wifi",
			usageBarsShowUsed: codexbar.UsageBarsShowUsed,
		})
	}

	sender := usb.NewSender()
	defer sender.Close()
	return runWithDeps(ctx, opts, runtimeDeps{
		deviceCaps:        sender.DeviceCapabilities,
		sendLine:          sender.Send,
		transportName:     "usb",
		usageBarsShowUsed: codexbar.UsageBarsShowUsed,
	})
}

func runWithDeps(ctx context.Context, opts Options, deps runtimeDeps) error {
	if opts.Interval <= 0 {
		opts.Interval = defaultIntervalForTransport(deps.transportName)
	}
	syncCycleMode := deps.fetchProviders != nil && deps.fetchProvider == nil
	deps = deps.withDefaults()

	state := initializeRuntimeState(deps.now(), opts, deps)
	collector, collectorCancel := startProviderCollector(ctx, opts, deps, syncCycleMode)
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

	return runDaemonLoop(ctx, opts, deps, runCycle)
}

func initializeRuntimeState(now time.Time, opts Options, deps runtimeDeps) *runtimeState {
	state := &runtimeState{
		selector: deps.newSelector(),
		cliTheme: opts.Theme,
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

func startProviderCollector(ctx context.Context, opts Options, deps runtimeDeps, syncCycleMode bool) (*providerCollector, context.CancelFunc) {
	if syncCycleMode {
		// Deterministic unit tests can run synchronous cycle fetches without a
		// background collector goroutine by injecting only fetchProviders.
		return nil, nil
	}

	collector := newProviderCollector(deps, opts)
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

func runDaemonLoop(ctx context.Context, opts Options, deps runtimeDeps, runCycle func(context.Context) error) error {
	backoff := newRetryBackoff(opts.Interval)
	cycleTimeout := cycleRunTimeout()
	var lastCycleStart time.Time
	var startedAt time.Time

	for {
		cycleStart := deps.now()
		if startedAt.IsZero() {
			startedAt = cycleStart
		}
		if detectSleepWakeGap(lastCycleStart, cycleStart, opts.Interval) {
			deps.logf("runtime event=sleep-wake gap=%s threshold=%s action=reset-retry\n",
				cycleStart.Sub(lastCycleStart),
				sleepWakeGapThreshold(opts.Interval),
			)
			backoff.Reset()
		}
		lastCycleStart = cycleStart

		err := runCycleWithTimeout(ctx, cycleTimeout, runCycle)
		if opts.Once {
			return err
		}

		waitFor := opts.Interval
		if err != nil {
			runtimeErr := asRuntimeError(err)
			if runtimeErr.Kind == runtimeErrorCycleTimeout {
				deps.logf("fatal cycle timeout: code=%s op=%s timeout=%s action=exit-for-launchd-restart\n",
					runtimeErr.ErrorCode(),
					runtimeErr.Op,
					cycleTimeout,
				)
				return runtimeErr
			}
			waitFor = backoff.Next()
			deps.logf("cycle error: code=%s op=%s retry=%s recovery=%q err=%v\n",
				runtimeErr.ErrorCode(),
				runtimeErr.Op,
				waitFor,
				runtimeErr.RecoveryAction(),
				err,
			)
		} else {
			backoff.Reset()
			uptime := cycleStart.Sub(startedAt)
			if !opts.DisableStartupFastPoll {
				waitFor = startupInterval(waitFor, uptime)
			}
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-opts.Wake:
		case <-deps.after(waitFor):
		}
	}
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

func defaultIntervalForTransport(transportName string) time.Duration {
	if strings.EqualFold(strings.TrimSpace(transportName), "wifi") {
		return defaultWiFiInterval
	}
	return defaultInterval
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

func configuredTheme(cliTheme string) string {
	if theme := runtimeconfig.NormalizeTheme(cliTheme); theme != "" {
		return theme
	}
	if theme := runtimeconfig.NormalizeTheme(os.Getenv(themeEnvVar)); theme != "" {
		return theme
	}

	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	cfg, err := runtimeconfig.Load(home)
	if err != nil {
		return ""
	}
	return runtimeconfig.NormalizeTheme(cfg.Theme)
}

func normalizeTransportName(raw string) string {
	return strings.TrimSpace(strings.ToLower(raw))
}

func requestedDeviceTarget(opts Options) string {
	if normalizeTransportName(opts.Transport) == "wifi" {
		if target := strings.TrimSpace(opts.Target); target != "" {
			return target
		}
		return strings.TrimSpace(opts.Port)
	}
	return strings.TrimSpace(opts.Port)
}

func effectiveCycleTarget(requestedTarget string, state *runtimeState, deps runtimeDeps) string {
	requestedTarget = strings.TrimSpace(requestedTarget)
	if deps.transportName != "wifi" {
		return requestedTarget
	}
	if cfg, ok := loadRuntimeConfig(deps); ok && strings.TrimSpace(cfg.DeviceTarget) != "" {
		return strings.TrimSpace(cfg.DeviceTarget)
	}
	if state != nil && strings.TrimSpace(state.deviceTarget) != "" {
		return strings.TrimSpace(state.deviceTarget)
	}
	return requestedTarget
}

func ensureCycleState(state *runtimeState, deps runtimeDeps) *runtimeState {
	if state == nil {
		state = &runtimeState{}
	}
	if state.selector == nil {
		state.selector = deps.newSelector()
	}
	return state
}

func resolveCycleDevice(requestedPort string, state *runtimeState, deps runtimeDeps) (string, protocol.DeviceCapabilities, int, error) {
	requestedPort = effectiveCycleTarget(requestedPort, state, deps)
	port, err := resolvePortWithFallback(requestedPort, deps)
	if err != nil {
		hint := errcode.DefaultRecovery(errcode.RuntimeSerialResolve)
		if deps.transportName == "wifi" {
			hint = "Verify the Mac can open http://vibetv.local. If not, rerun setup with --target http://<device-ip>."
		}
		return "", protocol.DeviceCapabilities{}, 0, &RuntimeError{
			Kind: runtimeErrorSerialResolve,
			Op:   "resolve-target",
			Err:  fmt.Errorf("detect display target: %w", err),
			Hint: hint,
		}
	}

	caps, capsErr := deps.deviceCaps(port)
	if capsErr != nil {
		if recoveredPort, recoveredCaps, recovered := recoverStaleWiFiTarget(port, capsErr, deps); recovered {
			rememberRecoveredWiFiTarget(recoveredPort, state, deps)
			return recoveredPort, recoveredCaps, maxFrameBytesForCaps(recoveredCaps), nil
		}
		deps.logf("runtime event=device-caps-read-failed target=%s transport=%s err=%v\n", port, deps.transportName, capsErr)
		caps = protocol.UnknownDeviceCapabilities()
	} else if !caps.Known {
		unknownErr := errors.New("device capabilities unknown")
		if recoveredPort, recoveredCaps, recovered := recoverStaleWiFiTarget(port, unknownErr, deps); recovered {
			rememberRecoveredWiFiTarget(recoveredPort, state, deps)
			return recoveredPort, recoveredCaps, maxFrameBytesForCaps(recoveredCaps), nil
		}
	}

	rememberActiveWiFiTarget(port, caps, state)
	return port, caps, maxFrameBytesForCaps(caps), nil
}

func rememberActiveWiFiTarget(target string, caps protocol.DeviceCapabilities, state *runtimeState) {
	if state == nil || strings.TrimSpace(target) == "" || !caps.Known {
		return
	}
	state.deviceTarget = strings.TrimSpace(target)
}

func rememberRecoveredWiFiTarget(target string, state *runtimeState, deps runtimeDeps) {
	target = strings.TrimSpace(target)
	if target == "" {
		return
	}
	if state != nil {
		state.deviceTarget = target
	}
	cfg, ok := loadRuntimeConfig(deps)
	if !ok {
		return
	}
	if isSameTarget(cfg.DeviceTarget, target) {
		return
	}
	cfg.DeviceTarget = target
	if err := saveRuntimeConfig(cfg, deps); err != nil {
		deps.logf("runtime event=wifi-target-persist-failed target=%s err=%v\n", target, err)
		return
	}
	deps.logf("runtime event=wifi-target-persisted target=%s\n", target)
}

func loadRuntimeConfig(deps runtimeDeps) (runtimeconfig.Config, bool) {
	home, err := deps.homeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return runtimeconfig.Config{}, false
	}
	cfg, err := deps.loadConfig(home)
	if err != nil {
		return runtimeconfig.Config{}, false
	}
	return cfg, true
}

func saveRuntimeConfig(cfg runtimeconfig.Config, deps runtimeDeps) error {
	home, err := deps.homeDir()
	if err != nil {
		return err
	}
	return deps.saveConfig(home, cfg)
}

func persistRuntimeDeviceToken(target, token string, deps runtimeDeps) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return errors.New("device token is empty")
	}
	cfg, ok := loadRuntimeConfig(deps)
	if !ok {
		cfg = runtimeconfig.Config{}
	}
	cfg.DeviceTarget = publicDeviceTarget(target)
	cfg.DeviceToken = token
	return saveRuntimeConfig(cfg, deps)
}

func pairWiFiDevice(ctx context.Context, target string) (string, error) {
	target = publicDeviceTarget(target)
	parsed, ok := parseDeviceTarget(target)
	if !ok {
		return "", fmt.Errorf("invalid device target %q", target)
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/") + "/api/pair"
	form := url.Values{}
	form.Set("api", "1")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, parsed.String(), strings.NewReader(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("build pair request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Close = true
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("post pair: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return "", fmt.Errorf("post pair: status=%d body=%q", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var payload struct {
		OK    bool   `json:"ok"`
		Token string `json:"token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return "", fmt.Errorf("decode pair response: %w", err)
	}
	token := strings.TrimSpace(payload.Token)
	if !payload.OK || token == "" {
		return "", errors.New("pair response did not include token")
	}
	return token, nil
}

func recoverStaleWiFiTarget(stalePort string, staleErr error, deps runtimeDeps) (string, protocol.DeviceCapabilities, bool) {
	if deps.transportName != "wifi" {
		return "", protocol.DeviceCapabilities{}, false
	}
	candidates := []string{stalePort}
	if isDefaultWiFiTarget(stalePort) {
		candidates = append(candidates, defaultWiFiTarget)
	}
	result, discoverErr := deps.discoverWiFi(candidates)
	if discoverErr != nil {
		return "", protocol.DeviceCapabilities{}, false
	}
	caps := protocol.CapabilitiesFromHello(result.Hello)
	if !caps.Known {
		return "", protocol.DeviceCapabilities{}, false
	}
	deps.logf(
		"runtime event=wifi-target-discovered from=%s to=%s source=%s staleErr=%v\n",
		stalePort,
		result.Target,
		result.Source,
		staleErr,
	)
	return result.Target, caps, true
}

func isDefaultWiFiTarget(target string) bool {
	return strings.Contains(strings.ToLower(strings.TrimSpace(target)), "vibetv.local")
}

func isSameTarget(left, right string) bool {
	return strings.EqualFold(strings.TrimRight(strings.TrimSpace(left), "/"), strings.TrimRight(strings.TrimSpace(right), "/"))
}

func maxFrameBytesForCaps(caps protocol.DeviceCapabilities) int {
	if caps.MaxFrameBytes > 0 {
		return caps.MaxFrameBytes
	}
	return protocol.DefaultMaxFrameBytes
}

func attachFirmwareUpdateState(ctx context.Context, state *runtimeState, deps runtimeDeps, caps protocol.DeviceCapabilities, result *cycleResult) {
	if result == nil || strings.TrimSpace(caps.Board) == "" || strings.TrimSpace(caps.Firmware) == "" {
		return
	}

	now := deps.now()
	board := strings.TrimSpace(strings.ToLower(caps.Board))
	firmware := strings.TrimSpace(caps.Firmware)
	if state.hasFirmwareUpdate &&
		state.updateCheckedBoard == board &&
		state.updateCheckedFirmware == firmware &&
		now.Sub(state.updateCheckedAt) >= 0 &&
		now.Sub(state.updateCheckedAt) < firmwareUpdateCheckGap {
		update := state.firmwareUpdate
		result.frame.Update = &update
		return
	}

	update, err := deps.fetchUpdateState(ctx, caps)
	if err != nil {
		update = protocol.UpdateState{
			Available: false,
			Status:    "check_failed",
			LastError: truncateUpdateError(err.Error()),
		}
	}
	state.firmwareUpdate = update
	state.hasFirmwareUpdate = true
	state.updateCheckedAt = now
	state.updateCheckedBoard = board
	state.updateCheckedFirmware = firmware
	result.frame.Update = &update
}

func truncateUpdateError(raw string) string {
	const maxLen = 160
	value := strings.TrimSpace(raw)
	if len(value) <= maxLen {
		return value
	}
	return strings.TrimSpace(value[:maxLen]) + "..."
}

type firmwareManifest struct {
	Artifacts []firmwareArtifact `json:"artifacts"`
}

type firmwareArtifact struct {
	Board           string `json:"board"`
	FirmwareVersion string `json:"firmwareVersion"`
	Severity        string `json:"severity"`
	Message         string `json:"message"`
	FirmwareURL     string `json:"firmwareUrl"`
	FilesystemURL   string `json:"filesystemUrl"`
	SHA256          string `json:"sha256"`
}

func fetchFirmwareUpdateState(ctx context.Context, caps protocol.DeviceCapabilities) (protocol.UpdateState, error) {
	manifestURL := strings.TrimSpace(os.Getenv(firmwareManifestEnvVar))
	if manifestURL == "" {
		manifestURL = firmwareManifestURL
	}
	if manifestURL == "-" || strings.EqualFold(manifestURL, "off") || strings.EqualFold(manifestURL, "disabled") {
		return protocol.UpdateState{Available: false, Status: "disabled"}, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, manifestURL, nil)
	if err != nil {
		return protocol.UpdateState{}, fmt.Errorf("build firmware manifest request: %w", err)
	}
	client := http.Client{Timeout: firmwareManifestTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return protocol.UpdateState{}, fmt.Errorf("fetch firmware manifest: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
		return protocol.UpdateState{}, fmt.Errorf("fetch firmware manifest: status=%d body=%q", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var manifest firmwareManifest
	if err := json.NewDecoder(io.LimitReader(resp.Body, 128*1024)).Decode(&manifest); err != nil {
		return protocol.UpdateState{}, fmt.Errorf("decode firmware manifest: %w", err)
	}
	return selectFirmwareUpdate(caps, manifest)
}

func selectFirmwareUpdate(caps protocol.DeviceCapabilities, manifest firmwareManifest) (protocol.UpdateState, error) {
	current, err := versioning.ParseSemVer(caps.Firmware)
	if err != nil {
		return protocol.UpdateState{}, fmt.Errorf("parse current firmware version %q: %w", caps.Firmware, err)
	}

	board := strings.TrimSpace(strings.ToLower(caps.Board))
	var latest *versioning.SemVer
	var latestRaw string
	var latestArtifact firmwareArtifact
	for _, artifact := range manifest.Artifacts {
		if strings.TrimSpace(strings.ToLower(artifact.Board)) != board {
			continue
		}
		artifactVersion, err := versioning.ParseSemVer(artifact.FirmwareVersion)
		if err != nil {
			continue
		}
		if latest == nil || artifactVersion.Compare(*latest) > 0 {
			candidate := artifactVersion
			latest = &candidate
			latestRaw = strings.TrimSpace(artifact.FirmwareVersion)
			latestArtifact = artifact
		}
	}
	if latest == nil {
		return protocol.UpdateState{Available: false, Status: "no_board_release"}, nil
	}
	update := protocol.UpdateState{
		Available:     firmwareReleaseNewerThanCurrent(*latest, current),
		LatestVersion: latestRaw,
		Severity:      latestArtifact.Severity,
		Message:       latestArtifact.Message,
		FirmwareURL:   latestArtifact.FirmwareURL,
		FilesystemURL: latestArtifact.FilesystemURL,
		SHA256:        latestArtifact.SHA256,
	}
	if !update.Available {
		update.Status = "current"
		return update, nil
	}
	update.Status = "update_available"
	return update, nil
}

func firmwareReleaseNewerThanCurrent(latest, current versioning.SemVer) bool {
	if latest.Major != current.Major {
		return latest.Major > current.Major
	}
	if latest.Minor != current.Minor {
		return latest.Minor > current.Minor
	}
	if latest.Patch != current.Patch {
		return latest.Patch > current.Patch
	}
	return false
}

func selectCycleFrameFromProviders(state *runtimeState, allProviders []codexbar.ParsedFrame, now time.Time, deps runtimeDeps, emptyProvidersOp, emptyReason, emptyDetail, errorSource string) cycleResult {
	result := cycleResult{
		selectionReason: emptyReason,
		selectionDetail: emptyDetail,
		errorSource:     errorSource,
	}

	if len(allProviders) == 0 {
		result.failureKind = runtimeErrorNoProviders
		result.failureOp = emptyProvidersOp
		result.failureErr = codexbar.ErrNoProviders
		return finalizeCycleResult(state, result)
	}

	decision, ok := state.selector.SelectWithDecision(allProviders)
	if !ok {
		result.failureKind = runtimeErrorNoProviders
		result.failureOp = "select-provider"
		result.failureErr = codexbar.ErrNoProviders
		return finalizeCycleResult(state, result)
	}

	result.frame = decision.Selected.Frame
	result.selectionReason = string(decision.Reason)
	result.selectionDetail = decision.Detail
	result.usageSource = usageSourceOrDefault(decision.Selected.Source, "codexbar")
	result.usageFresh = !decision.Selected.Stale
	collectedAt := decision.Selected.CollectedAt
	if collectedAt.IsZero() {
		collectedAt = now
		decision.Selected.CollectedAt = collectedAt
	}
	updateLastGoodState(state, result.frame, collectedAt, deps)
	result.frame, result.activityDetail = applySelectionActivity(result.frame, decision, state, now)
	return result
}

func finalizeCycleResult(state *runtimeState, result cycleResult) cycleResult {
	if result.failureErr == nil {
		return result
	}

	if state != nil && state.hasLastGood {
		result.frame = state.lastGood
		result.usedLastGood = true
		result.selectionReason = "stale-last-good"
		result.selectionDetail = fmt.Sprintf("kind=%s", result.failureKind)
		result.usageSource = "last-good"
		result.usageFresh = false
		return result
	}

	if result.failureKind == "" {
		result.failureKind = runtimeErrorUnknown
	}
	source := strings.TrimSpace(result.errorSource)
	if source == "" {
		source = "codexbar"
	}
	result.frame = protocol.ErrorFrame(runtimeErrorFrameCode(result.failureKind))
	result.selectionReason = "error-frame"
	result.selectionDetail = fmt.Sprintf("kind=%s source=%s", result.failureKind, source)
	result.usageSource = source
	result.usageFresh = false
	return result
}

func applySelectionActivity(frame protocol.Frame, decision codexbar.SelectionDecision, state *runtimeState, now time.Time) (protocol.Frame, string) {
	if strings.TrimSpace(frame.Activity) != "" {
		return frame, fmt.Sprintf("activity=explicit value=%s", frame.Activity)
	}
	if now.IsZero() {
		now = time.Now()
	}
	if state == nil {
		state = &runtimeState{}
	}

	collectedAt := decision.Selected.CollectedAt
	if collectedAt.IsZero() {
		collectedAt = now
	}
	activityObservedAt := decision.Selected.ActivityObservedAt
	if activityObservedAt.IsZero() {
		activityObservedAt = collectedAt
	}
	if decision.ActivitySignalReason != codexbar.SelectionReasonUsageDelta &&
		!activityObservedAt.IsZero() &&
		activityObservedAt.Equal(state.lastActivityObservedAt) &&
		state.lastActivity != "" {
		state.lastActivityAt = collectedAt
		frame.Activity = state.lastActivity
		return frame, fmt.Sprintf("activity=%s reason=unchanged-codexbar-activity detail=%s observedAt=%s", frame.Activity, state.lastActivityCause, activityObservedAt.Format(time.RFC3339))
	}
	if !collectedAt.IsZero() && collectedAt.Equal(state.lastActivityAt) && state.lastActivity != "" {
		frame.Activity = state.lastActivity
		return frame, fmt.Sprintf("activity=%s reason=unchanged-usage-frame detail=%s", frame.Activity, state.lastActivityCause)
	}

	activity := "idle"
	signalDetail := strings.TrimSpace(decision.ActivityDetail)
	signalReason := decision.ActivitySignalReason
	switch signalReason {
	case codexbar.SelectionReasonUsageDelta:
		activity = "coding"
		state.lastCodingAt = now
		state.lastIdleEvidenceAt = time.Time{}
		state.idleEvidenceCount = 0
	default:
		if state.lastActivity == "coding" {
			if !activityObservedAt.IsZero() && activityObservedAt.After(state.lastActivityObservedAt) && !activityObservedAt.Equal(state.lastIdleEvidenceAt) {
				state.lastIdleEvidenceAt = activityObservedAt
				state.idleEvidenceCount++
			}
			if codingHoldActive(state.lastCodingAt, now) || state.idleEvidenceCount < activityIdleEvidenceRequired() {
				activity = "coding"
				signalReason = "coding-waiting-for-idle-evidence"
				signalDetail = fmt.Sprintf("last_delta_age=%s hold=%s idle_evidence=%d/%d observedAt=%s", now.Sub(state.lastCodingAt).Round(time.Second), activityHoldDuration(), state.idleEvidenceCount, activityIdleEvidenceRequired(), activityObservedAt.Format(time.RFC3339))
			} else {
				state.lastIdleEvidenceAt = time.Time{}
				state.idleEvidenceCount = 0
			}
		}
	}

	if signalDetail == "" {
		signalDetail = string(signalReason)
	}
	if signalDetail == "" {
		signalDetail = "no-usage-delta"
	}
	reason := string(signalReason)
	if reason == "" {
		reason = "no-usage-delta"
	}

	state.lastActivityAt = collectedAt
	state.lastActivityObservedAt = activityObservedAt
	state.lastActivity = activity
	state.lastActivityCause = signalDetail
	frame.Activity = activity
	return frame, fmt.Sprintf("activity=%s reason=%s detail=%s", activity, reason, signalDetail)
}

func codingHoldActive(lastCodingAt time.Time, now time.Time) bool {
	if lastCodingAt.IsZero() {
		return false
	}
	if now.Before(lastCodingAt) {
		return true
	}
	return now.Sub(lastCodingAt) <= activityHoldDuration()
}

func sendCycleResult(ctx context.Context, port string, caps protocol.DeviceCapabilities, maxFrameBytes int, state *runtimeState, deps runtimeDeps, result cycleResult) error {
	publicPort := publicDeviceTarget(port)
	frame := applyUsageBarsPreference(result.frame, deps.usageBarsShowUsed())
	frame.V = protocol.NormalizeProtocolVersion(caps.NegotiatedProtocolVersion)
	sentAt := deps.now()
	frame = attachClockFields(frame, sentAt)

	if selectedTheme := configuredTheme(state.cliTheme); selectedTheme != "" {
		var applied bool
		frame, applied = applyThemeToFrame(frame, selectedTheme, caps)
		if !applied {
			deps.logf("runtime event=theme-skipped port=%s board=%s requested=%s reason=unsupported\n", publicPort, caps.Board, selectedTheme)
		}
	}

	line, marshaledFrame, err := marshalFrameWithinLimit(frame, maxFrameBytes)
	if err != nil {
		kind := runtimeErrorFrameEncode
		if errors.Is(err, errMarshalFrameTooLarge) {
			kind = runtimeErrorFrameTooLarge
		}
		return &RuntimeError{
			Kind: kind,
			Op:   "marshal-frame-with-limit",
			Err:  fmt.Errorf("encode frame: %w", err),
		}
	}
	frame = marshaledFrame

	sendTarget := sendTargetWithRuntimeAuth(port, deps)
	if err := deps.sendLine(sendTarget, line); err != nil {
		if repairedTarget, repaired := repairWiFiAuthAndRetry(ctx, port, line, deps, err); repaired {
			sendTarget = repairedTarget
		} else {
			return &RuntimeError{
				Kind: runtimeErrorSerialWrite,
				Op:   "send-line",
				Err:  err,
				Hint: errcode.DefaultRecovery(errcode.RuntimeSerialWrite),
			}
		}
	}

	if sendTarget == "" {
		return &RuntimeError{
			Kind: runtimeErrorSerialWrite,
			Op:   "send-line",
			Err:  errors.New("send target empty after auth repair"),
			Hint: errcode.DefaultRecovery(errcode.RuntimeSerialWrite),
		}
	}

	updateDisplayFrameState(state, frame, sentAt, deps)

	deps.logf("sent frame -> %s transport=%s source=%s fresh=%t usageMode=%s provider=%s label=%s session=%d weekly=%d reset=%ds activity=%q time=%q date=%q error=%q reason=%s detail=%q activityDetail=%q\n",
		publicPort, deps.transportName, usageSourceOrDefault(result.usageSource, "unknown"), result.usageFresh, frame.UsageMode, frame.Provider, frame.Label, frame.Session, frame.Weekly, frame.ResetSec, frame.Activity, frame.Time, frame.Date, frame.Error, result.selectionReason, result.selectionDetail, result.activityDetail)

	if result.failureErr != nil {
		if result.usedLastGood {
			deps.logf("warning: usage data unavailable kind=%s op=%s, sent stale frame: %v\n",
				result.failureKind,
				result.failureOp,
				result.failureErr,
			)
			return nil
		}
		return usageDataRuntimeError(result.failureKind, result.failureOp, result.failureErr)
	}

	return nil
}

func repairWiFiAuthAndRetry(ctx context.Context, target string, line []byte, deps runtimeDeps, sendErr error) (string, bool) {
	if deps.transportName != "wifi" || !deviceAuthFailed(sendErr) {
		return "", false
	}
	publicTarget := publicDeviceTarget(target)
	token, err := deps.pairDevice(ctx, publicTarget)
	if err != nil {
		deps.logf("runtime event=device-token-repair-failed target=%s err=%v\n", publicTarget, err)
		return "", false
	}
	if err := persistRuntimeDeviceToken(publicTarget, token, deps); err != nil {
		deps.logf("runtime event=device-token-persist-failed target=%s err=%v\n", publicTarget, err)
		return "", false
	}
	repairedTarget := targetWithDeviceToken(publicTarget, token)
	if err := deps.sendLine(repairedTarget, line); err != nil {
		deps.logf("runtime event=device-token-retry-failed target=%s err=%v\n", publicTarget, err)
		return "", false
	}
	deps.logf("runtime event=device-token-repaired target=%s\n", publicTarget)
	return repairedTarget, true
}

func deviceAuthFailed(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "status=401") ||
		strings.Contains(msg, "pairing token required") ||
		strings.Contains(msg, "unauthorized")
}

func sendTargetWithRuntimeAuth(target string, deps runtimeDeps) string {
	if deps.transportName != "wifi" {
		return target
	}
	cfg, ok := loadRuntimeConfig(deps)
	if !ok {
		return target
	}
	return targetWithDeviceToken(target, cfg.DeviceToken)
}

func targetWithDeviceToken(target, token string) string {
	token = strings.TrimSpace(token)
	if token == "" {
		return target
	}
	parsed, ok := parseDeviceTarget(target)
	if !ok {
		return target
	}
	query := parsed.Query()
	query.Set("token", token)
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func publicDeviceTarget(target string) string {
	parsed, ok := parseDeviceTarget(target)
	if !ok {
		return target
	}
	query := parsed.Query()
	if _, hasToken := query["token"]; !hasToken {
		return target
	}
	query.Del("token")
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func parseDeviceTarget(target string) (*url.URL, bool) {
	target = strings.TrimSpace(target)
	if target == "" || !strings.Contains(target, "://") {
		return nil, false
	}
	parsed, err := url.Parse(target)
	if err != nil || strings.TrimSpace(parsed.Scheme) == "" || strings.TrimSpace(parsed.Host) == "" {
		return nil, false
	}
	return parsed, true
}

func attachClockFields(frame protocol.Frame, now time.Time) protocol.Frame {
	if now.IsZero() {
		now = time.Now()
	}
	frame.Time = now.Format("15:04")
	frame.Date = now.Format("02.01.2006")
	return frame
}

func runCycleWithDeps(ctx context.Context, requestedPort string, state *runtimeState, deps runtimeDeps) error {
	deps = deps.withDefaults()
	state = ensureCycleState(state, deps)

	port, caps, maxFrameBytes, err := resolveCycleDevice(requestedPort, state, deps)
	if err != nil {
		return err
	}

	fetchCtx := ctx
	if !state.hasLastGood {
		timeout := coldStartFetchTimeout()
		if timeout > 0 {
			var cancel context.CancelFunc
			fetchCtx, cancel = context.WithTimeout(ctx, timeout)
			defer cancel()
		}
	}

	allProviders, fetchErr := deps.fetchProviders(fetchCtx)
	result := cycleResult{
		selectionReason: "fetch-error",
		errorSource:     "codexbar",
	}
	if fetchErr != nil {
		result.failureKind = runtimeErrorKindFromFetchErr(fetchErr)
		result.failureOp = "fetch-usage"
		result.failureErr = fetchErr
		result = finalizeCycleResult(state, result)
	} else {
		result = selectCycleFrameFromProviders(
			state,
			allProviders,
			deps.now(),
			deps,
			"select-provider",
			"fetch-error",
			"",
			"codexbar",
		)
	}

	attachFirmwareUpdateState(ctx, state, deps, caps, &result)
	return sendCycleResult(ctx, port, caps, maxFrameBytes, state, deps, result)
}

func runCycleFromCollector(ctx context.Context, requestedPort string, state *runtimeState, collector *providerCollector, deps runtimeDeps) error {
	deps = deps.withDefaults()
	state = ensureCycleState(state, deps)

	port, caps, maxFrameBytes, err := resolveCycleDevice(requestedPort, state, deps)
	if err != nil {
		return err
	}

	now := deps.now()
	allProviders := collector.providerFrames(now)
	if len(allProviders) == 0 {
		allProviders = probeProvidersDirectly(ctx, collector.order, deps)
	}
	result := selectCycleFrameFromProviders(
		state,
		allProviders,
		now,
		deps,
		"select-provider",
		"collector-empty",
		fmt.Sprintf("snapshot_max_age=%s", collector.snapshotMaxAge),
		"collector",
	)

	attachFirmwareUpdateState(ctx, state, deps, caps, &result)
	return sendCycleResult(ctx, port, caps, maxFrameBytes, state, deps, result)
}

func probeProvidersDirectly(parent context.Context, order []string, deps runtimeDeps) []codexbar.ParsedFrame {
	if deps.fetchProvider == nil {
		return nil
	}

	ctx := parent
	cancel := func() {}
	if deadline, ok := parent.Deadline(); !ok || time.Until(deadline) > 20*time.Second {
		ctx, cancel = context.WithTimeout(parent, 20*time.Second)
	}
	defer cancel()

	providers := order
	if len(providers) > directProviderProbeMax {
		providers = providers[:directProviderProbeMax]
	}

	seen := make(map[string]struct{}, len(providers))
	result := make([]codexbar.ParsedFrame, 0, len(providers))
	for _, provider := range providers {
		key := normalizeProviderKey(provider)
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}

		parsed, err := deps.fetchProvider(ctx, key)
		if err != nil {
			continue
		}
		if strings.TrimSpace(parsed.Frame.Error) != "" {
			continue
		}
		result = append(result, parsed)
	}

	return result
}

func updateLastGoodState(state *runtimeState, frame protocol.Frame, now time.Time, deps runtimeDeps) {
	if state == nil {
		return
	}

	normalized := frame.Normalize()
	state.lastGood = normalized
	state.lastGoodAt = now
	state.hasLastGood = true

	shouldPersist := !state.hasPersistedGood ||
		!framesEqual(state.lastPersistedGood, normalized) ||
		state.lastPersistedAt.IsZero() ||
		now.Sub(state.lastPersistedAt) >= lastGoodPersistInterval
	if !shouldPersist {
		return
	}

	if err := persistLastGood(normalized, now); err != nil {
		deps.logf("runtime event=last-good-persist-failed err=%v\n", err)
		return
	}
	state.lastPersistedGood = normalized
	state.lastPersistedAt = now
	state.hasPersistedGood = true
}

func framesEqual(a, b protocol.Frame) bool {
	return reflect.DeepEqual(a.Normalize(), b.Normalize())
}

func updateDisplayFrameState(state *runtimeState, frame protocol.Frame, now time.Time, deps runtimeDeps) {
	if state == nil {
		if err := persistDisplayFrame(frame, now); err != nil {
			deps.logf("runtime event=display-frame-persist-failed err=%v\n", err)
		}
		return
	}

	normalized := frame.Normalize()
	shouldPersist := !state.hasPersistedDisplay ||
		!framesEqual(state.lastPersistedDisplay, normalized) ||
		state.lastDisplayPersistedAt.IsZero() ||
		now.Sub(state.lastDisplayPersistedAt) >= lastGoodPersistInterval
	if !shouldPersist {
		return
	}

	if err := persistDisplayFrame(normalized, now); err != nil {
		deps.logf("runtime event=display-frame-persist-failed err=%v\n", err)
		return
	}
	state.lastPersistedDisplay = normalized
	state.lastDisplayPersistedAt = now
	state.hasPersistedDisplay = true
}

func usageDataRuntimeError(kind runtimeErrorKind, op string, err error) *RuntimeError {
	if kind == "" {
		kind = runtimeErrorUnknown
	}
	if err == nil {
		err = errors.New("usage data unavailable")
	}

	switch strings.TrimSpace(op) {
	case "select-provider":
		return &RuntimeError{
			Kind: kind,
			Op:   "select-provider",
			Err:  fmt.Errorf("select provider: %w", err),
		}
	default:
		return &RuntimeError{
			Kind: kind,
			Op:   "fetch-usage",
			Err:  fmt.Errorf("fetch codexbar usage: %w", err),
		}
	}
}

func applyThemeToFrame(frame protocol.Frame, selectedTheme string, caps protocol.DeviceCapabilities) (protocol.Frame, bool) {
	selectedTheme = runtimeconfig.NormalizeTheme(selectedTheme)
	if selectedTheme == "" {
		return frame, false
	}
	// For v0 MVP hardware we optimize for the single supported device path:
	// - known + explicit "no theme" => do not send theme
	// - unknown capabilities (missing hello) => optimistic send
	if caps.Known && !caps.SupportsTheme {
		return frame, false
	}
	frame.Theme = selectedTheme
	return frame, true
}

func applyUsageBarsPreference(frame protocol.Frame, showUsed bool) protocol.Frame {
	if strings.TrimSpace(frame.Error) != "" {
		return frame
	}

	if showUsed {
		frame.UsageMode = "used"
		return frame
	}

	frame.Session = 100 - clampPercent(frame.Session)
	frame.Weekly = 100 - clampPercent(frame.Weekly)
	frame.UsageMode = "remaining"
	return frame
}

func clampPercent(value int) int {
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}

func coldStartFetchTimeout() time.Duration {
	const fallback = 2 * time.Second

	raw := strings.TrimSpace(os.Getenv(coldStartTimeoutEnvVar))
	if raw == "" {
		return fallback
	}

	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return fallback
	}
	return time.Duration(n) * time.Second
}

func loadPersistedLastGood(now time.Time) (protocol.Frame, time.Time, bool) {
	frame, savedAt, ok := loadPersistedLastGoodAnyAge()
	if !ok {
		return protocol.Frame{}, time.Time{}, false
	}
	if !isLastGoodFreshAt(savedAt, now, lastGoodMaxAge()) {
		return protocol.Frame{}, time.Time{}, false
	}
	return frame, savedAt, true
}

func loadPersistedLastGoodAnyAge() (protocol.Frame, time.Time, bool) {
	path := lastGoodSnapshotPath()
	if path == "" {
		return protocol.Frame{}, time.Time{}, false
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		return protocol.Frame{}, time.Time{}, false
	}

	var saved persistedLastGood
	if err := json.Unmarshal(raw, &saved); err != nil {
		return protocol.Frame{}, time.Time{}, false
	}

	frame := saved.Frame.Normalize()
	if strings.TrimSpace(frame.Error) != "" {
		return protocol.Frame{}, time.Time{}, false
	}
	return frame, saved.SavedAt, true
}

func loadPersistedDisplayFrameAnyAge() (protocol.Frame, time.Time, bool) {
	path := displayFrameSnapshotPath()
	if path == "" {
		return protocol.Frame{}, time.Time{}, false
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		return protocol.Frame{}, time.Time{}, false
	}

	var saved persistedDisplayFrame
	if err := json.Unmarshal(raw, &saved); err != nil {
		return protocol.Frame{}, time.Time{}, false
	}

	frame := saved.Frame.Normalize()
	if strings.TrimSpace(frame.Error) != "" {
		return protocol.Frame{}, time.Time{}, false
	}
	if frame.UsageMode != "used" && frame.UsageMode != "remaining" {
		return protocol.Frame{}, time.Time{}, false
	}
	return frame, saved.SavedAt, true
}

func persistLastGood(frame protocol.Frame, savedAt time.Time) error {
	if strings.TrimSpace(frame.Error) != "" || savedAt.IsZero() {
		return nil
	}

	path := lastGoodSnapshotPath()
	if path == "" {
		return nil
	}

	payload := persistedLastGood{
		SavedAt: savedAt.UTC(),
		Frame:   frame.Normalize(),
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o644)
}

func persistDisplayFrame(frame protocol.Frame, savedAt time.Time) error {
	if strings.TrimSpace(frame.Error) != "" || savedAt.IsZero() {
		return nil
	}

	path := displayFrameSnapshotPath()
	if path == "" {
		return nil
	}

	payload := persistedDisplayFrame{
		SavedAt: savedAt.UTC(),
		Frame:   frame.Normalize(),
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o644)
}

func lastGoodSnapshotPath() string {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, "Library", "Application Support", "codexbar-display", "last-good-frame.json")
}

func displayFrameSnapshotPath() string {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, "Library", "Application Support", "codexbar-display", "last-display-frame.json")
}

func collectorInterval(renderInterval time.Duration) time.Duration {
	const (
		min = 30 * time.Second
		max = 60 * time.Second
	)

	if override := parseSecondsEnv(collectorIntervalEnvVar, 0); override > 0 {
		if override < min {
			return min
		}
		if override > max {
			return max
		}
		return override
	}

	if renderInterval <= 0 {
		return max
	}
	if renderInterval < min {
		return min
	}
	if renderInterval > max {
		return max
	}
	return renderInterval
}

func activityPollInterval() time.Duration {
	const (
		def = 2 * time.Second
		min = 1 * time.Second
		max = 10 * time.Second
	)

	override := parseSecondsEnv(activityPollEnvVar, int(def.Seconds()))
	if override < min {
		return min
	}
	if override > max {
		return max
	}
	return override
}

func activityHoldDuration() time.Duration {
	const (
		def = 180 * time.Second
		min = 5 * time.Second
		max = 600 * time.Second
	)

	override := parseSecondsEnv(activityHoldEnvVar, int(def.Seconds()))
	if override < min {
		return min
	}
	if override > max {
		return max
	}
	return override
}

func activityIdleEvidenceRequired() int {
	const (
		def = 2
		min = 1
		max = 10
	)

	raw := strings.TrimSpace(os.Getenv(activityIdleEvidenceEnvVar))
	if raw == "" {
		return def
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil {
		return def
	}
	if parsed < min {
		return min
	}
	if parsed > max {
		return max
	}
	return parsed
}

func cycleRunTimeout() time.Duration {
	const (
		min = 5 * time.Second
		max = 600 * time.Second
	)

	override := parseSecondsEnv(cycleTimeoutEnvVar, int(defaultCycleTimeout.Seconds()))
	if override < min {
		return min
	}
	if override > max {
		return max
	}
	return override
}

func collectorProviderTimeout() time.Duration {
	const (
		def = 600 * time.Second
		min = 60 * time.Second
		max = 900 * time.Second
	)

	override := parseSecondsEnv(collectorTimeoutEnvVar, int(def.Seconds()))
	if override < min {
		return min
	}
	if override > max {
		return max
	}
	return override
}

func collectorProviderOrder() []string {
	defaults := []string{
		"codex",
		"claude",
		"cursor",
		"copilot",
		"gemini",
		"vertexai",
		"jetbrains",
		"augment",
		"factory",
		"kimi",
		"ollama",
		"antigravity",
	}

	raw := strings.TrimSpace(os.Getenv(collectorOrderEnvVar))
	if raw == "" {
		return defaults
	}

	var out []string
	seen := make(map[string]struct{}, len(defaults))
	for _, part := range strings.Split(raw, ",") {
		key := normalizeProviderKey(part)
		if key == "" {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, key)
	}
	if len(out) == 0 {
		return defaults
	}
	return out
}

func providerSnapshotMaxAge() time.Duration {
	// Keep per-provider snapshots alive for stale-while-revalidate rendering.
	d := lastGoodMaxAge()
	raw := strings.TrimSpace(os.Getenv(providerMaxAgeEnvVar))
	if raw == "" {
		return d
	}
	parsed, err := time.ParseDuration(raw)
	if err != nil || parsed <= 0 {
		return d
	}
	return parsed
}

func parseSecondsEnv(key string, fallback int) time.Duration {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return time.Duration(fallback) * time.Second
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return time.Duration(fallback) * time.Second
	}
	return time.Duration(n) * time.Second
}

func normalizeProviderKey(raw string) string {
	return strings.TrimSpace(strings.ToLower(raw))
}

func providerSnapshotsPath() string {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, "Library", "Application Support", "codexbar-display", "provider-snapshots.json")
}

func persistProviderSnapshots(snapshots map[string]providerSnapshot, savedAt time.Time) error {
	if len(snapshots) == 0 || savedAt.IsZero() {
		return nil
	}

	path := providerSnapshotsPath()
	if path == "" {
		return nil
	}

	payload := persistedProviderSnapshots{
		SavedAt:   savedAt.UTC(),
		Providers: make([]providerSnapshot, 0, len(snapshots)),
	}
	for _, key := range sortedSnapshotKeys(snapshots) {
		snapshot := snapshots[key]
		snapshot.Provider = normalizeProviderKey(snapshot.Provider)
		if snapshot.Provider == "" {
			snapshot.Provider = key
		}
		snapshot.Frame = snapshot.Frame.Normalize()
		if strings.TrimSpace(snapshot.Frame.Error) != "" {
			continue
		}
		payload.Providers = append(payload.Providers, snapshot)
	}
	if len(payload.Providers) == 0 {
		return nil
	}

	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o644)
}

func loadPersistedProviderSnapshotsAnyAge() (map[string]providerSnapshot, time.Time, bool) {
	path := providerSnapshotsPath()
	if path == "" {
		return nil, time.Time{}, false
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, time.Time{}, false
	}

	var saved persistedProviderSnapshots
	if err := json.Unmarshal(raw, &saved); err != nil {
		return nil, time.Time{}, false
	}

	out := make(map[string]providerSnapshot, len(saved.Providers))
	for _, snapshot := range saved.Providers {
		key := normalizeProviderKey(snapshot.Provider)
		if key == "" {
			key = normalizeProviderKey(snapshot.Frame.Provider)
		}
		if key == "" {
			continue
		}
		snapshot.Provider = key
		snapshot.Frame = snapshot.Frame.Normalize()
		if strings.TrimSpace(snapshot.Frame.Error) != "" {
			continue
		}
		out[key] = snapshot
	}
	if len(out) == 0 {
		return nil, time.Time{}, false
	}
	return out, saved.SavedAt, true
}

func LoadPersistedUsage(now time.Time) (PersistedUsage, bool) {
	snapshots, savedAt, ok := loadPersistedProviderSnapshotsAnyAge()
	if !ok || len(snapshots) == 0 {
		return PersistedUsage{}, false
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}

	usage := PersistedUsage{
		SavedAt: savedAt.UTC(),
	}
	if frame, _, ok := loadPersistedLastGoodAnyAge(); ok {
		usage.CurrentProvider = normalizeProviderKey(frame.Provider)
	}

	for _, key := range orderedProviderUsageKeys(snapshots) {
		snapshot, ok := snapshots[key]
		if !ok {
			continue
		}
		frame := snapshot.Frame.Normalize()
		frame.Provider = normalizeProviderKey(frame.Provider)
		if frame.Provider == "" {
			frame.Provider = key
		}
		if frame.UsageMode == "" {
			frame.UsageMode = "used"
		}
		usage.Providers = append(usage.Providers, ProviderUsageSnapshot{
			Provider:           key,
			Frame:              frame,
			Source:             strings.TrimSpace(snapshot.Source),
			Meta:               snapshot.Meta,
			CollectedAt:        snapshot.Collected.UTC(),
			ActivityObservedAt: snapshot.ActivityObservedAt.UTC(),
			Stale:              providerUsageSnapshotIsStale(snapshot, now),
		})
	}
	if len(usage.Providers) == 0 {
		return PersistedUsage{}, false
	}
	if usage.CurrentProvider == "" {
		usage.CurrentProvider = usage.Providers[0].Provider
	}
	return usage, true
}

func LoadPersistedDisplayFrame(now time.Time) (protocol.Frame, time.Time, bool) {
	frame, savedAt, ok := loadPersistedDisplayFrameAnyAge()
	if !ok {
		return protocol.Frame{}, time.Time{}, false
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	if !isLastGoodFreshAt(savedAt, now, lastGoodMaxAge()) {
		return protocol.Frame{}, time.Time{}, false
	}
	return frame, savedAt.UTC(), true
}

func orderedProviderUsageKeys(snapshots map[string]providerSnapshot) []string {
	if len(snapshots) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(snapshots))
	keys := make([]string, 0, len(snapshots))
	for _, key := range collectorProviderOrder() {
		key = normalizeProviderKey(key)
		if key == "" {
			continue
		}
		if _, ok := snapshots[key]; !ok {
			continue
		}
		keys = append(keys, key)
		seen[key] = struct{}{}
	}
	remaining := make([]string, 0, len(snapshots)-len(keys))
	for key := range snapshots {
		if _, ok := seen[key]; ok {
			continue
		}
		remaining = append(remaining, key)
	}
	sort.Strings(remaining)
	return append(keys, remaining...)
}

func providerUsageSnapshotIsStale(snapshot providerSnapshot, now time.Time) bool {
	if snapshot.Collected.IsZero() || now.IsZero() {
		return true
	}
	age := now.Sub(snapshot.Collected)
	if age < 0 {
		return false
	}
	freshFor := collectorInterval(0) + 5*time.Second
	return age > freshFor
}

func encodeProviderSnapshotsForCompare(snapshots map[string]providerSnapshot) string {
	if len(snapshots) == 0 {
		return ""
	}

	ordered := make([]providerSnapshot, 0, len(snapshots))
	for _, key := range sortedSnapshotKeys(snapshots) {
		snapshot := snapshots[key]
		snapshot.Provider = normalizeProviderKey(snapshot.Provider)
		if snapshot.Provider == "" {
			snapshot.Provider = key
		}
		snapshot.Frame = snapshot.Frame.Normalize()
		if strings.TrimSpace(snapshot.Frame.Error) != "" {
			continue
		}
		ordered = append(ordered, snapshot)
	}
	if len(ordered) == 0 {
		return ""
	}
	raw, err := json.Marshal(ordered)
	if err != nil {
		return ""
	}
	return string(raw)
}

func sortedSnapshotKeys(snapshots map[string]providerSnapshot) []string {
	keys := make([]string, 0, len(snapshots))
	for key := range snapshots {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func asRuntimeError(err error) *RuntimeError {
	var runtimeErr *RuntimeError
	if errors.As(err, &runtimeErr) && runtimeErr != nil {
		return runtimeErr
	}
	return &RuntimeError{
		Kind: runtimeErrorUnknown,
		Op:   "unknown",
		Err:  err,
	}
}

func runtimeErrorKindFromFetchErr(err error) runtimeErrorKind {
	if err == nil {
		return runtimeErrorUnknown
	}

	switch codexbar.FetchErrorKindOf(err) {
	case codexbar.FetchErrorBinary:
		return runtimeErrorCodexbarBinary
	case codexbar.FetchErrorVersion:
		return runtimeErrorCodexbarVersion
	case codexbar.FetchErrorCommand:
		return runtimeErrorCodexbarCmd
	case codexbar.FetchErrorParse:
		return runtimeErrorCodexbarParse
	case codexbar.FetchErrorNoProviders:
		return runtimeErrorNoProviders
	default:
		if errors.Is(err, codexbar.ErrNoProviders) {
			return runtimeErrorNoProviders
		}
		return runtimeErrorCodexbarCmd
	}
}

func usageSourceOrDefault(source string, fallback string) string {
	source = strings.TrimSpace(strings.ToLower(source))
	if source != "" {
		return source
	}
	fallback = strings.TrimSpace(strings.ToLower(fallback))
	if fallback != "" {
		return fallback
	}
	return "unknown"
}

func runtimeErrorFrameCode(kind runtimeErrorKind) string {
	if kind == "" {
		kind = runtimeErrorUnknown
	}
	return string(kind)
}

func resolvePortWithFallback(requestedPort string, deps runtimeDeps) (string, error) {
	// KISS + safety: never auto-switch away from an explicit requested port.
	// If the port disappears, surface the error and let operator action decide.
	return deps.resolvePort(requestedPort)
}

func wallClockNow() time.Time {
	// Strip monotonic data so gap detection reflects wall-clock sleep/wake jumps.
	return time.Now().Round(0)
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

func isLastGoodFreshAt(lastGoodAt time.Time, now time.Time, maxAge time.Duration) bool {
	if lastGoodAt.IsZero() || now.IsZero() || maxAge <= 0 {
		return false
	}
	return now.Sub(lastGoodAt) <= maxAge
}

func lastGoodMaxAge() time.Duration {
	// If CodexBar requests fail for a short period, keep rendering the most recent good frame.
	d := 10 * time.Minute
	raw := os.Getenv("CODEXBAR_DISPLAY_LAST_GOOD_MAX_AGE")
	if raw == "" {
		return d
	}
	parsed, err := time.ParseDuration(raw)
	if err != nil || parsed <= 0 {
		return d
	}
	return parsed
}

func LastGoodMaxAge() time.Duration {
	return lastGoodMaxAge()
}

func marshalFrameWithinLimit(frame protocol.Frame, maxBytes int) ([]byte, protocol.Frame, error) {
	if maxBytes <= 0 {
		maxBytes = protocol.DefaultMaxFrameBytes
	}

	line, err := frame.MarshalLine()
	if err != nil {
		return nil, protocol.Frame{}, err
	}
	if len(line) <= maxBytes {
		return line, frame, nil
	}

	if frame.Update != nil {
		compactUpdate := frame
		compactUpdate.Update = compactFrameUpdate(frame.Update)
		for _, candidate := range compactUpdateCandidates(compactUpdate) {
			line, err = candidate.MarshalLine()
			if err != nil {
				return nil, protocol.Frame{}, err
			}
			if len(line) <= maxBytes {
				return line, candidate, nil
			}
		}

		noUpdate := frame
		noUpdate.Update = nil
		line, err = noUpdate.MarshalLine()
		if err != nil {
			return nil, protocol.Frame{}, err
		}
		if len(line) <= maxBytes {
			return line, noUpdate, nil
		}
	}

	if frame.Theme != "" {
		noTheme := frame
		noTheme.Theme = ""
		line, err = noTheme.MarshalLine()
		if err != nil {
			return nil, protocol.Frame{}, err
		}
		if len(line) <= maxBytes {
			return line, noTheme, nil
		}
	}

	if frame.SessionTokens > 0 || frame.WeekTokens > 0 || frame.TotalTokens > 0 {
		noTokens := frame
		noTokens.SessionTokens = 0
		noTokens.WeekTokens = 0
		noTokens.TotalTokens = 0
		line, err = noTokens.MarshalLine()
		if err != nil {
			return nil, protocol.Frame{}, err
		}
		if len(line) <= maxBytes {
			return line, noTokens, nil
		}
	}

	if frame.Time != "" || frame.Date != "" {
		noClock := frame
		noClock.Time = ""
		noClock.Date = ""
		line, err = noClock.MarshalLine()
		if err != nil {
			return nil, protocol.Frame{}, err
		}
		if len(line) <= maxBytes {
			return line, noClock, nil
		}
	}

	fallback := protocol.ErrorFrame(runtimeErrorFrameCode(runtimeErrorFrameTooLarge))
	line, err = fallback.MarshalLine()
	if err != nil {
		return nil, protocol.Frame{}, err
	}
	if len(line) <= maxBytes {
		return line, fallback, nil
	}

	return nil, protocol.Frame{}, fmt.Errorf("%w: maxFrameBytes=%d and fallback frame does not fit", errMarshalFrameTooLarge, maxBytes)
}

func compactFrameUpdate(update *protocol.UpdateState) *protocol.UpdateState {
	if update == nil {
		return nil
	}
	return &protocol.UpdateState{
		Available:     update.Available,
		LatestVersion: update.LatestVersion,
		Status:        update.Status,
		LastError:     update.LastError,
	}
}

func compactUpdateCandidates(frame protocol.Frame) []protocol.Frame {
	candidates := []protocol.Frame{frame}

	withoutTokens := frame
	withoutTokens.SessionTokens = 0
	withoutTokens.WeekTokens = 0
	withoutTokens.TotalTokens = 0
	candidates = append(candidates, withoutTokens)

	withoutClock := withoutTokens
	withoutClock.Time = ""
	withoutClock.Date = ""
	candidates = append(candidates, withoutClock)

	withoutTheme := withoutClock
	withoutTheme.Theme = ""
	candidates = append(candidates, withoutTheme)

	return candidates
}
