import type { UsageProviderInfo, UsageSnapshot } from "../control-center-types";
import { remainingResetSecs } from "@/lib/reset-countdown";
import { formatReset } from "../usage-screen";
import type { DisplayFrame } from "../live-vibetv-preview";
import type { SetupDisplayModePreview } from "./setup-display-mode-screen";

/**
 * The frame the theme renderer draws for one provider, built only from what
 * the usage service delivered for it. Nothing is calculated here: percentages,
 * labels, reset times and the used/remaining mode are passed through as read.
 * A window the collector could not read is left out, so the renderer shows it
 * as unavailable instead of as a number; a provider with no readable window has
 * no frame at all and the tile draws a placeholder.
 */
export function displayFrameFor(
  provider: UsageProviderInfo,
  tokenUsageReady = false,
): DisplayFrame | null {
  if (provider.stale === true || provider.usageUnavailable === true) {
    return null;
  }
  const slots = provider.windows?.length
    ? provider.windows.map((window) => ({
        id: window.id,
        label: window.label,
        percent: window.usedPercent,
        resetSecs: window.resetSecs,
      }))
    : [
        provider.sessionUnavailable
          ? null
          : { id: "session", label: "Session", percent: provider.session, resetSecs: provider.resetSecs },
        provider.weeklyUnavailable
          ? null
          : { id: "weekly", label: "Weekly", percent: provider.weekly, resetSecs: undefined },
      ].filter((slot): slot is NonNullable<typeof slot> => slot !== null);
  const readable = slots.filter((slot) => Number.isFinite(slot.percent));
  if (!readable.length) {
    return null;
  }
  return {
    v: 1,
    provider: provider.id,
    label: provider.label,
    session: provider.session,
    weekly: provider.weekly,
    sessionUnavailable: provider.sessionUnavailable === true,
    weeklyUnavailable: provider.weeklyUnavailable === true,
    resetSecs: provider.windows?.[0]?.resetSecs ?? provider.resetSecs,
    usageMode: provider.usageMode,
    usageWindows: readable,
    activity: provider.activity,
    sessionTokens: provider.sessionTokens,
    weekTokens: provider.weekTokens,
    totalTokens: provider.totalTokens,
    // /v1/usage leaves zero token totals out once the token history is read;
    // the snapshot's readiness says those zeros are known (Codex on #821).
    ...(tokenUsageReady ? { tokenTotalsKnown: true } : {}),
  };
}

/**
 * Turns a provider's usage into what the display-mode panel draws.
 *
 * A reading the collector could not take stays null all the way through, so the
 * panel says it is unavailable rather than showing a zero that looks like a
 * measurement.
 */
export function displayPreviewFor(
  provider: UsageProviderInfo | undefined,
  now = new Date(),
  tokenUsageReady = false,
): SetupDisplayModePreview | null {
  if (!provider) {
    return null;
  }
  const unavailable = provider.stale === true || provider.usageUnavailable === true;
  const frame = displayFrameFor(provider, tokenUsageReady);
  return {
    providerLabel: provider.label,
    ...(frame ? { frame, frameAt: provider.collectedAt } : {}),
    resetLabel: unavailable
      ? null
      : formatReset(
          remainingResetSecs(
            provider.windows?.[0]?.resetSecs ?? provider.resetSecs,
            provider.collectedAt,
            now,
          ),
        ),
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
      displayPreviewFor(reported.get(provider.id), new Date(), usage?.tokenUsageReady === true) ?? {
        providerLabel: provider.label,
        resetLabel: null,
        windows: [],
      },
  );
}
