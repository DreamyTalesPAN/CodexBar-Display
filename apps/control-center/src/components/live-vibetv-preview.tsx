"use client";

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import Image from "next/image";
import type { ReactNode } from "react";
import type { DeviceInfo, UsageSnapshot } from "./control-center-types";
import {
  deviceAwaitsProviderSetup,
  deviceIsActive,
  deviceIsCustomerConnected,
  deviceIsReady,
  deviceIsWaitingForUsage,
  deviceUsesCable,
} from "./control-center-types";
import {
  companionRequestUrl,
  needsLoopbackTargetAddressSpace,
  normalizeThemeSpecHash,
  themeRenderPackUrl,
} from "./control-center-runtime";
import { loadLocalThemeRenderPack } from "@/lib/local-theme-render-pack";
import { importThemeSpec, themeStudioSpecUsageLimitCount } from "@/lib/theme-studio";
import {
  formatResetCountdown,
  remainingResetSecs,
  secondsSince,
} from "@/lib/reset-countdown";

type LiveVibeTVPreviewProps = {
  device: DeviceInfo | null;
  displayFrame: DisplayFrameSnapshot | null;
  onPreviewReady?: () => void;
  /** Called once the screen no longer reads "Loading preview" (its theme pack is in, or failed). */
  onScreenSettled?: () => void;
  /** The screen went (back) to "Loading preview"; it is not settled any more. */
  onScreenLoading?: () => void;
  /** Render only the real display output when a 3D case provides the housing. */
  screenOnly?: boolean;
  updateOwnedDisconnect?: boolean;
  usage: UsageSnapshot | null;
};

const PREVIEW_HANDOVER_MS = 3000;

export type ThemePackAsset = {
  contentType: string;
  data: string;
  encoding: "base64" | "text";
};

export type ThemeRenderPack = {
  ok?: boolean;
  themeId?: string;
  name?: string;
  spec?: ThemeSpec;
  specHash?: string;
  specPath?: string;
  assets?: Record<string, ThemePackAsset>;
};

type ThemePackState = {
  themeId: string;
  themeSpecHash: string;
  themeSpecPath: string;
  pack: ThemeRenderPack | null;
  status: "ready" | "error" | "unsupported";
};

export type DisplayFrameSnapshot = {
  deviceId?: string;
  ok?: boolean;
  savedAt?: string;
  frame?: DisplayFrame;
};

type UsageSlotFrame = {
  id?: string;
  label?: string;
  percent?: number;
  resetSecs?: number;
  pace?: UsagePaceFrame;
};
// CodexBar's pace for a usage window, as the Companion sends it (usage-pace-v1).
type UsagePaceFrame = { delta?: number; state?: string; lasts?: boolean };
type UsageWindowFrame = UsageSlotFrame;

export type DisplayFrame = {
  footerWindow?: string;
  v?: number;
  provider?: string;
  label?: string;
  session?: number;
  weekly?: number;
  usageUnavailable?: boolean;
  sessionUnavailable?: boolean;
  weeklyUnavailable?: boolean;
  resetSecs?: number;
  resetTrust?: string;
  resetTrustSecs?: number;
  resetSource?: string;
  usageMode?: string;
  usageWindows?: UsageWindowFrame[];
  usageSlots?: UsageSlotFrame[];
  providerSlots?: UsageSlotFrame[];
  activity?: string;
  /** How long VibeTV keeps showing `activity` without a fresh frame; 0 or absent: no expiry. */
  activityTtlSecs?: number;
  sessionTokens?: number;
  weekTokens?: number;
  totalTokens?: number;
  tokenTotalsKnown?: boolean;
  /** An error frame: the device draws its error surface instead of the theme. */
  error?: string;
};

type LocalDisplayFrameRequestInit = RequestInit & {
  targetAddressSpace?: "loopback";
};

export type ThemeSpec = {
  id?: string;
  themeId?: string;
  bg?: string;
  bgColor?: string;
  p?: ThemePrimitive[];
  primitives?: ThemePrimitive[];
};

export type ThemePrimitive = {
  type?: string;
  t?: string;
  x?: number;
  y?: number;
  width?: number;
  w?: number;
  height?: number;
  h?: number;
  slot?: number;
  sl?: number;
  providerSlot?: number;
  pl?: number;
  usageIndex?: number;
  ui?: number;
  text?: string;
  v?: string;
  binding?: string;
  b?: string;
  fontSize?: number;
  s?: number;
  font?: number;
  f?: number;
  fit?: string;
  ft?: string;
  color?: string;
  c?: string;
  bgColor?: string;
  bg?: string;
  borderColor?: string;
  bc?: string;
  borderRadius?: number;
  br?: number;
  reserveColor?: string;
  rc?: string;
  deficitColor?: string;
  dc?: string;
  align?: string;
  al?: string;
  valign?: string;
  va?: string;
  maxWidth?: number;
  mw?: number;
  progressStyle?: string;
  ps?: string;
  segments?: number;
  sg?: number;
  segmentGap?: number;
  gg?: number;
  arcStart?: number;
  as?: number;
  arcSweep?: number;
  aw?: number;
  arcThickness?: number;
  at?: number;
  colorStops?: Array<{ gte?: number; color?: string; c?: string }>;
  cs?: Array<{ gte?: number; color?: string; c?: string }>;
  assetPath?: string;
  a?: string;
  stateAssets?: Record<string, string>;
  sa?: Record<string, string>;
  providerAssets?: Record<string, string>;
  pa?: Record<string, string>;
  data?: string;
  d?: string;
  r?: string[];
  p?: string[];
};

export type FrameData = {
  footerWindow?: string;
  resetBasisTrusted?: boolean;
  provider: string;
  label: string;
  session: number;
  weekly: number;
  sessionUnavailable: boolean;
  weeklyUnavailable: boolean;
  resetSecs: number;
  usageMode: string;
  usageWindows: Array<{
    id?: string;
    label: string;
    percent: number;
    resetSecs: number;
    available: boolean;
    idle: boolean;
    pace?: UsagePaceFrame;
  }>;
  usageSlot1Label: string;
  usageSlot1Percent: number;
  usageSlot1ResetSecs: number;
  usageSlot1Available: boolean;
  usageSlot1Idle: boolean;
  usageSlot2Label: string;
  usageSlot2Percent: number;
  usageSlot2ResetSecs: number;
  usageSlot2Available: boolean;
  usageSlot2Idle: boolean;
  providerSlots: Array<{
    label: string;
    percent: number;
    resetSecs: number;
    available: boolean;
    idle: boolean;
  }>;
  activity: string;
  sessionTokens: number;
  weekTokens: number;
  totalTokens: number;
  // Mirrors the firmware: token totals absent from the frame render as "--".
  hasTokenTotals: boolean;
  // The notice VibeTV shows in place of the provider name ("Update available"); the
  // device decides on it, so only a caller that knows one sets it.
  updateNotice?: string;
  time: string;
  date: string;
};

// The label of a catalog preview is the provider the customer actually shows,
// taken from the live frame (PreviewFrameProvider); without one there is no
// provider to name, so the sample carries none.
// Catalog previews deliberately use short, generic usage windows. They are not
// connected to the current provider or VibeTV frame, so labels must not imply
// a provider-specific entitlement such as "Codex Spark Weekly".
export const THEME_CATALOG_PREVIEW_FRAME: FrameData = {
  provider: "",
  label: "",
  session: 64,
  weekly: 28,
  sessionUnavailable: false,
  weeklyUnavailable: false,
  resetSecs: 3600,
  usageMode: "used",
  usageWindows: [
    {
      label: "Session",
      percent: 64,
      resetSecs: 3600,
      available: true,
      idle: false,
      pace: { delta: -12, state: "reserve", lasts: true },
    },
    {
      label: "Weekly",
      percent: 28,
      resetSecs: 7200,
      available: true,
      idle: false,
      pace: { delta: 8, state: "deficit", lasts: false },
    },
  ],
  usageSlot1Label: "Session",
  usageSlot1Percent: 64,
  usageSlot1ResetSecs: 3600,
  usageSlot1Available: true,
  usageSlot1Idle: false,
  usageSlot2Label: "Weekly",
  usageSlot2Percent: 28,
  usageSlot2ResetSecs: 7200,
  usageSlot2Available: true,
  usageSlot2Idle: false,
  providerSlots: [
    { label: "Claude", percent: 64, resetSecs: 3600, available: true, idle: false },
    { label: "Codex", percent: 28, resetSecs: 12000, available: true, idle: false },
  ],
  activity: "preview",
  sessionTokens: 1_400_000,
  weekTokens: 384_000_000,
  totalTokens: 1_070_000_000,
  hasTokenTotals: true,
  time: "12:00",
  date: "03.07.2026",
};

const DEVICE_THEME_ALIASES: Record<string, string> = {
  claude: "claude-creature",
  "claude-creature": "claude-creature",
  clippy: "clippy",
  cozy: "cozy-meadow",
  "cozy-meadow": "cozy-meadow",
  mini: "mini-classic",
  "mini-classic": "mini-classic",
  synth: "synthwave",
  synthwave: "synthwave",
};

type DecodedSprite = {
  width: number;
  height: number;
  fps: number;
  frames: Array<Array<SpriteRect>>;
};

type SpriteRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
};

// The last frame seen and the VibeTV it came from, so a screen that mounts
// again (tab switch) starts with it instead of an empty preview. It is only
// reused for the same VibeTV: another one must never show the old screen.
let lastDisplayFrame: { device: string; frame: DisplayFrameSnapshot | null } | null =
  null;

const DISPLAY_FRAME_POLL_MS = 1000;
const DISPLAY_FRAME_TIMEOUT_MS = 5000;

/**
 * Polls the frame VibeTV shows, once a second while connected. Call it only in
 * the screens that draw the preview: every answer re-renders the caller.
 * One request at a time, each bounded; paused while the window is hidden.
 */
export function useLatestDisplayFrame(connected: boolean, device = "") {
  const [displayFrame, setDisplayFrame] = useState<DisplayFrameSnapshot | null>(
    () => (connected && lastDisplayFrame?.device === device ? lastDisplayFrame.frame : null),
  );

  useEffect(() => {
    let resetTimer = 0;
    if (!connected || lastDisplayFrame?.device !== device) {
      lastDisplayFrame = null;
      resetTimer = window.setTimeout(() => setDisplayFrame(null), 0);
      if (!connected) {
        return () => window.clearTimeout(resetTimer);
      }
    }

    let stopped = false;
    let request: AbortController | null = null;

    const refreshDisplayFrame = async () => {
      if (request || document.hidden) {
        return;
      }
      const current = new AbortController();
      request = current;
      const timeout = window.setTimeout(
        () => current.abort(),
        DISPLAY_FRAME_TIMEOUT_MS,
      );
      try {
        const requestInit: LocalDisplayFrameRequestInit = {
          cache: "no-store",
          signal: current.signal,
        };
        const url = companionRequestUrl("/v1/display-frame/latest");
        if (needsLoopbackTargetAddressSpace(url)) {
          requestInit.targetAddressSpace = "loopback";
        }
        const response = await fetch(url, requestInit);
        const nextFrame = await parseLatestDisplayFrameResponse(response);
        if (!stopped) {
          lastDisplayFrame = { device, frame: nextFrame };
          setDisplayFrame(nextFrame);
        }
      } catch {
        // A failed or timed-out poll keeps the last frame; the next tick retries.
      } finally {
        window.clearTimeout(timeout);
        request = null;
      }
    };

    const refreshWhenVisible = () => {
      if (!document.hidden) {
        void refreshDisplayFrame();
      }
    };

    void refreshDisplayFrame();
    const timer = window.setInterval(refreshDisplayFrame, DISPLAY_FRAME_POLL_MS);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      stopped = true;
      window.clearTimeout(resetTimer);
      request?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [connected, device]);

  return displayFrame;
}

/** Renders `children` with the latest frame; only this subtree re-renders per poll. */
export function WithLatestDisplayFrame({
  active,
  device,
  children,
}: {
  active: boolean;
  /** Identity of the selected VibeTV; a cached frame is only reused for it. */
  device: string;
  children: (displayFrame: DisplayFrameSnapshot | null) => ReactNode;
}) {
  return children(useLatestDisplayFrame(active, device));
}

export async function parseLatestDisplayFrameResponse(
  response: Response,
): Promise<DisplayFrameSnapshot | null> {
  if (response.ok) {
    return (await response.json()) as DisplayFrameSnapshot;
  }
  if (response.status === 404) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: unknown };
    } | null;
    if (payload?.error?.code === "display_frame_unavailable") {
      return null;
    }
  }
  throw new Error("display frame unavailable");
}

export function LiveVibeTVPreview({
  device,
  displayFrame,
  onPreviewReady,
  onScreenSettled,
  onScreenLoading,
  screenOnly = false,
  updateOwnedDisconnect = false,
  usage,
}: LiveVibeTVPreviewProps) {
  const themeId = activeThemeId(device);
  const themeSpecPath = device?.display?.themeSpec?.path || "";
  const themeSpecHash = normalizeThemeSpecHash(
    device?.display?.themeSpec?.hash,
  );
  const deviceConnected = Boolean(
    deviceIsCustomerConnected(device) ||
      (deviceIsActive(device) &&
        device?.paired !== false &&
        // A missing USB device cannot be kept live by its last cached image.
        !(deviceUsesCable(device) &&
          device?.stream?.errorCode === "device_not_found") &&
        // Approved behavior (2026-08-03): temporary failures keep the last
        // verified preview visible while the device reconnects. But a cached
        // frame is not a live connection forever: once the companion reports
        // the device disconnected AND the frame has aged past the reconnect
        // grace window, the preview goes offline instead of replaying stale
        // usage as if it were live.
        (device?.connected !== false ||
          frameFreshForReconnect(displayFrame)) &&
        hasRenderableUsage(displayFrame)),
  );
  const deviceReady = deviceIsReady(device);
  const awaitingProviderSetup = deviceAwaitsProviderSetup(device);
  const waitingForUsage = deviceIsWaitingForUsage(device);
  const effectiveDisplayFrame = livePreviewDisplayFrame(device, displayFrame);
  const frame = hasRenderableUsage(effectiveDisplayFrame)
    ? buildFrameData(
        effectiveDisplayFrame?.savedAt || usage?.generatedAt,
        effectiveDisplayFrame.frame,
        new Date(),
      )
    : null;
  const [packState, setPackState] = useState<ThemePackState | null>(null);
  const [packRetryNonce, setPackRetryNonce] = useState(0);
  const pack =
    packState?.themeId === themeId &&
    packState.themeSpecHash === themeSpecHash &&
    packState.themeSpecPath === themeSpecPath
      ? packState.pack
      : null;
  const packStatus: "idle" | "loading" | ThemePackState["status"] = !themeId
    ? "idle"
    : packState?.themeId === themeId &&
        packState.themeSpecHash === themeSpecHash &&
        packState.themeSpecPath === themeSpecPath
      ? packState.status
      : "loading";

  useEffect(() => {
    if (!themeId) {
      return;
    }

    const localPack = loadLocalThemeRenderPack(themeId, themeSpecPath);
    if (
      localPack &&
      (!themeSpecHash || localPack.specHash === themeSpecHash)
    ) {
      const timer = window.setTimeout(() => {
        setPackState({
          themeId,
          themeSpecHash,
          themeSpecPath,
          pack: localPack,
          status: "ready",
        });
      }, 0);
      return () => window.clearTimeout(timer);
    }

    const controller = new AbortController();
    let retryTimer: number | undefined;
    // The pack fetch must never park in a terminal error state: the Companion
    // may still be starting, the pack cache may still be building, or the
    // device may be mid theme-update. A connected Overview showing a permanent
    // "PREVIEW UNAVAILABLE" is the customer bug from 2026-08-06 - keep
    // retrying until the pack matches the active revision.
    const scheduleRetry = () => {
      retryTimer = window.setTimeout(() => {
        setPackRetryNonce((nonce) => nonce + 1);
      }, THEME_PACK_RETRY_MS);
    };
    fetchThemeRenderPackRevision(
      themeId,
      themeSpecPath,
      themeSpecHash,
      controller.signal,
    )
      .then((payload) => {
        const matchesActiveRevision = themeRenderPackMatchesActiveRevision(
          payload,
          themeSpecPath,
          themeSpecHash,
        );
        setPackState({
          themeId,
          themeSpecHash,
          themeSpecPath,
          pack: matchesActiveRevision ? payload : null,
          status: matchesActiveRevision ? "ready" : "error",
        });
        if (!matchesActiveRevision) {
          scheduleRetry();
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        setPackState({
          themeId,
          themeSpecHash,
          themeSpecPath,
          pack: null,
          // No pack for this theme at all: a dev theme, or one installed by a
          // newer app. Still retried, a cache being built answers the same.
          status: error instanceof ThemeUnsupportedError ? "unsupported" : "error",
        });
        scheduleRetry();
      });

    return () => {
      controller.abort();
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [themeId, themeSpecHash, themeSpecPath, packRetryNonce]);

  // What VibeTV itself reports: the theme drawn and real usage arriving.
  const deviceShowsTheme = Boolean(
    deviceIsCustomerConnected(device) &&
      deviceReady &&
      !updateOwnedDisconnect &&
      device?.display?.themeSpec?.renderOk === true &&
      frame,
  );
  const previewReady =
    deviceShowsTheme && Boolean(pack?.spec || packStatus === "unsupported");
  useEffect(() => {
    if (!previewReady || !onPreviewReady) {
      return;
    }
    const timer = window.setTimeout(onPreviewReady, PREVIEW_HANDOVER_MS);
    return () => window.clearTimeout(timer);
  }, [
    onPreviewReady,
    previewReady,
    device?.deviceId,
    device?.target,
    themeId,
    themeSpecHash,
    themeSpecPath,
  ]);

  // Whether the screen below is the "Loading preview" placeholder.
  const showsPackLoading =
    packStatus === "loading" &&
    !updateOwnedDisconnect &&
    deviceConnected &&
    !(pack?.spec && frame) &&
    (frame ||
      (!awaitingProviderSetup && deviceReady && !waitingForUsage));
  useEffect(() => {
    if (showsPackLoading) {
      onScreenLoading?.();
    } else {
      onScreenSettled?.();
    }
  }, [onScreenLoading, onScreenSettled, showsPackLoading]);

  const screen = updateOwnedDisconnect ? (
    <FirmwareUpdateRestarting />
  ) : !deviceConnected ? (
    <ThemePreviewOffline />
  ) : pack?.spec && frame ? (
    <ThemeSpecSVG
      assets={pack.assets || {}}
      frame={frame}
      // In standby VibeTV reports its screensaver as the active theme.
      screensaver={device?.standby?.active ? pack.name || "" : undefined}
      spec={pack.spec}
      themeId={pack.themeId || themeId}
    />
  ) : frame ? (
    <ThemeSpecLoading status={packStatus} themeId={themeId} />
  ) : awaitingProviderSetup ? (
    <ThemeSpecLoading
      message="Waiting for AI setup…"
      status="loading"
      themeId={themeId}
    />
  ) : !deviceReady && !waitingForUsage ? (
    <ThemePreviewOffline />
  ) : waitingForUsage ? (
    <ThemeSpecLoading
      message="Waiting for usage…"
      status="loading"
      themeId={themeId}
    />
  ) : (
    <ThemeSpecLoading status={packStatus} themeId={themeId} />
  );

  // The 3D case draws the housing itself and only needs the screen.
  if (screenOnly) return screen;

  return (
    <figure className="w-full max-w-[520px]">
      <VibeTVCaseShell>{screen}</VibeTVCaseShell>
    </figure>
  );
}

// Matches the companion's displayStreamReadyAge window: a frame older than
// this is no longer evidence of a live device.
const RECONNECT_FRAME_GRACE_MS = 120_000;

// Retry cadence for the theme render pack while it is unavailable or does not
// match the device's active revision yet.
export const THEME_PACK_RETRY_MS = 5_000;
const THEME_PACK_TIMEOUT_MS = 15_000;

function frameFreshForReconnect(
  displayFrame: DisplayFrameSnapshot | null | undefined,
): boolean {
  const savedAt = displayFrame?.savedAt;
  if (!savedAt) {
    return true;
  }
  const savedAtMs = Date.parse(savedAt);
  if (!Number.isFinite(savedAtMs)) {
    return true;
  }
  return Date.now() - savedAtMs <= RECONNECT_FRAME_GRACE_MS;
}

export function livePreviewDisplayFrame(
  device: DeviceInfo | null | undefined,
  displayFrame: DisplayFrameSnapshot | null | undefined,
) {
  // Approved behavior (2026-08-03): temporary failures keep the last verified
  // preview frame visible while the device reconnects. The frame is only shown
  // as a LIVE connection when the device is not reported disconnected (see
  // deviceConnected above).
  if (
    (!deviceIsCustomerConnected(device) &&
      (!deviceIsActive(device) || device?.paired === false)) ||
    (deviceUsesCable(device) &&
      (!device?.deviceId || displayFrame?.deviceId?.toLowerCase() !== device.deviceId.toLowerCase())) ||
    !hasRenderableUsage(displayFrame)
  ) {
    return null;
  }
  return displayFrame;
}

const PreviewFrameContext = createContext<DisplayFrameSnapshot | null>(null);

/** Previews that name no frame of their own show this live frame. */
export function PreviewFrameProvider({
  children,
  snapshot,
}: {
  children: ReactNode;
  snapshot: DisplayFrameSnapshot | null;
}) {
  return <PreviewFrameContext.Provider value={snapshot}>{children}</PreviewFrameContext.Provider>;
}

/** Feeds every preview below it the companion's latest frame; only this node re-renders per poll. */
export function LivePreviewFrameProvider({
  active,
  children,
  device,
}: {
  active: boolean;
  children: ReactNode;
  device: string;
}) {
  return (
    <PreviewFrameProvider snapshot={useLatestDisplayFrame(active, device)}>
      {children}
    </PreviewFrameProvider>
  );
}

export function ThemeSpecPreview({
  animate = true,
  frame: ownFrame,
  pack,
  status,
  themeId,
}: {
  animate?: boolean;
  frame?: FrameData;
  pack: ThemeRenderPack | null;
  status: "idle" | "loading" | "ready" | "error";
  themeId: string;
}) {
  const snapshot = useContext(PreviewFrameContext);
  const frame =
    ownFrame ??
    (hasRenderableUsage(snapshot)
      ? buildFrameData(snapshot.savedAt, snapshot.frame)
      : THEME_CATALOG_PREVIEW_FRAME);
  if (pack?.spec) {
    return (
      <ThemeSpecSVG
        animate={animate}
        assets={pack.assets || {}}
        frame={frame}
        spec={pack.spec}
        themeId={pack.themeId || themeId}
      />
    );
  }

  return <ThemeSpecLoading status={status} themeId={themeId} />;
}

function VibeTVCaseShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative mx-auto w-full" data-testid="vibetv-case">
      <Image
        aria-hidden
        alt=""
        className="h-auto w-full select-none"
        draggable={false}
        height={510}
        priority
        src="/images/vibetv-device-overview-cutout.png"
        width={570}
      />
      <div className="absolute left-[17.35%] top-[14.1%] grid aspect-square w-[54.6%] place-items-center rounded-[8px] bg-[#030303] p-[2.8%] shadow-[inset_0_0_0_2px_rgba(0,0,0,0.96),inset_0_0_16px_rgba(255,255,255,0.10)]">
        <div className="aspect-square w-full overflow-hidden rounded-[2px] bg-black">
          {children}
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-[3.8%] rounded-[6px] bg-[linear-gradient(112deg,rgba(255,255,255,0.16)_0%,rgba(255,255,255,0.05)_15%,rgba(255,255,255,0)_36%)]"
        />
      </div>
    </div>
  );
}

function ThemeSpecSVG({
  animate = true,
  assets,
  frame,
  screensaver,
  spec,
  themeId,
}: {
  animate?: boolean;
  assets: Record<string, ThemePackAsset>;
  frame: FrameData;
  screensaver?: string;
  spec: ThemeSpec;
  themeId: string;
}) {
  const primitives = spec.primitives || spec.p || [];
  return (
    <svg
      aria-label={themeSpecAriaLabel(themeId, frame, screensaver)}
      className="size-full bg-black [image-rendering:pixelated]"
      role="img"
      viewBox="0 0 240 240"
    >
      <rect
        height="240"
        width="240"
        fill={colorFor(spec.bgColor || spec.bg, "#000000")}
      />
      {primitives.map((primitive, index) => (
        <ThemePrimitiveNode
          assets={assets}
          animate={animate}
          frame={frame}
          key={index}
          primitive={primitive}
          primitives={primitives}
        />
      ))}
    </svg>
  );
}

function ThemePrimitiveNode({
  assets,
  animate,
  frame,
  primitive,
  primitives,
}: {
  assets: Record<string, ThemePackAsset>;
  animate: boolean;
  frame: FrameData;
  primitive: ThemePrimitive;
  primitives: ThemePrimitive[];
}) {
  const type = primitive.type || primitive.t || "";
  const x = primitive.x || 0;
  const y = primitive.y || 0;
  const width = primitive.width || primitive.w || 0;
  const height = primitive.height || primitive.h || 0;
  if (!primitiveUsageSlotVisible(primitive, frame)) {
    return null;
  }

  if (type === "rect" || type === "r") {
    const radius = clampRadius(
      primitive.borderRadius ?? primitive.br ?? 0,
      width,
      height,
    );
    return (
      <rect
        fill={colorFor(primitive.color || primitive.c, "#000000")}
        height={height}
        rx={radius}
        ry={radius}
        width={width}
        x={x}
        y={y}
      />
    );
  }

  if (type === "text" || type === "tx") {
    const footer = displayedResetFooter(primitive, frame, primitives);
    const text = footer ?? renderTextPrimitive(primitive, frame);
    const maxWidth =
      primitive.maxWidth || primitive.mw || primitive.width || primitive.w || 0;
    const originalFont = primitive.font || primitive.f || 1;
    const maxSize = Math.max(1, primitive.fontSize || primitive.s || 1);
    // Preserve the fixed countdown size chosen by the footer formatter, unless
    // the countdown fits no variant: that one still shrinks.
    const countdownFooter =
      footer !== null &&
      footer !== RESET_IDLE &&
      footer !== RESET_UNAVAILABLE &&
      themeTextFittedSize(text, originalFont, maxSize, maxWidth, true) === maxSize;
    const { font, size, lines } = themeTextFit(text, originalFont, maxSize, maxWidth,
      !countdownFooter && (primitive.fit || primitive.ft) === "shrink", height);
    const boxHeight = themeTextValignBoxHeight(height, originalFont, maxSize);
    const top = themeTextAlignedY(y, boxHeight, themeFontSize(font, size) * lines.length, primitive.valign || primitive.va);
    const fontSize = themeFontSize(font, size);
    return (
      <g>{lines.map((line, index) => <ThemeTextPrimitive
        key={index}
        align={primitive.align || primitive.al}
        color={
          (primitive.binding || primitive.b || "").includes("Pace") &&
          (primitive.colorStops || primitive.cs)?.length
            ? paceStateColor(primitive, frame)
            : colorFor(primitive.color || primitive.c, "#FFFFFF")
        }
        font={font}
        fontSize={fontSize}
        fontWeight={themeFontWeight(font)}
        height={0}
        maxSize={maxSize}
        maxWidth={maxWidth}
        size={size}
        text={line}
        valign="top"
        x={x}
        y={top + index * fontSize}
      />)}</g>
    );
  }

  if (type === "progress" || type === "p") {
    return <ThemeProgress frame={frame} primitive={primitive} />;
  }

  if (
    type === "sprite" ||
    type === "sp" ||
    type === "image" ||
    type === "img"
  ) {
    const assetPath = activeAssetPath(primitive, frame);
    const asset = assetPath ? assets[assetPath] : undefined;
    return <ThemeSpriteImage
      raw={asset?.encoding === "text" ? asset.data : ""}
      animate={animate}
      x={x}
      y={y}
      width={width}
      height={height}
      background={primitive.bg || primitive.bgColor}
    />;
  }

  if (type === "gif" || type === "g") {
    const assetPath = activeAssetPath(primitive, frame);
    const asset = assetPath ? assets[assetPath] : undefined;
    if (!asset || asset.encoding !== "base64") {
      return null;
    }
    return (
      <image
        height={height}
        href={`data:${asset.contentType};base64,${asset.data}`}
        imageRendering="pixelated"
        preserveAspectRatio="xMidYMid meet"
        width={width}
        x={x}
        y={y}
      />
    );
  }

  if (type === "pixels" || type === "px") {
    return (
      <PixelRows
        color={colorFor(primitive.color || primitive.c, "#FFFFFF")}
        data={primitive.data || primitive.d || ""}
        height={height}
        rows={primitive.r || []}
        palette={primitive.p || []}
        width={width}
        x={x}
        y={y}
      />
    );
  }

  return null;
}

function ThemeTextPrimitive({
  align,
  color,
  font,
  fontSize,
  fontWeight,
  height,
  maxSize,
  maxWidth,
  size,
  text,
  valign,
  x,
  y,
}: {
  align?: string;
  color: string;
  font: number;
  fontSize: number;
  fontWeight: number;
  height: number;
  maxSize: number;
  maxWidth: number;
  size: number;
  text: string;
  valign?: string;
  x: number;
  y: number;
}) {
  const clipPathId = `theme-text-${useId().replaceAll(":", "")}`;
  const textRef = useRef<SVGTextElement>(null);
  const measurementKey = `${text}\u0000${fontSize}\u0000${fontWeight}`;
  const [measurement, setMeasurement] = useState({
    key: "",
    width: 0,
  });
  const firmwareMetrics = themeFirmwareTextMetrics(text, font, size);
  const textWidth =
    firmwareMetrics?.width ??
    themeTextWidth(
      text,
      fontSize,
      measurement.key === measurementKey ? measurement.width : undefined,
    );
  const layout = themeTextLayout(x, maxWidth, align, textWidth);
  const boxHeight = themeTextValignBoxHeight(height, font, maxSize);
  const textY = themeTextAlignedY(y, boxHeight, fontSize, valign);

  useEffect(() => {
    const node = textRef.current;
    if (!node) {
      return;
    }
    const width = node.getComputedTextLength();
    if (!Number.isFinite(width) || (text !== "" && width <= 0)) {
      return;
    }
    setMeasurement((current) =>
      current.key === measurementKey && current.width === width
        ? current
        : { key: measurementKey, width },
    );
  }, [measurementKey, text]);

  const commonTextProps = {
    // WebKit ignores text-before-edge and falls back to an alphabetic
    // baseline at y, leaving only descenders inside the firmware clip box.
    // Use the standard alphabetic baseline with an explicit ascent instead.
    dominantBaseline: "alphabetic" as const,
    fill: color,
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize,
    fontWeight,
    letterSpacing: "0",
    y: textY + fontSize * 0.8,
  };
  const textNode = firmwareMetrics ? (
    <text
      {...commonTextProps}
      style={{ whiteSpace: "pre" }}
      textAnchor="start"
      x={themeTextStartX(layout.textX, layout.textAnchor, textWidth)}
    >
      {firmwareMetrics.glyphs.map((glyph, index) => (
        <tspan
          key={`${index}-${glyph.character}`}
          lengthAdjust="spacingAndGlyphs"
          textLength={glyph.width}
          x={
            themeTextStartX(layout.textX, layout.textAnchor, textWidth) +
            glyph.offset
          }
        >
          {glyph.character}
        </tspan>
      ))}
    </text>
  ) : (
    <text
      {...commonTextProps}
      ref={textRef}
      textAnchor={layout.textAnchor}
      x={layout.textX}
    >
      {text}
    </text>
  );
  if (layout.clipWidth <= 0) {
    return textNode;
  }
  return (
    <>
      <defs>
        <clipPath id={clipPathId}>
          <rect
            height={Math.ceil(fontSize) + 4}
            width={layout.clipWidth}
            x={x}
            y={textY}
          />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipPathId})`}>{textNode}</g>
    </>
  );
}

function ThemeProgress({
  frame,
  primitive,
}: {
  frame: FrameData;
  primitive: ThemePrimitive;
}) {
  const x = primitive.x || 0;
  const y = primitive.y || 0;
  const width = primitive.width || primitive.w || 0;
  const height = primitive.height || primitive.h || 0;
  const percent = progressPercent(primitive, frame);
  const borderColor = colorFor(
    primitive.borderColor || primitive.bc,
    "#7BEF7B",
  );
  const bgColor = colorFor(primitive.bgColor || primitive.bg, "#000000");
  const fillColor = resolveProgressFillColor(
    primitive,
    percent,
    frame.usageMode,
  );
  const marks = paceBarMarks(primitive, frame, percent);
  const pieceColor = colorFor(
    marks.hatched
      ? primitive.deficitColor || primitive.dc
      : primitive.reserveColor || primitive.rc,
    marks.hatched ? "#FF0000" : "#00FF00",
  );
  const hatchId = `hatch-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  // Reserve: a solid piece. Deficit: diagonal stripes over the track.
  const pieceFill = marks.hatched ? `url(#${hatchId})` : pieceColor;
  const hatch = marks.hatched ? (
    <defs>
      <pattern
        height={4}
        id={hatchId}
        patternTransform="rotate(45)"
        patternUnits="userSpaceOnUse"
        width={4}
      >
        <rect fill={hatchGapColor(pieceColor, bgColor)} height={4} width={4} />
        <rect fill={pieceColor} height={4} width={2} />
      </pattern>
    </defs>
  ) : null;
  const innerWidth = Math.max(0, width - 2);
  const innerHeight = Math.max(0, height - 2);
  // A long-form key that is present decides, also when it is empty, as on
  // VibeTV: `"progressStyle":""` beside `"ps":"arc"` is a straight bar.
  const style = primitive.progressStyle ?? primitive.ps ?? "";
  if (style === "arc") {
    const arc = themeProgressArc(primitive, marks.fillTo);
    // Each stroke runs clockwise along the middle of the ring. A circle's
    // outline starts at 3 o'clock, a quarter turn after 12 o'clock.
    const stroke = (degrees: number, color: string) =>
      arc && degrees > 0 ? (
        <circle
          cx={arc.cx}
          cy={arc.cy}
          fill="none"
          r={arc.radius}
          stroke={color}
          strokeDasharray={`${(arc.radius * degrees * Math.PI) / 180} ${arc.radius * 2 * Math.PI}`}
          strokeWidth={arc.thickness}
          transform={`rotate(${arc.start - 90} ${arc.cx} ${arc.cy})`}
        />
      ) : null;
    // The piece runs from the end of the fill to its own end, and the tick
    // crosses the ring at the plan, in whole degrees like DrawProgressArc.
    const pieceDegrees = arc
      ? Math.floor((arc.sweep * marks.pieceTo) / 100) - arc.filled
      : 0;
    const planAngle = arc
      ? ((arc.start + Math.floor((arc.sweep * marks.planAt) / 100)) * Math.PI) / 180
      : 0;
    const inner = arc ? arc.radius - arc.thickness / 2 - PACE_TICK_OVERHANG : 0;
    const outer = arc ? arc.radius + arc.thickness / 2 + PACE_TICK_OVERHANG : 0;
    return (
      <g>
        {hatch}
        {stroke(arc?.sweep ?? 0, bgColor)}
        {stroke(arc?.filled ?? 0, fillColor)}
        {arc && pieceDegrees > 0 ? (
          <circle
            cx={arc.cx}
            cy={arc.cy}
            fill="none"
            r={arc.radius}
            stroke={pieceFill}
            strokeDasharray={`${(arc.radius * pieceDegrees * Math.PI) / 180} ${arc.radius * 2 * Math.PI}`}
            strokeWidth={arc.thickness}
            transform={`rotate(${arc.start + arc.filled - 90} ${arc.cx} ${arc.cy})`}
          />
        ) : null}
        {arc && marks.planAt >= 0 ? (
          <line
            stroke="#FFFFFF"
            strokeWidth={2}
            x1={arc.cx + inner * Math.sin(planAngle)}
            x2={arc.cx + outer * Math.sin(planAngle)}
            y1={arc.cy - inner * Math.cos(planAngle)}
            y2={arc.cy - outer * Math.cos(planAngle)}
          />
        ) : null}
      </g>
    );
  }
  const segmented = style === "segments" || style === "segmented";
  const radius = clampRadius(
    primitive.borderRadius ?? primitive.br ?? 0,
    width,
    height,
  );
  const innerRadius = Math.max(0, radius - 1);
  // A pace bar fills to the larger of use and plan and lays the piece over the
  // part past the fill, so the fill's rounded end is hidden under the piece.
  const barWidth = (value: number) =>
    Math.max(0, Math.min(innerWidth, Math.floor((innerWidth * value) / 100)));
  const fillWidth = barWidth(marks.pieceTo);
  const pieceFrom = barWidth(marks.fillTo);
  const tickX = Math.max(x, x + 1 + barWidth(marks.planAt) - 1);
  const tickTop = Math.max(0, y - PACE_TICK_OVERHANG);

  return (
    <g>
      {hatch}
      {innerRadius > 0 && !segmented && fillWidth > pieceFrom ? (
        // The piece follows the rounded interior of the bar where it reaches an end.
        <clipPath id={`${hatchId}-clip`}>
          <rect
            height={innerHeight}
            rx={innerRadius}
            ry={innerRadius}
            width={innerWidth}
            x={x + 1}
            y={y + 1}
          />
        </clipPath>
      ) : null}
      <rect
        fill="none"
        height={height}
        rx={radius}
        ry={radius}
        stroke={borderColor}
        width={width}
        x={x}
        y={y}
      />
      <rect
        fill={bgColor}
        height={innerHeight}
        rx={innerRadius}
        ry={innerRadius}
        width={innerWidth}
        x={x + 1}
        y={y + 1}
      />
      {segmented ? (
        <SegmentedProgress
          fillColor={fillColor}
          height={innerHeight}
          percent={marks.fillTo}
          exact={marks.planAt >= 0}
          pieceFill={pieceFill}
          piecePercent={marks.pieceTo}
          segmentGap={primitive.segmentGap ?? primitive.gg ?? 1}
          segments={primitive.segments || primitive.sg || 10}
          width={innerWidth}
          x={x + 1}
          y={y + 1}
          radius={innerRadius}
        />
      ) : (
        <>
          <rect
            fill={fillColor}
            height={innerHeight}
            rx={clampRadius(innerRadius, fillWidth, innerHeight)}
            ry={clampRadius(innerRadius, fillWidth, innerHeight)}
            width={fillWidth}
            x={x + 1}
            y={y + 1}
          />
          {fillWidth > pieceFrom ? (
            <rect
              clipPath={innerRadius > 0 ? `url(#${hatchId}-clip)` : undefined}
              fill={pieceFill}
              height={innerHeight}
              width={fillWidth - pieceFrom}
              x={x + 1 + pieceFrom}
              y={y + 1}
            />
          ) : null}
        </>
      )}
      {marks.planAt >= 0 ? (
        <rect
          fill="#FFFFFF"
          height={y + height + PACE_TICK_OVERHANG - tickTop}
          width={2}
          x={tickX}
          y={tickTop}
        />
      ) : null}
    </g>
  );
}

function SegmentedProgress({
  exact,
  fillColor,
  height,
  percent,
  pieceFill,
  piecePercent,
  radius,
  segmentGap,
  segments,
  width,
  x,
  y,
}: {
  exact: boolean;
  fillColor: string;
  height: number;
  percent: number;
  pieceFill: string;
  piecePercent: number;
  radius: number;
  segmentGap: number;
  segments: number;
  width: number;
  x: number;
  y: number;
}) {
  const filledSegments = Math.ceil((segments * percent) / 100);
  const pieceSegments = Math.ceil((segments * piecePercent) / 100);
  return (
    <g>
      {Array.from({ length: segments }, (_, index) => {
        const segX1 = exact
          ? Math.floor((index * width) / segments)
          : (index * width) / segments;
        const segX2 = exact
          ? Math.floor(((index + 1) * width) / segments)
          : ((index + 1) * width) / segments;
        const segW = Math.max(0, segX2 - segX1 - Math.max(0, segmentGap));
        // Pace boundaries are pixels, not rounded-up whole segments.
        const fillW = exact
          ? Math.max(0, Math.min(segW, Math.floor(width * percent / 100) - segX1))
          : index < filledSegments ? segW : 0;
        const endW = exact
          ? Math.max(0, Math.min(segW, Math.floor(width * piecePercent / 100) - segX1))
          : index < pieceSegments ? segW : 0;
        return (
          <g key={index}>
            {fillW > 0 ? (
              <rect
                fill={fillColor} height={height}
                rx={clampRadius(radius, fillW, height)} ry={clampRadius(radius, fillW, height)}
                width={fillW} x={x + segX1} y={y}
              />
            ) : null}
            {endW > fillW ? (
              <rect
                fill={pieceFill} height={height}
                rx={clampRadius(radius, endW - fillW, height)} ry={clampRadius(radius, endW - fillW, height)}
                width={endW - fillW} x={x + segX1 + fillW} y={y}
              />
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

function clampRadius(radius: number, width: number, height: number): number {
  return Math.max(0, Math.min(Math.round(radius), width / 2, height / 2));
}

function PixelRows({
  color,
  data,
  height,
  palette,
  rows,
  width,
  x,
  y,
}: {
  color: string;
  data: string;
  height: number;
  palette: string[];
  rows: string[];
  width: number;
  x: number;
  y: number;
}) {
  if (palette.length > 0 && rows.length > 0) {
    return (
      <g>
        {decodeRleRows(
          rows,
          width,
          palette.map((entry) => colorFor(entry, "#000000")),
        ).map((rect, index) => (
          <rect
            fill={rect.color}
            height={rect.height}
            key={index}
            width={rect.width}
            x={x + rect.x}
            y={y + rect.y}
          />
        ))}
      </g>
    );
  }

  return (
    <g>
      {decodeBitmapBits(data, width, height).map((rect, index) => (
        <rect
          fill={color}
          height={rect.height}
          key={index}
          width={rect.width}
          x={x + rect.x}
          y={y + rect.y}
        />
      ))}
    </g>
  );
}

function ThemeSpecLoading({
  message,
  status,
  themeId,
}: {
  message?: string;
  status: "idle" | "loading" | ThemePackState["status"];
  themeId: string;
}) {
  const content =
    message ||
    (status === "unsupported"
      ? "Unsupported theme"
      : status === "error"
        ? "Preview unavailable"
        : themeId
          ? "Loading preview"
          : "Waiting for theme");
  return (
    <div
      className="grid aspect-square w-full place-items-center whitespace-normal break-words border border-[#747A60] bg-[#111111] p-3 text-center font-mono text-[10px] font-bold uppercase leading-tight text-[#CCFF00] sm:text-xs"
      role={message ? "status" : undefined}
    >
      {content}
    </div>
  );
}

function ThemePreviewOffline() {
  return (
    <div
      aria-label="VibeTV live preview is offline"
      className="grid aspect-square w-full place-items-center bg-[#050505] p-5 text-center font-mono text-[11px] font-bold uppercase text-[#CCFF00]"
      role="img"
    >
      <div>
        <div className="mb-3 text-[#FF4FC3]">Live preview paused</div>
        <div className="text-[#FFFFFF]">Reconnect VibeTV to continue</div>
      </div>
    </div>
  );
}

function FirmwareUpdateRestarting() {
  return (
    <div
      aria-label="VibeTV firmware update is restarting the device"
      className="grid aspect-square w-full place-items-center bg-[#050505] p-5 text-center font-mono text-[11px] font-bold uppercase text-[#CCFF00]"
      role="status"
    >
      <div>
        <div className="mb-3 text-[#CCFF00]">VibeTV is restarting</div>
        <div className="text-[#FFFFFF]">Keep power connected and wait</div>
      </div>
    </div>
  );
}

export function hasRenderableUsage(
  snapshot: DisplayFrameSnapshot | null | undefined,
): snapshot is DisplayFrameSnapshot & { ok: true; frame: DisplayFrame } {
  const displayFrame = snapshot?.frame;
  if (
    snapshot?.ok !== true ||
    !displayFrame ||
    displayFrame.usageUnavailable === true ||
    typeof displayFrame.v !== "number" ||
    !Number.isInteger(displayFrame.v) ||
    displayFrame.v < 1
  ) {
    return false;
  }
  const hasProvider = [displayFrame.provider, displayFrame.label].some(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  const hasLegacyUsage = [displayFrame.session, displayFrame.weekly].some(
    (value) => typeof value === "number" && Number.isFinite(value),
  );
  const frameUsageWindows = displayFrame.usageWindows?.length
    ? displayFrame.usageWindows
    : displayFrame.usageSlots;
  const hasSlotUsage = (frameUsageWindows || []).some(
    (slot) =>
      Boolean(slot.id?.trim() && slot.label?.trim()) &&
      typeof slot.percent === "number" &&
      Number.isFinite(slot.percent),
  );
  return hasProvider && (hasLegacyUsage || hasSlotUsage);
}

export function buildFrameData(
  generatedAt: string | undefined,
  displayFrame: DisplayFrame,
  currentTime = new Date(),
): FrameData {
  const elapsedSeconds = secondsSince(generatedAt, currentTime);
  const sourceUsageMode = frameUsageMode(displayFrame);
  const slots = (
    (displayFrame.usageWindows?.length
      ? displayFrame.usageWindows
      : displayFrame.usageSlots) || []
  ).filter((slot) => Boolean(slot.id?.trim() && slot.label?.trim()));
  const slot1 = slots[0];
  const slot2 = slots[1];
  const providerSlots = (displayFrame.providerSlots || []).filter((slot) =>
    Boolean(slot.id?.trim() && slot.label?.trim()),
  );
  // Mirrors ApplyFrameResetTrust and CurrentResetTrust in
  // codexbar_display_core.h: the device stands behind a frame only while it is
  // not marked stale and its trust budget has not run out. A "live" frame is
  // the host's statement that the basis is current and stands without a
  // deadline (an account in which no window has a reset time, #532); every
  // other frame needs at least one deadline. Without that basis a window with
  // no deadline is unavailable, not idle.
  const trustEnforced =
    displayFrame.resetTrust === "live" || displayFrame.resetTrust === "offline";
  const basisTrusted =
    displayFrame.resetTrust !== "stale" &&
    // Retained windows of a failed collection stay unavailable, as on the device.
    displayFrame.usageUnavailable !== true &&
    (displayFrame.resetTrust === "live" ||
      [displayFrame, ...slots, ...providerSlots].some(
        (carrier) => (carrier.resetSecs ?? 0) > 0,
      )) &&
    (!trustEnforced ||
      (Boolean(displayFrame.resetSource) &&
        (displayFrame.resetTrustSecs ?? 0) - elapsedSeconds > 0));
  const remainingResetSeconds = (seconds: number | undefined) =>
    basisTrusted ? remainingResetSecs(seconds, generatedAt, currentTime) : 0;
  // Mirrors CurrentUsageWindowRemainingSecs: idle is a window the host sent
  // with no deadline and nothing used. No deadline alone is not enough -- the
  // host also sends 0 for a deadline that ran out before the frame left and
  // for a provider that names none. In "remaining" mode the host sends what is
  // left, so nothing used reads 100. A provider slot is only sent with a
  // deadline and is never idle.
  const nothingUsedPercent = sourceUsageMode === "remaining" ? 100 : 0;
  const windowIsIdle = (slot: UsageWindowFrame | UsageSlotFrame | undefined) =>
    basisTrusted &&
    (slot?.resetSecs ?? 0) <= 0 &&
    clampPercent(slot?.percent) === nothingUsedPercent;
  return {
    resetBasisTrusted: basisTrusted,
    footerWindow: displayFrame.footerWindow,
    provider: displayFrame.provider || "",
    label: displayFrame.label ?? displayFrame.provider ?? "",
    session: clampPercent(displayFrame.session),
    weekly: clampPercent(displayFrame.weekly),
    sessionUnavailable: displayFrame.usageUnavailable === true || displayFrame.sessionUnavailable === true,
    weeklyUnavailable: displayFrame.usageUnavailable === true || displayFrame.weeklyUnavailable === true,
    resetSecs: remainingResetSeconds(displayFrame.resetSecs),
    usageMode: sourceUsageMode,
    usageWindows: slots.map((slot) => ({
      id: slot.id,
      label: slot.label || "",
      percent: clampPercent(slot.percent),
      resetSecs: remainingResetSeconds(slot.resetSecs),
      available: displayFrame.usageUnavailable !== true,
      idle: windowIsIdle(slot),
      // The device drops pace with the reset trust it was computed against.
      pace: basisTrusted ? slot.pace : undefined,
    })),
    usageSlot1Label: slot1?.label || "",
    usageSlot1Percent: clampPercent(slot1?.percent),
    usageSlot1ResetSecs: remainingResetSeconds(slot1?.resetSecs),
    usageSlot1Available: displayFrame.usageUnavailable !== true && Boolean(slot1),
    usageSlot1Idle: Boolean(slot1) && windowIsIdle(slot1),
    usageSlot2Label: slot2?.label || "",
    usageSlot2Percent: clampPercent(slot2?.percent),
    usageSlot2ResetSecs: remainingResetSeconds(slot2?.resetSecs),
    usageSlot2Available: displayFrame.usageUnavailable !== true && Boolean(slot2),
    usageSlot2Idle: Boolean(slot2) && windowIsIdle(slot2),
    providerSlots: providerSlots.map((slot) => ({
      label: slot.label || "",
      percent: clampPercent(slot.percent),
      resetSecs: remainingResetSeconds(slot.resetSecs),
      available: true,
      idle: false,
    })),
    activity: displayFrame.activity || "idle",
    sessionTokens: displayFrame.sessionTokens ?? 0,
    hasTokenTotals:
      displayFrame.tokenTotalsKnown === true ||
      displayFrame.sessionTokens !== undefined ||
      displayFrame.weekTokens !== undefined ||
      displayFrame.totalTokens !== undefined,
    weekTokens: displayFrame.weekTokens ?? 0,
    totalTokens: displayFrame.totalTokens ?? 0,
    time: new Intl.DateTimeFormat("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(currentTime),
    // DD.MM.YYYY, matching attachClockFields and the device clock. A shorter
    // date here would hide the width and shrink behaviour of the hardware.
    date: new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(currentTime),
  };
}

function missingUsageText(primitive: ThemePrimitive, frame: FrameData): string | null {
  if (!["tx", "text"].includes(primitive.t || primitive.type || "")) return null;
  const index = primitive.usageIndex ?? primitive.ui ?? ((primitive.slot ?? primitive.sl ?? 0) - 1);
  const window = frame.usageWindows[index];
  if (!window?.label || window.available) return null;
  const source = primitive.binding || primitive.b || primitive.text || primitive.v || "";
  const label = /Label|\.label/.test(source), percent = /Percent|\.percent/.test(source);
  return label || percent ? `${label ? window.label : ""}${percent ? (label ? " --" : "--") : ""}` : null;
}

export function primitiveUsageSlotVisible(
  primitive: ThemePrimitive,
  frame: FrameData,
): boolean {
  if (missingUsageText(primitive, frame) !== null) return true;
  const usageIndex = primitive.usageIndex ?? primitive.ui;
  if (typeof usageIndex === "number") {
    return frame.usageWindows[usageIndex]?.available === true;
  }
  const slot = primitive.slot ?? primitive.sl;
  if (slot === 1) {
    return frame.usageSlot1Available;
  }
  if (slot === 2) {
    return frame.usageSlot2Available;
  }
  const providerSlot = primitive.providerSlot ?? primitive.pl;
  if (providerSlot === 1 || providerSlot === 2) {
    return frame.providerSlots[providerSlot - 1]?.available === true;
  }
  return true;
}

export function themeSpecAriaLabel(
  themeId: string,
  frame: FrameData,
  // The title of the screensaver when that is what the picture shows; it may
  // be empty.
  screensaver?: string,
): string {
  const usage = frame.usageWindows
    .filter((window) => window.available)
    .map((window) => `${window.label} ${window.percent}% ${frame.usageMode}`);
  const shown =
    screensaver === undefined
      ? `theme ${themeId}`
      : `screensaver ${screensaver}`.trim();
  return `Rendered VibeTV ${shown} showing ${[frame.label, usage.length > 0 ? usage.join(", ") : "no usage windows available"].filter(Boolean).join(", ")}`;
}

function frameUsageMode(displayFrame: DisplayFrame | undefined): string {
  if (
    displayFrame?.usageMode === "remaining" ||
    displayFrame?.usageMode === "used"
  ) {
    return displayFrame.usageMode;
  }
  return "used";
}

export function activeThemeId(device: DeviceInfo | null): string {
  const theme = normalizeThemeAlias(device?.activeTheme);
  if (theme && theme !== "installing") {
    return theme;
  }
  return themeFromThemeSpecPath(device?.display?.themeSpec?.path);
}

function themeFromThemeSpecPath(path: string | undefined): string {
  const basename = (path || "").split("/").pop() || "";
  const slug = basename
    .replace(/\.json$/i, "")
    .replace(/--.*$/, "")
    .trim()
    .toLowerCase();
  return normalizeThemeAlias(slug);
}

function normalizeThemeAlias(theme: string | undefined): string {
  const normalized = (theme || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  return DEVICE_THEME_ALIASES[normalized] || normalized;
}

function renderPackSpecHash(pack: ThemeRenderPack): string {
  return normalizeThemeSpecHash(pack.specHash);
}

class ThemeUnsupportedError extends Error {}

export async function fetchThemeRenderPackRevision(
  themeId: string,
  themeSpecPath: string,
  themeSpecHash: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<ThemeRenderPack> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    // Timeout is a retryable load failure; AbortError is reserved for cleanup.
    controller.abort(new DOMException("Theme pack took too long to answer", "TimeoutError"));
  }, THEME_PACK_TIMEOUT_MS);
  // macOS 14.0's WebKit predates AbortSignal.any.
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const exactResponse = await fetcher(
      themeRenderPackUrl(themeId, themeSpecPath, themeSpecHash),
      { signal: controller.signal },
    );
    if (exactResponse.ok) {
      return await exactResponse.json() as ThemeRenderPack;
    }
    if (!themeSpecPath) {
      throw packUnavailable(exactResponse);
    }

    // Old Companions only expose the latest cache by theme ID. Their payload
    // still includes specPath, which lets the caller reject a wrong revision.
    const legacyResponse = await fetcher(themeRenderPackUrl(themeId), { signal: controller.signal });
    if (!legacyResponse.ok) {
      // Unknown only when both reads say so; a transient exact failure stays one.
      throw packUnavailable(
        exactResponse.status === 404 ? legacyResponse : exactResponse,
      );
    }
    return await legacyResponse.json() as ThemeRenderPack;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

function packUnavailable(response: Response): Error {
  return response.status === 404
    ? new ThemeUnsupportedError("theme pack unknown")
    : new Error("theme pack unavailable");
}

export function themeRenderPackMatchesActiveRevision(
  pack: ThemeRenderPack,
  themeSpecPath: string,
  themeSpecHash: string,
): boolean {
  if (!pack?.spec) {
    return false;
  }
  const receivedSpecPath = (pack.specPath || "").trim();
  const receivedSpecHash = renderPackSpecHash(pack);
  const exactPath = !themeSpecPath || receivedSpecPath === themeSpecPath;
  return (
    exactPath &&
    (!themeSpecHash ||
      receivedSpecHash === themeSpecHash ||
      (!receivedSpecHash && Boolean(themeSpecPath)))
  );
}

/** What the active theme has room for, as Settings explains it. */
export type ActiveThemeLimits = {
  name: string;
  /** How many of the customer's ticked limits the theme shows. */
  limits: number;
};

export function themeLimitsFromPack(
  pack: Pick<ThemeRenderPack, "name" | "spec" | "themeId">,
): ActiveThemeLimits | null {
  if (!pack.spec) {
    return null;
  }
  try {
    const spec = importThemeSpec(pack.spec);
    return {
      name: pack.name || pack.themeId || "Your theme",
      limits: themeStudioSpecUsageLimitCount(spec),
    };
  } catch {
    return null;
  }
}

/**
 * Reads the theme VibeTV runs, once per installed revision. Until it is read,
 * or when it cannot be, the answer is null and Settings says nothing about
 * the theme rather than guessing.
 */
export function useActiveThemeLimits(
  device: DeviceInfo | null,
): ActiveThemeLimits | null {
  const themeId = activeThemeId(device);
  const themeSpecPath = device?.display?.themeSpec?.path || "";
  const themeSpecHash = normalizeThemeSpecHash(
    device?.display?.themeSpec?.hash,
  );
  const key = [themeId, themeSpecPath, themeSpecHash].join("|");
  const [state, setState] = useState<{
    key: string;
    limits: ActiveThemeLimits | null;
  } | null>(null);

  useEffect(() => {
    if (!themeId) {
      return;
    }
    const localPack = loadLocalThemeRenderPack(themeId, themeSpecPath);
    if (localPack && (!themeSpecHash || localPack.specHash === themeSpecHash)) {
      const timer = window.setTimeout(
        () => setState({ key, limits: themeLimitsFromPack(localPack) }),
        0,
      );
      return () => window.clearTimeout(timer);
    }
    const controller = new AbortController();
    fetchThemeRenderPackRevision(
      themeId,
      themeSpecPath,
      themeSpecHash,
      controller.signal,
    )
      .then((pack) =>
        setState({
          key,
          limits: themeRenderPackMatchesActiveRevision(
            pack,
            themeSpecPath,
            themeSpecHash,
          )
            ? themeLimitsFromPack(pack)
            : null,
        }),
      )
      .catch(() => undefined);
    return () => controller.abort();
  }, [key, themeId, themeSpecHash, themeSpecPath]);

  return state?.key === key ? state.limits : null;
}

// The firmware renders this wherever a countdown has expired or its basis went
// stale. A preview that softens it to "0m" tells the customer something the
// device never shows.
const RESET_UNAVAILABLE = "Reset unavailable";

// Mirrors kResetIdleText in theme_spec_renderer_core.h. A window that is
// current and measured but has no deadline is idle, not broken: the customer
// simply has not started a session yet, so nothing is scheduled to reset.
const RESET_IDLE = "No active session";

// Mirrors RootResetIsIdle in theme_spec_renderer_core.h. The root {reset}
// token owns no window, so it is idle only when every window the frame does
// carry is idle; a stale basis leaves no idle window behind and keeps the
// unavailable wording.
function rootResetIsIdle(frame: FrameData): boolean {
  const windows = frame.usageWindows.filter((window) => window.available);
  return windows.length > 0 && windows.every((window) => window.idle);
}

// Whether a theme draws a value that boundValue shows as "--" on a computer
// without token history.
export function themeShowsTokenTotals(spec?: ThemeSpec | null): boolean {
  return (spec?.primitives || spec?.p || []).some((primitive) => {
    const binding = primitive.binding || primitive.b;
    return binding
      ? /^(sessionTokens|weekTokens|totalTokens|st|wt|tt)$/.test(binding)
      : /\{(sessionTokens|weekTokens|totalTokens|st|wt|tt)\}/.test(
          primitive.text || primitive.v || "",
        );
  });
}

// A standalone first-limit countdown below the usage rows is the shared footer.
// Explicit per-limit lines (with their label or another row below) keep their binding.
function displayedResetFooter(
  primitive: ThemePrimitive,
  frame: FrameData,
  primitives: ThemePrimitive[],
): string | null {
  const binding = primitive.binding || primitive.b;
  const isFooter = binding
    ? /^(?:usageSlot1Reset|us1r|usage\.0\.reset)$/.test(binding)
    : /^(?:Reset|Resets) in \{(?:usageSlot1Reset|us1r|usage\.0\.reset)\}$/.test(
        primitive.text || primitive.v || "",
      );
  if (!isFooter) return null;
  const slots = new Set<number>();
  for (const row of primitives) {
    if (row === primitive || !primitiveUsageSlotVisible(row, frame)) continue;
    const index = row.usageIndex ?? row.ui ?? ((row.slot ?? row.sl ?? 0) - 1);
    if (index < 0) continue;
    if ((row.y || 0) >= (primitive.y || 0)) return null;
    slots.add(index);
  }
  if (slots.size === 0) return null;
  if (frame.resetBasisTrusted === false) return RESET_UNAVAILABLE;
  let sawAvailable = false;
  let allIdle = true;
  const ordered = [...slots].sort((a, b) => a - b);
  const preferred = ordered.find(index => frame.usageWindows[index]?.id === frame.footerWindow &&
    frame.usageWindows[index]?.available && frame.usageWindows[index].resetSecs > 0);
  for (const index of preferred === undefined ? ordered : [preferred]) {
    const window = frame.usageWindows[index];
    if (!window?.available) continue;
    sawAvailable = true;
    allIdle = allIdle && window.idle;
    if (window.resetSecs > 0) {
      const duration = formatReset(window.resetSecs, false);
      // A pair label ("Claude Weekly") is longer than the limit name ("Weekly").
      const limit = frame.provider.includes("+") ? window.label.replace(/^\S+ /, "") : window.label;
      const variants = [`${window.label} resets in ${duration}`, `${window.label} ${duration}`, `${limit} ${duration}`];
      if (slots.size === 1) variants.push(`Resets ${duration}`);
      const maxWidth = primitive.maxWidth || primitive.mw || primitive.width || primitive.w || 0;
      const font = primitive.font || primitive.f || 1;
      const size = Math.max(1, primitive.fontSize || primitive.s || 1);
      return variants.find(text => maxWidth <= 0 ||
        (themeFirmwareTextMetrics(text, font, size)?.width ??
          themeTextWidth(text, themeFontSize(font, size))) <= maxWidth) ?? variants.at(-1)!;
    }
  }
  return sawAvailable && allIdle ? RESET_IDLE : RESET_UNAVAILABLE;
}

export function renderTextPrimitive(
  primitive: ThemePrimitive,
  frame: FrameData,
  primitives: ThemePrimitive[] = [],
): string {
  const missing = missingUsageText(primitive, frame);
  if (missing !== null) return missing;
  const footer = displayedResetFooter(primitive, frame, primitives);
  if (footer !== null) return footer;
  const binding = primitive.binding || primitive.b;
  if (binding) {
    return boundValue(binding, frame);
  }
  const raw = primitive.text || primitive.v || "";
  // RenderTextTemplate replaces the whole template for an expired countdown
  // instead of substituting in place, so the surrounding literal text
  // disappears. This covers the root tokens and, since the idle-session fix,
  // any template whose only substitution is an unavailable slot countdown:
  // shipped themes hard-code "Resets in {usageSlot1Reset}", and substituting
  // in place produced "Resets in Reset unavailable" on a customer's screen.
  if (frame.resetSecs <= 0 && /\{reset\}|\{resetCountdown\}|\{r\}/.test(raw)) {
    return rootResetIsIdle(frame) ? RESET_IDLE : RESET_UNAVAILABLE;
  }
  const countdownOnly = templateCountdownOnlyText(raw, frame);
  if (countdownOnly) {
    return countdownOnly;
  }
  return raw.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_match, key: string) =>
    boundValue(key, frame),
  );
}

// Mirrors TemplateCountdownOnlyText in theme_spec_renderer_core.h.
// A template that also substitutes a label or a percentage still carries
// information, so it keeps its in-place substitution; an unavailable window
// renders empty rather than as the unavailable text, so it is left alone too.
function templateCountdownOnlyText(
  raw: string,
  frame: FrameData,
): string | null {
  const tokens = raw.match(/\{([a-zA-Z0-9_.-]+)\}/g);
  if (!tokens || tokens.length === 0) {
    return null;
  }
  let sawUnavailableCountdown = false;
  let allIdle = true;
  for (const token of tokens) {
    const key = token.slice(1, -1);
    const slot = slotCountdownFor(key, frame);
    if (!slot) {
      return null;
    }
    if (!slot.available || slot.resetSecs > 0) {
      return null;
    }
    sawUnavailableCountdown = true;
    allIdle = allIdle && slot.idle;
  }
  if (!sawUnavailableCountdown) {
    return null;
  }
  return allIdle ? RESET_IDLE : RESET_UNAVAILABLE;
}

function slotCountdownFor(
  key: string,
  frame: FrameData,
): { available: boolean; resetSecs: number; idle: boolean } | undefined {
  const usageMatch = /^usage\.(\d+)\.reset$/.exec(key);
  if (usageMatch) {
    const window = frame.usageWindows[Number(usageMatch[1])];
    return window
      ? {
          available: window.available,
          resetSecs: window.resetSecs,
          idle: window.idle,
        }
      : undefined;
  }
  // PaceLastsSep collapses with the countdown of its window.
  const lead = paceBinding(key);
  if (lead?.field === "LastsSep") {
    const window = frame.usageWindows[lead.index];
    return window
      ? { available: window.available, resetSecs: window.resetSecs, idle: window.idle }
      : undefined;
  }
  switch (key) {
    case "usageSlot1Reset":
    case "us1r":
      return {
        available: frame.usageSlot1Available,
        resetSecs: frame.usageSlot1ResetSecs,
        idle: frame.usageSlot1Idle,
      };
    case "usageSlot2Reset":
    case "us2r":
      return {
        available: frame.usageSlot2Available,
        resetSecs: frame.usageSlot2ResetSecs,
        idle: frame.usageSlot2Idle,
      };
    case "providerSlot1Reset":
    case "pv1r":
      return frame.providerSlots[0]
        ? {
            available: frame.providerSlots[0].available,
            resetSecs: frame.providerSlots[0].resetSecs,
            idle: frame.providerSlots[0].idle,
          }
        : undefined;
    case "providerSlot2Reset":
    case "pv2r":
      return frame.providerSlots[1]
        ? {
            available: frame.providerSlots[1].available,
            resetSecs: frame.providerSlots[1].resetSecs,
            idle: frame.providerSlots[1].idle,
          }
        : undefined;
    default:
      return undefined;
  }
}

// Mirrors the firmware's FormatTokenCount digit for digit (truncated
// hundredths, never rounded) so catalog previews and the device agree.
function formatTokenCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    value = 0;
  }
  value = Math.floor(value);
  if (value < 1000) {
    return String(value);
  }
  let unit = "K";
  let divisor = 1000;
  if (value >= 1_000_000_000) {
    unit = "B";
    divisor = 1_000_000_000;
  } else if (value >= 1_000_000) {
    unit = "M";
    divisor = 1_000_000;
  }
  const hundredths = Math.floor((value * 100) / divisor);
  const whole = Math.floor(hundredths / 100);
  // Three significant digits keep every value at most five glyphs wide, so
  // stacked token rows share one font size instead of shrinking per row.
  let frac = hundredths % 100;
  if (whole >= 100) {
    frac = 0;
  } else if (whole >= 10) {
    frac -= frac % 10;
  }
  if (frac === 0) {
    return `${whole}${unit}`;
  }
  if (frac % 10 === 0) {
    return `${whole}.${frac / 10}${unit}`;
  }
  return `${whole}.${String(frac).padStart(2, "0")}${unit}`;
}

// A pace binding in any spelling the firmware reads (UsageWindowBindingIndex
// with the "Pace..." field): usageSlot1PaceText, us1PaceText, usage.0.PaceText.
// The window is 0-based; the field is what follows "Pace".
export function paceBinding(key: string): { index: number; field: string } | null {
  const match =
    /^usageSlot([12])Pace(\w*)$/.exec(key) ||
    /^us([12])Pace(\w*)$/.exec(key);
  if (match) {
    return { index: Number(match[1]) - 1, field: match[2] };
  }
  const generic = /^usage\.(\d+)\.Pace(\w*)$/.exec(key);
  return generic ? { index: Number(generic[1]), field: generic[2] } : null;
}

// The pace behind a pace binding while its window is available and its
// countdown still runs, as in BoundPaceFor (theme_spec_renderer_core.h).
function boundPace(binding: string, frame: FrameData): UsagePaceFrame | undefined {
  const key = paceBinding(binding);
  const window = key ? frame.usageWindows[key.index] : undefined;
  const pace = window?.available && window.resetSecs > 0 ? window.pace : undefined;
  return PACE_STATE_LEVEL[pace?.state ?? ""] === undefined ? undefined : pace;
}

const PACE_STATE_LEVEL: Record<string, number> = { reserve: 100, "on pace": 50, deficit: 0 };

// Mirrors FormatBoundPace: CodexBar's pace as ready sentences, and nothing
// without a pace or once the window's countdown is gone.
function usagePaceText(binding: string, kind: string, frame: FrameData): string {
  const pace = boundPace(binding, frame);
  if (!pace) {
    return "";
  }
  if (kind === "Text" || kind === "Short") {
    const short = kind === "Short";
    if (pace.state === "on pace") {
      return short ? "on pace" : "On pace";
    }
    const amount = Math.min(100, Math.abs(pace.delta ?? 0));
    return `${amount}% ${pace.state}`;
  }
  if (pace.lasts === undefined || (kind === "RunsOut" && pace.lasts)) {
    return "";
  }
  const sentence = pace.lasts ? "lasts until reset" : "runs out";
  return kind === "LastsSep" ? `${sentence} - ` : sentence;
}

// Mirrors FormatPaceFooter: the notice while one shows, else the reset sentence
// ("lasts until reset - resets 3h 34m", "resets 3h 34m", or the idle or
// unavailable text without a countdown).
function paceFooterText(key: string, index: number, frame: FrameData): string {
  const window = frame.usageWindows[index];
  if (frame.updateNotice) {
    return frame.updateNotice;
  }
  if (!window?.available) {
    return "";
  }
  if (window.resetSecs <= 0) {
    return formatReset(window.resetSecs, window.idle);
  }
  return `${usagePaceText(key.replace(/Footer$/, "LastsSep"), "LastsSep", frame)}resets ${formatReset(window.resetSecs)}`;
}

export function boundValue(key: string, frame: FrameData): string {
  const paceKey = paceBinding(key);
  if (paceKey && /^(Text|Short|LastsSep|Lasts|RunsOut)$/.test(paceKey.field)) {
    return usagePaceText(key, paceKey.field, frame);
  }
  if (paceKey?.field === "Footer") {
    return paceFooterText(key, paceKey.index, frame);
  }
  const usageMatch = /^usage\.(\d+)\.(label|percent|reset|available)$/.exec(
    key,
  );
  if (usageMatch) {
    const window = frame.usageWindows[Number(usageMatch[1])];
    const field = usageMatch[2];
    if (field === "available") {
      return String(window?.available === true);
    }
    if (!window?.available) {
      return "";
    }
    if (field === "label") {
      return window.label;
    }
    if (field === "reset") {
      return formatReset(window.resetSecs, window.idle);
    }
    return String(window.percent);
  }
  if (key === "usageModeShort" || key === "usageModeStandalone") {
    if (frame.provider.includes("+")) return "";
    // Mirrors the firmware: "left" for what remains, else the mode itself.
    return key === "usageModeShort" && frame.usageMode === "remaining" ? "left" : frame.usageMode;
  }
  switch (key) {
    case "label":
    case "providerLabel":
    case "l":
      return frame.updateNotice || (frame.provider.includes("+") ? frame.usageMode : frame.label);
    case "usageProviderName":
      // The percentage basis for Two at once, otherwise the provider; never the notice.
      return frame.provider.includes("+") ? frame.usageMode : frame.label;
    case "provider":
    case "pr":
      return frame.provider;
    case "session":
    case "sessionPercent":
    case "s":
      return usageLaneText(frame.session, frame.sessionUnavailable);
    case "weekly":
    case "weeklyPercent":
    case "w":
      return usageLaneText(frame.weekly, frame.weeklyUnavailable);
    case "reset":
    case "resetCountdown":
    case "r":
      return formatReset(frame.resetSecs, rootResetIsIdle(frame));
    case "usageSlot1Label":
    case "us1l":
      return frame.usageSlot1Available ? frame.usageSlot1Label : "";
    case "usageSlot1Percent":
    case "us1p":
      return frame.usageSlot1Available ? String(frame.usageSlot1Percent) : "";
    case "usageSlot1Reset":
    case "us1r":
      return frame.usageSlot1Available
        ? formatReset(frame.usageSlot1ResetSecs, frame.usageSlot1Idle)
        : "";
    case "usageSlot1Available":
    case "us1a":
      return String(frame.usageSlot1Available);
    case "usageSlot2Label":
    case "us2l":
      return frame.usageSlot2Available ? frame.usageSlot2Label : "";
    case "usageSlot2Percent":
    case "us2p":
      return frame.usageSlot2Available ? String(frame.usageSlot2Percent) : "";
    case "usageSlot2Reset":
    case "us2r":
      return frame.usageSlot2Available
        ? formatReset(frame.usageSlot2ResetSecs, frame.usageSlot2Idle)
        : "";
    case "usageSlot2Available":
    case "us2a":
      return String(frame.usageSlot2Available);
    case "providerSlot1Label":
    case "pv1l":
      return frame.providerSlots[0]?.available ? frame.providerSlots[0].label : "";
    case "providerSlot1Percent":
    case "pv1p":
      return frame.providerSlots[0]?.available
        ? String(frame.providerSlots[0].percent)
        : "";
    case "providerSlot1Reset":
    case "pv1r":
      return frame.providerSlots[0]?.available
        ? formatReset(frame.providerSlots[0].resetSecs, frame.providerSlots[0].idle)
        : "";
    case "providerSlot1Available":
    case "pv1a":
      return String(frame.providerSlots[0]?.available === true);
    case "providerSlot2Label":
    case "pv2l":
      return frame.providerSlots[1]?.available ? frame.providerSlots[1].label : "";
    case "providerSlot2Percent":
    case "pv2p":
      return frame.providerSlots[1]?.available
        ? String(frame.providerSlots[1].percent)
        : "";
    case "providerSlot2Reset":
    case "pv2r":
      return frame.providerSlots[1]?.available
        ? formatReset(frame.providerSlots[1].resetSecs, frame.providerSlots[1].idle)
        : "";
    case "providerSlot2Available":
    case "pv2a":
      return String(frame.providerSlots[1]?.available === true);
    case "usageMode":
    case "u":
      return frame.usageMode;
    case "activity":
    case "act":
      return frame.activity;
    case "time":
    case "tm":
      return frame.time;
    case "date":
    case "dt":
      return frame.date;
    case "sessionTokens":
    case "st":
      return frame.hasTokenTotals ? formatTokenCount(frame.sessionTokens) : "--";
    case "weekTokens":
    case "wt":
      return frame.hasTokenTotals ? formatTokenCount(frame.weekTokens) : "--";
    case "totalTokens":
    case "tt":
      return frame.hasTokenTotals ? formatTokenCount(frame.totalTokens) : "--";
    default:
      return "";
  }
}

export function progressPercent(
  primitive: ThemePrimitive,
  frame: FrameData,
): number {
  const binding = primitive.binding || primitive.b || "";
  const usageMatch = /^usage\.(\d+)\.percent$/.exec(binding);
  if (usageMatch) {
    const window = frame.usageWindows[Number(usageMatch[1])];
    return window?.available ? window.percent : 0;
  }
  const paceKey = paceBinding(binding);
  if (paceKey?.field === "") {
    // A pace bar fills like its window's percent.
    const window = frame.usageWindows[paceKey.index];
    return window?.available ? window.percent : 0;
  }
  if (binding === "usageSlot1Percent" || binding === "us1p") {
    return frame.usageSlot1Available ? frame.usageSlot1Percent : 0;
  }
  if (binding === "usageSlot2Percent" || binding === "us2p") {
    return frame.usageSlot2Available ? frame.usageSlot2Percent : 0;
  }
  if (binding === "weekly" || binding === "weeklyPercent" || binding === "w") {
    return frame.weeklyUnavailable ? 0 : frame.weekly;
  }
  return frame.sessionUnavailable ? 0 : frame.session;
}

// The ring an arc-style progress draws, as CompilePrimitive and
// DrawProgressArc in theme_spec_renderer_core.h work it out: inside the box,
// angles in whole degrees clockwise from 12 o'clock, and the filled share of
// the sweep cut to whole degrees. The device skips an arc outside its limits,
// so there is none here either.
export function themeProgressArc(primitive: ThemePrimitive, percent: number) {
  const width = primitive.width || primitive.w || 0;
  const height = primitive.height || primitive.h || 0;
  const diameter = Math.min(width, height);
  const start = primitive.arcStart ?? primitive.as ?? 0;
  const sweep = primitive.arcSweep ?? primitive.aw ?? 0;
  const thickness = primitive.arcThickness ?? primitive.at ?? 0;
  if (
    ![start, sweep, thickness].every(Number.isInteger) ||
    start < 0 ||
    start > 359 ||
    sweep < 1 ||
    sweep > 360 ||
    thickness < 1 ||
    thickness * 2 > diameter
  ) {
    return null;
  }
  return {
    cx: (primitive.x || 0) + width / 2,
    cy: (primitive.y || 0) + height / 2,
    radius: (diameter - thickness) / 2,
    thickness,
    start,
    sweep,
    filled: Math.floor((sweep * Math.max(0, Math.min(100, percent))) / 100),
  };
}

// A pace-bound text matches its stops against CodexBar's state instead of the
// quota (reserve 100, on pace 50, deficit 0), like ResolvePaceColor; without a
// pace it keeps the solid colour.
function paceStateColor(primitive: ThemePrimitive, frame: FrameData): string {
  const pace = boundPace(primitive.binding || primitive.b || "", frame);
  const level = PACE_STATE_LEVEL[pace?.state ?? ""];
  if (level !== undefined) {
    for (const stop of [...(primitive.colorStops || primitive.cs || [])]
      .filter((entry) => typeof entry.gte === "number" && (entry.color || entry.c))
      .sort((a, b) => (b.gte ?? 0) - (a.gte ?? 0))) {
      if (level >= (stop.gte ?? 0)) {
        return colorFor(stop.color || stop.c, "#FFFFFF");
      }
    }
  }
  return colorFor(primitive.color || primitive.c, "#FFFFFF");
}

// Where a pace bar stands, as PaceBarFor works it out: filled to the smaller
// of use and plan, the piece up to the larger, the tick at the plan. On pace
// shows the use itself and no piece; without a pace it is a plain bar.
export function paceBarMarks(
  primitive: ThemePrimitive,
  frame: FrameData,
  percent: number,
) {
  const binding = primitive.binding || primitive.b || "";
  const pace = paceBinding(binding)?.field === "" ? boundPace(binding, frame) : undefined;
  if (!pace) {
    return { fillTo: percent, pieceTo: percent, planAt: -1, hatched: false };
  }
  const delta = pace.delta ?? 0;
  const planAt = Math.max(
    0,
    Math.min(100, percent + (frame.usageMode === "used" ? -delta : delta)),
  );
  const onPace = pace.state === "on pace";
  return {
    fillTo: onPace ? percent : Math.min(percent, planAt),
    pieceTo: onPace ? percent : Math.max(percent, planAt),
    planAt,
    hatched: pace.state === "deficit",
  };
}

// The hatch's gaps are the track, tinted a little towards the stripe colour.
function hatchGapColor(stripe: string, track: string): string {
  const parse = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [s, t] = [parse(stripe), parse(track)];
  const mixed = t.map((channel, i) => Math.trunc(channel + (s[i] - channel) / 12));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

// The plan tick reaches this far beyond the bar or ring it marks.
const PACE_TICK_OVERHANG = 3;

function resolveProgressFillColor(
  primitive: ThemePrimitive,
  percent: number,
  usageMode?: string,
): string {
  const stops = [...(primitive.colorStops || primitive.cs || [])]
    .map((stop) => ({
      gte: typeof stop.gte === "number" ? stop.gte : -1,
      color: stop.color || stop.c || "",
    }))
    .filter((stop) => stop.gte >= 0 && stop.gte <= 100 && stop.color)
    .sort((a, b) => b.gte - a.gte);
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const remainingStyle =
    usageMode === "used" ? 100 - clamped : clamped;
  for (const stop of stops) {
    if (remainingStyle >= stop.gte) {
      return colorFor(stop.color, "#FFFFFF");
    }
  }
  return colorFor(primitive.color || primitive.c, "#FFFFFF");
}

function usageLaneText(value: number, unavailable: boolean): string {
  return unavailable ? "??" : String(value);
}

function activeAssetPath(primitive: ThemePrimitive, frame: FrameData): string {
  const providerAssets = primitive.providerAssets || primitive.pa || {};
  const provider = (frame.provider || "").trim().toLowerCase();
  if (provider && providerAssets[provider]) {
    return providerAssets[provider];
  }
  const stateAssets = primitive.stateAssets || primitive.sa || {};
  if (frame.activity === "coding" && stateAssets.coding) {
    return stateAssets.coding;
  }
  return stateAssets.idle || primitive.assetPath || primitive.a || "";
}

export function decodeSprite(raw: string): DecodedSprite | null {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const kind = lines[0];
  if (kind !== "CBI1" && kind !== "CBA1") {
    return null;
  }
  const header = lines[1]?.split(/\s+/).map(Number) || [];
  const width = header[0] || 0;
  const height = header[1] || 0;
  const frameCount = kind === "CBA1" ? header[2] || 1 : 1;
  const fps = kind === "CBA1" ? header[3] || 0 : 0;
  const paletteSize = Number(lines[2] || 0);
  if (width <= 0 || height <= 0 || frameCount <= 0 || paletteSize <= 0) {
    return null;
  }
  const palette = lines
    .slice(3, 3 + paletteSize)
    .map((entry) => colorFor(entry, "#000000"));
  const rowStart = 3 + paletteSize;
  const frames: Array<Array<SpriteRect>> = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const rows = lines.slice(
      rowStart + frameIndex * height,
      rowStart + (frameIndex + 1) * height,
    );
    frames.push(decodeRleRows(rows, width, palette));
  }
  return { width, height, fps, frames };
}

function useAnimationTick(framesPerSecond: number): number {
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    if (framesPerSecond <= 0) {
      return;
    }

    const intervalMs = Math.max(50, Math.ceil(1000 / framesPerSecond));
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: number | undefined;

    const stopTimer = () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };
    const pageIsActive = () =>
      !reducedMotion.matches &&
      document.visibilityState === "visible" &&
      document.hasFocus();
    const scheduleNextFrame = () => {
      stopTimer();
      if (!pageIsActive()) {
        return;
      }
      timer = window.setTimeout(() => {
        timer = undefined;
        setTick(Date.now());
        scheduleNextFrame();
      }, intervalMs);
    };
    const handlePageActivity = () => {
      if (pageIsActive()) {
        setTick(Date.now());
        scheduleNextFrame();
      } else {
        stopTimer();
        if (reducedMotion.matches) {
          setTick(0);
        }
      }
    };

    document.addEventListener("visibilitychange", handlePageActivity);
    window.addEventListener("focus", handlePageActivity);
    window.addEventListener("blur", handlePageActivity);
    reducedMotion.addEventListener("change", handlePageActivity);
    handlePageActivity();

    return () => {
      stopTimer();
      document.removeEventListener("visibilitychange", handlePageActivity);
      window.removeEventListener("focus", handlePageActivity);
      window.removeEventListener("blur", handlePageActivity);
      reducedMotion.removeEventListener("change", handlePageActivity);
    };
  }, [framesPerSecond]);

  return framesPerSecond > 0 ? tick : 0;
}

function spriteFrameIndex(
  sprite: DecodedSprite,
  animationTick: number,
): number {
  if (sprite.frames.length <= 1 || sprite.fps <= 0) {
    return 0;
  }
  return Math.floor((animationTick / 1000) * sprite.fps) % sprite.frames.length;
}

function ThemeSpriteImage({
  raw,
  animate,
  x,
  y,
  width,
  height,
  background,
}: {
  raw: string;
  animate: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  background?: string;
}) {
  // Editor geometry changes clone asset objects. Cache by their immutable text,
  // so only changed image bytes are decoded again, not every pointer move.
  const sprite = useMemo(() => decodeSprite(raw), [raw]);
  const renderWidth = width || sprite?.width || 0;
  const renderHeight = height || sprite?.height || 0;
  const animationTick = useAnimationTick(
    animate && sprite && sprite.frames.length > 1 ? sprite.fps : 0,
  );
  // Animation updates only this image, leaving the static background alone.
  const images = useMemo(
    () => sprite?.frames.map((rects) => {
      const pixels = scaleSpriteRects(rects, sprite, 0, 0, renderWidth, renderHeight)
        .map((rect) => `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="${rect.color}"/>`)
        .join("");
      return `data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${renderWidth}" height="${renderHeight}" viewBox="0 0 ${renderWidth} ${renderHeight}">${pixels}</svg>`,
      )}`;
    }) || [],
    [sprite, renderWidth, renderHeight],
  );
  return (
    <g>
      {background && <rect fill={colorFor(background, "#000000")} x={x} y={y} width={renderWidth} height={renderHeight} />}
      {sprite && <image
        href={images[spriteFrameIndex(sprite, animationTick)] || images[0]}
        x={x}
        y={y}
        width={renderWidth}
        height={renderHeight}
        imageRendering="pixelated"
        preserveAspectRatio="none"
      />}
    </g>
  );
}

function scaleSpriteRects(
  rects: SpriteRect[],
  sprite: DecodedSprite,
  x: number,
  y: number,
  targetWidth: number,
  targetHeight: number,
): SpriteRect[] {
  const drawWidth = targetWidth > 0 ? targetWidth : sprite.width;
  const drawHeight = targetHeight > 0 ? targetHeight : sprite.height;
  return rects.map((rect) => {
    const x1 = x + Math.floor((rect.x * drawWidth) / sprite.width);
    const x2 =
      x + Math.ceil(((rect.x + rect.width) * drawWidth) / sprite.width);
    const y1 = y + Math.floor((rect.y * drawHeight) / sprite.height);
    const y2 =
      y + Math.ceil(((rect.y + rect.height) * drawHeight) / sprite.height);
    return {
      ...rect,
      height: Math.max(1, y2 - y1),
      width: Math.max(1, x2 - x1),
      x: x1,
      y: y1,
    };
  });
}

function decodeRleRows(
  rows: string[],
  width: number,
  palette: string[],
): SpriteRect[] {
  const rects: SpriteRect[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    for (let index = 0; index < row.length;) {
      let digits = "";
      while (index < row.length && /[0-9]/.test(row[index])) {
        digits += row[index];
        index += 1;
      }
      const runLength = digits ? Number(digits) : 1;
      const token = row[index];
      index += 1;
      if (!token || runLength <= 0) {
        break;
      }
      if (token !== ".") {
        const colorIndex = token.charCodeAt(0) - 97;
        const color = palette[colorIndex];
        if (color) {
          rects.push({ x, y, width: runLength, height: 1, color });
        }
      }
      x += runLength;
      if (x > width) {
        break;
      }
    }
  });
  return rects;
}

function decodeBitmapBits(
  data: string,
  width: number,
  height: number,
): SpriteRect[] {
  const rects: SpriteRect[] = [];
  if (!data || width <= 0 || height <= 0) {
    return rects;
  }
  for (let y = 0; y < height; y += 1) {
    let runStart = -1;
    for (let x = 0; x <= width; x += 1) {
      const bit = x < width && bitmapBitSet(data, y * width + x);
      if (bit && runStart < 0) {
        runStart = x;
      } else if (!bit && runStart >= 0) {
        rects.push({
          x: runStart,
          y,
          width: x - runStart,
          height: 1,
          color: "",
        });
        runStart = -1;
      }
    }
  }
  return rects;
}

function bitmapBitSet(data: string, bitIndex: number): boolean {
  const hexIndex = Math.floor(bitIndex / 4);
  const raw = data[hexIndex];
  if (!raw) {
    return false;
  }
  const nibble = Number.parseInt(raw, 16);
  if (!Number.isFinite(nibble)) {
    return false;
  }
  return (nibble & (1 << (3 - (bitIndex % 4)))) !== 0;
}

function svgTextAnchor(align?: string): "start" | "middle" | "end" {
  if (align === "center") {
    return "middle";
  }
  if (align === "right") {
    return "end";
  }
  return "start";
}

function alignedTextX(
  x: number,
  maxWidth: number,
  anchor: "start" | "middle" | "end",
): number {
  if (anchor === "middle") {
    return x + maxWidth / 2;
  }
  if (anchor === "end") {
    return x + maxWidth;
  }
  return x;
}

export function themeTextValignBoxHeight(
  explicitHeight: number,
  font: number,
  maxSize: number,
): number {
  if (explicitHeight > 0) {
    return explicitHeight;
  }
  return themeFontSize(font, maxSize) + 4;
}

export function themeTextAlignedY(
  boxY: number,
  boxHeight: number,
  glyphHeight: number,
  valign: string | undefined,
): number {
  if (boxHeight <= 0) {
    return boxY;
  }
  if (valign === "middle" || valign === "center") {
    return boxY + Math.trunc((boxHeight - glyphHeight) / 2);
  }
  if (valign === "bottom") {
    return boxY + boxHeight - glyphHeight;
  }
  return boxY;
}

export function themeTextLayout(
  x: number,
  maxWidth: number,
  align: string | undefined,
  textWidth: number,
) {
  const clipWidth = Math.max(0, maxWidth);
  // TFT_eSPI keeps an overlong centered/right-aligned string at the left edge
  // of its viewport, then clips it. Match that behavior so every provider
  // label stays inside the same ThemeSpec lane in hardware and web previews.
  const textAnchor =
    clipWidth > 0 && textWidth > clipWidth
      ? ("start" as const)
      : clipWidth > 0
        ? svgTextAnchor(align)
        : ("start" as const);
  return {
    clipWidth,
    textAnchor,
    textX: alignedTextX(x, clipWidth, textAnchor),
  };
}

export function themeTextWidth(
  text: string,
  fontSize: number,
  measuredWidth?: number,
): number {
  if (
    typeof measuredWidth === "number" &&
    Number.isFinite(measuredWidth) &&
    (text === "" || measuredWidth > 0)
  ) {
    return measuredWidth;
  }
  return text.length * fontSize * 0.6;
}

export function themeTextFittedSize(
  text: string,
  font: number,
  maxSize: number,
  maxWidth: number,
  fitShrink: boolean,
): number {
  let size = Math.max(1, maxSize);
  if (!fitShrink || maxWidth <= 0) {
    return size;
  }
  while (size > 1) {
    const metrics = themeFirmwareTextMetrics(text, font, size);
    const width =
      metrics?.width ?? themeTextWidth(text, themeFontSize(font, size));
    if (width <= maxWidth) {
      break;
    }
    size -= 1;
  }
  return size;
}

// Same fallback and two-line fitting as themespec::FitText on the device.
export function themeTextFit(text: string, font: number, maxSize: number, maxWidth: number, shrink: boolean, height = 0) {
  let size = themeTextFittedSize(text, font, maxSize, maxWidth, shrink);
  const boxHeight = themeTextValignBoxHeight(height, font, maxSize);
  const width = (value: string) => themeFirmwareTextMetrics(value, font, size)?.width ?? themeTextWidth(value, themeFontSize(font, size));
  if (!shrink || maxWidth <= 0) return { font, size, lines: [text] };
  for (;;) {
    if (width(text) <= maxWidth) return { font, size, lines: [text] };
    if (boxHeight >= 2 * themeFontSize(font, size)) {
      const splits = Array.from(text.matchAll(/ /g), (match) => match.index!)
        .filter((index) => width(text.slice(0, index)) <= maxWidth && width(text.slice(index + 1)) <= maxWidth)
        .reverse();
      if (splits.length) return { font, size, lines: [text.slice(0, splits[0]), text.slice(splits[0] + 1)] };
    }
    if (font === 1) return { font, size, lines: [text] };
    font = 1;
    size = 1;
  }
}

// Mirrors TFT_eSPI 2.5.43 Fonts/Font16.c, pinned in
// firmware_esp8266/platformio.ini. Update both together when the pin changes.
const TFT_ESPI_FONT2_WIDTHS = [
  6, 3, 4, 9, 8, 9, 9, 3, 7, 7, 8, 6, 3, 6, 5, 7, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8,
  3, 3, 6, 6, 6, 8, 9, 8, 8, 8, 8, 8, 8, 8, 8, 4, 8, 8, 7, 10, 8, 8, 8, 8, 8, 8,
  8, 8, 8, 10, 8, 8, 8, 4, 7, 4, 7, 9, 5, 7, 7, 7, 7, 7, 6, 7, 7, 4, 5, 6, 4, 8,
  7, 8, 7, 8, 6, 6, 5, 7, 8, 8, 6, 7, 7, 5, 3, 5, 8, 6,
] as const;

// Mirrors the same pinned TFT_eSPI Font32rle.c (font 4).
const TFT_ESPI_FONT4_WIDTHS = [
  5, 8, 8, 19, 14, 21, 17, 6, 8, 8, 12, 10, 7, 8, 7, 8, 14, 14, 14, 14, 14, 14, 14, 14,
  14, 14, 7, 7, 14, 9, 14, 13, 25, 16, 17, 18, 18, 16, 15, 19, 18, 6, 13, 17, 13, 21, 18, 19,
  16, 19, 17, 16, 14, 18, 15, 23, 15, 16, 16, 9, 13, 9, 12, 13, 9, 14, 15, 13, 15, 14, 8, 15,
  15, 6, 6, 12, 6, 22, 15, 15, 15, 15, 8, 12, 7, 14, 12, 18, 13, 13, 12, 13, 13, 13, 15, 1,
] as const;

// Mirrors the classic GLCD font's CP437 glyph order in TFT_eSPI 2.5.43.
// TFT_eSPI keeps the historical Adafruit_GFX >175 one-glyph shift unless
// setCP437(true) is called; the firmware uses that default.
const TFT_GLCD_CP437_EXTENDED = Array.from(
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ",
);

export function themeFirmwareTextMetrics(
  text: string,
  font: number,
  size: number,
): {
  width: number;
  glyphs: Array<{ character: string; offset: number; width: number }>;
} | null {
  if (font !== 1 && font !== 2 && font !== 4) {
    return null;
  }
  const widths = font === 4 ? TFT_ESPI_FONT4_WIDTHS : TFT_ESPI_FONT2_WIDTHS;
  const scale = Math.max(1, size);
  let layoutOffset = 0;
  let drawOffset = 0;
  const glyphs: Array<{ character: string; offset: number; width: number }> =
    [];
  for (const character of Array.from(text)) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    const utf8ByteCount = new TextEncoder().encode(character).length;
    if (font === 1) {
      layoutOffset += utf8ByteCount * 6 * scale;
      const width = 6 * scale;
      const glyphIndex = codePoint > 175 ? codePoint + 1 : codePoint;
      const visibleCharacter =
        glyphIndex < 128
          ? String.fromCodePoint(glyphIndex)
          : TFT_GLCD_CP437_EXTENDED[glyphIndex - 128];
      if (visibleCharacter !== undefined) {
        glyphs.push({
          character: visibleCharacter,
          offset: drawOffset,
          width,
        });
      }
      drawOffset += width;
      continue;
    }

    if (codePoint >= 32 && codePoint <= 127) {
      const width = widths[codePoint - 32] * scale;
      glyphs.push({ character, offset: drawOffset, width });
      layoutOffset += width;
      drawOffset += width;
    } else {
      // Fonts 2/4 measure every unsupported UTF-8 byte as a space but drops the
      // decoded glyph without advancing the draw cursor.
      layoutOffset += utf8ByteCount * widths[0] * scale;
    }
  }
  return { width: layoutOffset, glyphs };
}

function themeTextStartX(
  textX: number,
  textAnchor: "start" | "middle" | "end",
  textWidth: number,
): number {
  if (textAnchor === "middle") {
    return textX - textWidth / 2;
  }
  if (textAnchor === "end") {
    return textX - textWidth;
  }
  return textX;
}

function themeFontSize(font?: number, size?: number): number {
  const scale = Math.max(1, size || 1);
  switch (font || 1) {
    case 2:
      return 16 * scale;
    case 4:
      return 26 * scale;
    case 6:
    case 7:
      return 48 * scale;
    case 8:
      return 75 * scale;
    case 1:
    default:
      return 8 * scale;
  }
}

function themeFontWeight(font?: number): number {
  return font === 4 || font === 6 || font === 7 || font === 8 ? 800 : 700;
}

function colorFor(value: string | undefined, fallback: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value || "") ? (value as string) : fallback;
}

function clampPercent(value?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatReset(seconds?: number, idle = false): string {
  if (!seconds || seconds <= 0) {
    return idle ? RESET_IDLE : RESET_UNAVAILABLE;
  }
  return formatResetCountdown(seconds);
}
