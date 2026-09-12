import { buildFrameData, type FrameData } from "../live-vibetv-preview";
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
  const unavailable = provider.stale === true || provider.usageUnavailable === true;
  return {
    frame: buildFrameData(undefined, {
      provider: provider.id, label: provider.label,
      session: provider.session, weekly: provider.weekly,
      sessionUnavailable: unavailable || provider.sessionUnavailable,
      weeklyUnavailable: unavailable || provider.weeklyUnavailable,
      resetSecs: unavailable ? undefined : provider.resetSecs,
      usageMode: provider.usageMode,
      usageWindows: unavailable ? [] : provider.windows?.map((window) => ({
        id: window.id, label: window.label, percent: window.usedPercent, resetSecs: window.resetSecs,
      })),
      sessionTokens: provider.sessionTokens, weekTokens: provider.weekTokens,
      totalTokens: provider.totalTokens,
    }),
    providerLabel: provider.label,
    resetLabel: unavailable ? null : formatReset(provider.windows?.[0]?.resetSecs ?? provider.resetSecs),
    windows: provider.windows?.length
      ? provider.windows.map((window) => ({
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
): SetupDisplayModePreview[] {
  const reported = new Map(
    (usage?.providers || []).map((provider) => [provider.id, provider]),
  );
  return providers.map(
    (provider) =>
      displayPreviewFor(reported.get(provider.id)) ?? {
        providerLabel: provider.label,
        resetLabel: null,
        windows: [],
      },
  );
}

export type UsageDisplayMode = "used" | "remaining";

/** Convert only the presentation; the collector's snapshot stays untouched. */
export function previewUsageMode(frame: FrameData, mode: UsageDisplayMode): FrameData {
  if (frame.usageMode === mode) return frame;
  const percent = (value: number) => 100 - Math.max(0, Math.min(100, value));
  return {
    ...frame, usageMode: mode,
    session: percent(frame.session), weekly: percent(frame.weekly),
    usageSlot1Percent: percent(frame.usageSlot1Percent), usageSlot2Percent: percent(frame.usageSlot2Percent),
    usageWindows: frame.usageWindows.map((slot) => ({ ...slot, percent: percent(slot.percent) })),
    providerSlots: frame.providerSlots.map((slot) => ({ ...slot, percent: percent(slot.percent) })),
  };
}
