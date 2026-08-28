import type { UsageProviderInfo, UsageSnapshot } from "../control-center-types";
import { formatReset } from "../usage-screen";
import type { SetupDisplayModePreview } from "./setup-display-mode-screen";

/**
 * Turns a provider's usage into what the display-mode panel draws.
 *
 * A reading the collector could not take stays null all the way through, so the
 * panel says it is unavailable rather than showing a zero that looks like a
 * measurement.
 */
export function displayPreviewFor(
  provider: UsageProviderInfo | undefined,
): SetupDisplayModePreview | null {
  if (!provider) {
    return null;
  }
  const unavailable = provider.usageUnavailable === true;
  return {
    providerLabel: provider.label,
    resetLabel: unavailable ? null : formatReset(provider.resetSecs),
    sessionPercent:
      unavailable || provider.sessionUnavailable ? null : provider.session,
    weeklyPercent:
      unavailable || provider.weeklyUnavailable ? null : provider.weekly,
  };
}

/**
 * The rotation Automatic moves through: every provider switched on for this
 * Mac, in the order the usage service reports them, so the panel shows the same
 * set the device will.
 */
export function displayPreviewsFor(
  usage: UsageSnapshot | null,
  enabledProviderIds: string[],
): SetupDisplayModePreview[] {
  const enabled = new Set(enabledProviderIds);
  return (usage?.providers || [])
    .filter((provider) => enabled.has(provider.id))
    .map((provider) => displayPreviewFor(provider))
    .filter((preview): preview is SetupDisplayModePreview => preview !== null);
}
