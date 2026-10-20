import type { UsageProviderInfo, UsageSnapshot } from "../control-center-types";
import { remainingResetSecs } from "@/lib/reset-countdown";
import { formatReset } from "../usage-screen";
import type { DisplayFrame } from "../live-vibetv-preview";
import type { SetupDisplayModePreview } from "./setup-display-mode-screen";

function windowSlotsOf(provider: UsageProviderInfo) {
  return provider.windows?.length
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
}

/**
 * The cross-provider rows of the frame, as the host builds them
 * (providerResetSlots in companion/internal/daemon/selection.go): every
 * provider that is neither stale nor unavailable, in the order they are
 * switched on, gives one row with its soonest window reset and the heaviest
 * window's percentage, at most two rows. Each reset is first expressed as of
 * the shown frame's own reading time, because buildFrameData later counts the
 * whole frame down from exactly that instant. Everything is read from what the
 * usage service delivered for each provider; a provider without a reset
 * deadline gets no row, as on the device.
 */
export function providerSlotsFor(
  providers: UsageProviderInfo[],
  basisAt: string | undefined,
): NonNullable<DisplayFrame["providerSlots"]> {
  const basis = basisAt ? new Date(basisAt).getTime() : Number.NaN;
  const rows: NonNullable<DisplayFrame["providerSlots"]> = [];
  for (const provider of providers) {
    if (provider.stale === true || provider.usageUnavailable === true) {
      continue;
    }
    const collected = provider.collectedAt
      ? new Date(provider.collectedAt).getTime()
      : Number.NaN;
    const shift =
      Number.isNaN(basis) || Number.isNaN(collected)
        ? 0
        : Math.floor((basis - collected) / 1000);
    let soonest = 0;
    let percent: number | undefined;
    for (const slot of windowSlotsOf(provider)) {
      if (!Number.isFinite(slot.percent)) {
        continue;
      }
      const reset = (slot.resetSecs ?? 0) > 0 ? (slot.resetSecs ?? 0) - shift : 0;
      if (reset > 0 && (soonest === 0 || reset < soonest)) {
        soonest = reset;
      }
      // Used mode: the heaviest window. Remaining mode: the host takes the
      // heaviest used window and flips it, which is the smallest remaining.
      percent =
        percent === undefined
          ? slot.percent
          : provider.usageMode === "remaining"
            ? Math.min(percent, slot.percent)
            : Math.max(percent, slot.percent);
    }
    if (soonest <= 0 || percent === undefined) {
      continue;
    }
    rows.push({
      id: provider.id,
      label: provider.label,
      percent,
      resetSecs: soonest,
    });
    if (rows.length === 2) {
      break;
    }
  }
  return rows;
}

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
  allProviders: UsageProviderInfo[] = [provider],
): DisplayFrame | null {
  if (provider.stale === true || provider.usageUnavailable === true) {
    return null;
  }
  const slots = windowSlotsOf(provider);
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
    // Cross-provider rows (pv1*/pv2* in a theme), from the complete provider set.
    providerSlots: providerSlotsFor(allProviders, provider.collectedAt),
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
  allProviders?: UsageProviderInfo[],
): SetupDisplayModePreview | null {
  if (!provider) {
    return null;
  }
  const unavailable = provider.stale === true || provider.usageUnavailable === true;
  const frame = displayFrameFor(provider, tokenUsageReady, allProviders);
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
  // The complete set the host builds its provider rows from: the providers
  // switched on, in that order, as far as the usage service has read them.
  const complete = providers
    .map((provider) => reported.get(provider.id))
    .filter((reading): reading is UsageProviderInfo => reading !== undefined);
  return providers.map(
    (provider) =>
      displayPreviewFor(
        reported.get(provider.id),
        new Date(),
        usage?.tokenUsageReady === true,
        complete,
      ) ?? {
        providerLabel: provider.label,
        resetLabel: null,
        windows: [],
      },
  );
}
