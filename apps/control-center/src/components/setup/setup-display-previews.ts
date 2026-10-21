import type { UsageSnapshot } from "../control-center-types";
import { remainingResetSecs, secondsSince } from "@/lib/reset-countdown";
import { formatReset } from "../usage-screen";
import type { DisplayFrame } from "../live-vibetv-preview";
import type { SetupDisplayModePreview } from "./setup-display-mode-screen";

/** `previewFrames` of GET /v1/usage?previewFrames=1: the frames the companion builds for the stream, per provider. */
export type PreviewFrames = {
  generatedAt?: string;
  providers?: { id: string; automatic?: DisplayFrame; pinned?: DisplayFrame }[];
};

/** Formats the companion's frame for the plain tile; normalization stays in Go. */
export function displayPreviewFor(
  frame: DisplayFrame | undefined,
  frameAt?: string,
  now = new Date(),
): SetupDisplayModePreview | null {
  if (!frame) {
    return null;
  }
  // An error frame carries no reading: the same no-usage state as the theme tile.
  const unavailable = frame.usageUnavailable === true || Boolean(frame.error);
  const windows = frame.usageWindows?.length ? frame.usageWindows : frame.usageSlots;
  return {
    providerLabel: frame.label || frame.provider || "",
    frame,
    frameAt,
    resetLabel: unavailable || frame.resetTrust === "stale"
      ? null
      : formatReset(
          remainingResetSecs(
            frame.resetSecs,
            frameAt,
            now,
          ),
        ),
    windows: windows?.length
      ? windows.map((window) => ({
          label: window.label ?? "",
          percent: unavailable ? null : window.percent ?? null,
        }))
      : [
          { label: "Session", percent: unavailable || frame.sessionUnavailable ? null : frame.session ?? 0 },
          { label: "Weekly", percent: unavailable || frame.weeklyUnavailable ? null : frame.weekly ?? 0 },
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
  // The frames come from the usage they were read with: without usage they
  // are gone too, so a provider whose reading disappeared cannot keep old values.
  const framed = new Map(
    (usage ? previewFrames?.providers || [] : []).map((entry) => [entry.id, entry]),
  );
  return providers.map((provider) => {
    const entry = framed.get(provider.id);
    const preview = displayPreviewFor(entry?.automatic, previewFrames?.generatedAt) ?? {
      providerLabel: provider.label,
      resetLabel: null,
      windows: [],
    };
    // The frames are the companion's, as the host would send them; a provider
    // it built none for stays a placeholder. No Automatic frame means the
    // stream does not rotate to it (rotatingPreviews).
    return entry
      ? {
          ...preview,
          providerLabel: provider.label,
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
  return {
    ...preview,
    ...(displayPreviewFor(preview.pinnedFrame, preview.frameAt) ?? { resetLabel: null, windows: [] }),
    providerLabel: preview.providerLabel,
    frame: preview.pinnedFrame,
  };
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

/**
 * The usage windows VibeTV shows for a provider: the ones the customer did not
 * hide. Source loss must not bring a hidden window back.
 */
export function visibleUsageWindows<T extends { id: string }>(
  windows: T[],
  hiddenWindowIds: string[] | undefined,
): T[] {
  return windows.filter(
    (window) => !hiddenWindowIds?.includes(window.id),
  );
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
  if (!first.windows.length || !second.windows.length) {
    return first.windows.length ? first : second;
  }
  const unknownReset = formatReset(0);
  const counting = [first, second].find(
    (preview) => preview.resetLabel && preview.resetLabel !== unknownReset,
  );
  // Reuse the two live frames already built for the other cards. Each keeps
  // its first visible window; both countdowns use the first frame's basis.
  const frameAt = first.frameAt;
  const usageWindows = [first, second].flatMap((preview) => {
    const window = preview.frame?.usageWindows?.[0];
    if (!window || !preview.frame?.provider) return [];
    const shift = frameAt && preview.frameAt
      ? (new Date(frameAt).getTime() - new Date(preview.frameAt).getTime()) / 1000
      : 0;
    return [{
      ...window,
      id: `${preview.frame.provider}:${window.id}`,
      label: `${preview.providerLabel} ${window.label}`,
      resetSecs: (window.resetSecs ?? 0) > 0
        ? Math.max(0, (window.resetSecs ?? 0) - shift)
        : 0,
    }];
  });
  const frame: DisplayFrame | undefined = usageWindows.length === 2 ? {
    v: 1,
    provider: `${first.frame!.provider}+${second.frame!.provider}`,
    label: "",
    session: usageWindows[0].percent,
    weekly: usageWindows[1].percent,
    usageWindows,
    usageMode: first.frame!.usageMode,
    providerSlots: first.frame!.providerSlots,
    resetSecs: usageWindows.find((window) => (window.resetSecs ?? 0) > 0)?.resetSecs ?? 0,
    resetSource: first.frame!.resetSource ?? first.frame!.provider,
    resetTrust: [first, second].some((preview) => preview.frame?.resetTrust === "stale")
      ? "stale"
      : first.frame!.resetTrust,
  } : undefined;
  return {
    providerLabel: `${first.providerLabel} + ${second.providerLabel}`,
    ...(frame ? { frame, frameAt } : {}),
    resetLabel: (counting ?? first).resetLabel,
    windows: [first, second].map((preview) => ({
      label: preview.windows[0]
        ? `${preview.providerLabel} ${preview.windows[0].label}`
        : preview.providerLabel,
      percent: preview.windows[0]?.percent ?? null,
    })),
  };
}
