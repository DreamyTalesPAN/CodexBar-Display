package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/timeline"
)

// activityTTL is how long a device may keep showing a frame's activity when no
// further frame arrives (#369). It guards against the writer going away, not
// against routine switching, so it is three frame intervals: two lost frames
// do not flip a working device to idle. The floor keeps one slow cycle on the
// 2s cable cadence from doing that either.
func activityTTL(interval time.Duration, transportName string) time.Duration {
	if interval <= 0 {
		interval = defaultIntervalForTransport(transportName)
	}
	return max(3*interval, 10*time.Second)
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

func sendCycleResult(ctx context.Context, port string, caps protocol.DeviceCapabilities, maxFrameBytes int, state *runtimeState, deps runtimeDeps, result cycleResult) error {
	publicPort := publicDeviceTarget(port)
	if result.usedLastGood {
		result.frame = limitLastGood(result.frame, deps)
	}
	authoritativeFrame := result.frame
	frame := applyUsageBarsPreference(authoritativeFrame.Normalize(), deps.usageBarsShowUsed())
	if !result.usageFresh && result.failureErr == nil {
		// While the computer is too busy for the usage engine, the last good
		// frame does not expire: a screensaver shows the last good provider
		// with its values, and a live theme shows them under SystemBusyLabel
		// (Paul, 2026-10-15, #628). The reset countdown keeps its own limit.
		lastGoodLasts := result.systemBusy
		expiredLastGood := state != nil && state.hasLastGood && !lastGoodLasts && !isLastGoodFreshAt(state.lastGoodAt, deps.now(), providerSnapshotMaxAge())
		// The reading is only retained, so there is nothing new to show.
		// Falling silent would look like a lost writer to the device, which
		// then ends a working state on its own (#369). Restate the last good
		// frame instead, as a failed collection does, with the activity
		// verdict of this cycle. Without a last good frame (the display was
		// just moved to this provider) the retained reading itself goes out,
		// marked as not live below and never stored as last good.
		if state != nil && state.hasLastGood && (!frame.UsageUnavailable || !expiredLastGood) {
			authoritativeFrame = limitLastGood(state.lastGood, deps)
			authoritativeFrame.Activity, authoritativeFrame.Update = result.frame.Activity, result.frame.Update
			if !lastGoodLasts && !isLastGoodFreshAt(state.lastGoodAt, deps.now(), lastGoodMaxAge()) {
				authoritativeFrame.UsageUnavailable = true
			}
			result.resetBasisAt = state.lastGoodAt
			result.usageSource = "last-good"
			result.selectionReason, result.selectionDetail = "usage-waiting", "usage-not-fresh"
			frame = applyUsageBarsPreference(authoritativeFrame.Normalize(), deps.usageBarsShowUsed())
		}
	}
	if result.systemBusy {
		// The values on screen are old because the computer is starved, and
		// VibeTV says so where it names the provider (#606).
		frame.Label = SystemBusyLabel
	}
	frame.V = protocol.NormalizeProtocolVersion(caps.NegotiatedProtocolVersion)
	frame = applyDeviceUsageWindowLimit(frame, caps)
	frame.FooterWindow = ""
	cfg, configLoaded := loadRuntimeConfig(deps)
	if caps.SupportsResetFooterV1 && configLoaded {
		// Pair windows prefix the engine id with the provider. Keep the
		// exact id on the wire; never infer a kind from a label or duration.
		windows := frame.UsageWindows
		if len(windows) == 0 {
			windows = frame.UsageSlots
		}
		for _, window := range windows {
			_, kind, paired := strings.Cut(window.ID, ":")
			if window.ID == cfg.FooterReset || paired && kind == cfg.FooterReset {
				frame.FooterWindow = window.ID
				break
			}
		}
	}
	if !caps.SupportsProviderSlotsV1 {
		// Firmware without provider-slots-v1 would carry these rows as dead
		// wire bytes against its frame budget.
		frame.ProviderSlots = nil
	}
	// CodexBar paced a window against a reading that was fresh; a retained or
	// stale one carries no pace, like the Usage API (Settings "Pace" can also turn it off).
	if !caps.SupportsUsagePaceV1 || !result.usageFresh || configLoaded && cfg.HidePace {
		frame = frame.WithoutUsagePace()
	}
	now := deps.now()
	frame = attachClockFields(frame, now)
	frame = frame.ApplyResetTrust(result.resetBasisAt, now, result.usageFresh)

	if selectedTheme := configuredTheme(state.cliTheme); selectedTheme != "" {
		var applied bool
		frame, applied = applyThemeToFrame(frame, selectedTheme, caps)
		if !applied {
			deps.logf("runtime event=theme-skipped port=%s board=%s requested=%s reason=unsupported\n", publicPort, caps.Board, selectedTheme)
		}
	}
	// ESP8266 firmware only reads these four update fields. Dropping release
	// metadata before every send keeps the JSON document small enough for
	// devices that have just left WiFi setup with a fragmented heap.
	frame.Update = compactFrameUpdate(frame.Update)
	frame.ActivityTTLSec = int64(activityTTL(deps.interval, deps.transportName) / time.Second)

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
	// A mode change can arrive while provider collection is running. Recheck
	// before the only device write so an old transport never sends application
	// data after the new customer choice was committed.
	if connectionModeChanged(deps) {
		return ErrConnectionModeChanged
	}

	sendTarget, authErr := sendTargetWithRuntimeAuth(port, deps)
	if authErr != nil {
		return &RuntimeError{
			Kind: runtimeErrorPairingRequired,
			Op:   "authorize-wifi-frame",
			Err:  authErr,
			Hint: errcode.DefaultRecovery(errcode.RuntimePairingRequired),
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
	releaseDeviceWrite := func() {}
	if deps.beginDeviceWrite != nil {
		if release := deps.beginDeviceWrite(); release != nil {
			releaseDeviceWrite = release
		}
	}
	if cableWriteBlocked(deps) {
		releaseDeviceWrite()
		deps.logf("runtime event=cable-frame-skipped reason=connection-choice-required\n")
		deps.recordEvent(timeline.Event{Component: "stream", DeviceID: caps.DeviceID, State: "paused", Reason: "connection-choice-required"})
		return nil
	}
	sendErr := deps.sendLine(sendTarget, line)
	releaseDeviceWrite()
	if sendErr != nil {
		return &RuntimeError{
			Kind: runtimeErrorSerialWrite,
			Op:   "send-line",
			Err:  sendErr,
			Hint: errcode.DefaultRecovery(errcode.RuntimeSerialWrite),
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	persistActiveWiFiTarget(port, deps)
	// A sent unavailable frame keeps the persisted last-good: that file is the
	// only evidence after a restart that this Mac ever delivered usage, and
	// deleting it turned every restart during a hiccup into the no-providers
	// classification. Loading already marks an expired frame unavailable, and
	// a provider switched off in inventory still clears it deliberately
	// (invalidateLastGoodDisabledByInventory).
	if result.usageFresh && !frame.UsageUnavailable && result.failureErr == nil {
		collectedAt := result.collectedAt
		if collectedAt.IsZero() {
			collectedAt = deps.now()
		}
		updateLastGoodState(state, authoritativeFrame, collectedAt, deps)
	}

	deps.logf("%s", SentFrameLogLine(publicPort, deps.transportName, caps.DeviceID, usageSourceOrDefault(result.usageSource, "unknown"), result.usageFresh, frame, result.selectionReason, result.selectionDetail, result.activityDetail))

	// What the VibeTV now shows. Reported after every frame; the timeline keeps
	// the changes. Every frame has a provider and every hello a firmware, so a
	// missing one (an error frame) is recorded as unknown instead of leaving
	// the last value standing. A frame names a theme only when it carries one.
	// A frame without a fresh reading carries old values: the last good frame
	// restated after a failed collection or while the provider has nothing
	// new, or a retained reading sent because there is no last good (#369).
	restated := !result.usageFresh
	failureKind := string(result.failureKind)
	if restated && failureKind == "" {
		failureKind = "usage-not-fresh"
	}
	usage := usageTimelineEvent(frame.UsageUnavailable || frame.Error != "", restated, failureKind, result.selectionReason)
	events := []timeline.Event{
		{Component: "device", State: "reachable"},
		{Component: "firmware", State: timelineStateOrUnknown(caps.Firmware)},
		{Component: "theme", State: frame.Theme},
		{Component: "provider", State: timelineStateOrUnknown(frame.Provider)},
		usage,
		// The VibeTV took the frame, whatever it says about usage.
		{Component: "stream", State: "sending"},
	}
	for _, event := range events {
		event.DeviceID = caps.DeviceID
		deps.recordEvent(event)
	}

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

// SentFrameLogLine is the one writer of the "sent frame" line. The Companion
// API reads the frame back from it for the preview
// (frameFromDisplayStreamLogLine), so a field missing here is a field the
// preview sees as empty; its test formats lines with this function.
func SentFrameLogLine(port, transport, deviceID, source string, fresh bool, frame protocol.Frame, reason, detail, activityDetail string) string {
	return fmt.Sprintf("sent frame -> %s transport=%s deviceId=%s source=%s fresh=%t usageMode=%s footerWindow=%s provider=%s label=%s session=%d weekly=%d sessionTokens=%d weekTokens=%d totalTokens=%d tokenTotalsKnown=%t usageUnavailable=%t sessionUnavailable=%t weeklyUnavailable=%t reset=%ds usageWindows=%s usageSlots=%s providerSlots=%s activity=%q time=%q date=%q error=%q reason=%s detail=%q activityDetail=%q resetTrust=%s resetTrustSecs=%d resetSource=%q\n",
		port, transport, deviceID, source, fresh, frame.UsageMode, frame.FooterWindow, frame.Provider, frame.Label, frame.Session, frame.Weekly, frame.SessionTokens, frame.WeekTokens, frame.TotalTokens, frame.TokenTotalsKnown, frame.UsageUnavailable, frame.SessionUnavailable, frame.WeeklyUnavailable, frame.ResetSec, usageWindowsLogValue(frame.UsageWindows), usageSlotsLogValue(frame.UsageSlots), usageSlotsLogValue(frame.ProviderSlots), frame.Activity, frame.Time, frame.Date, frame.Error, reason, detail, activityDetail, frame.ResetTrust, frame.ResetTrustSec, frame.ResetSource)
}

func usageSlotsLogValue(slots []protocol.UsageSlot) string {
	if len(slots) == 0 {
		return ""
	}
	raw, err := json.Marshal(slots)
	if err != nil {
		return ""
	}
	return url.QueryEscape(string(raw))
}

func usageWindowsLogValue(windows []protocol.UsageWindow) string {
	if len(windows) == 0 {
		return "-"
	}
	raw, err := json.Marshal(windows)
	if err != nil {
		return "-"
	}
	return url.QueryEscape(string(raw))
}

func attachClockFields(frame protocol.Frame, now time.Time) protocol.Frame {
	if now.IsZero() {
		now = time.Now()
	}
	frame.Time = now.Format("15:04")
	frame.Date = now.Format("02.01.2006")
	frame.NextClockTransition = nextClockTransition(now)
	return frame
}

func nextClockTransition(now time.Time) *protocol.ClockSchedule {
	if now.IsZero() {
		return nil
	}
	location := now.Location()
	if location == nil {
		location = time.Local
	}
	localNow := now.In(location)
	_, currentOffset := localNow.Zone()
	schedule := &protocol.ClockSchedule{CurrentOffsetMinutes: currentOffset / 60}
	nowEpoch := now.UTC().Unix()
	transitionsFound := 0
	for transitionsFound < 2 {
		_, end := localNow.ZoneBounds()
		if end.IsZero() {
			break
		}
		transitionEpoch := end.UTC().Unix()
		if transitionEpoch <= nowEpoch {
			localNow = end.Add(time.Nanosecond).In(location)
			continue
		}
		afterTransition := end.Add(time.Nanosecond).In(location)
		_, nextOffset := afterTransition.Zone()
		if nextOffset == currentOffset {
			localNow = afterTransition
			continue
		}
		if transitionsFound == 0 {
			schedule.TransitionEpoch = transitionEpoch
			schedule.OffsetMinutes = nextOffset / 60
		} else {
			schedule.FollowingTransitionEpoch = transitionEpoch
			schedule.FollowingOffsetMinutes = nextOffset / 60
		}
		currentOffset = nextOffset
		localNow = afterTransition
		transitionsFound++
	}
	return schedule
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

func applyDeviceUsageWindowLimit(frame protocol.Frame, caps protocol.DeviceCapabilities) protocol.Frame {
	if caps.MaxUsageWindows <= 0 || len(frame.UsageWindows) <= caps.MaxUsageWindows {
		return frame
	}
	frame.UsageWindows = append([]protocol.UsageWindow(nil), frame.UsageWindows[:caps.MaxUsageWindows]...)
	return frame.Normalize()
}

func applyUsageBarsPreference(frame protocol.Frame, showUsed bool) protocol.Frame {
	if strings.TrimSpace(frame.Error) != "" {
		return frame
	}

	if showUsed {
		frame.UsageMode = "used"
		return frame
	}
	// The cross-provider rows carry a percentage of their own, which a theme
	// can bind; it has to read the same way as everything else in a frame
	// that says "remaining", also when the shown provider has no usage.
	for i := range frame.ProviderSlots {
		frame.ProviderSlots[i].Percent = 100 - clampPercent(frame.ProviderSlots[i].Percent)
	}
	if frame.UsageUnavailable {
		frame.UsageMode = "remaining"
		return frame
	}

	if len(frame.UsageWindows) == 0 {
		frame.Session = 100 - clampPercent(frame.Session)
		frame.Weekly = 100 - clampPercent(frame.Weekly)
	} else {
		for i := range frame.UsageWindows {
			frame.UsageWindows[i].Percent = 100 - clampPercent(frame.UsageWindows[i].Percent)
		}
		frame = frame.Normalize()
	}
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

func marshalFrameWithinLimit(frame protocol.Frame, maxBytes int) ([]byte, protocol.Frame, error) {
	if maxBytes <= 0 {
		maxBytes = protocol.DefaultMaxFrameBytes
	}

	frame = frame.Normalize()
	line, err := frame.MarshalNormalizedLine()
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
			line, err = candidate.MarshalNormalizedLine()
			if err != nil {
				return nil, protocol.Frame{}, err
			}
			if len(line) <= maxBytes {
				return line, candidate, nil
			}
		}

		noUpdate := frame
		noUpdate.Update = nil
		line, err = noUpdate.MarshalNormalizedLine()
		if err != nil {
			return nil, protocol.Frame{}, err
		}
		if len(line) <= maxBytes {
			return line, noUpdate, nil
		}
		frame = noUpdate
	}

	if frame.Theme != "" {
		noTheme := frame
		noTheme.Theme = ""
		line, err = noTheme.MarshalNormalizedLine()
		if err != nil {
			return nil, protocol.Frame{}, err
		}
		if len(line) <= maxBytes {
			return line, noTheme, nil
		}
		frame = noTheme
	}

	if frame.SessionTokens > 0 || frame.WeekTokens > 0 || frame.TotalTokens > 0 {
		noTokens := frame
		noTokens.SessionTokens = 0
		noTokens.WeekTokens = 0
		noTokens.TotalTokens = 0
		noTokens.TokenTotalsKnown = false
		line, err = noTokens.MarshalNormalizedLine()
		if err != nil {
			return nil, protocol.Frame{}, err
		}
		if len(line) <= maxBytes {
			return line, noTokens, nil
		}
		frame = noTokens
	}

	if frame.Time != "" || frame.Date != "" {
		noClock := frame
		noClock.Time = ""
		noClock.Date = ""
		line, err = noClock.MarshalNormalizedLine()
		if err != nil {
			return nil, protocol.Frame{}, err
		}
		if len(line) <= maxBytes {
			return line, noClock, nil
		}
		frame = noClock
	}

	// Provider rows are an overview extra; the selected provider's own usage
	// windows are the core customer data and must outlive them in the trim.
	if len(frame.ProviderSlots) > 0 {
		for limit := len(frame.ProviderSlots) - 1; limit >= 0; limit-- {
			trimmed := frame
			trimmed.ProviderSlots = append([]protocol.UsageSlot(nil), frame.ProviderSlots[:limit]...)
			normalized := trimmed.Normalize()
			line, err = normalized.MarshalNormalizedLine()
			if err != nil {
				return nil, protocol.Frame{}, err
			}
			if len(line) <= maxBytes {
				return line, normalized, nil
			}
		}
		frame.ProviderSlots = nil
	}

	// Pace only qualifies its window, so the window outlives its pace.
	noPace := frame.WithoutUsagePace()
	line, err = noPace.MarshalNormalizedLine()
	if err != nil {
		return nil, protocol.Frame{}, err
	}
	if len(line) <= maxBytes {
		return line, noPace, nil
	}
	frame = noPace

	usageWindowsActive := len(frame.UsageWindows) > 0
	usageCount := len(frame.UsageWindows)
	if !usageWindowsActive {
		usageCount = len(frame.UsageSlots)
	}
	if usageCount > 0 {
		for limit := usageCount - 1; limit >= 0; limit-- {
			trimmed := frame
			if usageWindowsActive {
				trimmed.UsageWindows = append([]protocol.UsageWindow(nil), frame.UsageWindows[:limit]...)
			} else {
				trimmed.UsageSlots = append([]protocol.UsageSlot(nil), frame.UsageSlots[:limit]...)
			}
			normalized := trimmed.Normalize()
			line, err = normalized.MarshalNormalizedLine()
			if err != nil {
				return nil, protocol.Frame{}, err
			}
			if len(line) <= maxBytes {
				return line, normalized, nil
			}
		}
	}

	fallback := protocol.ErrorFrame(runtimeErrorFrameCode(runtimeErrorFrameTooLarge)).Normalize()
	line, err = fallback.MarshalNormalizedLine()
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

	// Dropping the totals drops the claim with them: leaving the marker set
	// would let the device read the omitted fields as a completed all-zero
	// history and render fabricated zeroes.
	withoutTokens := frame
	withoutTokens.SessionTokens = 0
	withoutTokens.WeekTokens = 0
	withoutTokens.TotalTokens = 0
	withoutTokens.TokenTotalsKnown = false
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
