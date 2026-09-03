"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Image from "next/image";
import type { ReactNode } from "react";
import type { DeviceInfo, UsageSnapshot } from "./control-center-types";
import {
  deviceAwaitsProviderSetup,
  deviceIsActive,
  deviceIsCustomerConnected,
  deviceIsReady,
  deviceIsWaitingForUsage,
} from "./control-center-types";
import {
  companionRequestUrl,
  needsLoopbackTargetAddressSpace,
  themeRenderPackUrl,
} from "./control-center-runtime";
import { loadLocalThemeRenderPack } from "@/lib/local-theme-render-pack";

type LiveVibeTVPreviewProps = {
  device: DeviceInfo | null;
  displayFrame: DisplayFrameSnapshot | null;
  onPreviewReady?: () => void;
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
  status: "ready" | "error";
};

export type DisplayFrameSnapshot = {
  ok?: boolean;
  savedAt?: string;
  frame?: DisplayFrame;
};

type UsageSlotFrame = {
  id?: string;
  label?: string;
  percent?: number;
  resetSecs?: number;
};
type UsageWindowFrame = UsageSlotFrame;

type DisplayFrame = {
  v?: number;
  provider?: string;
  label?: string;
  session?: number;
  weekly?: number;
  usageUnavailable?: boolean;
  sessionUnavailable?: boolean;
  weeklyUnavailable?: boolean;
  resetSecs?: number;
  usageMode?: string;
  usageWindows?: UsageWindowFrame[];
  usageSlots?: UsageSlotFrame[];
  providerSlots?: UsageSlotFrame[];
  activity?: string;
  sessionTokens?: number;
  weekTokens?: number;
  totalTokens?: number;
  tokenTotalsKnown?: boolean;
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
  align?: string;
  al?: string;
  maxWidth?: number;
  mw?: number;
  progressStyle?: string;
  ps?: string;
  segments?: number;
  sg?: number;
  segmentGap?: number;
  gg?: number;
  assetPath?: string;
  a?: string;
  stateAssets?: Record<string, string>;
  sa?: Record<string, string>;
  data?: string;
  d?: string;
  r?: string[];
  p?: string[];
};

type FrameData = {
  provider: string;
  label: string;
  session: number;
  weekly: number;
  sessionUnavailable: boolean;
  weeklyUnavailable: boolean;
  resetSecs: number;
  usageMode: string;
  usageWindows: Array<{
    label: string;
    percent: number;
    resetSecs: number;
    available: boolean;
  }>;
  usageSlot1Label: string;
  usageSlot1Percent: number;
  usageSlot1ResetSecs: number;
  usageSlot1Available: boolean;
  usageSlot2Label: string;
  usageSlot2Percent: number;
  usageSlot2ResetSecs: number;
  usageSlot2Available: boolean;
  providerSlots: Array<{
    label: string;
    percent: number;
    resetSecs: number;
    available: boolean;
  }>;
  activity: string;
  sessionTokens: number;
  weekTokens: number;
  totalTokens: number;
  // Mirrors the firmware: token totals absent from the frame render as "--".
  hasTokenTotals: boolean;
  time: string;
  date: string;
};

// Catalog previews deliberately use short, generic usage windows. They are not
// connected to the current provider or VibeTV frame, so labels must not imply
// a provider-specific entitlement such as "Codex Spark Weekly".
export const THEME_CATALOG_PREVIEW_FRAME: FrameData = {
  provider: "vibetv",
  label: "VibeTV",
  session: 64,
  weekly: 64,
  sessionUnavailable: false,
  weeklyUnavailable: false,
  resetSecs: 3600,
  usageMode: "used",
  usageWindows: [
    { label: "Session", percent: 64, resetSecs: 3600, available: true },
    { label: "Weekly", percent: 28, resetSecs: 7200, available: true },
  ],
  usageSlot1Label: "Session",
  usageSlot1Percent: 64,
  usageSlot1ResetSecs: 3600,
  usageSlot1Available: true,
  usageSlot2Label: "Weekly",
  usageSlot2Percent: 28,
  usageSlot2ResetSecs: 7200,
  usageSlot2Available: true,
  providerSlots: [
    { label: "Claude", percent: 64, resetSecs: 3600, available: true },
    { label: "Codex", percent: 28, resetSecs: 12000, available: true },
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

export function useLatestDisplayFrame(
  connected: boolean,
  onFrame?: (frame: DisplayFrameSnapshot) => void,
) {
  const [displayFrame, setDisplayFrame] = useState<DisplayFrameSnapshot | null>(
    null,
  );

  useEffect(() => {
    if (!connected) {
      const timer = window.setTimeout(() => setDisplayFrame(null), 0);
      return () => window.clearTimeout(timer);
    }

    const controller = new AbortController();

    const refreshDisplayFrame = async () => {
      try {
        const requestInit: LocalDisplayFrameRequestInit = {
          cache: "no-store",
          signal: controller.signal,
        };
        const url = companionRequestUrl("/v1/display-frame/latest");
        if (needsLoopbackTargetAddressSpace(url)) {
          requestInit.targetAddressSpace = "loopback";
        }
        const response = await fetch(url, requestInit);
        const nextFrame = await parseLatestDisplayFrameResponse(response);
        if (!nextFrame) {
          setDisplayFrame(null);
          return;
        }
        setDisplayFrame(nextFrame);
        onFrame?.(nextFrame);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      }
    };

    void refreshDisplayFrame();
    const timer = window.setInterval(refreshDisplayFrame, 1000);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [connected, onFrame]);

  return displayFrame;
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
  const packStatus: "idle" | "loading" | "ready" | "error" = !themeId
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
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setPackState({
          themeId,
          themeSpecHash,
          themeSpecPath,
          pack: null,
          status: "error",
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

  const previewReady = Boolean(deviceConnected && pack?.spec && frame);
  useEffect(() => {
    if (!previewReady || !onPreviewReady) {
      return;
    }
    const timer = window.setTimeout(onPreviewReady, PREVIEW_HANDOVER_MS);
    return () => window.clearTimeout(timer);
  }, [onPreviewReady, previewReady]);

  return (
    <figure className="w-full max-w-[520px]">
      <VibeTVCaseShell>
        {updateOwnedDisconnect ? (
          <FirmwareUpdateRestarting />
        ) : !deviceConnected ? (
          <ThemePreviewOffline />
        ) : pack?.spec && frame ? (
          <ThemeSpecSVG
            assets={pack.assets || {}}
            frame={frame}
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
        )}
      </VibeTVCaseShell>
    </figure>
  );
}

// Matches the companion's displayStreamReadyAge window: a frame older than
// this is no longer evidence of a live device.
const RECONNECT_FRAME_GRACE_MS = 120_000;

// Retry cadence for the theme render pack while it is unavailable or does not
// match the device's active revision yet.
const THEME_PACK_RETRY_MS = 5_000;

export function frameFreshForReconnect(
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
    !hasRenderableUsage(displayFrame)
  ) {
    return null;
  }
  return displayFrame;
}

export function ThemeSpecPreview({
  animate = true,
  frame = THEME_CATALOG_PREVIEW_FRAME,
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
  spec,
  themeId,
}: {
  animate?: boolean;
  assets: Record<string, ThemePackAsset>;
  frame: FrameData;
  spec: ThemeSpec;
  themeId: string;
}) {
  const sprites = useMemo(() => decodeSpriteAssets(assets), [assets]);
  const primitives = spec.primitives || spec.p || [];
  const animationFps = useMemo(
    () => (animate ? maximumAnimatedSpriteFps(sprites) : 0),
    [animate, sprites],
  );
  const animationTick = useAnimationTick(animationFps);
  return (
    <svg
      aria-label={themeSpecAriaLabel(themeId, frame)}
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
          animationTick={animationTick}
          frame={frame}
          key={index}
          primitive={primitive}
          sprites={sprites}
        />
      ))}
    </svg>
  );
}

function ThemePrimitiveNode({
  assets,
  animationTick,
  frame,
  primitive,
  sprites,
}: {
  assets: Record<string, ThemePackAsset>;
  animationTick: number;
  frame: FrameData;
  primitive: ThemePrimitive;
  sprites: Record<string, DecodedSprite>;
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
    const text = renderTextPrimitive(primitive, frame);
    const maxWidth =
      primitive.maxWidth || primitive.mw || primitive.width || primitive.w || 0;
    const font = primitive.font || primitive.f || 1;
    const maxSize = Math.max(1, primitive.fontSize || primitive.s || 1);
    const size = themeTextFittedSize(
      text,
      font,
      maxSize,
      maxWidth,
      (primitive.fit || primitive.ft) === "shrink",
    );
    const fontSize = themeFontSize(font, size);
    return (
      <ThemeTextPrimitive
        align={primitive.align || primitive.al}
        color={colorFor(primitive.color || primitive.c, "#FFFFFF")}
        font={font}
        fontSize={fontSize}
        fontWeight={themeFontWeight(font)}
        maxWidth={maxWidth}
        size={size}
        text={text}
        x={x}
        y={y}
      />
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
    const sprite = assetPath ? sprites[assetPath] : undefined;
    const renderWidth = width || sprite?.width || 0;
    const renderHeight = height || sprite?.height || 0;
    if (!sprite) {
      return primitive.bg || primitive.bgColor ? (
        <rect
          fill={colorFor(primitive.bg || primitive.bgColor, "#000000")}
          height={renderHeight}
          width={renderWidth}
          x={x}
          y={y}
        />
      ) : null;
    }
    const currentFrame =
      sprite.frames[spriteFrameIndex(sprite, animationTick)] ||
      sprite.frames[0] ||
      [];
    return (
      <g>
        {(primitive.bg || primitive.bgColor) && (
          <rect
            fill={colorFor(primitive.bg || primitive.bgColor, "#000000")}
            height={renderHeight}
            width={renderWidth}
            x={x}
            y={y}
          />
        )}
        {scaleSpriteRects(
          currentFrame,
          sprite,
          x,
          y,
          renderWidth,
          renderHeight,
        ).map((rect, index) => (
          <rect
            fill={rect.color}
            height={rect.height}
            key={index}
            width={rect.width}
            x={rect.x}
            y={rect.y}
          />
        ))}
      </g>
    );
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
  maxWidth,
  size,
  text,
  x,
  y,
}: {
  align?: string;
  color: string;
  font: number;
  fontSize: number;
  fontWeight: number;
  maxWidth: number;
  size: number;
  text: string;
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
    y: y + fontSize * 0.8,
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
            y={y}
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
  const fillColor = colorFor(primitive.color || primitive.c, "#FFFFFF");
  const innerWidth = Math.max(0, width - 2);
  const innerHeight = Math.max(0, height - 2);
  const style = primitive.progressStyle || primitive.ps || "";
  const segmented = style === "segments" || style === "segmented";
  const radius = clampRadius(
    primitive.borderRadius ?? primitive.br ?? 0,
    width,
    height,
  );
  const innerRadius = Math.max(0, radius - 1);
  const fillWidth = Math.max(
    0,
    Math.min(innerWidth, Math.floor((innerWidth * percent) / 100)),
  );

  return (
    <g>
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
          percent={percent}
          segmentGap={primitive.segmentGap ?? primitive.gg ?? 1}
          segments={primitive.segments || primitive.sg || 10}
          width={innerWidth}
          x={x + 1}
          y={y + 1}
          radius={innerRadius}
        />
      ) : (
        <rect
          fill={fillColor}
          height={innerHeight}
          rx={clampRadius(innerRadius, fillWidth, innerHeight)}
          ry={clampRadius(innerRadius, fillWidth, innerHeight)}
          width={fillWidth}
          x={x + 1}
          y={y + 1}
        />
      )}
    </g>
  );
}

function SegmentedProgress({
  fillColor,
  height,
  percent,
  radius,
  segmentGap,
  segments,
  width,
  x,
  y,
}: {
  fillColor: string;
  height: number;
  percent: number;
  radius: number;
  segmentGap: number;
  segments: number;
  width: number;
  x: number;
  y: number;
}) {
  const filledSegments = Math.ceil((segments * percent) / 100);
  return (
    <g>
      {Array.from({ length: segments }, (_, index) => {
        const segX1 = x + (index * width) / segments;
        const segX2 = x + ((index + 1) * width) / segments;
        const segW = Math.max(0, segX2 - segX1 - Math.max(0, segmentGap));
        return index < filledSegments && segW > 0 ? (
          <rect
            fill={fillColor}
            height={height}
            key={index}
            rx={clampRadius(radius, segW, height)}
            ry={clampRadius(radius, segW, height)}
            width={segW}
            x={segX1}
            y={y}
          />
        ) : null;
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
  status: "idle" | "loading" | "ready" | "error";
  themeId: string;
}) {
  const content =
    message ||
    (status === "error"
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
  const savedAt = generatedAt ? new Date(generatedAt) : currentTime;
  const usableSavedAt = Number.isNaN(savedAt.getTime()) ? currentTime : savedAt;
  const elapsedSeconds = Math.max(
    0,
    Math.floor((currentTime.getTime() - usableSavedAt.getTime()) / 1000),
  );
  const remainingResetSeconds = (seconds: number | undefined) =>
    Math.max(0, (seconds ?? 0) - elapsedSeconds);
  const sourceUsageMode = frameUsageMode(displayFrame);
  const slots = (
    (displayFrame.usageWindows?.length
      ? displayFrame.usageWindows
      : displayFrame.usageSlots) || []
  ).filter((slot) => Boolean(slot.id?.trim() && slot.label?.trim()));
  const slot1 = slots[0];
  const slot2 = slots[1];
  return {
    provider: displayFrame.provider || "",
    label: displayFrame.label || displayFrame.provider || "",
    session: clampPercent(displayFrame.session),
    weekly: clampPercent(displayFrame.weekly),
    sessionUnavailable: displayFrame.sessionUnavailable === true,
    weeklyUnavailable: displayFrame.weeklyUnavailable === true,
    resetSecs: remainingResetSeconds(displayFrame.resetSecs),
    usageMode: sourceUsageMode,
    usageWindows: slots.map((slot) => ({
      label: slot.label || "",
      percent: clampPercent(slot.percent),
      resetSecs: remainingResetSeconds(slot.resetSecs),
      available: true,
    })),
    usageSlot1Label: slot1?.label || "",
    usageSlot1Percent: clampPercent(slot1?.percent),
    usageSlot1ResetSecs: remainingResetSeconds(slot1?.resetSecs),
    usageSlot1Available: Boolean(slot1),
    usageSlot2Label: slot2?.label || "",
    usageSlot2Percent: clampPercent(slot2?.percent),
    usageSlot2ResetSecs: remainingResetSeconds(slot2?.resetSecs),
    usageSlot2Available: Boolean(slot2),
    providerSlots: (displayFrame.providerSlots || [])
      .filter((slot) => Boolean(slot.id?.trim() && slot.label?.trim()))
      .map((slot) => ({
        label: slot.label || "",
        percent: clampPercent(slot.percent),
        resetSecs: remainingResetSeconds(slot.resetSecs),
        available: true,
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

export function primitiveUsageSlotVisible(
  primitive: ThemePrimitive,
  frame: FrameData,
): boolean {
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

export function themeSpecAriaLabel(themeId: string, frame: FrameData): string {
  const usage = frame.usageWindows
    .filter((window) => window.available)
    .map((window) => `${window.label} ${window.percent}% ${frame.usageMode}`);
  return `Rendered VibeTV theme ${themeId} showing ${frame.label}, ${usage.length > 0 ? usage.join(", ") : "no usage windows available"}`;
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

function activeThemeId(device: DeviceInfo | null): string {
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

function normalizeThemeSpecHash(value: string | undefined): string {
  const hash = (value || "").trim().toLowerCase();
  return /^[a-f0-9]{8}$/.test(hash) ? hash : "";
}

function renderPackSpecHash(pack: ThemeRenderPack): string {
  return normalizeThemeSpecHash(pack.specHash);
}

export async function fetchThemeRenderPackRevision(
  themeId: string,
  themeSpecPath: string,
  themeSpecHash: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<ThemeRenderPack> {
  const exactResponse = await fetcher(
    themeRenderPackUrl(themeId, themeSpecPath, themeSpecHash),
    { signal },
  );
  if (exactResponse.ok) {
    return exactResponse.json() as Promise<ThemeRenderPack>;
  }
  if (!themeSpecPath) {
    throw new Error("theme pack unavailable");
  }

  // Old Companions only expose the latest cache by theme ID. Their payload
  // still includes specPath, which lets the caller reject a wrong revision.
  const legacyResponse = await fetcher(themeRenderPackUrl(themeId), { signal });
  if (!legacyResponse.ok) {
    throw new Error("theme pack unavailable");
  }
  return legacyResponse.json() as Promise<ThemeRenderPack>;
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

// The firmware renders this wherever a countdown has expired or its basis went
// stale. A preview that softens it to "0m" tells the customer something the
// device never shows.
const RESET_UNAVAILABLE = "Reset unavailable";

export function renderTextPrimitive(
  primitive: ThemePrimitive,
  frame: FrameData,
): string {
  const binding = primitive.binding || primitive.b;
  if (binding) {
    return boundValue(binding, frame);
  }
  const raw = primitive.text || primitive.v || "";
  // RenderTextTemplate replaces the whole template for an expired root
  // countdown instead of substituting in place, so the surrounding literal
  // text disappears. Only the root tokens do this — {usage.N.reset}, {us1r}
  // and {pv1r} substitute inline, and the device really does render
  // "Reset in Reset unavailable" for those.
  if (frame.resetSecs <= 0 && /\{reset\}|\{resetCountdown\}|\{r\}/.test(raw)) {
    return RESET_UNAVAILABLE;
  }
  return raw.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_match, key: string) =>
    boundValue(key, frame),
  );
}

// Mirrors the firmware's FormatTokenCount digit for digit (truncated
// hundredths, never rounded) so catalog previews and the device agree.
export function formatTokenCount(value: number): string {
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

export function boundValue(key: string, frame: FrameData): string {
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
      return formatReset(window.resetSecs);
    }
    return String(window.percent);
  }
  switch (key) {
    case "label":
    case "providerLabel":
    case "l":
      return frame.label;
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
      return formatReset(frame.resetSecs);
    case "usageSlot1Label":
    case "us1l":
      return frame.usageSlot1Available ? frame.usageSlot1Label : "";
    case "usageSlot1Percent":
    case "us1p":
      return frame.usageSlot1Available ? String(frame.usageSlot1Percent) : "";
    case "usageSlot1Reset":
    case "us1r":
      return frame.usageSlot1Available
        ? formatReset(frame.usageSlot1ResetSecs)
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
        ? formatReset(frame.usageSlot2ResetSecs)
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
        ? formatReset(frame.providerSlots[0].resetSecs)
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
        ? formatReset(frame.providerSlots[1].resetSecs)
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

function usageLaneText(value: number, unavailable: boolean): string {
  return unavailable ? "??" : String(value);
}

function activeAssetPath(primitive: ThemePrimitive, frame: FrameData): string {
  const stateAssets = primitive.stateAssets || primitive.sa || {};
  if (frame.activity === "coding" && stateAssets.coding) {
    return stateAssets.coding;
  }
  return stateAssets.idle || primitive.assetPath || primitive.a || "";
}

function decodeSpriteAssets(
  assets: Record<string, ThemePackAsset>,
): Record<string, DecodedSprite> {
  const decoded: Record<string, DecodedSprite> = {};
  for (const [assetPath, asset] of Object.entries(assets)) {
    if (asset.encoding !== "text") {
      continue;
    }
    const sprite = decodeSprite(asset.data);
    if (sprite) {
      decoded[assetPath] = sprite;
    }
  }
  return decoded;
}

function decodeSprite(raw: string): DecodedSprite | null {
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

function maximumAnimatedSpriteFps(
  sprites: Record<string, DecodedSprite>,
): number {
  const maximumFps = Object.values(sprites).reduce(
    (currentMaximum, sprite) =>
      sprite.frames.length > 1
        ? Math.max(currentMaximum, sprite.fps)
        : currentMaximum,
    0,
  );
  return Math.min(20, Math.max(0, maximumFps));
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

// Mirrors TFT_eSPI 2.5.43 Fonts/Font16.c, pinned in
// firmware_esp8266/platformio.ini. Update both together when the pin changes.
const TFT_ESPI_FONT2_WIDTHS = [
  6, 3, 4, 9, 8, 9, 9, 3, 7, 7, 8, 6, 3, 6, 5, 7, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8,
  3, 3, 6, 6, 6, 8, 9, 8, 8, 8, 8, 8, 8, 8, 8, 4, 8, 8, 7, 10, 8, 8, 8, 8, 8, 8,
  8, 8, 8, 10, 8, 8, 8, 4, 7, 4, 7, 9, 5, 7, 7, 7, 7, 7, 6, 7, 7, 4, 5, 6, 4, 8,
  7, 8, 7, 8, 6, 6, 5, 7, 8, 8, 6, 7, 7, 5, 3, 5, 8, 6,
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
  if (font !== 1 && font !== 2) {
    return null;
  }
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
      const width = TFT_ESPI_FONT2_WIDTHS[codePoint - 32] * scale;
      glyphs.push({ character, offset: drawOffset, width });
      layoutOffset += width;
      drawOffset += width;
    } else {
      // Font 2 measures every unsupported UTF-8 byte as a space but drops the
      // decoded glyph without advancing the draw cursor.
      layoutOffset += utf8ByteCount * TFT_ESPI_FONT2_WIDTHS[0] * scale;
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

function formatReset(seconds?: number): string {
  if (!seconds || seconds <= 0) {
    return RESET_UNAVAILABLE;
  }
  const totalMinutes = Math.floor(seconds / 60);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}
