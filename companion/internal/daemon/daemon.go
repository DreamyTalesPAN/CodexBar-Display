package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
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
	startupFastPollWindow   = 2 * time.Minute
	startupFastPollInterval = 30 * time.Second
	lastGoodPersistInterval = 1 * time.Minute
	themeEnvVar             = "CODEXBAR_DISPLAY_THEME"
	coldStartTimeoutEnvVar  = "CODEXBAR_DISPLAY_COLDSTART_TIMEOUT_SECS"
)

var errMarshalFrameTooLarge = errors.New("frame exceeds max bytes")

type runtimeErrorKind errcode.Code

const (
	runtimeErrorUnknown        runtimeErrorKind = runtimeErrorKind(errcode.Unknown)
	runtimeErrorSerialResolve  runtimeErrorKind = runtimeErrorKind(errcode.RuntimeSerialResolve)
	runtimeErrorSerialWrite    runtimeErrorKind = runtimeErrorKind(errcode.RuntimeSerialWrite)
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

type persistedLastGood struct {
	SavedAt time.Time      `json:"savedAt"`
	Frame   protocol.Frame `json:"frame"`
}

type retryBackoff struct {
	base    time.Duration
	max     time.Duration
	current time.Duration
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
	deps = deps.withDefaults()
	now := deps.now()

	state := &runtimeState{
		selector: deps.newSelector(),
		cliTheme: opts.Theme,
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
	backoff := newRetryBackoff(opts.Interval)
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

		err := runCycleWithDeps(ctx, opts.Port, state, deps)
		if opts.Once {
			return err
		}

		waitFor := opts.Interval
		if err != nil {
			runtimeErr := asRuntimeError(err)
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

func runCycleWithDeps(ctx context.Context, requestedPort string, state *runtimeState, deps runtimeDeps) error {
	deps = deps.withDefaults()
	if state == nil {
		state = &runtimeState{}
	}
	if state.selector == nil {
		state.selector = deps.newSelector()
	}

	port, err := resolvePortWithFallback(requestedPort, deps)
	if err != nil {
		return &RuntimeError{
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
	fetchKind := runtimeErrorKindFromFetchErr(fetchErr)

	var frame protocol.Frame
	usedLastGood := false
	failureKind := runtimeErrorKind("")
	failureOp := ""
	var failureErr error
	selectionReason := "fetch-error"
	selectionDetail := ""

	if fetchErr != nil {
		failureKind = fetchKind
		failureOp = "fetch-usage"
		failureErr = fetchErr
	} else {
		decision, ok := state.selector.SelectWithDecision(allProviders)
		if !ok {
			failureKind = runtimeErrorNoProviders
			failureOp = "select-provider"
			failureErr = codexbar.ErrNoProviders
		} else {
			frame = decision.Selected.Frame
			selectionReason = string(decision.Reason)
			selectionDetail = decision.Detail
		}
		if failureErr == nil {
			now := deps.now()
			normalized := frame.Normalize()

			state.lastGood = normalized
			state.lastGoodAt = now
			state.hasLastGood = true

			shouldPersist := !state.hasPersistedGood ||
				state.lastPersistedGood != normalized ||
				state.lastPersistedAt.IsZero() ||
				now.Sub(state.lastPersistedAt) >= lastGoodPersistInterval
			if shouldPersist {
				if err := persistLastGood(normalized, now); err != nil {
					deps.logf("runtime event=last-good-persist-failed err=%v\n", err)
				} else {
					state.lastPersistedGood = normalized
					state.lastPersistedAt = now
					state.hasPersistedGood = true
				}
			}
		}
	}

	if failureErr != nil {
		if state.hasLastGood {
			frame = state.lastGood
			usedLastGood = true
			selectionReason = "stale-last-good"
			selectionDetail = fmt.Sprintf("kind=%s", failureKind)
		} else {
			frame = protocol.ErrorFrame(runtimeErrorFrameCode(failureKind))
			selectionReason = "error-frame"
			selectionDetail = fmt.Sprintf("kind=%s source=codexbar", failureKind)
		}
	}

	frame = applyUsageBarsPreference(frame, deps.usageBarsShowUsed())

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
		port, frame.Provider, frame.Label, frame.Session, frame.Weekly, frame.ResetSec, frame.Error, selectionReason, selectionDetail)

	if failureErr != nil {
		if usedLastGood {
			deps.logf("warning: usage data unavailable kind=%s op=%s, sent stale frame: %v\n",
				failureKind,
				failureOp,
				failureErr,
			)
			return nil
		}
		return usageDataRuntimeError(failureKind, failureOp, failureErr)
	}

	return nil
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
