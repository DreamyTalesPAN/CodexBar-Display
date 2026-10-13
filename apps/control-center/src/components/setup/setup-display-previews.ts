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
  hiddenWindowIds?: string[],
): SetupDisplayModePreview | null {
  if (!provider) {
    return null;
  }
  const unavailable = provider.stale === true || provider.usageUnavailable === true;
  const windows = visibleUsageWindows(provider.windows ?? [], hiddenWindowIds);
  return {
    providerLabel: provider.label,
    resetLabel: unavailable ? null : formatReset(windows[0]?.resetSecs ?? provider.resetSecs),
    windows: windows.length
      ? windows.map((window) => ({
          label: window.label,
          percent: unavailable ? null : window.usedPercent,
        }))
      : [
          { label: "Session", percent: unavailable || provider.sessionUnavailable ? null : provider.session },
          { label: "Weekly", percent: unavailable || provider.weeklyUnavailable ? null : provider.weekly },
        ],
  };
}

/**
 * The rotation Automatic moves through: one frame per provider switched on for
 * this Mac, in that order, so the panel shows the same set the device will.
 *
 * A provider the usage service has not reported yet keeps its place and stays
 * visibly unavailable. Dropping it instead shrank the rotation to whatever had
 * already been read -- on a Mac where that was one provider, Automatic held
 * still and looked exactly like Manual.
 */
export function displayPreviewsFor(
  usage: UsageSnapshot | null,
  providers: { id: string; label: string }[],
  hiddenWindows?: Record<string, string[]>,
): SetupDisplayModePreview[] {
  const reported = new Map(
    (usage?.providers || []).map((provider) => [provider.id, provider]),
  );
  return providers.map(
    (provider) =>
      displayPreviewFor(reported.get(provider.id), hiddenWindows?.[provider.id]) ?? {
        providerLabel: provider.label,
        resetLabel: null,
        windows: [],
      },
  );
}

/**
 * The usage windows VibeTV shows for a provider: the ones the customer did not
 * hide. With every one hidden all of them stay, as the companion does, so the
 * panel never goes blank.
 */
export function visibleUsageWindows<T extends { id: string }>(
  windows: T[],
  hiddenWindowIds: string[] | undefined,
): T[] {
  const visible = windows.filter(
    (window) => !hiddenWindowIds?.includes(window.id),
  );
  return visible.length ? visible : windows;
}

/**
 * Two at once on the panel: each provider's first shown limit, named after its
 * provider, the way the companion sends the pair to VibeTV. Like the
 * companion it counts down with the first of the two that has a reset time.
 */
export function pairDisplayPreview(
  first: SetupDisplayModePreview | undefined,
  second: SetupDisplayModePreview | undefined,
): SetupDisplayModePreview | null {
  if (!first || !second) {
    return null;
  }
  const unknownReset = formatReset(undefined);
  const counting = [first, second].find(
    (preview) => preview.resetLabel && preview.resetLabel !== unknownReset,
  );
  return {
    providerLabel: `${first.providerLabel} + ${second.providerLabel}`,
    resetLabel: (counting ?? first).resetLabel,
    windows: [first, second].map((preview) => ({
      label: preview.windows[0]
        ? `${preview.providerLabel} ${preview.windows[0].label}`
        : preview.providerLabel,
      percent: preview.windows[0]?.percent ?? null,
    })),
  };
}
