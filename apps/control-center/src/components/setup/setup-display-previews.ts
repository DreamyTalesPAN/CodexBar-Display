import type { UsageProviderInfo, UsageSnapshot } from "../control-center-types";
import { remainingResetSecs, secondsSince } from "@/lib/reset-countdown";
import { formatReset } from "../usage-screen";
import { buildFrameData, hasRenderableUsage, type DisplayFrame, type DisplayFrameSnapshot } from "../live-vibetv-preview";
import type { SetupDisplayModePreview } from "./setup-display-mode-screen";

function providerWindowSlots(provider: UsageProviderInfo, maxUsageWindows = 0) {
  return (provider.windows ?? [])
    .slice(0, maxUsageWindows > 0 ? maxUsageWindows : undefined)
    .map((window) => ({
      id: window.id,
      label: window.label,
      percent: window.usedPercent,
      resetSecs: window.resetSecs,
    }));
}

function windowSlotsOf(provider: UsageProviderInfo, maxUsageWindows = 0) {
  return provider.windows?.length
    ? providerWindowSlots(provider, maxUsageWindows)
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
 * The frame's root resetSecs as Frame.Normalize sets it
 * (applyLegacyUsageProjection): the first window with a deadline, not the first
 * window. A legacy provider's single session slot carries provider.resetSecs.
 */
function rootResetSecs(slots: { resetSecs?: number }[]): number {
  return slots.find((slot) => (slot.resetSecs ?? 0) > 0)?.resetSecs ?? 0;
}

/**
 * The root countdown of a provider's frame. A legacy provider (no windows)
 * carries its only reset in provider.resetSecs, independent of whether its
 * session percentage is readable: a session the collector could not read still
 * leaves the authoritative root deadline in the frame sent to VibeTV, so the
 * tile keeps it too instead of showing "Reset unavailable" (Codex on #821).
 */
function providerRootResetSecs(
  provider: UsageProviderInfo,
  slots: { resetSecs?: number }[],
): number {
  return provider.windows?.length
    ? rootResetSecs(slots)
    : Math.max(0, provider.resetSecs ?? 0);
}

type ProviderRow = NonNullable<DisplayFrame["providerSlots"]>[number];

/**
 * One provider's row from the windows /v1/usage delivered for it: its soonest
 * window reset (shifted by `shift` seconds) and the heaviest window's
 * percentage. Null when no window has a reset ahead or a readable percentage.
 * A legacy provider has no windows, so it gets no row, as on the device.
 */
function providerRowOf(
  provider: { id: string; label: string; usageMode?: string },
  windows: { percent?: number; resetSecs?: number }[],
  shift: number,
): ProviderRow | null {
  let soonest = 0;
  let percent: number | undefined;
  for (const slot of windows) {
    const slotPercent = slot.percent ?? Number.NaN;
    if (!Number.isFinite(slotPercent)) {
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
        ? slotPercent
        : provider.usageMode === "remaining"
          ? Math.min(percent, slotPercent)
          : Math.max(percent, slotPercent);
  }
  if (soonest <= 0 || percent === undefined) {
    return null;
  }
  return { id: provider.id, label: provider.label, percent, resetSecs: soonest };
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
    const row = providerRowOf(provider, providerWindowSlots(provider), shift);
    if (!row) {
      continue;
    }
    rows.push(row);
    if (rows.length === 2) {
      break;
    }
  }
  return rows;
}

/**
 * The freshness fields the host stamps on every frame it sends, mirroring
 * Frame.ApplyResetTrust (companion/internal/protocol/protocol.go).
 *
 * /v1/usage does not deliver resetTrust, resetTrustSecs or resetSource -- the
 * host only computes them when it sends a frame -- so they are derived here the
 * way ApplyResetTrust does for a frame that is fresh (sourceLive) and leaves at
 * the instant its data was read (age 0): the full trust horizon (5 h), the
 * provider key as source (ResetSourceKey with no window; the device only checks
 * that a source exists), and "live" -- with or without a deadline, so an idle
 * account (nothing used, no reset) is a measured idle account, not unavailable.
 * Without a reading time or an attributable source the host marks the frame
 * "stale" and clears every countdown, and so does this.
 */
const RESET_TRUST_HORIZON_SECS = 5 * 3600;

function resetSourceKey(provider: string): string {
  const source = provider.trim().toLowerCase();
  return source.length > 0 && source.length <= 31 && /^[a-z0-9_:.-]+$/.test(source)
    ? source
    : "";
}

/**
 * Mirrors hasResetCountdown / reanchorResetSec: whether any deadline of the
 * frame (root, windows, provider rows) is still ahead after `age` seconds.
 */
function hasCountdown(frame: DisplayFrame, age: number): boolean {
  return [frame, ...(frame.usageWindows ?? []), ...(frame.providerSlots ?? [])].some(
    (carrier) => (carrier.resetSecs ?? 0) > age,
  );
}

/**
 * Classifies a frame's countdowns as of `now`, exported so a tile re-runs it on
 * every clock tick: the device does this each time it draws, so an expired
 * deadline or an expired trust horizon turns the frame stale while the screen
 * is open. A frame that is already stale stays stale (its deadlines are gone,
 * so there is nothing left that could make it live again).
 */
export function withResetTrust(
  frame: DisplayFrame,
  collectedAt: string | undefined,
  now: Date,
): DisplayFrame {
  if (frame.resetTrust === "stale") {
    return frame;
  }
  const basisKnown = Boolean(collectedAt) && !Number.isNaN(new Date(collectedAt!).getTime());
  const source = frame.resetSource ?? resetSourceKey(frame.provider ?? "");
  // ApplyResetTrust: a countdown that was positive when read and has run out by
  // the time the frame leaves turns the frame stale -- "Reset unavailable" on
  // the device -- instead of a measured idle account (`hadCountdown`).
  const age = secondsSince(collectedAt, now);
  const ranOut = hasCountdown(frame, 0) && !hasCountdown(frame, age);
  // Synthetic frames start with the host's 5 h horizon; a sent frame already
  // carries its remaining budget and must never receive a fresh one here.
  const trustBudget = frame.resetTrustSecs ?? RESET_TRUST_HORIZON_SECS;
  const trustExpired = age >= trustBudget;
  if (!basisKnown || !source || ranOut || trustExpired) {
    return {
      ...frame,
      resetSecs: 0,
      usageWindows: frame.usageWindows?.map((window) => ({ ...window, resetSecs: 0 })),
      providerSlots: frame.providerSlots?.map((slot) => ({ ...slot, resetSecs: 0 })),
      resetTrust: "stale",
      resetTrustSecs: 0,
      resetSource: source,
    };
  }
  return {
    ...frame,
    resetTrust: frame.resetTrust ?? "live",
    resetTrustSecs: trustBudget,
    resetSource: source,
  };
}

/**
 * The frame the theme renderer draws for one provider, built only from what
 * the usage service delivered for it. Retained windows are projected as in
 * Frame.Normalize; percentages, labels and the used/remaining mode stay as read.
 * A window the collector could not read is left out, so the renderer shows it
 * as unavailable instead of as a number; a provider with no readable window has
 * no frame at all and the tile draws a placeholder.
 */
export function displayFrameFor(
  provider: UsageProviderInfo,
  allProviders: UsageProviderInfo[] = [provider],
  now = new Date(),
  maxUsageWindows = 0,
): DisplayFrame | null {
  if (provider.stale === true || provider.usageUnavailable === true) {
    return null;
  }
  const slots = windowSlotsOf(provider, maxUsageWindows);
  // The same advertised capability used by applyDeviceUsageWindowLimit,
  // before the root reset is projected from the retained windows.
  const readable = slots.filter((slot) => Number.isFinite(slot.percent));
  if (!readable.length) {
    return null;
  }
  // Frame.Normalize projects named lanes from the retained windows; only a
  // frame with neither structural lane uses the first two windows by position.
  let session = readable.find((slot) => slot.id === "session")
    ?? readable.find((slot) => slot.id === "primary");
  let weekly = readable.find((slot) => slot.id === "weekly")
    ?? readable.find((slot) => slot.id === "secondary");
  if (!session && !weekly) {
    [session, weekly] = readable;
  }
  return withResetTrust({
    v: 1,
    provider: provider.id,
    label: provider.label,
    session: provider.windows?.length ? session?.percent ?? 0 : provider.session,
    weekly: provider.windows?.length ? weekly?.percent ?? 0 : provider.weekly,
    sessionUnavailable: provider.windows?.length ? !session : provider.sessionUnavailable === true,
    weeklyUnavailable: provider.windows?.length ? !weekly : provider.weeklyUnavailable === true,
    resetSecs: providerRootResetSecs(provider, readable),
    usageMode: provider.usageMode,
    // A legacy provider has no windows: the frame keeps only its root session
    // and weekly, and no window slot is invented for them (Codex on #821).
    usageWindows: provider.windows?.length ? readable : [],
    // Cross-provider rows (pv1*/pv2* in a theme), from the complete provider set.
    providerSlots: providerSlotsFor(allProviders, provider.collectedAt),
    // No activity here: /v1/usage's provider.activity is the collector snapshot
    // from before the daemon applies its verdict. The verdict is the one in the
    // frame last sent to the device (withSentActivity).
    sessionTokens: provider.sessionTokens,
    weekTokens: provider.weekTokens,
    totalTokens: provider.totalTokens,
    // Completed token history can still be unavailable. Only reported counts
    // establish known totals; global tokenUsageReady is not a measurement.
    tokenTotalsKnown: [provider.sessionTokens, provider.weekTokens, provider.totalTokens]
      .some((count) => count !== undefined),
  }, provider.collectedAt, now);
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
  allProviders?: UsageProviderInfo[],
  maxUsageWindows = 0,
): SetupDisplayModePreview | null {
  if (!provider) {
    return null;
  }
  const unavailable = provider.stale === true || provider.usageUnavailable === true;
  const frame = displayFrameFor(provider, allProviders, now, maxUsageWindows);
  return {
    providerId: provider.id,
    providerLabel: provider.label,
    ...(frame ? { frame, frameAt: provider.collectedAt } : {}),
    // Fixed selection builds its own row before send.go caps usage windows,
    // including a provider outside Automatic's two cross-provider rows.
    pinnedFrame: displayFrameFor(provider, [provider], now, maxUsageWindows) ?? undefined,
    resetLabel: unavailable
      ? null
      : formatReset(
          remainingResetSecs(
            providerRootResetSecs(provider, windowSlotsOf(provider, maxUsageWindows)),
            provider.collectedAt,
            now,
          ),
        ),
    windows: provider.windows?.length
      ? providerWindowSlots(provider, maxUsageWindows).map((window) => ({
          label: window.label,
          percent: unavailable ? null : window.percent,
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
  maxUsageWindows = 0,
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
        complete,
        maxUsageWindows,
      ) ?? {
        providerId: provider.id,
        providerLabel: provider.label,
        resetLabel: null,
        windows: [],
      },
  );
}

/**
 * The Manual tile uses the same frame builder with fixed provider selection,
 * before the window cap and reset trust. Only the sent activity is overlaid
 * afterwards, as it is for Automatic.
 */
export function pinnedPreview(preview: SetupDisplayModePreview): SetupDisplayModePreview {
  const frame = preview.pinnedFrame;
  if (!frame) {
    return preview;
  }
  return {
    ...preview,
    frame: {
      ...frame,
      activity: preview.frame?.activity,
      activityTtlSecs: preview.frame?.activityTtlSecs,
    },
  };
}

/**
 * The activity verdict VibeTV was last sent, put on the preview of the provider
 * that frame was for. The daemon decides coding/idle from usage and token deltas
 * after /v1/usage is built, so the device's frame is the only authority; every
 * other provider keeps no verdict (idle), as it would on the device until it is
 * the one being sent. If collection cannot supply a frame, reuse the matching
 * verified sent frame, as the host restates lastGood during a transient failure.
 */
export function withSentActivity(
  previews: SetupDisplayModePreview[],
  sent: DisplayFrameSnapshot | null | undefined,
): SetupDisplayModePreview[] {
  const provider = sent?.frame?.provider;
  const activity = sent?.frame?.activity;
  if (!provider) {
    return previews;
  }
  // The verdict carries its TTL and the time VibeTV got it, so the tile can let
  // it run out the way the device does (withActivityExpiry).
  const activityTtlSecs = sent.frame?.activityTtlSecs;
  return previews.map((preview) => {
    if (!preview.frame && preview.providerId === provider && sent.savedAt && hasRenderableUsage(sent)) {
      const now = new Date();
      const data = buildFrameData(sent.savedAt, withResetTrust(sent.frame, sent.savedAt, now), now);
      return {
        ...preview,
        frame: sent.frame,
        frameAt: sent.savedAt,
        activityAt: sent.savedAt,
        resetLabel: formatReset(data.resetSecs),
        windows: data.usageWindows.length ? data.usageWindows.map(({ label, percent }) => ({ label, percent })) : [
          { label: "Session", percent: data.sessionUnavailable ? null : sent.frame.session ?? null },
          { label: "Weekly", percent: data.weeklyUnavailable ? null : sent.frame.weekly ?? null },
        ],
      };
    }
    return preview.frame?.provider === provider && activity
      ? { ...preview, activityAt: sent.savedAt, frame: { ...preview.frame, activity, activityTtlSecs } }
      : preview;
  });
}

/**
 * Mirrors the device (#369): past `activityTtlSecs` without a fresh frame,
 * counted from receipt, VibeTV shows idle on its own. Zero or absent: no expiry.
 */
export function withActivityExpiry(
  frame: DisplayFrame,
  activityAt: string | undefined,
  now: Date,
): DisplayFrame {
  const ttl = frame.activityTtlSecs ?? 0;
  if (!frame.activity || frame.activity === "idle" || ttl <= 0 || !activityAt) {
    return frame;
  }
  return secondsSince(activityAt, now) >= ttl ? { ...frame, activity: "idle" } : frame;
}
