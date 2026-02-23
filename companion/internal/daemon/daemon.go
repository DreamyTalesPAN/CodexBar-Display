package daemon

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
)

type Options struct {
	Port     string
	Interval time.Duration
	Once     bool
}

type runtimeErrorKind string

const (
	runtimeErrorUnknown        runtimeErrorKind = "unknown"
	runtimeErrorSerialResolve  runtimeErrorKind = "serial-resolve"
	runtimeErrorSerialWrite    runtimeErrorKind = "serial-write"
	runtimeErrorFrameEncode    runtimeErrorKind = "frame-encode"
	runtimeErrorCodexbarBinary runtimeErrorKind = "codexbar-binary"
	runtimeErrorCodexbarCmd    runtimeErrorKind = "codexbar-command"
	runtimeErrorCodexbarParse  runtimeErrorKind = "codexbar-parse"
	runtimeErrorNoProviders    runtimeErrorKind = "no-providers"
)

type RuntimeError struct {
	Kind runtimeErrorKind
	Op   string
	Err  error
}

func (e *RuntimeError) Error() string {
	if e == nil {
		return ""
	}
	if e.Op == "" {
		return fmt.Sprintf("%s: %v", e.Kind, e.Err)
	}
	return fmt.Sprintf("%s (%s): %v", e.Kind, e.Op, e.Err)
}

func (e *RuntimeError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

type runtimeDeps struct {
	now            func() time.Time
	after          func(time.Duration) <-chan time.Time
	resolvePort    func(string) (string, error)
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
		d.logf = func(format string, args ...any) {
			_, _ = fmt.Printf(format, args...)
		}
	}
	return d
}

type runtimeState struct {
	selector    *codexbar.ProviderSelector
	lastGood    protocol.Frame
	lastGoodAt  time.Time
	hasLastGood bool
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
	return runWithDeps(ctx, opts, runtimeDeps{})
}

func runWithDeps(ctx context.Context, opts Options, deps runtimeDeps) error {
	if opts.Interval <= 0 {
		opts.Interval = 60 * time.Second
	}
	deps = deps.withDefaults()

	state := &runtimeState{
		selector: deps.newSelector(),
	}
	backoff := newRetryBackoff(opts.Interval)
	var lastCycleStart time.Time

	for {
		cycleStart := deps.now()
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
			deps.logf("cycle error: kind=%s op=%s retry=%s err=%v\n", runtimeErr.Kind, runtimeErr.Op, waitFor, err)
		} else {
			backoff.Reset()
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-deps.after(waitFor):
		}
	}
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
		}
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

	line, err := frame.MarshalLine()
	if err != nil {
		return &RuntimeError{
			Kind: runtimeErrorFrameEncode,
			Op:   "marshal-frame",
			Err:  fmt.Errorf("encode frame: %w", err),
		}
	}

	if err := deps.sendLine(port, line); err != nil {
		return &RuntimeError{
			Kind: runtimeErrorSerialWrite,
			Op:   "send-line",
			Err:  err,
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
	return "runtime/" + string(kind)
}

func resolvePortWithFallback(requestedPort string, deps runtimeDeps) (string, error) {
	port, err := deps.resolvePort(requestedPort)
	if err == nil {
		return port, nil
	}

	if strings.TrimSpace(requestedPort) == "" {
		return "", err
	}

	autoPort, autoErr := deps.resolvePort("")
	if autoErr != nil {
		return "", err
	}
	deps.logf("runtime event=port-fallback requested=%s resolved=%s cause=%v\n", requestedPort, autoPort, err)
	return autoPort, nil
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
		interval = 60 * time.Second
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

func isLastGoodFresh(lastGoodAt time.Time) bool {
	return isLastGoodFreshAt(lastGoodAt, wallClockNow(), lastGoodMaxAge())
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
