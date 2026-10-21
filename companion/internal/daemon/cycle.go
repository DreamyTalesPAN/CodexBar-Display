package daemon

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/timeline"
)

type runtimeState struct {
	selector               *codexbar.ProviderSelector
	lastGood               protocol.Frame
	lastGoodAt             time.Time
	hasLastGood            bool
	lastPersistedGood      protocol.Frame
	lastPersistedAt        time.Time
	hasPersistedGood       bool
	cliTheme               string
	firmwareUpdates        *FirmwareUpdateCache
	lastActivityAt         time.Time
	lastActivityObservedAt time.Time
	lastIdleEvidenceAt     time.Time
	idleEvidenceCount      int
	lastCodingAt           time.Time
	lastCodingTokenScanAt  time.Time
	lastActivity           string
	lastActivityCause      string
	deviceTarget           string
	// providerDisplayFallback names the Manual selection that currently names
	// no provider CodexBar still collects, so the runtime shows the remaining
	// providers instead of a blank screen. Tied to that selection: a later
	// Manual choice must not inherit the fallback frame.
	providerDisplayFallback string
	// rotationProvider is the provider the timed rotation of Automatic shows,
	// and rotationAt is when its turn began. Empty while nothing rotates.
	rotationProvider string
	rotationAt       time.Time
}

type cycleResult struct {
	frame           protocol.Frame
	collectedAt     time.Time
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
	// resetBasisAt is when the reset deadline in frame was collected. It is the
	// anchor the device-facing freshness fields are derived from.
	resetBasisAt time.Time
	// systemBusy puts SystemBusyLabel in place of the provider name.
	systemBusy bool
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

func runCycleWithDeps(ctx context.Context, requestedPort string, state *runtimeState, deps runtimeDeps) error {
	deps = deps.withDefaults()
	state = ensureCycleState(state, deps)
	invalidateLastGoodOutsideProviderDisplay(state, deps)

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
		var now time.Time
		if state.hasLastGood {
			now = deps.now()
		}
		result = finalizeCycleResult(state, result, now)
	} else {
		result = selectCycleFrameFromProviders(
			state,
			allProviders,
			deps.now(),
			deps,
			nil,
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
	invalidateLastGoodOutsideProviderDisplay(state, deps)
	invalidateLastGoodDisabledByInventory(state, collector, deps)

	port, caps, maxFrameBytes, err := resolveCycleDevice(requestedPort, state, deps)
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
		collector.providerOffByInventory,
		"select-provider",
		"collector-empty",
		fmt.Sprintf("snapshot_max_age=%s", collector.snapshotMaxAge),
		"collector",
	)
	first := collector.firstCollectState(now)
	if !state.hasLastGood && first.bounded && !first.settled && (first.warming || !first.started) &&
		(result.failureKind == runtimeErrorNoProviders || !result.usageFresh) {
		deps.logf("runtime event=usage-waiting port=%s reason=collector-warming\n", publicDeviceTarget(port))
		return nil
	}

	// Before the first collection since runtime start completes, a no-providers
	// verdict is warm-up, not an answer about this Mac: the collector simply
	// has not asked CodexBar yet. Wait for it, bounded in time; past the bound
	// a failed fetch keeps its own error kind instead of flattening into
	// no-providers. Once CodexBar has answered -- including with zero
	// providers -- the verdict stands.
	// `daemon --once` runs without a warm-up window (first.bounded == false)
	// and keeps the immediate no-providers verdict: the hosted guest matrix
	// greps exactly that code from a provider-less one-shot run.
	if result.failureKind == runtimeErrorNoProviders && !state.hasLastGood {
		if first.bounded && !first.settled {
			fetchErr := first.fetchErr
			failureKind := runtimeErrorKindFromFetchErr(fetchErr)
			if fetchErr == nil {
				fetchErr = errors.New("first provider collection exceeded the warm-up window")
				failureKind = runtimeErrorCodexbarCmd
			}
			if codexbar.FetchErrorKindOf(fetchErr) != codexbar.FetchErrorNoProviders {
				result = finalizeCycleResult(state, cycleResult{
					selectionReason: "collector-warming-failed",
					errorSource:     "collector",
					failureKind:     failureKind,
					failureOp:       "collect-usage",
					failureErr:      fetchErr,
				}, now)
			}
		}
	}

	result.systemBusy = collector.isSystemBusy()
	attachFirmwareUpdateState(ctx, state, deps, caps, &result)
	return sendCycleResult(ctx, port, caps, maxFrameBytes, state, deps, result)
}

func invalidateLastGoodDisabledByInventory(state *runtimeState, collector *providerCollector, deps runtimeDeps) {
	provider := discardLastGoodDisabledByInventory(state, collector.providerEnabledByInventory)
	if provider == "" {
		return
	}
	if err := clearPersistedDisplayFrame(state); err != nil {
		deps.logf("runtime event=last-good-clear-failed provider=%s err=%v\n", provider, err)
		return
	}
	deps.logf("runtime event=last-good-cleared provider=%s reason=provider-disabled\n", provider)
}

// Shared with read-only previews: only the stream invalidates the persisted file.
func discardLastGoodDisabledByInventory(state *runtimeState, providerEnabled func(string) (bool, bool)) string {
	if state == nil || !state.hasLastGood {
		return ""
	}
	enabled, known := providerEnabled(state.lastGood.Provider)
	if !known || enabled {
		return ""
	}
	provider := normalizeProviderKey(state.lastGood.Provider)
	state.lastGood = protocol.Frame{}
	state.lastGoodAt = time.Time{}
	state.hasLastGood = false
	if state.selector != nil {
		state.selector.SetCurrentProvider("")
	}
	return provider
}

func invalidateLastGoodOutsideProviderDisplay(state *runtimeState, deps runtimeDeps) {
	if state == nil {
		return
	}
	cfg, ok := loadRuntimeConfig(deps)
	if !ok || cfg.ProviderDisplay == nil || cfg.ProviderDisplay.Mode == "automatic" {
		// Leaving Manual ends its fallback: a later Manual choice of the same
		// provider is a new choice and must not inherit the fallback frame.
		state.providerDisplayFallback = ""
		return
	}
	if !state.hasLastGood {
		return
	}
	if state.providerDisplayFallback != "" &&
		state.providerDisplayFallback == providerDisplaySelectionKey(cfg.ProviderDisplay.ProviderIDs) {
		return
	}
	state.providerDisplayFallback = ""
	provider := normalizeProviderKey(state.lastGood.Provider)
	for _, providerID := range cfg.ProviderDisplay.ProviderIDs {
		if normalizeProviderKey(providerID) == provider {
			return
		}
	}

	state.lastGood = protocol.Frame{}
	state.lastGoodAt = time.Time{}
	state.hasLastGood = false
	state.lastPersistedGood = protocol.Frame{}
	state.lastPersistedAt = time.Time{}
	state.hasPersistedGood = false
	if state.selector != nil {
		state.selector.SetCurrentProvider("")
	}
	if err := clearPersistedLastGood(); err != nil {
		deps.logf("runtime event=last-good-clear-failed provider=%s err=%v\n", provider, err)
		return
	}
	deps.logf("runtime event=last-good-cleared provider=%s reason=provider-display-selection\n", provider)
}

func clearPersistedDisplayFrame(state *runtimeState) error {
	if state != nil {
		state.lastPersistedGood = protocol.Frame{}
		state.lastPersistedAt = time.Time{}
		state.hasPersistedGood = false
	}
	return clearPersistedLastGood()
}

// invalidateLastGoodTerminal drops the runtime and persisted last-good frame
// when CodexBar reported its provider as permanently unsupported; the bounded
// retention exists for transient failures only.
func invalidateLastGoodTerminal(state *runtimeState, providers []codexbar.ParsedFrame, deps runtimeDeps) {
	provider := discardLastGoodTerminal(state, providers)
	if provider == "" {
		return
	}
	if err := clearPersistedDisplayFrame(state); err != nil {
		deps.logf("runtime event=last-good-clear-failed provider=%s err=%v\n", provider, err)
		return
	}
	deps.logf("runtime event=last-good-cleared provider=%s reason=provider-terminal\n", provider)
}

// Shared with read-only previews: only the stream invalidates the persisted file.
func discardLastGoodTerminal(state *runtimeState, providers []codexbar.ParsedFrame) string {
	if state == nil || !state.hasLastGood {
		return ""
	}
	provider := normalizeProviderKey(state.lastGood.Provider)
	for _, parsed := range providers {
		if !parsed.Terminal || normalizeProviderKey(parsed.Provider) != provider {
			continue
		}
		state.lastGood = protocol.Frame{}
		state.lastGoodAt = time.Time{}
		state.hasLastGood = false
		if state.selector != nil {
			state.selector.SetCurrentProvider("")
		}
		return provider
	}
	return ""
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

func timelineStateOrUnknown(state string) string {
	if strings.TrimSpace(state) == "" {
		return "unknown"
	}
	return state
}

// usageTimelineEvent names what the sent frame says about usage. A frame
// without a fresh reading (the last good frame restated, or a retained
// reading) is "stale", so an outage does not read as fresh usage in the
// support timeline. When the collection failed, its error code is the reason.
func usageTimelineEvent(unavailable, restated bool, failureKind, selectionReason string) timeline.Event {
	switch {
	case unavailable && failureKind != "":
		return timeline.Event{Component: "usage", State: "unavailable", Reason: failureKind}
	case unavailable:
		return timeline.Event{Component: "usage", State: "unavailable", Reason: selectionReason}
	case restated:
		return timeline.Event{Component: "usage", State: "stale", Reason: failureKind}
	}
	return timeline.Event{Component: "usage", State: "shown"}
}
