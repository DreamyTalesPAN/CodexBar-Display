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
// at once, and the reserve or deficit switch. It only leaves out or regroups
// what CodexBar reported; it never invents a window or a pace.
func applyDisplayLimits(frame protocol.Frame, providers []codexbar.ParsedFrame, display *runtimeconfig.ProviderDisplayConfig, basisAt time.Time) protocol.Frame {
	if display == nil || frame.UsageUnavailable {
		return frame
	}
	if display.Mode == providerDisplayModePair {
		frame = pairDisplayFrame(frame, providers, display, basisAt)
	} else {
		frame = withVisibleUsageWindows(frame, display)
	}
	if display.HidePace {
		frame = frame.WithoutUsagePace()
	}
	return frame
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
// of the two has nothing to show, VibeTV shows the other the way One provider
// would rather than half a pair.
func pairDisplayFrame(selected protocol.Frame, providers []codexbar.ParsedFrame, display *runtimeconfig.ProviderDisplayConfig, basisAt time.Time) protocol.Frame {
	windows := make([]protocol.UsageWindow, 0, 2)
	ids := make([]string, 0, 2)
	labels := make([]string, 0, 2)
	resetSource := ""
	for _, providerID := range display.ProviderIDs {
		provider, ok := parsedProviderByID(providers, providerID)
		if !ok || provider.Frame.UsageUnavailable {
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
		if provider.Stale {
			// A countdown the collector cannot vouch for must not tick.
			window.ResetSec = 0
		} else if window.ResetSec > 0 && !provider.CollectedAt.IsZero() && !basisAt.IsZero() {
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
		labels = append(labels, label)
	}
	if len(windows) < 2 {
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
	frame.Label = strings.Join(labels, " + ")
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
