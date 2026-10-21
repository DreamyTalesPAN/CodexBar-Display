import type { UsageProviderInfo, UsageSnapshot } from "../control-center-types";
import { remainingResetSecs, secondsSince } from "@/lib/reset-countdown";
import { formatReset } from "../usage-screen";
import type { DisplayFrame } from "../live-vibetv-preview";
import type { SetupDisplayModePreview } from "./setup-display-mode-screen";

/** GET /v1/display/preview-frames: the frames the companion builds for the stream, per provider. */
export type PreviewFrames = {
  generatedAt?: string;
  providers?: { id: string; automatic?: DisplayFrame; pinned?: DisplayFrame }[];
};

function providerWindowSlots(provider: UsageProviderInfo) {
  return (provider.windows ?? []).map((window) => ({
    id: window.id,
    label: window.label,
    percent: window.usedPercent,
    resetSecs: window.resetSecs,
  }));
}

function windowSlotsOf(provider: UsageProviderInfo) {
  return provider.windows?.length
    ? providerWindowSlots(provider)
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
): SetupDisplayModePreview | null {
  if (!provider) {
    return null;
  }
  const unavailable = provider.stale === true || provider.usageUnavailable === true;
  return {
    providerLabel: provider.label,
    resetLabel: unavailable
      ? null
      : formatReset(
          remainingResetSecs(
            providerRootResetSecs(provider, windowSlotsOf(provider)),
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
  previewFrames: PreviewFrames | null = null,
): SetupDisplayModePreview[] {
  const reported = new Map(
    (usage?.providers || []).map((provider) => [provider.id, provider]),
  );
  // The frames come from the usage they were read with: without usage they
  // are gone too, so a provider whose reading disappeared cannot keep old values.
  const framed = new Map(
    (usage ? previewFrames?.providers || [] : []).map((entry) => [entry.id, entry]),
  );
  return providers.map((provider) => {
    const preview = displayPreviewFor(reported.get(provider.id)) ?? {
      providerLabel: provider.label,
      resetLabel: null,
      windows: [],
    };
    const entry = framed.get(provider.id);
    // The frames are the companion's, as the host would send them; a provider
    // it built none for stays a placeholder. No Automatic frame means the
    // stream does not rotate to it (rotatingPreviews).
    return entry
      ? {
          ...preview,
          frame: entry.automatic,
          pinnedFrame: entry.pinned,
          frameAt: previewFrames?.generatedAt,
        }
      : preview;
  });
}

/**
 * The previews Automatic rotates over: the stream drops a provider without a
 * current reading while another has one, and the companion then builds it a
 * pinned frame only.
 */
export function rotatingPreviews(previews: SetupDisplayModePreview[]): SetupDisplayModePreview[] {
  return previews.filter((preview) => !preview.pinnedFrame || preview.frame);
}

/** The Manual tile's preview: the frame the host builds with only this provider pinned. */
export function pinnedPreview(preview: SetupDisplayModePreview): SetupDisplayModePreview {
  return { ...preview, frame: preview.pinnedFrame };
}

/**
 * The activity verdict VibeTV was last sent, put on the preview of the provider
 * that frame was for. The daemon decides coding/idle from usage and token deltas
 * after /v1/usage is built, so the device's frame is the only authority; every
 * other provider keeps no verdict (idle), as it would on the device until it is
 * the one being sent.
 */
export function withSentActivity(
  previews: SetupDisplayModePreview[],
  sent: { frame?: DisplayFrame; savedAt?: string } | null | undefined,
): SetupDisplayModePreview[] {
  const provider = sent?.frame?.provider;
  const activity = sent?.frame?.activity;
  if (!provider || !activity) {
    return previews;
  }
  // The verdict carries its TTL and the time VibeTV got it, so the tile can let
  // it run out the way the device does (withActivityExpiry).
  const activityTtlSecs = sent.frame?.activityTtlSecs;
  const withVerdict = (frame?: DisplayFrame) =>
    frame && { ...frame, activity, activityTtlSecs };
  return previews.map((preview) =>
    preview.frame?.provider === provider
      ? {
          ...preview,
          activityAt: sent.savedAt,
          frame: withVerdict(preview.frame),
          pinnedFrame: withVerdict(preview.pinnedFrame),
        }
      : preview,
  );
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
