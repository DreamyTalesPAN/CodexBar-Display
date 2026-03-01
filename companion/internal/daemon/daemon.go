package daemon

import (
	"context"
	"errors"
	"fmt"
	"os"
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
	themeEnvVar             = "VIBEBLOCK_THEME"
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
	now            func() time.Time
	after          func(time.Duration) <-chan time.Time
	resolvePort    func(string) (string, error)
	deviceCaps     func(string) (protocol.DeviceCapabilities, error)
	fetchProviders func(context.Context) ([]codexbar.ParsedFrame, error)
	sendLine       func(string, []byte) error
	newSelector    func() *codexbar.ProviderSelector
	logf           func(string, ...any)
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
	selector    *codexbar.ProviderSelector
	lastGood    protocol.Frame
	lastGoodAt  time.Time
	hasLastGood bool
	cliTheme    string
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
		deviceCaps: sender.DeviceCapabilities,
		sendLine:   sender.Send,
	})
}

func runWithDeps(ctx context.Context, opts Options, deps runtimeDeps) error {
	if opts.Interval <= 0 {
		opts.Interval = defaultInterval
	}
	deps = deps.withDefaults()

	state := &runtimeState{
		selector: deps.newSelector(),
		cliTheme: opts.Theme,
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

	allProviders, fetchErr := deps.fetchProviders(ctx)
	fetchKind := runtimeErrorKindFromFetchErr(fetchErr)

	var frame protocol.Frame
	usedLastGood := false
	selectionReason := "fetch-error"
	selectionDetail := ""

	if fetchErr != nil {
		if state.hasLastGood && isLastGoodFreshAt(state.lastGoodAt, deps.now(), lastGoodMaxAge()) {
			frame = state.lastGood
			usedLastGood = true
			selectionReason = "stale-last-good"
			selectionDetail = fmt.Sprintf("kind=%s", fetchKind)
		} else {
			frame = protocol.ErrorFrame(runtimeErrorFrameCode(fetchKind))
			selectionReason = "error-frame"
			selectionDetail = fmt.Sprintf("kind=%s source=codexbar", fetchKind)
		}
	} else {
		decision, ok := state.selector.SelectWithDecision(allProviders)
		if !ok {
			frame = protocol.ErrorFrame(runtimeErrorFrameCode(runtimeErrorNoProviders))
			selectionReason = "error-frame"
			selectionDetail = "kind=no-providers-after-selection"
		} else {
			frame = decision.Selected.Frame
			selectionReason = string(decision.Reason)
			selectionDetail = decision.Detail
		}

		state.lastGood = frame
		state.lastGoodAt = deps.now()
		state.hasLastGood = true
	}

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

	if fetchErr != nil {
		if usedLastGood {
			deps.logf("warning: codexbar fetch failed kind=%s, sent stale frame: %v\n", fetchKind, fetchErr)
			return nil
		}
		return &RuntimeError{
			Kind: fetchKind,
			Op:   "fetch-usage",
			Err:  fmt.Errorf("fetch codexbar usage: %w", fetchErr),
		}
	}

	return nil
}

func applyThemeToFrame(frame protocol.Frame, selectedTheme string, caps protocol.DeviceCapabilities) (protocol.Frame, bool) {
	selectedTheme = runtimeconfig.NormalizeTheme(selectedTheme)
	if selectedTheme == "" {
		return frame, false
	}
	if caps.Known && caps.SupportsTheme {
		frame.Theme = selectedTheme
		return frame, true
	}
	return frame, false
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
	raw := os.Getenv("VIBEBLOCK_LAST_GOOD_MAX_AGE")
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
