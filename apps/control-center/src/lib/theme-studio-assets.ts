import type { ThemeStudioAsset } from "@/lib/theme-studio";

const DEFAULT_SPRITE_FPS = 8;
const MAX_SPRITE_FRAME_WIDTH = 64;
const MAX_SPRITE_FRAME_HEIGHT = 64;
const MAX_SPRITE_FRAMES = 32;
const MAX_SPRITE_TOTAL_PIXELS = 32768;

export type ThemeStudioAssetKind = "gif" | "sprite";

export type SpriteMetadata = {
  width: number;
  height: number;
  frameCount: number;
  fps: number;
};

export type SpriteImportResult = {
  asset: ThemeStudioAsset;
  assetPath: string;
  fps: number;
  frameCount: number;
  height: number;
  sheetColumns: number;
  width: number;
};

type EncodedSprite = {
  fps: number;
  frameCount: number;
  frames: string[][];
  height: number;
  palette: string[];
  width: number;
};

export async function importSpriteFile(file: File): Promise<SpriteImportResult> {
  if (isSpriteTextFile(file)) {
    const raw = ensureTrailingNewline(await file.text());
    const metadata = spriteMetadata(raw);
    if (!metadata) {
      throw new Error("Sprite file must be CBI1 or CBA1.");
    }
    const extension = raw.trimStart().startsWith("CBA1") ? ".cba" : ".cbi";
    return {
      asset: {
        contentType: "text/plain",
        data: raw,
        encoding: "text",
      },
      assetPath: themeAssetPathForFile(file.name, extension),
      fps: metadata.fps,
      frameCount: metadata.frameCount,
      height: metadata.height,
      sheetColumns: metadata.frameCount,
      width: metadata.width,
    };
  }

  if (file.type && !file.type.startsWith("image/")) {
    throw new Error("Choose a PNG, JPEG, WebP, CBI, or CBA file.");
  }

  const bitmap = await createImageBitmap(file);
  try {
    const frame = inferSpriteSheetFrame(bitmap.width, bitmap.height);
    const sprite = spriteFromBitmap(bitmap, frame);
    return {
      asset: {
        contentType: "text/plain",
        data: encodeSpriteAsset(sprite),
        encoding: "text",
      },
      assetPath: themeAssetPathForFile(file.name, ".cba"),
      fps: sprite.fps,
      frameCount: sprite.frameCount,
      height: sprite.height,
      sheetColumns: frame.columns,
      width: sprite.width,
    };
  } finally {
    bitmap.close();
  }
}

function inferSpriteSheetFrame(width: number, height: number) {
  let frameWidth = width;
  let frameHeight = height;
  if (
    width !== height ||
    width > MAX_SPRITE_FRAME_WIDTH ||
    height > MAX_SPRITE_FRAME_HEIGHT
  ) {
    const commonSizes = [64, 48, 32, 24, 16, 8];
    const squareCell = commonSizes.find((size) => {
      const frames = (width / size) * (height / size);
      return (
        width % size === 0 &&
        height % size === 0 &&
        frames >= 2 &&
        frames <= MAX_SPRITE_FRAMES &&
        size <= MAX_SPRITE_FRAME_WIDTH &&
        size <= MAX_SPRITE_FRAME_HEIGHT
      );
    });
    if (squareCell) {
      frameWidth = squareCell;
      frameHeight = squareCell;
    } else if (height <= MAX_SPRITE_FRAME_HEIGHT && width % height === 0) {
      frameWidth = height;
      frameHeight = height;
    } else {
      frameWidth = Math.min(width, MAX_SPRITE_FRAME_WIDTH);
      frameHeight = Math.min(height, MAX_SPRITE_FRAME_HEIGHT);
    }
  }
  frameWidth = clampInt(frameWidth, 1, Math.min(MAX_SPRITE_FRAME_WIDTH, width));
  frameHeight = clampInt(frameHeight, 1, Math.min(MAX_SPRITE_FRAME_HEIGHT, height));
  const columns = Math.max(1, Math.floor(width / frameWidth));
  const rows = Math.max(1, Math.floor(height / frameHeight));
  const frameCount = Math.min(
    MAX_SPRITE_FRAMES,
    columns * rows,
    Math.max(1, Math.floor(MAX_SPRITE_TOTAL_PIXELS / (frameWidth * frameHeight))),
  );
  return { columns, frameCount, height: frameHeight, width: frameWidth };
}

function spriteFromBitmap(
  bitmap: ImageBitmap,
  frame: { columns: number; frameCount: number; height: number; width: number },
): EncodedSprite {
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return {
      fps: 0,
      frameCount: 1,
      frames: [Array.from({ length: frame.height }, () => `${frame.width}.`)],
      height: frame.height,
      palette: ["#FFFFFF"],
      width: frame.width,
    };
  }

  const rawFrames: Array<Array<string | null>> = [];
  const colorCounts = new Map<string, number>();
  for (let frameIndex = 0; frameIndex < frame.frameCount; frameIndex += 1) {
    const sx = (frameIndex % frame.columns) * frame.width;
    const sy = Math.floor(frameIndex / frame.columns) * frame.height;
    context.clearRect(0, 0, frame.width, frame.height);
    context.drawImage(
      bitmap,
      sx,
      sy,
      frame.width,
      frame.height,
      0,
      0,
      frame.width,
      frame.height,
    );
    const image = context.getImageData(0, 0, frame.width, frame.height).data;
    const pixels: Array<string | null> = [];
    for (let offset = 0; offset < image.length; offset += 4) {
      const alpha = image[offset + 3] ?? 0;
      if (alpha < 128) {
        pixels.push(null);
        continue;
      }
      const color = quantizedHexColor(
        image[offset] ?? 0,
        image[offset + 1] ?? 0,
        image[offset + 2] ?? 0,
      );
      colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1);
      pixels.push(color);
    }
    rawFrames.push(pixels);
  }

  const nonEmptyFrames = rawFrames.filter((pixels) =>
    pixels.some((color) => color !== null),
  );
  const framesToEncode = nonEmptyFrames.length > 0 ? nonEmptyFrames : rawFrames.slice(0, 1);
  const palette = Array.from(colorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 26)
    .map(([color]) => color);
  if (palette.length === 0) {
    palette.push("#FFFFFF");
  }

  const frames = framesToEncode.map((pixels) => {
    const rows: string[] = [];
    for (let row = 0; row < frame.height; row += 1) {
      const tokens: string[] = [];
      for (let col = 0; col < frame.width; col += 1) {
        const color = pixels[row * frame.width + col];
        tokens.push(color ? paletteTokenForColor(color, palette) : ".");
      }
      rows.push(encodeRleTokenRow(tokens));
    }
    return rows;
  });

  return {
    fps: frames.length > 1 ? DEFAULT_SPRITE_FPS : 0,
    frameCount: frames.length,
    frames,
    height: frame.height,
    palette,
    width: frame.width,
  };
}

function encodeSpriteAsset(sprite: EncodedSprite): string {
  if (sprite.frameCount <= 1) {
    return ensureTrailingNewline(
      [
        "CBI1",
        `${sprite.width} ${sprite.height}`,
        String(sprite.palette.length),
        ...sprite.palette,
        ...(sprite.frames[0] || []),
      ].join("\n"),
    );
  }
  return ensureTrailingNewline(
    [
      "CBA1",
      `${sprite.width} ${sprite.height} ${sprite.frameCount} ${sprite.fps}`,
      String(sprite.palette.length),
      ...sprite.palette,
      ...sprite.frames.flat(),
    ].join("\n"),
  );
}

function encodeRleTokenRow(tokens: string[]): string {
  let output = "";
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index] || ".";
    let count = 1;
    while (tokens[index + count] === token) {
      count += 1;
    }
    output += `${count > 1 ? count : ""}${token}`;
    index += count;
  }
  return output;
}

function quantizedHexColor(r: number, g: number, b: number): string {
  const quantize = (value: number) => clampInt(Math.round(value / 17) * 17, 0, 255);
  return `#${[quantize(r), quantize(g), quantize(b)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

function paletteTokenForColor(color: string, palette: string[]): string {
  const exactIndex = palette.indexOf(color);
  const index = exactIndex >= 0 ? exactIndex : nearestPaletteIndex(color, palette);
  return String.fromCharCode(97 + clampInt(index, 0, palette.length - 1));
}

function nearestPaletteIndex(color: string, palette: string[]): number {
  const [r, g, b] = rgbFromHex(color);
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  palette.forEach((candidate, index) => {
    const [cr, cg, cb] = rgbFromHex(candidate);
    const distance = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function rgbFromHex(color: string): [number, number, number] {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

export function spriteMetadata(raw: string | undefined): SpriteMetadata | null {
  if (!raw) {
    return null;
  }
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const kind = lines[0];
  if (kind !== "CBI1" && kind !== "CBA1") {
    return null;
  }
  const header = (lines[1] || "").split(/\s+/).map(Number);
  const width = header[0] || 0;
  const height = header[1] || 0;
  const frameCount = kind === "CBA1" ? header[2] || 0 : 1;
  const fps = kind === "CBA1" ? header[3] || 0 : 0;
  const paletteSize = Number(lines[2] || 0);
  if (
    width <= 0 ||
    height <= 0 ||
    frameCount <= 0 ||
    paletteSize <= 0 ||
    paletteSize > 26
  ) {
    return null;
  }
  return { width, height, frameCount, fps };
}

export function themeAssetPathForFile(
  name: string,
  extension: ".cba" | ".cbi" | ".gif",
): string {
  return `/themes/u/${safeAssetName(name, extension)}`;
}

function safeAssetName(name: string, extension: ".cba" | ".cbi" | ".gif"): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const withoutExtension = cleaned.replace(/\.[a-z0-9]+$/i, "");
  const withExtension = cleaned.endsWith(extension)
    ? cleaned
    : `${withoutExtension || "asset"}${extension}`;
  if (withExtension.length <= 21) {
    return withExtension;
  }
  const base = withExtension.slice(0, -extension.length);
  const maxBase = 21 - extension.length;
  return `${base.slice(0, maxBase).replace(/[._-]+$/g, "") || "asset"}${extension}`;
}

function isSpriteTextFile(file: File): boolean {
  return /\.(cbi|cba)$/i.test(file.name) || file.type === "text/plain";
}

export async function fileToBase64(file: File): Promise<string> {
  return arrayBufferToBase64(await file.arrayBuffer());
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return window.btoa(binary);
}

export function themeAssetByteLength(asset: ThemeStudioAsset): number {
  if (asset.encoding === "text") {
    return new TextEncoder().encode(asset.data).byteLength;
  }
  return Math.floor((asset.data.replace(/=+$/, "").length * 3) / 4);
}

export function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  return `${Math.round(value / 1024)} KB`;
}

export function assetKind(path: string): ThemeStudioAssetKind | null {
  if (/\.gif$/i.test(path)) {
    return "gif";
  }
  if (/\.(cbi|cba)$/i.test(path)) {
    return "sprite";
  }
  return null;
}

export function assetKindLabel(path: string): string {
  const kind = assetKind(path);
  return kind === "gif" ? "GIF" : kind === "sprite" ? "Sprite" : "Asset";
}

export function assetFileName(path: string): string {
  return path.split("/").pop()?.trim() || "asset.bin";
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function clampInt(value: number, min: number, max: number): number {
  const rounded = Math.round(value);
  return Math.max(min, Math.min(Math.max(min, max), rounded));
}
