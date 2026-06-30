"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import type { ReactNode } from "react";
import type {
  DeviceInfo,
  UsageProviderInfo,
  UsageSnapshot,
} from "./control-center-types";

type LiveVibeTVPreviewProps = {
  device: DeviceInfo | null;
  usage: UsageSnapshot | null;
};

type ThemePackAsset = {
  contentType: string;
  data: string;
  encoding: "base64" | "text";
};

type ThemeRenderPack = {
  ok?: boolean;
  themeId?: string;
  name?: string;
  spec?: ThemeSpec;
  assets?: Record<string, ThemePackAsset>;
};

type ThemePackState = {
  themeId: string;
  pack: ThemeRenderPack | null;
  status: "ready" | "error";
};

type DisplayFrameSnapshot = {
  ok?: boolean;
  savedAt?: string;
  frame?: DisplayFrame;
};

type DisplayFrame = {
  provider?: string;
  label?: string;
  session?: number;
  weekly?: number;
  resetSecs?: number;
  usageMode?: string;
  activity?: string;
  sessionTokens?: number;
  weekTokens?: number;
  totalTokens?: number;
};

type LocalDisplayFrameRequestInit = RequestInit & {
  targetAddressSpace?: "loopback";
};

type ThemeSpec = {
  id?: string;
  themeId?: string;
  bg?: string;
  bgColor?: string;
  p?: ThemePrimitive[];
  primitives?: ThemePrimitive[];
};

type ThemePrimitive = {
  type?: string;
  t?: string;
  x?: number;
  y?: number;
  width?: number;
  w?: number;
  height?: number;
  h?: number;
  text?: string;
  v?: string;
  binding?: string;
  b?: string;
  fontSize?: number;
  s?: number;
  font?: number;
  f?: number;
  color?: string;
  c?: string;
  bgColor?: string;
  bg?: string;
  borderColor?: string;
  bc?: string;
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
  resetSecs: number;
  usageMode: string;
  activity: string;
  sessionTokens: number;
  weekTokens: number;
  totalTokens: number;
  time: string;
  date: string;
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

export function LiveVibeTVPreview({ device, usage }: LiveVibeTVPreviewProps) {
  const provider = currentUsageProvider(usage);
  const themeId = activeThemeId(device);
  const [displayFrame, setDisplayFrame] = useState<DisplayFrameSnapshot | null>(
    null,
  );
  const frame = buildFrameData(
    provider,
    displayFrame?.savedAt || usage?.generatedAt,
    displayFrame?.frame,
  );
  const [packState, setPackState] = useState<ThemePackState | null>(null);
  const pack = packState?.themeId === themeId ? packState.pack : null;
  const packStatus: "idle" | "loading" | "ready" | "error" = !themeId
    ? "idle"
    : packState?.themeId === themeId
      ? packState.status
      : "loading";

  useEffect(() => {
    if (!themeId) {
      return;
    }

    const controller = new AbortController();
    fetch(`/api/theme-pack/${encodeURIComponent(themeId)}`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("theme pack unavailable");
        }
        return response.json() as Promise<ThemeRenderPack>;
      })
      .then((payload) => {
        setPackState({
          themeId,
          pack: payload,
          status: payload?.spec ? "ready" : "error",
        });
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setPackState({ themeId, pack: null, status: "error" });
      });

    return () => controller.abort();
  }, [themeId]);

  useEffect(() => {
    const controller = new AbortController();

    const refreshDisplayFrame = async () => {
      try {
        const requestInit: LocalDisplayFrameRequestInit = {
          cache: "no-store",
          signal: controller.signal,
        };
        const url = displayFrameUrl();
        if (url.startsWith("http://127.0.0.1:47832/")) {
          requestInit.targetAddressSpace = "loopback";
        }
        const response = await fetch(url, requestInit);
        if (!response.ok) {
          throw new Error("display frame unavailable");
        }
        setDisplayFrame((await response.json()) as DisplayFrameSnapshot);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setDisplayFrame(null);
      }
    };

    void refreshDisplayFrame();
    const timer = window.setInterval(refreshDisplayFrame, 5000);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  return (
    <figure className="w-full max-w-[540px]">
      <VibeTVCaseShell>
        {pack?.spec ? (
          <ThemeSpecSVG
            assets={pack.assets || {}}
            frame={frame}
            spec={pack.spec}
            themeId={pack.themeId || themeId}
          />
        ) : (
          <ThemeSpecLoading status={packStatus} themeId={themeId} />
        )}
      </VibeTVCaseShell>
    </figure>
  );
}

function displayFrameUrl(): string {
  if (typeof window === "undefined") {
    return "http://127.0.0.1:47832/v1/display-frame/latest";
  }
  if (["127.0.0.1", "localhost", "::1"].includes(window.location.hostname)) {
    return "/api/local-companion/v1/display-frame/latest";
  }
  return "http://127.0.0.1:47832/v1/display-frame/latest";
}

function VibeTVCaseShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative mx-auto w-full"
      data-testid="vibetv-case"
    >
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
  assets,
  frame,
  spec,
  themeId,
}: {
  assets: Record<string, ThemePackAsset>;
  frame: FrameData;
  spec: ThemeSpec;
  themeId: string;
}) {
  const sprites = useMemo(() => decodeSpriteAssets(assets), [assets]);
  const primitives = spec.primitives || spec.p || [];
  const hasAnimatedSprites = useMemo(
    () =>
      Object.values(sprites).some(
        (sprite) => sprite.fps > 0 && sprite.frames.length > 1,
      ),
    [sprites],
  );
  const animationTick = useAnimationTick(hasAnimatedSprites);
  return (
    <svg
      aria-label={`Rendered VibeTV theme ${themeId} showing ${frame.label}, ${frame.session}% session ${frame.usageMode}, ${frame.weekly}% weekly ${frame.usageMode}`}
      className="aspect-square w-full bg-black [image-rendering:pixelated]"
      role="img"
      viewBox="0 0 240 240"
    >
      <rect height="240" width="240" fill={colorFor(spec.bgColor || spec.bg, "#000000")} />
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

  if (type === "rect" || type === "r") {
    return (
      <rect
        fill={colorFor(primitive.color || primitive.c, "#000000")}
        height={height}
        width={width}
        x={x}
        y={y}
      />
    );
  }

  if (type === "text" || type === "tx") {
    const text = renderTextPrimitive(primitive, frame);
    const maxWidth = primitive.maxWidth || primitive.mw || primitive.width || primitive.w || 0;
    const fontSize = themeFontSize(primitive.font || primitive.f, primitive.fontSize || primitive.s);
    const textAnchor = svgTextAnchor(primitive.align || primitive.al);
    const textX = alignedTextX(x, maxWidth, textAnchor);
    return (
      <text
        dominantBaseline="hanging"
        fill={colorFor(primitive.color || primitive.c, "#FFFFFF")}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
        fontSize={fontSize}
        fontWeight={themeFontWeight(primitive.font || primitive.f)}
        letterSpacing="0"
        textAnchor={textAnchor}
        x={textX}
        y={y}
      >
        {text}
      </text>
    );
  }

  if (type === "progress" || type === "p") {
    return <ThemeProgress frame={frame} primitive={primitive} />;
  }

  if (type === "sprite" || type === "sp" || type === "image" || type === "img") {
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
      sprite.frames[spriteFrameIndex(sprite, animationTick)] || sprite.frames[0] || [];
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
        {scaleSpriteRects(currentFrame, sprite, x, y, renderWidth, renderHeight).map((rect, index) => (
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
  const borderColor = colorFor(primitive.borderColor || primitive.bc, "#7BEF7B");
  const bgColor = colorFor(primitive.bgColor || primitive.bg, "#000000");
  const fillColor = colorFor(primitive.color || primitive.c, "#FFFFFF");
  const innerWidth = Math.max(0, width - 2);
  const innerHeight = Math.max(0, height - 2);
  const style = primitive.progressStyle || primitive.ps || "";
  const segmented = style === "segments" || style === "segmented";

  return (
    <g>
      <rect fill="none" height={height} stroke={borderColor} width={width} x={x} y={y} />
      <rect fill={bgColor} height={innerHeight} width={innerWidth} x={x + 1} y={y + 1} />
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
        />
      ) : (
        <rect
          fill={fillColor}
          height={innerHeight}
          width={Math.max(0, Math.min(innerWidth, Math.floor((width * percent) / 100)))}
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
  segmentGap,
  segments,
  width,
  x,
  y,
}: {
  fillColor: string;
  height: number;
  percent: number;
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
            width={segW}
            x={segX1}
            y={y}
          />
        ) : null;
      })}
    </g>
  );
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
        {decodeRleRows(rows, width, palette.map((entry) => colorFor(entry, "#000000"))).map(
          (rect, index) => (
            <rect
              fill={rect.color}
              height={rect.height}
              key={index}
              width={rect.width}
              x={x + rect.x}
              y={y + rect.y}
            />
          ),
        )}
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
  status,
  themeId,
}: {
  status: "idle" | "loading" | "ready" | "error";
  themeId: string;
}) {
  const message =
    status === "error"
      ? "ThemeSpec not available"
      : themeId
        ? "Loading ThemeSpec"
        : "Waiting for theme";
  return (
    <div className="grid aspect-square w-full place-items-center border border-[#747A60] bg-[#111111] p-4 text-center font-mono text-sm font-bold uppercase text-[#CCFF00]">
      {message}
    </div>
  );
}

function currentUsageProvider(
  usage: UsageSnapshot | null,
): UsageProviderInfo | null {
  const providers = usage?.providers || [];
  if (providers.length === 0) {
    return null;
  }
  return (
    providers.find((provider) => provider.id === usage?.currentProvider) ||
    providers[0]
  );
}

function buildFrameData(
  provider: UsageProviderInfo | null,
  generatedAt?: string,
  displayFrame?: DisplayFrame,
): FrameData {
  const now = generatedAt ? new Date(generatedAt) : new Date();
  const usableDate = Number.isNaN(now.getTime()) ? new Date() : now;
  const sourceUsageMode = frameUsageMode(displayFrame, provider);
  return {
    provider: displayFrame?.provider || provider?.id || "",
    label:
      displayFrame?.label ||
      provider?.label ||
      displayFrame?.provider ||
      provider?.id ||
      "",
    session: previewUsagePercent(
      displayFrame?.session ?? provider?.session,
      sourceUsageMode,
    ),
    weekly: previewUsagePercent(
      displayFrame?.weekly ?? provider?.weekly,
      sourceUsageMode,
    ),
    resetSecs: displayFrame?.resetSecs ?? provider?.resetSecs ?? 0,
    usageMode: "remaining",
    activity: displayFrame?.activity || provider?.activity || "idle",
    sessionTokens: displayFrame?.sessionTokens ?? provider?.sessionTokens ?? 0,
    weekTokens: displayFrame?.weekTokens ?? provider?.weekTokens ?? 0,
    totalTokens: displayFrame?.totalTokens ?? provider?.totalTokens ?? 0,
    time: new Intl.DateTimeFormat("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(usableDate),
    date: new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
    }).format(usableDate),
  };
}

function previewUsagePercent(value: number | undefined, sourceUsageMode: string): number {
  const percent = clampPercent(value);
  return sourceUsageMode === "remaining" ? percent : 100 - percent;
}

function frameUsageMode(
  displayFrame: DisplayFrame | undefined,
  provider: UsageProviderInfo | null,
): string {
  if (displayFrame?.usageMode === "remaining" || displayFrame?.usageMode === "used") {
    return displayFrame.usageMode;
  }
  return provider?.usageMode === "remaining" ? "remaining" : "used";
}

function activeThemeId(device: DeviceInfo | null): string {
  const theme = device?.activeTheme?.trim().toLowerCase();
  if (theme) {
    return theme;
  }
  return "";
}

function renderTextPrimitive(primitive: ThemePrimitive, frame: FrameData): string {
  const binding = primitive.binding || primitive.b;
  if (binding) {
    return boundValue(binding, frame);
  }
  const raw = primitive.text || primitive.v || "";
  return raw.replace(/\{([a-zA-Z0-9_-]+)\}/g, (_match, key: string) =>
    boundValue(key, frame),
  );
}

function boundValue(key: string, frame: FrameData): string {
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
      return String(frame.session);
    case "weekly":
    case "weeklyPercent":
    case "w":
      return String(frame.weekly);
    case "reset":
    case "resetCountdown":
    case "r":
      return formatReset(frame.resetSecs);
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
      return String(frame.sessionTokens);
    case "weekTokens":
    case "wt":
      return String(frame.weekTokens);
    case "totalTokens":
    case "tt":
      return String(frame.totalTokens);
    default:
      return "";
  }
}

function progressPercent(primitive: ThemePrimitive, frame: FrameData): number {
  const binding = primitive.binding || primitive.b || "";
  return binding === "weekly" || binding === "weeklyPercent" || binding === "w"
    ? frame.weekly
    : frame.session;
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
  const palette = lines.slice(3, 3 + paletteSize).map((entry) =>
    colorFor(entry, "#000000"),
  );
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

function useAnimationTick(enabled: boolean): number {
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const timer = window.setInterval(() => setTick(Date.now()), 50);
    return () => window.clearInterval(timer);
  }, [enabled]);

  return tick;
}

function spriteFrameIndex(sprite: DecodedSprite, animationTick: number): number {
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
    const x2 = x + Math.ceil(((rect.x + rect.width) * drawWidth) / sprite.width);
    const y1 = y + Math.floor((rect.y * drawHeight) / sprite.height);
    const y2 = y + Math.ceil(((rect.y + rect.height) * drawHeight) / sprite.height);
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

function decodeBitmapBits(data: string, width: number, height: number): SpriteRect[] {
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
        rects.push({ x: runStart, y, width: x - runStart, height: 1, color: "" });
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
    return "0m";
  }
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}
