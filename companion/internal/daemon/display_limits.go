package daemon

import (
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

const providerDisplayModePair = "pair"

// applyDisplayLimits shapes the selected frame by the customer's display
// choice: the usage windows they took off VibeTV, the second provider of Two
// at once. It only leaves out or regroups what CodexBar reported; it never
// invents a window or a pace.
func applyDisplayLimits(frame protocol.Frame, providers []codexbar.ParsedFrame, display *runtimeconfig.ProviderDisplayConfig, basisAt time.Time) protocol.Frame {
	if display == nil || frame.UsageUnavailable {
		return frame
	}
	if display.Mode == providerDisplayModePair {
		frame = pairDisplayFrame(frame, providers, display, basisAt)
	} else {
		frame = withVisibleUsageWindows(frame, display)
	}
	return frame
}

// limitLastGood applies the current display choice to a last good frame before
// it is sent in place of a reading. Every such substitution goes through here,
// so a limit hidden since the frame was kept never comes back on a restated one.
func limitLastGood(frame protocol.Frame, deps runtimeDeps) protocol.Frame {
	if cfg, ok := loadRuntimeConfig(deps); ok {
		return limitCachedFrame(frame, cfg.ProviderDisplay)
	}
	return frame
}

// limitCachedFrame applies the current display choice to a frame kept from an
// earlier reading, which VibeTV resends while collection fails. That frame was
// shaped by the choice of its time, so what the customer has hidden since is
// taken out here; what they showed again returns with the next reading. A
// pair with a hidden limit, or a provider with no chosen limit left, cannot
// show the current choice from this frame, so it shows usage as unavailable
// until then instead of the hidden percentages.
func limitCachedFrame(frame protocol.Frame, display *runtimeconfig.ProviderDisplayConfig) protocol.Frame {
	pair := len(frameProviderMembers(frame.Provider)) > 1
	// A pair kept from before the customer left Two at once is no longer
	// their choice; the next reading shows the new one.
	if pair && (display == nil || display.Mode != providerDisplayModePair) {
		return frameWithoutUsage(frame)
	}
	if display == nil {
		return frame
	}
	// A provider row keeps no window ids, so a cached row of a provider that
	// now hides a limit may still hold it. The rows return with the next reading.
	for _, slot := range frame.ProviderSlots {
		if len(display.HiddenWindows[normalizeProviderKey(slot.ID)]) > 0 {
			frame.ProviderSlots = nil
			break
		}
	}
	if pair {
		for _, window := range frame.UsageWindows {
			if pairWindowHidden(window.ID, display) {
				return frameWithoutUsage(frame)
			}
		}
	} else if len(frame.UsageWindows) > 0 {
		visible := 0
		for _, window := range frame.UsageWindows {
			if !display.WindowHidden(frame.Provider, window.ID) {
				visible++
			}
		}
		if visible == 0 {
			return frameWithoutUsage(frame)
		}
		frame = withVisibleUsageWindows(frame, display)
	}
	return frame
}

func frameWithoutUsage(frame protocol.Frame) protocol.Frame {
	frame.UsageUnavailable = true
	frame.SessionUnavailable = true
	frame.WeeklyUnavailable = true
	frame.Session = 0
	frame.Weekly = 0
	frame.ResetSec = 0
	frame.UsageWindows = nil
	frame.UsageSlots = nil
	frame.ProviderSlots = nil
	return frame
}

// pairWindowHidden reports whether a window of a Two at once frame is one the
// customer hid. Its id is "provider:window" cut to the wire limit, so an id cut
// there matches the hidden window it is the start of.
func pairWindowHidden(windowID string, display *runtimeconfig.ProviderDisplayConfig) bool {
	provider, _, ok := strings.Cut(windowID, ":")
	if !ok {
		return false
	}
	cut := len(windowID) >= protocol.DefaultUsageWindowIDBytes
	for _, hidden := range display.HiddenWindows[normalizeProviderKey(provider)] {
		full := provider + ":" + hidden
		if full == windowID || (cut && strings.HasPrefix(full, windowID)) {
			return true
		}
	}
	return false
}

// visibleUsageWindows drops the windows the customer hid for this provider.
// Hiding every window would leave VibeTV blank, so then all of them stay.
func visibleUsageWindows(provider string, windows []protocol.UsageWindow, display *runtimeconfig.ProviderDisplayConfig) []protocol.UsageWindow {
	visible := make([]protocol.UsageWindow, 0, len(windows))
	for _, window := range windows {
		if !display.WindowHidden(provider, window.ID) {
			visible = append(visible, window)
		}
	}
	if len(visible) == 0 {
		return windows
	}
	return visible
}

func withVisibleUsageWindows(frame protocol.Frame, display *runtimeconfig.ProviderDisplayConfig) protocol.Frame {
	visible := visibleUsageWindows(frame.Provider, frame.UsageWindows, display)
	if len(visible) == len(frame.UsageWindows) {
		return frame
	}
	frame.UsageWindows = visible
	frame.UsageSlots = nil
	// The root countdown is now the first visible window's, so the device
	// must not continue the hidden one's deadline under the old name.
	frame.ResetSource = ""
	for _, window := range visible {
		if window.ResetSec > 0 {
			frame.ResetSource = usageWindowResetSource(frame.Provider, window.ID)
			break
		}
	}
	return frame
}

// pairDisplayFrame puts the first visible window of each of the two chosen
// providers into one frame, first provider first, labelled with the provider
// ("Claude Weekly"). Each provider was collected at its own time, so its
// countdown is first expressed as of basisAt, the frame's own basis. When one
// of the two has nothing current to show, VibeTV shows the other the way One
// provider would rather than half a pair. A retained reading counts as
// nothing current: the frame's freshness is the selected provider's, so an old
// percent beside it would pass for a live one.
func pairDisplayFrame(selected protocol.Frame, providers []codexbar.ParsedFrame, display *runtimeconfig.ProviderDisplayConfig, basisAt time.Time) protocol.Frame {
	windows := make([]protocol.UsageWindow, 0, 2)
	ids := make([]string, 0, 2)
	resetSource := ""
	for _, providerID := range display.ProviderIDs {
		provider, ok := parsedProviderByID(providers, providerID)
		if !ok || provider.Stale || provider.Frame.UsageUnavailable {
			continue
		}
		id := normalizeProviderKey(provider.Frame.Provider)
		if id == "" {
			id = normalizeProviderKey(provider.Provider)
		}
		visible := visibleUsageWindows(id, provider.Frame.UsageWindows, display)
		if len(visible) == 0 {
			continue
		}
		window := visible[0]
		if window.ResetSec > 0 && !provider.CollectedAt.IsZero() && !basisAt.IsZero() {
			window.ResetSec -= int64(basisAt.Sub(provider.CollectedAt) / time.Second)
			if window.ResetSec < 0 {
				window.ResetSec = 0
			}
		}
		if resetSource == "" && window.ResetSec > 0 {
			resetSource = usageWindowResetSource(id, window.ID)
		}
		label := strings.TrimSpace(provider.Frame.Label)
		if label == "" {
			label = id
		}
		window.ID = id + ":" + window.ID
		window.Label = label + " " + window.Label
		windows = append(windows, window)
		ids = append(ids, id)
	}
	// The pair is known by its ids joined in Frame.Provider, which the wire cuts
	// to DefaultProviderBytes. Cut, the cached pair would lose its identity, so
	// ids too long to join show the selected provider alone, as above.
	if len(windows) < 2 || len(strings.Join(ids, pairProviderSeparator)) > protocol.DefaultProviderBytes {
		return withVisibleUsageWindows(selected, display)
	}
	if resetSource == "" {
		// Neither limit has a countdown. The pair is still a current reading,
		// so it needs a source the device accepts: the ids joined by "+" are
		// refused, and the frame would be shown as stale.
		resetSource = pairResetSource(ids)
	}
	frame := selected
	frame.Provider = strings.Join(ids, pairProviderSeparator)
	// Each window already names its provider; keep the shared line for notices.
	frame.Label = ""
	frame.UsageWindows = windows
	frame.UsageSlots = nil
	frame.ResetSource = resetSource
	// Token counts belong to one provider; a pair has no honest total.
	frame.SessionTokens = 0
	frame.WeekTokens = 0
	frame.TotalTokens = 0
	frame.TokenTotalsKnown = false
	return frame
}

// pairProviderSeparator joins the two provider ids of a Two at once frame.
// Provider ids never contain it, so the frame cannot pass for either one.
const pairProviderSeparator = "+"

// frameProviderMembers lists the providers a frame shows: its own provider,
// or both members of a Two at once frame ("claude+codex"). Checks that keep
// or drop a frame per provider must look at each member.
func frameProviderMembers(provider string) []string {
	members := []string{}
	for _, member := range strings.Split(normalizeProviderKey(provider), pairProviderSeparator) {
		if member = strings.TrimSpace(member); member != "" {
			members = append(members, member)
		}
	}
	return members
}

// pairResetSource names a pair frame without a countdown: both provider ids
// joined by ".", cut to the 31 characters the device accepts.
func pairResetSource(ids []string) string {
	key := strings.Join(ids, ".")
	if len(key) > 31 {
		key = key[:31]
	}
	return protocol.ResetSourceKey(key, "")
}

// providerDisplayShowsProvider reports whether a frame of this provider is
// one the display choice can show: a chosen provider, or the pair of them.
func providerDisplayShowsProvider(display *runtimeconfig.ProviderDisplayConfig, provider string) bool {
	provider = normalizeProviderKey(provider)
	if display == nil || provider == "" {
		return false
	}
	for _, providerID := range display.ProviderIDs {
		if normalizeProviderKey(providerID) == provider {
			return true
		}
	}
	return display.Mode == providerDisplayModePair &&
		provider == normalizeProviderKey(strings.Join(display.ProviderIDs, pairProviderSeparator))
}

func parsedProviderByID(providers []codexbar.ParsedFrame, providerID string) (codexbar.ParsedFrame, bool) {
	providerID = normalizeProviderKey(providerID)
	for _, provider := range providers {
		if normalizeProviderKey(provider.Frame.Provider) == providerID || normalizeProviderKey(provider.Provider) == providerID {
			return provider, true
		}
	}
	return codexbar.ParsedFrame{}, false
}

// usageWindowResetSource names the countdown of one usage window. A long
// window id is cut to the 31 characters the device accepts; left whole, the
// deadline would count as unattributed and never tick.
func usageWindowResetSource(provider string, window string) string {
	key := normalizeProviderKey(provider) + ":" + normalizeProviderKey(window)
	if len(key) > 31 {
		key = key[:31]
	}
	if source := protocol.ResetSourceKey(key, ""); source != "" {
		return source
	}
	return protocol.ResetSourceKey(provider, "")
}
