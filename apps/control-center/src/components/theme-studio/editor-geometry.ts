import {
  deviceThemeSpecJson,
  type ThemeStudioPrimitive,
  type ThemeStudioSpec,
} from "@/lib/theme-studio";

export const DISPLAY_SIZE = 240;

const TEXT_SELECTION_HEIGHT_SCALE = 1.2;

const DEFAULT_FRAME = {
  v: 2,
  provider: "vibetv",
  label: "VibeTV",
  session: 62,
  weekly: 62,
  resetSecs: 3600,
  usageSlot1Label: "Weekly",
  usageSlot1Percent: 62,
  usageSlot1Reset: "1h",
  usageSlot2Label: "Codex Spark Weekly",
  usageSlot2Percent: 38,
  usageSlot2Reset: "2h",
  usageMode: "remaining",
  activity: "preview",
  sessionTokens: 12000,
  weekTokens: 82000,
  totalTokens: 248000,
  time: "12:00",
  date: "03.07",
};

export type ResizeSize = {
  height: number;
  width: number;
};

export type DragMoveOrigin = {
  height: number;
  index: number;
  width: number;
  x: number;
  y: number;
};

export type PrimitiveMove = {
  index: number;
  x: number;
  y: number;
};

export type SelectionBox = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type FieldKey = keyof ThemeStudioPrimitive;

export function prettyJson(spec: ThemeStudioSpec): string {
  return JSON.stringify(JSON.parse(deviceThemeSpecJson(spec)), null, 2);
}

export function defaultPrimitive(
  type: "progress" | "rect" | "text",
  count: number,
): ThemeStudioPrimitive {
  const offset = Math.min(42, count * 8);
  if (type === "text") {
    return {
      type,
      x: 24 + offset,
      y: 24 + offset,
      text: "Text",
      fontSize: 2,
      color: "#EEF2F6",
    };
  }
  if (type === "progress") {
    return {
      type,
      x: 24,
      y: 118 + Math.min(40, offset),
      width: 190,
      height: 16,
      binding: "session",
      color: "#C7FF68",
      bgColor: "#111111",
      borderColor: "#3B4552",
    };
  }
  return {
    type,
    x: 32 + offset,
    y: 32 + offset,
    width: 56,
    height: 36,
    color: "#24313D",
  };
}

export function setPrimitiveField(
  primitive: ThemeStudioPrimitive,
  field: FieldKey,
  value: unknown,
) {
  if (value === "") {
    delete primitive[field];
    return;
  }
  (primitive as Record<FieldKey, unknown>)[field] = value;
}

export function primitiveBounds(primitive: ThemeStudioPrimitive) {
  if (
    primitive.type === "rect" ||
    primitive.type === "progress" ||
    primitive.type === "gif" ||
    primitive.type === "sprite" ||
    primitive.type === "pixels"
  ) {
    return {
      height: primitive.height || 16,
      width: primitive.width || 16,
    };
  }
  const fontSize = primitive.fontSize || 1;
  const visibleWidth = Math.max(
    primitive.width || 0,
    textPrimitiveNaturalWidth(primitive, fontSize),
  );
  const visibleHeight = textPrimitiveSelectionHeight(primitive, fontSize);
  return {
    height: Math.min(
      Math.max(1, DISPLAY_SIZE - primitive.y),
      Math.max(8, visibleHeight),
    ),
    width: Math.min(
      Math.max(1, DISPLAY_SIZE - primitive.x),
      Math.max(24, visibleWidth),
    ),
  };
}

export function aspectLockedResizeSize({
  maxHeight,
  maxWidth,
  originHeight,
  originWidth,
  targetHeight,
  targetWidth,
}: {
  maxHeight: number;
  maxWidth: number;
  originHeight: number;
  originWidth: number;
  targetHeight: number;
  targetWidth: number;
}): ResizeSize {
  if (originWidth <= 0 || originHeight <= 0) {
    return {
      height: clampInt(targetHeight, 1, maxHeight),
      width: clampInt(targetWidth, 1, maxWidth),
    };
  }
  const widthScale = targetWidth / originWidth;
  const heightScale = targetHeight / originHeight;
  const dominantScale =
    Math.abs(widthScale - 1) >= Math.abs(heightScale - 1)
      ? widthScale
      : heightScale;
  const minScale = Math.max(1 / originWidth, 1 / originHeight);
  const maxScale = Math.min(maxWidth / originWidth, maxHeight / originHeight);
  const scale = Math.max(minScale, Math.min(maxScale, dominantScale));

  return {
    height: clampInt(originHeight * scale, 1, maxHeight),
    width: clampInt(originWidth * scale, 1, maxWidth),
  };
}

export function clampedMoveDelta(
  origins: DragMoveOrigin[],
  rawDeltaX: number,
  rawDeltaY: number,
) {
  const minDeltaX = Math.max(...origins.map((origin) => -origin.x));
  const maxDeltaX = Math.min(
    ...origins.map((origin) => DISPLAY_SIZE - origin.x - origin.width),
  );
  const minDeltaY = Math.max(...origins.map((origin) => -origin.y));
  const maxDeltaY = Math.min(
    ...origins.map((origin) => DISPLAY_SIZE - origin.y - origin.height),
  );

  return {
    x: clampInt(rawDeltaX, minDeltaX, maxDeltaX),
    y: clampInt(rawDeltaY, minDeltaY, maxDeltaY),
  };
}

export function normalizeSelectedIndices(
  indices: number[],
  primitiveCount: number,
): number[] {
  return [...new Set(indices)].filter(
    (index) => Number.isInteger(index) && index >= 0 && index < primitiveCount,
  );
}

export function normalizedSelectionBox(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
): SelectionBox {
  const minX = Math.max(0, Math.min(startX, currentX));
  const minY = Math.max(0, Math.min(startY, currentY));
  const maxX = Math.min(DISPLAY_SIZE, Math.max(startX, currentX));
  const maxY = Math.min(DISPLAY_SIZE, Math.max(startY, currentY));
  return {
    height: Math.max(0, maxY - minY),
    width: Math.max(0, maxX - minX),
    x: minX,
    y: minY,
  };
}

export function selectedPrimitiveIndices(
  primitives: ThemeStudioPrimitive[],
  selection: SelectionBox,
): number[] {
  const hits = primitives.flatMap((primitive, index) => {
    const bounds = primitiveBounds(primitive);
    const box = {
      height: bounds.height,
      width: bounds.width,
      x: primitive.x,
      y: primitive.y,
    };
    return selectionBoxesIntersect(selection, box) ? [index] : [];
  });
  const foregroundHits = hits.filter(
    (index) => !isFullCanvasRect(primitives[index]),
  );
  return foregroundHits.length > 0 ? foregroundHits : hits;
}

function selectionBoxesIntersect(a: SelectionBox, b: SelectionBox): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function isFullCanvasRect(
  primitive: ThemeStudioPrimitive | undefined,
): boolean {
  return Boolean(
    primitive &&
      primitive.type === "rect" &&
      primitive.x === 0 &&
      primitive.y === 0 &&
      primitive.width === DISPLAY_SIZE &&
      primitive.height === DISPLAY_SIZE,
  );
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tagName === "a" ||
    tagName === "button" ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select"
  );
}

export function textPrimitiveNaturalWidth(
  primitive: ThemeStudioPrimitive,
  fontSize = primitive.fontSize || 1,
) {
  const text = primitive.binding
    ? boundText(primitive.binding)
    : substituteText(primitive.text || "Text");
  const renderFontSize = textPrimitiveRenderFontSize(primitive, fontSize);
  return Math.min(
    Math.max(1, DISPLAY_SIZE - primitive.x),
    Math.ceil(text.length * renderFontSize * 0.6),
  );
}

function textPrimitiveRenderFontSize(
  primitive: ThemeStudioPrimitive,
  fontSize = primitive.fontSize || 1,
) {
  const scale = Math.max(1, fontSize);
  switch (primitive.font || 1) {
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

function textPrimitiveSelectionHeight(
  primitive: ThemeStudioPrimitive,
  fontSize = primitive.fontSize || 1,
) {
  return Math.ceil(
    textPrimitiveRenderFontSize(primitive, fontSize) *
      TEXT_SELECTION_HEIGHT_SCALE,
  );
}

export function textPrimitiveFontSizeFromVisualHeight(
  primitive: ThemeStudioPrimitive,
  height: number,
) {
  const baseHeight = textPrimitiveRenderFontSize(
    { ...primitive, fontSize: 1 },
    1,
  );
  return Math.round(height / (baseHeight * TEXT_SELECTION_HEIGHT_SCALE));
}

export function primitiveTitle(primitive: ThemeStudioPrimitive): string {
  if (primitive.type === "text") {
    return primitive.text || primitive.binding || "Text";
  }
  if (primitive.type === "progress") {
    return primitive.binding || "session";
  }
  if (primitive.type === "gif" || primitive.type === "sprite") {
    return primitive.assetPath?.split("/").pop() || "Asset";
  }
  if (primitive.type === "pixels") {
    return `${primitive.width ?? 0}x${primitive.height ?? 0}`;
  }
  return primitive.color || "Rect";
}

function boundText(binding: string): string {
  switch (binding) {
    case "label":
      return DEFAULT_FRAME.label;
    case "provider":
      return DEFAULT_FRAME.provider;
    case "session":
    case "sessionPercent":
      return String(DEFAULT_FRAME.session);
    case "weekly":
    case "weeklyPercent":
      return String(DEFAULT_FRAME.weekly);
    case "reset":
    case "resetCountdown":
      return "1h";
    case "usageSlot1Label":
      return DEFAULT_FRAME.usageSlot1Label;
    case "usageSlot1Percent":
      return String(DEFAULT_FRAME.usageSlot1Percent);
    case "usageSlot1Reset":
      return DEFAULT_FRAME.usageSlot1Reset;
    case "usageSlot1Available":
      return "true";
    case "usageSlot2Label":
      return DEFAULT_FRAME.usageSlot2Label;
    case "usageSlot2Percent":
      return String(DEFAULT_FRAME.usageSlot2Percent);
    case "usageSlot2Reset":
      return DEFAULT_FRAME.usageSlot2Reset;
    case "usageSlot2Available":
      return "true";
    case "usageMode":
      return DEFAULT_FRAME.usageMode;
    case "activity":
      return DEFAULT_FRAME.activity;
    case "time":
      return DEFAULT_FRAME.time;
    case "date":
      return DEFAULT_FRAME.date;
    case "sessionTokens":
      return String(DEFAULT_FRAME.sessionTokens);
    case "weekTokens":
      return String(DEFAULT_FRAME.weekTokens);
    case "totalTokens":
      return String(DEFAULT_FRAME.totalTokens);
    default:
      return "";
  }
}

function substituteText(value: string): string {
  return value.replace(/\{([a-zA-Z0-9_-]+)\}/g, (_match, key: string) =>
    boundText(key),
  );
}

export function clampInt(value: number, min: number, max: number): number {
  const rounded = Math.round(value);
  return Math.max(min, Math.min(Math.max(min, max), rounded));
}

export function titleFromThemeId(themeId: string): string {
  return themeId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
