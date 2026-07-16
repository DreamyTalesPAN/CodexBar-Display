export type ThemeStudioPrimitiveType =
  | "rect"
  | "text"
  | "progress"
  | "gif"
  | "sprite"
  | "pixels";

export type ThemeStudioBinding =
  | "label"
  | "provider"
  | "session"
  | "weekly"
  | "reset"
  | "usageMode"
  | "activity"
  | "time"
  | "date"
  | "sessionTokens"
  | "weekTokens"
  | "totalTokens"
  | string;

export type ThemeStudioPrimitive = {
  type: ThemeStudioPrimitiveType;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  binding?: ThemeStudioBinding;
  fontSize?: number;
  font?: number;
  color?: string;
  bgColor?: string;
  borderColor?: string;
  align?: "left" | "center" | "right";
  progressStyle?: "solid" | "segments";
  segments?: number;
  segmentGap?: number;
  assetPath?: string;
  stateAssets?: Record<string, string>;
  frameCount?: number;
  fps?: number;
  sheetColumns?: number;
  data?: string;
  p?: string[];
  r?: string[];
};

export type ThemeStudioSpec = {
  themeSpecVersion: 1;
  themeId: string;
  themeRev: number;
  fallbackTheme?: "mini" | "classic" | "crt" | string;
  bgColor?: string;
  primitives: ThemeStudioPrimitive[];
};

export type ThemeStudioDraft = {
  assets?: Record<string, ThemeStudioAsset>;
  savedAt: string;
  packName: string;
  spec: ThemeStudioSpec;
};

export type ThemeStudioAsset = {
  contentType: string;
  data: string;
  encoding: "base64" | "text";
};

export type ThemeStudioValidation = {
  errors: string[];
  warnings: string[];
  bytes: number;
  primitiveCount: number;
  themeSpecPath: string;
};

export type ThemePackBuild = {
  fileName: string;
  manifest: ThemePackManifest;
  themeJson: string;
  themeSpecPath: string;
  zipBytes: Uint8Array;
};

type ThemePackManifest = {
  kind: "vibetv-theme-pack";
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  minFirmware: string;
  themeSpec: {
    path: string;
    file: "theme.json";
    bytes: number;
    contentType: "application/json";
  };
  assets: Array<{
    path: string;
    file: string;
    bytes: number;
    contentType: string;
  }>;
};

type ZipSourceFile = {
  name: string;
  data: Uint8Array;
};

const DISPLAY_SIZE = 240;
const FIXED_THEME_REV = 1;
const FIXED_FALLBACK_THEME = "mini";
const MAX_STORED_THEME_SPEC_BYTES = 4096;
const MAX_THEME_PRIMITIVES = 32;
const MAX_GIF_BYTES = 24 * 1024;
const MAX_GIF_WIDTH = 80;
const MAX_GIF_HEIGHT = 80;
const MAX_GIF_PIXELS = MAX_GIF_WIDTH * MAX_GIF_HEIGHT;
const MAX_SPRITE_FRAME_WIDTH = 64;
const MAX_SPRITE_FRAME_HEIGHT = 64;
const MAX_STATIC_SPRITE_FRAME_WIDTH = DISPLAY_SIZE;
const MAX_STATIC_SPRITE_FRAME_HEIGHT = DISPLAY_SIZE;
const MAX_SPRITE_FRAMES = 32;
const MAX_SPRITE_TOTAL_PIXELS = 32768;
const DEFAULT_SPRITE_FPS = 8;
const MAX_ESP8266_LITTLEFS_PATH_CHARS = 31;
const USER_THEME_ASSET_PATH_PREFIX = "/themes/u/";
const THEME_ID_RE = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const SHORT_COLOR_RE = /^#[0-9a-fA-F]{3}$/;
const PLAIN_COLOR_RE = /^[0-9a-fA-F]{6}$/;
const RGB_COLOR_RE =
  /^rgba?\(\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)(?:\s*,\s*[+-]?\d+(?:\.\d+)?%?)?\s*\)$/i;
const CSS_COLOR_NAMES: Record<string, string> = {
  aqua: "#00FFFF",
  black: "#000000",
  blue: "#0000FF",
  cyan: "#00FFFF",
  darkgray: "#A9A9A9",
  darkgrey: "#A9A9A9",
  fuchsia: "#FF00FF",
  gray: "#808080",
  green: "#008000",
  grey: "#808080",
  lime: "#00FF00",
  magenta: "#FF00FF",
  maroon: "#800000",
  navy: "#000080",
  neonblue: "#35C9FF",
  neongreen: "#CCFF00",
  neonpink: "#FF4FA3",
  neonpurple: "#8A7CFF",
  orange: "#FFA500",
  purple: "#800080",
  red: "#FF0000",
  silver: "#C0C0C0",
  teal: "#008080",
  transparent: "",
  white: "#FFFFFF",
  yellow: "#FFFF00",
};
const STATE_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const SUPPORTED_PRIMITIVE_TYPES: ThemeStudioPrimitiveType[] = [
  "rect",
  "text",
  "progress",
  "gif",
  "sprite",
  "pixels",
];
const SHORT_TYPES: Record<string, ThemeStudioPrimitiveType> = {
  bar: "progress",
  image: "sprite",
  rectangle: "rect",
  tx: "text",
  r: "rect",
  p: "progress",
  g: "gif",
  sp: "sprite",
  img: "sprite",
  px: "pixels",
};
const SHORT_BINDINGS: Record<string, ThemeStudioBinding> = {
  l: "label",
  name: "label",
  pr: "provider",
  s: "session",
  sessionpercent: "session",
  session_pct: "session",
  sessionusage: "session",
  w: "weekly",
  week: "weekly",
  weeklypercent: "weekly",
  weekly_pct: "weekly",
  weeklyusage: "weekly",
  r: "reset",
  resetcountdown: "reset",
  u: "usageMode",
  mode: "usageMode",
  act: "activity",
  tm: "time",
  dt: "date",
  st: "sessionTokens",
  wt: "weekTokens",
  tt: "totalTokens",
};
const COMPACT_TYPES: Record<ThemeStudioPrimitiveType, string> = {
  rect: "r",
  text: "tx",
  progress: "p",
  gif: "g",
  sprite: "sp",
  pixels: "px",
};
const COMPACT_BINDINGS: Record<string, string> = {
  label: "l",
  provider: "pr",
  session: "s",
  sessionPercent: "s",
  weekly: "w",
  weeklyPercent: "w",
  reset: "r",
  resetCountdown: "r",
  usageMode: "u",
  activity: "act",
  time: "tm",
  date: "dt",
  sessionTokens: "st",
  weekTokens: "wt",
  totalTokens: "tt",
};

export const THEME_STUDIO_DRAFT_STORAGE_KEY =
  "vibetv.controlCenter.themeStudioDraft";

export function createBlankThemeSpec(): ThemeStudioSpec {
  return {
    themeSpecVersion: 1,
    themeId: "my-theme",
    themeRev: FIXED_THEME_REV,
    fallbackTheme: FIXED_FALLBACK_THEME,
    bgColor: "#000000",
    primitives: [
      {
        type: "rect",
        x: 0,
        y: 0,
        width: DISPLAY_SIZE,
        height: DISPLAY_SIZE,
        color: "#000000",
      },
    ],
  };
}

export function createStarterThemeSpec(): ThemeStudioSpec {
  return {
    themeSpecVersion: 1,
    themeId: "mini-classic",
    themeRev: FIXED_THEME_REV,
    fallbackTheme: FIXED_FALLBACK_THEME,
    bgColor: "#000000",
    primitives: [
      {
        type: "text",
        x: 0,
        y: 4,
        width: 240,
        binding: "label",
        align: "center",
        fontSize: 2,
        color: "#999999",
      },
      {
        type: "text",
        x: 7,
        y: 30,
        text: "Session",
        fontSize: 2,
        color: "#999999",
      },
      {
        type: "text",
        x: 7,
        y: 60,
        text: "{session}%",
        fontSize: 5,
        color: "#CCFF00",
      },
      {
        type: "text",
        x: 153,
        y: 30,
        text: "Weekly",
        fontSize: 2,
        color: "#999999",
      },
      {
        type: "text",
        x: 144,
        y: 66,
        width: 90,
        text: "{weekly}%",
        align: "right",
        fontSize: 5,
        color: "#CCFF00",
      },
      {
        type: "gif",
        x: 82,
        y: 122,
        width: 76,
        height: 76,
        assetPath: "/themes/mini/mini.gif",
      },
      {
        type: "text",
        x: 24,
        y: 208,
        width: 192,
        text: "Reset in {reset}",
        align: "center",
        fontSize: 2,
        color: "#999999",
      },
      {
        type: "text",
        x: 7,
        y: 106,
        text: "{usageMode}",
        fontSize: 2,
        color: "#999999",
      },
      {
        type: "text",
        x: 128,
        y: 106,
        width: 108,
        text: "{usageMode}",
        align: "right",
        fontSize: 2,
        color: "#999999",
      },
    ],
  };
}

export function cloneThemeSpec(spec: ThemeStudioSpec): ThemeStudioSpec {
  return JSON.parse(JSON.stringify(spec)) as ThemeStudioSpec;
}

export function importThemeSpec(value: unknown): ThemeStudioSpec {
  if (!isRecord(value)) {
    throw new Error("Theme file must contain a JSON object.");
  }
  const primitives =
    arrayValue(value.primitives) ??
    arrayValue(value.elements) ??
    arrayValue(value.layers) ??
    arrayValue(value.p);
  if (!primitives) {
    throw new Error("Theme file needs a primitives array.");
  }
  const spec: ThemeStudioSpec = {
    themeSpecVersion: 1,
    themeId: stringValue(value.themeId) ?? stringValue(value.id) ?? "",
    themeRev:
      numberValue(value.themeRev) ?? numberValue(value.rev) ?? FIXED_THEME_REV,
    fallbackTheme:
      stringValue(value.fallbackTheme) ??
      stringValue(value.fb) ??
      FIXED_FALLBACK_THEME,
    bgColor: normalizeColor(
      colorStringValue(value.bgColor) ??
        colorStringValue(value.backgroundColor) ??
        colorStringValue(value.background) ??
        colorStringValue(value.bg),
    ),
    primitives: primitives.map(importPrimitive),
  };
  return normalizeThemeSpec(spec);
}

export function normalizeThemeSpec(spec: ThemeStudioSpec): ThemeStudioSpec {
  const next = cloneThemeSpec(spec);
  next.themeSpecVersion = 1;
  next.themeId = slugThemeId(next.themeId || "custom-mini");
  next.themeRev = FIXED_THEME_REV;
  next.fallbackTheme = FIXED_FALLBACK_THEME;
  next.bgColor = normalizeColor(next.bgColor) || "#000000";
  next.primitives = Array.isArray(next.primitives) ? next.primitives : [];
  next.primitives = next.primitives.map((primitive) => ({
    ...primitive,
    type: expandPrimitiveType(primitive.type),
    x: integerOrDefault(primitive.x, 0),
    y: integerOrDefault(primitive.y, 0),
    color: normalizeColor(primitive.color),
    bgColor: normalizeColor(primitive.bgColor),
    borderColor: normalizeColor(primitive.borderColor),
    align:
      primitive.align === "center" || primitive.align === "right"
        ? primitive.align
        : primitive.align === "left"
          ? "left"
          : undefined,
    progressStyle:
      primitive.progressStyle === "segments" ? "segments" : undefined,
    frameCount:
      primitive.frameCount === undefined
        ? undefined
        : integerOrDefault(primitive.frameCount, 1),
    fps:
      primitive.fps === undefined
        ? undefined
        : integerOrDefault(primitive.fps, DEFAULT_SPRITE_FPS),
    sheetColumns:
      primitive.sheetColumns === undefined
        ? undefined
        : integerOrDefault(primitive.sheetColumns, 1),
  }));
  return next;
}

export function validateThemeSpec(
  spec: ThemeStudioSpec,
  assets: Record<string, ThemeStudioAsset> = {},
): ThemeStudioValidation {
  const normalized = normalizeThemeSpec(spec);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!THEME_ID_RE.test(normalized.themeId)) {
    errors.push("Theme ID must be lowercase and 3-64 characters.");
  }
  if (normalized.themeRev !== FIXED_THEME_REV) {
    errors.push(`Theme revision must be ${FIXED_THEME_REV}.`);
  }
  if (normalized.fallbackTheme !== FIXED_FALLBACK_THEME) {
    errors.push("Fallback theme must be mini.");
  }
  if (normalized.bgColor && !COLOR_RE.test(normalized.bgColor)) {
    errors.push("Background color must use #RRGGBB.");
  }
  if (normalized.primitives.length === 0) {
    errors.push("Add at least one visual element.");
  }
  if (normalized.primitives.length > MAX_THEME_PRIMITIVES) {
    errors.push(
      `Too many elements: ${normalized.primitives.length}/${MAX_THEME_PRIMITIVES}.`,
    );
  }

  normalized.primitives.forEach((primitive, index) => {
    validatePrimitive(primitive, index, errors, warnings, assets);
  });

  const themeJson = deviceThemeSpecJson(normalized);
  const bytes = new TextEncoder().encode(themeJson).byteLength;
  if (bytes > MAX_STORED_THEME_SPEC_BYTES) {
    errors.push(
      `Theme file is too large: ${bytes}/${MAX_STORED_THEME_SPEC_BYTES} bytes.`,
    );
  }

  return {
    errors,
    warnings,
    bytes,
    primitiveCount: normalized.primitives.length,
    themeSpecPath: themeSpecAssetPath(normalized),
  };
}

export function buildThemePack(
  spec: ThemeStudioSpec,
  packName: string,
  assets: Record<string, ThemeStudioAsset> = {},
): ThemePackBuild {
  const normalized = normalizeThemeSpec(spec);
  const validation = validateThemeSpec(normalized, assets);
  if (validation.errors.length > 0) {
    throw new Error(validation.errors[0]);
  }

  const themeJson = `${deviceThemeSpecJson(normalized)}\n`;
  const themeSpecData = new TextEncoder().encode(themeJson);
  const referencedAssets = referencedThemeAssetPaths(normalized);
  const usedFiles = new Set(["manifest.json", "theme.json"]);
  const assetFiles = referencedAssets.map((assetPath, index) => {
    const asset = assets[assetPath];
    const file = uniquePackAssetFile(assetPath, usedFiles, index);
    return {
      asset,
      bytes: themeStudioAssetBytes(asset),
      contentType: asset.contentType || "application/octet-stream",
      file,
      path: assetPath,
    };
  });
  const manifest: ThemePackManifest = {
    kind: "vibetv-theme-pack",
    schemaVersion: 1,
    id: normalized.themeId,
    name: cleanPackName(packName) || titleFromThemeId(normalized.themeId),
    version: "0.1.0",
    minFirmware: "1.0.24",
    themeSpec: {
      path: validation.themeSpecPath,
      file: "theme.json",
      bytes: themeSpecData.byteLength,
      contentType: "application/json",
    },
    assets: assetFiles.map((asset) => ({
      path: asset.path,
      file: asset.file,
      bytes: asset.bytes.byteLength,
      contentType: asset.contentType,
    })),
  };
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  const zipBytes = buildStoredZip([
    { name: "manifest.json", data: new TextEncoder().encode(manifestJson) },
    { name: "theme.json", data: themeSpecData },
    ...assetFiles.map((asset) => ({ name: asset.file, data: asset.bytes })),
  ]);

  return {
    fileName: `vibetv-theme-${normalized.themeId}.zip`,
    manifest,
    themeJson,
    themeSpecPath: validation.themeSpecPath,
    zipBytes,
  };
}

export function deviceThemeSpecJson(spec: ThemeStudioSpec): string {
  return JSON.stringify(buildDeviceThemeSpec(spec));
}

export function updateThemeColors(
  spec: ThemeStudioSpec,
  colors: {
    background?: string;
    primary?: string;
    secondary?: string;
    muted?: string;
  },
): ThemeStudioSpec {
  const next = normalizeThemeSpec(spec);
  if (colors.background) {
    next.bgColor = normalizeColor(colors.background) || next.bgColor;
    const background = next.primitives.find(
      (primitive) =>
        primitive.type === "rect" &&
        primitive.x === 0 &&
        primitive.y === 0 &&
        primitive.width === DISPLAY_SIZE &&
        primitive.height === DISPLAY_SIZE,
    );
    if (background) {
      background.color = next.bgColor;
    }
  }
  next.primitives.forEach((primitive) => {
    const text = primitive.text || "";
    if (
      colors.primary &&
      (text.includes("{session}") || primitive.binding === "session")
    ) {
      primitive.color = normalizeColor(colors.primary);
      if (primitive.type === "progress") {
        primitive.borderColor = normalizeColor(colors.primary);
      }
    }
    if (
      colors.secondary &&
      (text.includes("{weekly}") || primitive.binding === "weekly")
    ) {
      primitive.color = normalizeColor(colors.secondary);
    }
    if (
      colors.muted &&
      primitive.type === "text" &&
      !text.includes("{session}") &&
      !text.includes("{weekly}") &&
      primitive.binding !== "label"
    ) {
      primitive.color = normalizeColor(colors.muted);
    }
  });
  return next;
}

function validatePrimitive(
  primitive: ThemeStudioPrimitive,
  index: number,
  errors: string[],
  warnings: string[],
  assets: Record<string, ThemeStudioAsset>,
) {
  const prefix = `Element ${index + 1}`;
  if (!SUPPORTED_PRIMITIVE_TYPES.includes(primitive.type)) {
    errors.push(`${prefix}: type is not supported.`);
    return;
  }
  if (!isNonNegativeInteger(primitive.x) || !isNonNegativeInteger(primitive.y)) {
    errors.push(`${prefix}: x/y must be whole numbers starting at 0.`);
  }
  for (const key of ["color", "bgColor", "borderColor"] as const) {
    const value = primitive[key];
    if (value && !COLOR_RE.test(value)) {
      errors.push(`${prefix}: ${key} must use #RRGGBB.`);
    }
  }

  if (primitive.type === "text") {
    if ((!primitive.text || primitive.text.trim() === "") && !primitive.binding) {
      errors.push(`${prefix}: text or binding is required.`);
    }
    if (
      primitive.fontSize !== undefined &&
      (!Number.isInteger(primitive.fontSize) || primitive.fontSize < 1)
    ) {
      errors.push(`${prefix}: font size must be at least 1.`);
    }
  }

  if (primitive.type === "rect" || primitive.type === "progress") {
    if (!isPositiveInteger(primitive.width) || !isPositiveInteger(primitive.height)) {
      errors.push(`${prefix}: width/height must be greater than 0.`);
    }
  }

  if (primitive.type === "progress") {
    if (
      primitive.progressStyle !== undefined &&
      primitive.progressStyle !== "solid" &&
      primitive.progressStyle !== "segments"
    ) {
      errors.push(`${prefix}: progress style must be solid or segments.`);
    }
    if (
      primitive.segments !== undefined &&
      (!Number.isInteger(primitive.segments) ||
        primitive.segments < 1 ||
        primitive.segments > 32)
    ) {
      errors.push(`${prefix}: segments must be between 1 and 32.`);
    }
  }

  if (primitive.type === "gif" || primitive.type === "sprite") {
    validateThemeAssetPaths(primitive, prefix, errors);
    const paths = primitiveAssetPaths(primitive);
    for (const assetPath of paths) {
      if (!assets[assetPath]) {
        errors.push(`${prefix}: ${assetPath} is not loaded.`);
      }
    }
  }

  if (primitive.type === "gif") {
    if (!isPositiveInteger(primitive.width) || !isPositiveInteger(primitive.height)) {
      errors.push(`${prefix}: width/height must be greater than 0.`);
    } else if (
      primitive.width > MAX_GIF_WIDTH ||
      primitive.height > MAX_GIF_HEIGHT ||
      primitive.width * primitive.height > MAX_GIF_PIXELS
    ) {
      errors.push(`${prefix}: GIF must stay within ${MAX_GIF_WIDTH}x${MAX_GIF_HEIGHT}.`);
    }
    for (const assetPath of primitiveAssetPaths(primitive)) {
      const asset = assets[assetPath];
      if (asset && themeStudioAssetBytes(asset).byteLength > MAX_GIF_BYTES) {
        errors.push(
          `${prefix}: ${assetPath} is too large (${themeStudioAssetBytes(asset).byteLength}/${MAX_GIF_BYTES} bytes).`,
        );
      }
    }
  }

  if (primitive.type === "sprite") {
    if (primitive.width !== undefined && (!isPositiveInteger(primitive.width) || primitive.width > DISPLAY_SIZE)) {
      errors.push(`${prefix}: sprite width must be between 1 and ${DISPLAY_SIZE}.`);
    }
    if (primitive.height !== undefined && (!isPositiveInteger(primitive.height) || primitive.height > DISPLAY_SIZE)) {
      errors.push(`${prefix}: sprite height must be between 1 and ${DISPLAY_SIZE}.`);
    }
    if (
      primitive.frameCount !== undefined &&
      (!isPositiveInteger(primitive.frameCount) || primitive.frameCount > MAX_SPRITE_FRAMES)
    ) {
      errors.push(`${prefix}: sprite frames must be between 1 and ${MAX_SPRITE_FRAMES}.`);
    }
    if (
      primitive.fps !== undefined &&
      (!Number.isInteger(primitive.fps) || primitive.fps < 0 || primitive.fps > 30)
    ) {
      errors.push(`${prefix}: sprite FPS must be between 0 and 30.`);
    }
    for (const assetPath of primitiveAssetPaths(primitive)) {
      const asset = assets[assetPath];
      const sprite = asset?.encoding === "text" ? spriteMetadata(asset.data) : null;
      if (asset && !sprite) {
        errors.push(`${prefix}: ${assetPath} is not a valid sprite asset.`);
      }
      const width = sprite?.width ?? primitive.width ?? 0;
      const height = sprite?.height ?? primitive.height ?? 0;
      const frames = sprite?.frameCount ?? primitive.frameCount ?? 1;
      const maxFrameWidth =
        sprite?.kind === "CBI1"
          ? MAX_STATIC_SPRITE_FRAME_WIDTH
          : MAX_SPRITE_FRAME_WIDTH;
      const maxFrameHeight =
        sprite?.kind === "CBI1"
          ? MAX_STATIC_SPRITE_FRAME_HEIGHT
          : MAX_SPRITE_FRAME_HEIGHT;
      if (width > maxFrameWidth || height > maxFrameHeight) {
        errors.push(
          `${prefix}: sprite frames must stay within ${maxFrameWidth}x${maxFrameHeight}.`,
        );
      }
      if (width * height * frames > MAX_SPRITE_TOTAL_PIXELS) {
        errors.push(
          `${prefix}: sprite is too large (${width * height * frames}/${MAX_SPRITE_TOTAL_PIXELS} pixels across frames).`,
        );
      }
    }
  }

  if (primitive.type === "pixels") {
    if (!isPositiveInteger(primitive.width) || !isPositiveInteger(primitive.height)) {
      errors.push(`${prefix}: width/height must be greater than 0.`);
    } else if (primitive.width * primitive.height > 1024) {
      errors.push(`${prefix}: pixel masks must stay under 1024 pixels.`);
    }
  }

  const width = primitive.width ?? estimatePrimitiveWidth(primitive);
  const height = primitive.height ?? estimatePrimitiveHeight(primitive);
  if (primitive.x + width > DISPLAY_SIZE || primitive.y + height > DISPLAY_SIZE) {
    errors.push(`${prefix}: it must stay inside 240x240.`);
  }
}

function spriteMetadata(raw: string): {
  kind: "CBI1" | "CBA1";
  width: number;
  height: number;
  frameCount: number;
  fps: number;
} | null {
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
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    !Number.isInteger(frameCount) ||
    !Number.isInteger(fps) ||
    !Number.isInteger(paletteSize) ||
    width <= 0 ||
    height <= 0 ||
    frameCount <= 0 ||
    paletteSize <= 0 ||
    paletteSize > 26
  ) {
    return null;
  }
  const rowStart = 3 + paletteSize;
  const rows = lines.slice(rowStart, rowStart + frameCount * height);
  if (rows.length !== frameCount * height) {
    return null;
  }
  return { kind, width, height, frameCount, fps };
}

export function referencedThemeAssetPaths(spec: ThemeStudioSpec): string[] {
  const paths = new Set<string>();
  for (const primitive of normalizeThemeSpec(spec).primitives) {
    for (const assetPath of primitiveAssetPaths(primitive)) {
      paths.add(assetPath);
    }
  }
  return [...paths];
}

function validateThemeAssetPaths(
  primitive: ThemeStudioPrimitive,
  prefix: string,
  errors: string[],
) {
  const paths = [
    primitive.assetPath,
    ...Object.values(primitive.stateAssets || {}),
  ].filter((path): path is string => Boolean(path));
  if (paths.length === 0) {
    errors.push(`${prefix}: asset path is required.`);
  }
  for (const [stateName, assetPath] of Object.entries(
    primitive.stateAssets || {},
  )) {
    if (!STATE_NAME_RE.test(stateName)) {
      errors.push(`${prefix}: state name ${stateName} is not supported.`);
    }
    if (stateName !== "idle" && stateName !== "coding") {
      errors.push(`${prefix}: use idle or coding for state assets.`);
    }
    validateThemeAssetPath(assetPath, prefix, errors);
  }
  if (primitive.assetPath) {
    validateThemeAssetPath(primitive.assetPath, prefix, errors);
  }
}

function primitiveAssetPaths(primitive: ThemeStudioPrimitive): string[] {
  if (primitive.type !== "gif" && primitive.type !== "sprite") {
    return [];
  }
  return [
    primitive.assetPath,
    ...Object.values(primitive.stateAssets || {}),
  ].filter((path): path is string => Boolean(path));
}

function validateThemeAssetPath(
  assetPath: string,
  prefix: string,
  errors: string[],
) {
  if (
    !assetPath.startsWith("/themes/") ||
    assetPath.includes("..") ||
    assetPath.includes("\\") ||
    assetPath.includes("//") ||
    assetPath.endsWith("/")
  ) {
    errors.push(`${prefix}: asset path must be under /themes/.`);
  }
  if (assetPath.length > MAX_ESP8266_LITTLEFS_PATH_CHARS) {
    errors.push(
      `${prefix}: asset path is too long (${assetPath.length}/${MAX_ESP8266_LITTLEFS_PATH_CHARS}).`,
    );
  }
}

function buildDeviceThemeSpec(spec: ThemeStudioSpec): Record<string, unknown> {
  const normalized = normalizeThemeSpec(spec);
  const compact: Record<string, unknown> = {
    v: normalized.themeSpecVersion,
    id: normalized.themeId,
    rev: normalized.themeRev,
    p: normalized.primitives.map(buildDevicePrimitive),
  };
  if (normalized.fallbackTheme) {
    compact.fb = normalized.fallbackTheme;
  }
  if (normalized.bgColor) {
    compact.bg = normalized.bgColor;
  }
  return compact;
}

function buildDevicePrimitive(
  primitive: ThemeStudioPrimitive,
): Record<string, unknown> {
  const compact: Record<string, unknown> = {
    t: COMPACT_TYPES[primitive.type],
    x: primitive.x,
    y: primitive.y,
  };
  if (primitive.width !== undefined) {
    compact.w = primitive.width;
  }
  if (primitive.height !== undefined) {
    compact.h = primitive.height;
  }
  if (primitive.text !== undefined) {
    compact.v = primitive.text;
  }
  if (primitive.binding !== undefined) {
    compact.b = COMPACT_BINDINGS[primitive.binding] || primitive.binding;
  }
  if (primitive.fontSize !== undefined) {
    compact.s = primitive.fontSize;
  }
  if (primitive.font !== undefined) {
    compact.f = primitive.font;
  }
  if (primitive.align && primitive.align !== "left") {
    compact.al = primitive.align;
  }
  if (primitive.progressStyle === "segments") {
    compact.ps = "segments";
  }
  if (primitive.segments !== undefined) {
    compact.sg = primitive.segments;
  }
  if (primitive.segmentGap !== undefined) {
    compact.gg = primitive.segmentGap;
  }
  if (primitive.color !== undefined) {
    compact.c = primitive.color;
  }
  if (primitive.bgColor !== undefined) {
    compact.bg = primitive.bgColor;
  }
  if (primitive.borderColor !== undefined) {
    compact.bc = primitive.borderColor;
  }
  if (primitive.assetPath !== undefined) {
    compact.a = primitive.assetPath;
  }
  if (primitive.stateAssets !== undefined) {
    compact.sa = primitive.stateAssets;
  }
  if (primitive.frameCount !== undefined) {
    compact.fc = primitive.frameCount;
  }
  if (primitive.fps !== undefined) {
    compact.fps = primitive.fps;
  }
  if (primitive.sheetColumns !== undefined) {
    compact.sc = primitive.sheetColumns;
  }
  if (primitive.data !== undefined) {
    compact.d = primitive.data;
  }
  if (primitive.p !== undefined) {
    compact.p = primitive.p;
  }
  if (primitive.r !== undefined) {
    compact.r = primitive.r;
  }
  return compact;
}

function importPrimitive(value: unknown): ThemeStudioPrimitive {
  if (!isRecord(value)) {
    throw new Error("Every visual element must be an object.");
  }
  const type = expandPrimitiveType(
    stringValue(value.type) ??
      stringValue(value.kind) ??
      stringValue(value.elementType) ??
      stringValue(value.t) ??
      "",
  );
  const primitive: ThemeStudioPrimitive = {
    type,
    x: numberValue(value.x) ?? 0,
    y: numberValue(value.y) ?? 0,
  };
  const width = numberValue(value.width) ?? numberValue(value.w);
  const height = numberValue(value.height) ?? numberValue(value.h);
  if (width !== undefined) {
    primitive.width = width;
  }
  if (height !== undefined) {
    primitive.height = height;
  }
  const text = stringValue(value.text) ?? stringValue(value.label) ?? stringValue(value.v);
  if (text !== undefined) {
    primitive.text = text;
  }
  const binding =
    stringValue(value.binding) ??
    stringValue(value.dataKey) ??
    stringValue(value.metric) ??
    stringValue(value.value) ??
    stringValue(value.b);
  if (binding !== undefined) {
    primitive.binding = expandBinding(binding);
  }
  const fontSize = numberValue(value.fontSize) ?? numberValue(value.s);
  if (fontSize !== undefined) {
    primitive.fontSize = fontSize;
  }
  const font = numberValue(value.font) ?? numberValue(value.f);
  if (font !== undefined) {
    primitive.font = font;
  }
  const align = stringValue(value.align) ?? stringValue(value.al);
  if (align === "left" || align === "center" || align === "right") {
    primitive.align = align;
  }
  const progressStyle = stringValue(value.progressStyle) ?? stringValue(value.ps);
  if (progressStyle === "segments" || progressStyle === "segmented") {
    primitive.progressStyle = "segments";
  }
  const segments = numberValue(value.segments) ?? numberValue(value.sg);
  if (segments !== undefined) {
    primitive.segments = segments;
  }
  const segmentGap = numberValue(value.segmentGap) ?? numberValue(value.gg);
  if (segmentGap !== undefined) {
    primitive.segmentGap = segmentGap;
  }
  primitive.color = normalizeColor(
    colorStringValue(value.color) ??
      colorStringValue(value.fillColor) ??
      colorStringValue(value.textColor) ??
      colorStringValue(value.foregroundColor) ??
      colorStringValue(value.foreground) ??
      colorStringValue(value.fill) ??
      colorStringValue(value.c),
  );
  primitive.bgColor = normalizeColor(
    colorStringValue(value.bgColor) ??
      colorStringValue(value.backgroundColor) ??
      colorStringValue(value.trackColor) ??
      colorStringValue(value.background) ??
      colorStringValue(value.track) ??
      colorStringValue(value.bg),
  );
  primitive.borderColor = normalizeColor(
    colorStringValue(value.borderColor) ??
      colorStringValue(value.strokeColor) ??
      colorStringValue(value.border) ??
      colorStringValue(value.stroke) ??
      colorStringValue(value.bc),
  );
  primitive.assetPath = stringValue(value.assetPath) ?? stringValue(value.a);
  const stateAssets = stateAssetsValue(value.stateAssets) ?? stateAssetsValue(value.sa);
  if (stateAssets) {
    primitive.stateAssets = stateAssets;
  }
  const frameCount = numberValue(value.frameCount) ?? numberValue(value.fc);
  if (frameCount !== undefined) {
    primitive.frameCount = frameCount;
  }
  const fps = numberValue(value.fps);
  if (fps !== undefined) {
    primitive.fps = fps;
  }
  const sheetColumns = numberValue(value.sheetColumns) ?? numberValue(value.sc);
  if (sheetColumns !== undefined) {
    primitive.sheetColumns = sheetColumns;
  }
  primitive.data = stringValue(value.data) ?? stringValue(value.d);
  const palette = stringArrayValue(value.p);
  if (palette) {
    primitive.p = palette;
  }
  const rows = stringArrayValue(value.r);
  if (rows) {
    primitive.r = rows;
  }
  return primitive;
}

function themeSpecAssetPath(spec: ThemeStudioSpec): string {
  const extension = ".json";
  const maxSegmentLength = Math.max(
    1,
    MAX_ESP8266_LITTLEFS_PATH_CHARS -
      USER_THEME_ASSET_PATH_PREFIX.length -
      extension.length,
  );
  const revSuffix = `-${spec.themeRev || 1}-${themeSpecHash(spec).slice(0, 6)}`;
  const maxBaseLength = Math.max(1, maxSegmentLength - revSuffix.length);
  const cleaned = slugThemeId(spec.themeId || "theme");
  const base = `${cleaned.slice(0, maxBaseLength)}${revSuffix}`.slice(
    0,
    maxSegmentLength,
  );
  return `${USER_THEME_ASSET_PATH_PREFIX}${base}${extension}`;
}

function themeSpecHash(spec: ThemeStudioSpec): string {
  return fnv1aHex8(deviceThemeSpecJson(spec));
}

function fnv1aHex8(value: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function buildStoredZip(files: ZipSourceFile[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  const { dosDate, dosTime } = dosDateTime();

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, file.data.length, true);
    localView.setUint32(22, file.data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    localParts.push(local, file.data);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, file.data.length, true);
    centralView.setUint32(24, file.data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length + file.data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  return concatUint8Arrays([...localParts, ...centralParts, end]);
}

function themeStudioAssetBytes(asset: ThemeStudioAsset): Uint8Array {
  if (asset.encoding === "text") {
    return new TextEncoder().encode(asset.data);
  }
  return base64ToUint8Array(asset.data);
}

function base64ToUint8Array(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function uniquePackAssetFile(
  devicePath: string,
  used: Set<string>,
  fallbackIndex: number,
): string {
  const fallback = `asset-${fallbackIndex}`;
  const name = (devicePath.split("/").pop() || fallback)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  let candidate = `assets/${name}`;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `assets/${base}-${counter}${extension}`;
    counter += 1;
  }
  used.add(candidate);
  return candidate;
}

function concatUint8Arrays(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let c = index;
  for (let bit = 0; bit < 8; bit += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function dosDateTime() {
  const date = new Date("2000-01-01T00:00:00Z");
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = Math.floor(date.getUTCSeconds() / 2);
  return {
    dosDate: ((year - 1980) << 9) | (month << 5) | day,
    dosTime: (hours << 11) | (minutes << 5) | seconds,
  };
}

function expandPrimitiveType(value: string): ThemeStudioPrimitiveType {
  const normalized = value.trim().toLowerCase();
  return SHORT_TYPES[normalized] || (normalized as ThemeStudioPrimitiveType);
}

function expandBinding(value: string): ThemeStudioBinding {
  const clean = value.trim();
  const normalized = clean.toLowerCase().replace(/[\s-]+/g, "");
  return SHORT_BINDINGS[clean] || SHORT_BINDINGS[normalized] || clean;
}

function normalizeColor(value: string | undefined): string | undefined {
  const clean = value?.trim();
  if (!clean) {
    return undefined;
  }
  if (COLOR_RE.test(clean)) {
    return clean.toUpperCase();
  }
  if (SHORT_COLOR_RE.test(clean)) {
    const [, r, g, b] = clean;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  if (PLAIN_COLOR_RE.test(clean)) {
    return `#${clean}`.toUpperCase();
  }
  const rgb = clean.match(RGB_COLOR_RE);
  if (rgb) {
    return `#${rgb
      .slice(1, 4)
      .map((part) =>
        clampInt(Math.round(Number(part)), 0, 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`.toUpperCase();
  }
  const named = CSS_COLOR_NAMES[clean.toLowerCase().replace(/[\s_-]+/g, "")];
  return named || undefined;
}

function slugThemeId(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "custom-mini";
}

function cleanPackName(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 80);
}

function titleFromThemeId(themeId: string): string {
  return themeId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function integerOrDefault(value: unknown, fallback: number): number {
  return Number.isInteger(value) ? Number(value) : fallback;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function estimatePrimitiveWidth(primitive: ThemeStudioPrimitive): number {
  if (primitive.width !== undefined) {
    return primitive.width;
  }
  if (primitive.type === "text") {
    const text = previewTextForEstimate(primitive.text || primitive.binding || "");
    return Math.max(12, text.length * Math.max(1, primitive.fontSize || 1) * 6);
  }
  return 1;
}

function previewTextForEstimate(value: string): string {
  return value
    .replace(/\{session\}/g, "100")
    .replace(/\{weekly\}/g, "100")
    .replace(/\{reset\}/g, "1h 0m")
    .replace(/\{usageMode\}/g, "used")
    .replace(/\{label\}/g, "VibeTV");
}

function estimatePrimitiveHeight(primitive: ThemeStudioPrimitive): number {
  if (primitive.height !== undefined) {
    return primitive.height;
  }
  if (primitive.type === "text") {
    return Math.max(8, (primitive.fontSize || 1) * 8);
  }
  return 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function colorStringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.length >= 3) {
    const [r, g, b] = value.map((part) =>
      typeof part === "number" && Number.isFinite(part) ? part : Number.NaN,
    );
    if ([r, g, b].every(Number.isFinite)) {
      return rgbString(r, g, b);
    }
  }
  if (isRecord(value)) {
    const direct =
      stringValue(value.hex) ??
      stringValue(value.value) ??
      stringValue(value.color) ??
      stringValue(value.c);
    if (direct) {
      return direct;
    }
    const r = numericValue(value.r ?? value.red);
    const g = numericValue(value.g ?? value.green);
    const b = numericValue(value.b ?? value.blue);
    if (r !== undefined && g !== undefined && b !== undefined) {
      return rgbString(r, g, b);
    }
  }
  return undefined;
}

function numericValue(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function rgbString(r: number, g: number, b: number): string {
  return `rgb(${r}, ${g}, ${b})`;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value.trim())) {
    return Math.round(Number(value.trim()));
  }
  return undefined;
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function stringArrayValue(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function stateAssetsValue(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [stateName, assetPath] of Object.entries(value)) {
    if (typeof assetPath === "string") {
      result[stateName] = assetPath;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
