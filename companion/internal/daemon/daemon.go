package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
)

type Options struct {
	Port     string
	Interval time.Duration
	Once     bool
	Theme    string
}

const (
	defaultInterval         = 60 * time.Second
	defaultCycleTimeout     = 20 * time.Second
	startupFastPollWindow   = 2 * time.Minute
	startupFastPollInterval = 30 * time.Second
	lastGoodPersistInterval = 1 * time.Minute
	themeEnvVar             = "CODEXBAR_DISPLAY_THEME"
	coldStartTimeoutEnvVar  = "CODEXBAR_DISPLAY_COLDSTART_TIMEOUT_SECS"
	cycleTimeoutEnvVar      = "CODEXBAR_DISPLAY_CYCLE_TIMEOUT_SECS"
	collectorIntervalEnvVar = "CODEXBAR_DISPLAY_COLLECTOR_INTERVAL_SECS"
	collectorTimeoutEnvVar  = "CODEXBAR_DISPLAY_PROVIDER_TIMEOUT_SECS"
	collectorParallelEnvVar = "CODEXBAR_DISPLAY_PROVIDER_MAX_PARALLEL"
	collectorOrderEnvVar    = "CODEXBAR_DISPLAY_PROVIDER_ORDER"
	providerMaxAgeEnvVar    = "CODEXBAR_DISPLAY_PROVIDER_LAST_GOOD_MAX_AGE"
)

var errMarshalFrameTooLarge = errors.New("frame exceeds max bytes")

type runtimeErrorKind errcode.Code

const (
	runtimeErrorUnknown        runtimeErrorKind = runtimeErrorKind(errcode.Unknown)
	runtimeErrorSerialResolve  runtimeErrorKind = runtimeErrorKind(errcode.RuntimeSerialResolve)
	runtimeErrorSerialWrite    runtimeErrorKind = runtimeErrorKind(errcode.RuntimeSerialWrite)
	runtimeErrorCycleTimeout   runtimeErrorKind = runtimeErrorKind(errcode.RuntimeCycleTimeout)
	runtimeErrorFrameEncode    runtimeErrorKind = runtimeErrorKind(errcode.RuntimeFrameEncode)
	runtimeErrorFrameTooLarge  runtimeErrorKind = runtimeErrorKind(errcode.RuntimeFrameTooLarge)
	runtimeErrorCodexbarBinary runtimeErrorKind = runtimeErrorKind(errcode.RuntimeCodexbarBinary)
	runtimeErrorCodexbarCmd    runtimeErrorKind = runtimeErrorKind(errcode.RuntimeCodexbarCmd)
	runtimeErrorCodexbarParse  runtimeErrorKind = runtimeErrorKind(errcode.RuntimeCodexbarParse)
	runtimeErrorNoProviders    runtimeErrorKind = runtimeErrorKind(errcode.RuntimeNoProviders)
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
	now               func() time.Time
	after             func(time.Duration) <-chan time.Time
	resolvePort       func(string) (string, error)
	deviceCaps        func(string) (protocol.DeviceCapabilities, error)
	fetchProviders    func(context.Context) ([]codexbar.ParsedFrame, error)
	fetchProvider     func(context.Context, string) (codexbar.ParsedFrame, error)
	usageBarsShowUsed func() bool
	sendLine          func(string, []byte) error
	newSelector       func() *codexbar.ProviderSelector
	logf              func(string, ...any)
}

func (d runtimeDeps) withDefaults() runtimeDeps {
	if d.now == nil {
		d.now = wallClockNow
	}
	if d.after == nil {
		d.after = time.After
	}
	if d.resolvePort == nil {
		d.resolvePort = usb.ResolvePort
	}
	if d.deviceCaps == nil {
		d.deviceCaps = usb.GetDeviceCapabilities
	}
	if d.fetchProviders == nil {
		d.fetchProviders = codexbar.FetchAllProviders
	}
	if d.fetchProvider == nil {
		d.fetchProvider = codexbar.FetchProvider
	}
	if d.usageBarsShowUsed == nil {
		d.usageBarsShowUsed = func() bool { return true }
	}
	if d.sendLine == nil {
		d.sendLine = usb.SendLine
	}
	if d.newSelector == nil {
		d.newSelector = codexbar.NewProviderSelector
	}
	if d.logf == nil {
		d.logf = defaultRuntimeLogf
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
	selector          *codexbar.ProviderSelector
	lastGood          protocol.Frame
	lastGoodAt        time.Time
	hasLastGood       bool
	lastPersistedGood protocol.Frame
	lastPersistedAt   time.Time
	hasPersistedGood  bool
	cliTheme          string
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
}

type persistedLastGood struct {
	SavedAt time.Time      `json:"savedAt"`
	Frame   protocol.Frame `json:"frame"`
}

type providerSnapshot struct {
	Provider  string         `json:"provider"`
	Frame     protocol.Frame `json:"frame"`
	Source    string         `json:"source,omitempty"`
	Collected time.Time      `json:"collectedAt"`
}

type persistedProviderSnapshots struct {
	SavedAt   time.Time          `json:"savedAt"`
	Providers []providerSnapshot `json:"providers"`
}

type retryBackoff struct {
	base    time.Duration
	max     time.Duration
	current time.Duration
}

type providerCollector struct {
	now             func() time.Time
	logf            func(string, ...any)
	fetchProvider   func(context.Context, string) (codexbar.ParsedFrame, error)
	order           []string
	interval        time.Duration
	timeout         time.Duration
	maxParallel     int
	snapshotMaxAge  time.Duration
	persistInterval time.Duration

	mu               sync.RWMutex
	providers        map[string]providerSnapshot
	lastPersistedRaw string
	lastPersistedAt  time.Time
}

func newProviderCollector(deps runtimeDeps, opts Options) *providerCollector {
	nowFn := deps.now
	if nowFn == nil {
		nowFn = wallClockNow
	}
	logFn := deps.logf
	if logFn == nil {
		logFn = defaultRuntimeLogf
	}

	collector := &providerCollector{
		now:             nowFn,
		logf:            logFn,
		fetchProvider:   deps.fetchProvider,
		order:           collectorProviderOrder(),
		interval:        collectorInterval(opts.Interval),
		timeout:         collectorProviderTimeout(),
		maxParallel:     collectorMaxParallel(),
		snapshotMaxAge:  providerSnapshotMaxAge(),
		persistInterval: 1 * time.Minute,
		providers:       make(map[string]providerSnapshot),
	}

	if loaded, savedAt, ok := loadPersistedProviderSnapshotsAnyAge(); ok {
		collector.providers = loaded
		collector.lastPersistedAt = savedAt
		if raw := encodeProviderSnapshotsForCompare(loaded); raw != "" {
			collector.lastPersistedRaw = raw
		}
	}
	return collector
}

func (c *providerCollector) start(ctx context.Context) {
	if c == nil {
		return
	}
	go c.run(ctx)
}

func (c *providerCollector) run(ctx context.Context) {
	if c == nil {
		return
	}
	c.collectOnce(ctx)

	ticker := time.NewTicker(c.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.collectOnce(ctx)
		}
	}
}

func (c *providerCollector) collectOnce(parent context.Context) {
	if c == nil || c.fetchProvider == nil {
		return
	}

	now := c.now()
	type collectResult struct {
		key   string
		frame codexbar.ParsedFrame
		err   error
	}

	results := make(chan collectResult, len(c.order))
	semaphore := make(chan struct{}, c.maxParallel)
	var wg sync.WaitGroup

	for _, provider := range c.order {
		key := normalizeProviderKey(provider)
		if key == "" {
			continue
		}
		wg.Add(1)
		go func(providerKey string) {
			defer wg.Done()
			select {
			case semaphore <- struct{}{}:
			case <-parent.Done():
				return
			}
			defer func() { <-semaphore }()

			ctx, cancel := context.WithTimeout(parent, c.timeout)
			defer cancel()

			parsed, err := c.fetchProvider(ctx, providerKey)
			results <- collectResult{key: providerKey, frame: parsed, err: err}
		}(key)
	}

	wg.Wait()
	close(results)

	updated := false
	successes := 0

	c.mu.Lock()
	for result := range results {
		if result.err != nil {
			c.logf("collector provider=%s err=%v\n", result.key, result.err)
			continue
		}
		frame := result.frame.Frame.Normalize()
		if strings.TrimSpace(frame.Error) != "" {
			continue
		}

		key := normalizeProviderKey(result.key)
		if parsedKey := normalizeProviderKey(result.frame.Provider); parsedKey != "" {
			key = parsedKey
		}
		if key == "" {
			continue
		}

		frame.Provider = key
		snapshot := providerSnapshot{
			Provider:  key,
			Frame:     frame,
			Source:    strings.TrimSpace(result.frame.Source),
			Collected: now.UTC(),
		}
		c.providers[key] = snapshot
		successes++
		updated = true
	}
	c.mu.Unlock()

	if updated {
		c.persistIfNeeded(now)
	}
	c.logf("collector complete providers=%d succeeded=%d timeout=%s parallel=%d\n", len(c.order), successes, c.timeout, c.maxParallel)
}

func (c *providerCollector) providerFrames(now time.Time) []codexbar.ParsedFrame {
	if c == nil {
		return nil
	}

	c.mu.RLock()
	defer c.mu.RUnlock()

	if len(c.providers) == 0 {
		return nil
	}

	var frames []codexbar.ParsedFrame
	for _, key := range c.orderedKeysLocked() {
		snapshot, ok := c.providers[key]
		if !ok {
			continue
		}
		if !snapshot.Collected.IsZero() && !isLastGoodFreshAt(snapshot.Collected, now, c.snapshotMaxAge) {
			continue
		}

		frame := snapshot.Frame.Normalize()
		frame.Provider = normalizeProviderKey(frame.Provider)
		if frame.Provider == "" {
			frame.Provider = key
		}
		frames = append(frames, codexbar.ParsedFrame{
			Frame:    frame,
			Provider: key,
			Source:   snapshot.Source,
		})
	}
	return frames
}

func (c *providerCollector) orderedKeysLocked() []string {
	keys := make([]string, 0, len(c.providers))
	seen := make(map[string]struct{}, len(c.providers))
	for _, key := range c.order {
		key = normalizeProviderKey(key)
		if key == "" {
			continue
		}
		if _, ok := c.providers[key]; !ok {
			continue
		}
		keys = append(keys, key)
		seen[key] = struct{}{}
	}
	for key := range c.providers {
		if _, ok := seen[key]; ok {
			continue
		}
		keys = append(keys, key)
	}
	return keys
}

func (c *providerCollector) persistIfNeeded(now time.Time) {
	if c == nil {
		return
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	encoded := encodeProviderSnapshotsForCompare(c.providers)
	if encoded == "" {
		return
	}
	if c.lastPersistedRaw == encoded && !c.lastPersistedAt.IsZero() && now.Sub(c.lastPersistedAt) < c.persistInterval {
		return
	}

	if err := persistProviderSnapshots(c.providers, now); err != nil {
		c.logf("runtime event=provider-snapshot-persist-failed err=%v\n", err)
		return
	}
	c.lastPersistedRaw = encoded
	c.lastPersistedAt = now
}

func newRetryBackoff(interval time.Duration) *retryBackoff {
	max := 30 * time.Second
	if interval > 0 && interval < max {
		max = interval
	}
	if max <= 0 {
		max = time.Second
	}
	base := time.Second
	if max < base {
		base = max
	}
	return &retryBackoff{
		base: base,
		max:  max,
	}
}

func (b *retryBackoff) Next() time.Duration {
	if b == nil {
		return time.Second
	}
	if b.current <= 0 {
		b.current = b.base
		return b.current
	}
	next := b.current * 2
	if next > b.max {
		next = b.max
	}
	b.current = next
	return b.current
}

func (b *retryBackoff) Reset() {
	if b == nil {
		return
	}
	b.current = 0
}

func Run(ctx context.Context, opts Options) error {
	sender := usb.NewSender()
	defer sender.Close()

	return runWithDeps(ctx, opts, runtimeDeps{
		deviceCaps:        sender.DeviceCapabilities,
		sendLine:          sender.Send,
		usageBarsShowUsed: codexbar.UsageBarsShowUsed,
	})
}

func runWithDeps(ctx context.Context, opts Options, deps runtimeDeps) error {
	if opts.Interval <= 0 {
		opts.Interval = defaultInterval
	}
	legacySyncFetch := deps.fetchProviders != nil && deps.fetchProvider == nil
	deps = deps.withDefaults()

	state := initializeRuntimeState(deps.now(), opts, deps)
	collector, collectorCancel := startProviderCollector(ctx, opts, deps, legacySyncFetch)
	if collectorCancel != nil {
		defer collectorCancel()
	}

	runCycle := func(cycleCtx context.Context) error {
		if collector != nil {
			return runCycleFromCollector(cycleCtx, opts.Port, state, collector, deps)
		}
		return runCycleWithDeps(cycleCtx, opts.Port, state, deps)
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

func startProviderCollector(ctx context.Context, opts Options, deps runtimeDeps, legacySyncFetch bool) (*providerCollector, context.CancelFunc) {
	if legacySyncFetch {
		return nil, nil
	}

	collector := newProviderCollector(deps, opts)
	collectorCtx, cancel := context.WithCancel(ctx)
	collector.start(collectorCtx)
	deps.logf("collector started interval=%s timeout=%s max_parallel=%d providers=%s\n",
		collector.interval,
		collector.timeout,
		collector.maxParallel,
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
			waitFor = startupInterval(waitFor, uptime)
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
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

func ensureCycleState(state *runtimeState, deps runtimeDeps) *runtimeState {
	if state == nil {
		state = &runtimeState{}
	}
	if state.selector == nil {
		state.selector = deps.newSelector()
	}
	return state
}

func resolveCycleDevice(requestedPort string, deps runtimeDeps) (string, protocol.DeviceCapabilities, int, error) {
	port, err := resolvePortWithFallback(requestedPort, deps)
	if err != nil {
		return "", protocol.DeviceCapabilities{}, 0, &RuntimeError{
			Kind: runtimeErrorSerialResolve,
			Op:   "resolve-port",
			Err:  fmt.Errorf("detect serial device: %w", err),
			Hint: errcode.DefaultRecovery(errcode.RuntimeSerialResolve),
		}
	}

	caps, capsErr := deps.deviceCaps(port)
	if capsErr != nil {
		deps.logf("runtime event=device-caps-read-failed port=%s err=%v\n", port, capsErr)
		caps = protocol.UnknownDeviceCapabilities()
	}
	maxFrameBytes := protocol.DefaultMaxFrameBytes
	if caps.MaxFrameBytes > 0 {
		maxFrameBytes = caps.MaxFrameBytes
	}

	return port, caps, maxFrameBytes, nil
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
	updateLastGoodState(state, result.frame, now, deps)
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
	return result
}

func sendCycleResult(port string, caps protocol.DeviceCapabilities, maxFrameBytes int, state *runtimeState, deps runtimeDeps, result cycleResult) error {
	frame := applyUsageBarsPreference(result.frame, deps.usageBarsShowUsed())

	if selectedTheme := configuredTheme(state.cliTheme); selectedTheme != "" {
		var applied bool
		frame, applied = applyThemeToFrame(frame, selectedTheme, caps)
		if !applied {
			deps.logf("runtime event=theme-skipped port=%s board=%s requested=%s reason=unsupported\n", port, caps.Board, selectedTheme)
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

	if err := deps.sendLine(port, line); err != nil {
		return &RuntimeError{
			Kind: runtimeErrorSerialWrite,
			Op:   "send-line",
			Err:  err,
			Hint: errcode.DefaultRecovery(errcode.RuntimeSerialWrite),
		}
	}

	deps.logf("sent frame -> %s provider=%s label=%s session=%d weekly=%d reset=%ds error=%q reason=%s detail=%q\n",
		port, frame.Provider, frame.Label, frame.Session, frame.Weekly, frame.ResetSec, frame.Error, result.selectionReason, result.selectionDetail)

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

func runCycleWithDeps(ctx context.Context, requestedPort string, state *runtimeState, deps runtimeDeps) error {
	deps = deps.withDefaults()
	state = ensureCycleState(state, deps)

	port, caps, maxFrameBytes, err := resolveCycleDevice(requestedPort, deps)
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

	return sendCycleResult(port, caps, maxFrameBytes, state, deps, result)
}

func runCycleFromCollector(ctx context.Context, requestedPort string, state *runtimeState, collector *providerCollector, deps runtimeDeps) error {
	deps = deps.withDefaults()
	state = ensureCycleState(state, deps)

	port, caps, maxFrameBytes, err := resolveCycleDevice(requestedPort, deps)
	if err != nil {
		return err
	}

	now := deps.now()
	allProviders := collector.providerFrames(now)
	result := selectCycleFrameFromProviders(
		state,
		allProviders,
		now,
		deps,
		"collect-provider",
		"collector-empty",
		fmt.Sprintf("snapshot_max_age=%s", collector.snapshotMaxAge),
		"collector",
	)

	return sendCycleResult(port, caps, maxFrameBytes, state, deps, result)
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
		state.lastPersistedGood != normalized ||
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

func lastGoodSnapshotPath() string {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, "Library", "Application Support", "codexbar-display", "last-good-frame.json")
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

func cycleRunTimeout() time.Duration {
	const (
		min = 5 * time.Second
		max = 120 * time.Second
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
		def = 4 * time.Second
		min = 2 * time.Second
		max = 4 * time.Second
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

func collectorMaxParallel() int {
	const (
		def = 3
		min = 1
		max = 4
	)

	raw := strings.TrimSpace(os.Getenv(collectorParallelEnvVar))
	if raw == "" {
		return def
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return def
	}
	if n < min {
		return min
	}
	if n > max {
		return max
	}
	return n
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
