import Konva from "konva";
import { strToU8, zipSync } from "fflate";
import "gifler";
import "./styles.css";

const DISPLAY_SIZE = 240;
const MAX_SPEC_BYTES = 4096;
const MAX_FRAME_BYTES = 2048;
const MAX_PRIMITIVES = 32;
const COLOR_RE = /^#[A-Fa-f0-9]{6}$/;
const THEME_ID_RE = /^[a-z0-9][a-z0-9\-_]{2,63}$/;
const FIXED_THEME_REV = 1;
const FIXED_FALLBACK_THEME = "mini";
const DEFAULT_TARGET_ORIGIN = "http://vibetv.local";
const TARGET_STORAGE_KEY = "codexbar.themeStudio.targetOrigin";
const DEFAULT_GIF_SIZE = 80;
const DEFAULT_SPRITE_FPS = 8;
const MAX_SPRITE_FRAME_WIDTH = 64;
const MAX_SPRITE_FRAME_HEIGHT = 64;
const MAX_SPRITE_FRAMES = 32;
const MAX_SPRITE_TOTAL_PIXELS = 32768;
const MAX_ANIMATED_REPAINT_PIXELS_PER_SECOND = 18000;
const MAX_INITIAL_RENDER_PIXELS = 120000;
const WARN_INITIAL_RENDER_PIXELS = 90000;
const MAX_ESP8266_LITTLEFS_PATH_CHARS = 31;
const THEME_ASSET_PATH_PREFIX = "/themes/";
const USER_THEME_ASSET_PATH_PREFIX = "/themes/u/";
const STATE_NAME_RE = /^[a-z0-9][a-z0-9\-_]{0,30}$/;
const SUPPORTED_PRIMITIVE_TYPES = ["rect", "text", "progress", "gif", "sprite", "pixels"] as const;
const HISTORY_LIMIT = 60;
const SAVED_THEMES_STORAGE_KEY = "codexbar.themeStudio.savedThemes.v1";

type PrimitiveType = typeof SUPPORTED_PRIMITIVE_TYPES[number];
type ResizeHandle = "e" | "s" | "se";
type PixelTool = "move" | "paint" | "erase";
type EditableKonvaNode = Konva.Group | Konva.Shape;
type GiflerAnimator = {
  width: number;
  height: number;
  start(): GiflerAnimator;
  stop(): GiflerAnimator;
  reset(): GiflerAnimator;
  animateInCanvas(canvas: HTMLCanvasElement, setDimension?: boolean): GiflerAnimator;
};
type GiflerFactory = (url: string) => {
  get(callback: (animator: GiflerAnimator) => void): unknown;
};
type GifPreview = {
  canvas: HTMLCanvasElement;
  key: string;
  loading: boolean;
  animator: GiflerAnimator | null;
  playing: boolean;
};
type SpriteSource = {
  file: File;
  previewUrl: string;
  bitmap: ImageBitmap;
  sheetWidth: number;
  sheetHeight: number;
  frameWidth: number;
  frameHeight: number;
};
type SpriteAsset = {
  width: number;
  height: number;
  frameCount: number;
  fps: number;
  palette: string[];
  frames: string[][];
};
type UploadableAsset = {
  file: File;
  previewUrl?: string;
};
type BindingKey =
  | "label"
  | "provider"
  | "session"
  | "sessionPercent"
  | "weekly"
  | "weeklyPercent"
  | "reset"
  | "resetCountdown"
  | "usageMode"
  | "activity"
  | "time"
  | "date"
  | "sessionTokens"
  | "weekTokens"
  | "totalTokens";

interface Primitive {
  type: PrimitiveType;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  font?: number;
  fontSize?: number;
  binding?: BindingKey;
  color?: string;
  bgColor?: string;
  borderColor?: string;
  rotation?: number;
  assetPath?: string;
  stateAssets?: Record<string, string>;
  frameCount?: number;
  fps?: number;
  sheetColumns?: number;
  data?: string;
  p?: string[];
  r?: string[];
}

interface ThemeSpec {
  themeSpecVersion: 1;
  themeId: string;
  themeRev: number;
  fallbackTheme?: "classic" | "crt" | "mini";
  bgColor?: string;
  primitives: Primitive[];
}

interface ThemeSnapshot {
  spec: ThemeSpec;
  selectedIndex: number;
}

interface SavedTheme {
  id: string;
  name: string;
  savedAt: string;
  spec: ThemeSpec;
}

interface FrameData {
  provider: string;
  label: string;
  session: number;
  weekly: number;
  reset: string;
  resetSecs: number;
  usageMode: string;
  activity: string;
  time: string;
  date: string;
  sessionTokens: number;
  weekTokens: number;
  totalTokens: number;
}

interface AppState {
  spec: ThemeSpec;
  selectedIndex: number;
  hoveredIndex: number | null;
  editingTextIndex: number | null;
  copiedPrimitive: Primitive | null;
  gifAssets: Record<string, { file: File; previewUrl: string }>;
  spriteAssets: Record<string, { file: File; rawText: string; sprite: SpriteAsset; source?: SpriteSource }>;
  jsonText: string;
  jsonDirty: boolean;
  errors: string[];
  warnings: string[];
  notice: string;
  targetOrigin: string;
  pixelTool: PixelTool;
  pixelBrushToken: string;
  undoStack: ThemeSnapshot[];
  redoStack: ThemeSnapshot[];
  savedThemes: SavedTheme[];
}

interface DeviceHealth {
  system?: {
    freeHeap?: number;
    resetReason?: string;
  };
  display?: {
    themeSpec?: {
      active?: boolean;
      id?: string | null;
      rev?: number;
      path?: string | null;
      hash?: string | null;
      renderOk?: boolean;
      renderError?: string | null;
      renderFailures?: number;
    };
    gif?: {
      activePath?: string;
      lastError?: unknown;
    };
  };
}

interface DeviceAssets {
  filesystem?: {
    mounted?: boolean;
  };
  assets?: Array<{
    path?: string;
    sizeBytes?: number;
  }>;
}

const frame: FrameData = {
  provider: "codex",
  label: "Codex",
  session: 94,
  weekly: 87,
  reset: "89h 54m",
  resetSecs: 323640,
  usageMode: "remaining",
  activity: "idle",
  time: previewTime(new Date()),
  date: previewDate(new Date()),
  sessionTokens: 12840,
  weekTokens: 68120,
  totalTokens: 190420,
};

function previewTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function previewDate(date: Date): string {
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;
}

const variableTokens = [
  { label: "Name", token: "{label}", preview: frame.label },
  { label: "Session", token: "{session}%", preview: `${frame.session}%` },
  { label: "Weekly", token: "{weekly}%", preview: `${frame.weekly}%` },
  { label: "Reset", token: "{reset}", preview: frame.reset },
  { label: "Mode", token: "{usageMode}", preview: frame.usageMode },
  { label: "Activity", token: "{activity}", preview: frame.activity },
  { label: "Time", token: "{time}", preview: frame.time },
  { label: "Date", token: "{date}", preview: frame.date },
  { label: "Session tokens", token: "{sessionTokens}", preview: String(frame.sessionTokens) },
  { label: "Week tokens", token: "{weekTokens}", preview: String(frame.weekTokens) },
  { label: "Total tokens", token: "{totalTokens}", preview: String(frame.totalTokens) },
];

const PREVIEW_FONT_FAMILY = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const PREVIEW_FONT_WEIGHT = 800;
const DEFAULT_PIXELS_WIDTH = 16;
const DEFAULT_PIXELS_HEIGHT = 10;
const DEFAULT_CLOUD_SPRITE_PATH = "/themes/u/cloud.cbi";
const COZY_BACKGROUND_SPRITE_PATH = "/themes/u/meadow.cbi";
const COZY_SUN_SPRITE_PATH = "/themes/u/sun.cbi";
const COZY_TREE_SPRITE_PATH = "/themes/u/tree.cbi";
const COZY_FLOWERS_SPRITE_PATH = "/themes/u/flowers.cbi";
const COZY_BIRDS_SPRITE_PATH = "/themes/u/birds.cba";
const COZY_BUTTERFLY_SPRITE_PATH = "/themes/u/butter.cba";
const CLAUDE_IDLE_SPRITE_PATH = "/themes/u/cld-i.cba";
const CLAUDE_CODING_SPRITE_PATH = "/themes/u/cld-c.cba";
const DEFAULT_CLOUD_SPRITE = `CBI1
24 14
3
#9DE7F7
#FFFFFF
#D7F7C8
24.
14.3b7.
12.3b2c7.
10.4b4c6.
8.4b6c6.
7.5b8c4.
6.4b12c2.
5.4a14c1.
4.5a15c
4.4a14c2.
5.3a12c4.
7.10c7.
9.6c9.
24.
`;
const COZY_SUN_SPRITE = `CBI1
22 22
3
#FFF7A8
#FFD35A
#F59E2E
22.
10.b11.
7.b.3a.b8.
5.b2.5a2.b6.
4.b2.7a2.b5.
3.b2.3a3c3a2.b4.
2.b2.4a3c4a2.b3.
3.5a3c5a6.
2.6a3c6a5.
2.6a4c6a4.
b.6a4c6a3.b
2.6a4c6a4.
2.6a3c6a5.
3.5a3c5a6.
2.b2.4a3c4a2.b3.
3.b2.3a3c3a2.b4.
4.b2.7a2.b5.
5.b2.5a2.b6.
7.b.3a.b8.
10.b11.
22.
22.
`;
const COZY_TREE_SPRITE = `CBI1
28 38
5
#2E7D43
#4EA65A
#1F5E35
#8B5A2B
#5C351A
28.
11.3b14.
9.7b12.
7.11b10.
6.5b3a5b9.
5.7b4a6b6.
4.7c2b5a5b5.
3.8c3b4a6b4.
2.9c5b3a6b3.
2.8c8b7c3.
3.6c9b7c3.
4.5c6b2a6c5.
5.4c5b4a5c5.
6.4c4b5a4c5.
4.7c3b5a5c4.
3.8c2b6a6c3.
2.9c2b7a6c2.
3.8c3b6a5c3.
5.6c4b5a4c4.
7.5c3b4a4c5.
9.4c2b3a4c6.
12.2d2e12.
12.2d2e12.
11.3d2e12.
11.3d2e12.
10.4d2e12.
10.4d2e12.
9.5d2e12.
9.5d2e12.
8.6d2e12.
7.7d2e12.
6.8d2e12.
5.9d2e12.
4.10d2e12.
3.11d2e12.
2.13d13.
28.
28.
`;
const COZY_FLOWERS_SPRITE = `CBI1
36 12
6
#2E7D43
#DFF7C2
#FFE36E
#FF8DB3
#B388FF
#FFFFFF
36.
4.a6.a5.a4.a7.a5.
4.a6.a5.a4.a7.a5.
3.2a5.2a4.2a3.2a6.2a5.
2.2ad4.2ac3.2ae2.2ab5.2af5.
2.3a4.3a3.3a2.3a5.3a5.
1.4a3.4a2.4a1.4a4.4a5.
36a
2.5a4.7a4.8a1.5a
36.
36.
36.
`;
const COZY_BIRDS_SPRITE = `CBA1
16 10 4 6
2
#243326
#FFE0A3
16.
16.
7.a8.
5.3a8.
3.3a.3a6.
2.4a2b4a4.
5.6a5.
7.2a7.
16.
16.
16.
6.a9.
4.2a2.2a6.
3.3a4.3a3.
2.5a2b5a2.
5.6a5.
7.2a7.
16.
16.
16.
16.
7.a8.
5.3a8.
4.4a2b4a2.
3.3a4.3a3.
5.6a5.
7.2a7.
16.
16.
16.
6.a9.
4.2a2.2a6.
3.3a4.3a3.
2.5a2b5a2.
5.6a5.
7.2a7.
16.
16.
16.
16.
`;
const COZY_BUTTERFLY_SPRITE = `CBA1
14 12 4 7
4
#271A18
#FFD34D
#FF7FB7
#9DE7F7
14.
3.b2.2a2.c3.
2.3b.2a.3c2.
1.4b2a4c3.
2.3b2a3c4.
4.baac6.
5.2a7.
4.caab6.
2.3c2a3b4.
1.4c2a4b3.
2.3c.2a.3b2.
14.
14.
4.b.2a.c4.
3.2b2a2c5.
2.3b2a3c4.
1.4b2a4c3.
4.baac6.
5.2a7.
4.caab6.
1.4c2a4b3.
2.3c2a3b4.
3.2c2a2b5.
14.
14.
5.b2c6.
4.2b2c6.
3.3b2c6.
2.4b2c6.
4.baac6.
5.2a7.
4.caab6.
2.4c2b6.
3.3c2b6.
4.2c2b6.
14.
14.
4.b.2a.c4.
3.2b2a2c5.
2.3b2a3c4.
1.4b2a4c3.
4.baac6.
5.2a7.
4.caab6.
1.4c2a4b3.
2.3c2a3b4.
3.2c2a2b5.
14.
`;
const CLAUDE_IDLE_SPRITE = `CBA1
24 24 4 4
4
#FF8F6F
#D45F4C
#FFD1C2
#070504
24.
24.
24.
24.
12.b11.
11.2a11.
10.a2.a10.
7.10a7.
7.a8ba7.
6.b10ab6.
6.12a6.
4.5ad5ad4a4.
4.16a4.
4.16a4.
4.8a2b6a4.
4.16a4.
4.16a4.
7.10a7.
7.10a7.
7.2a2.2a2.2a7.
7.2a2.2a2.2a7.
7.2a2.2a2.2a7.
24.
24.
24.
24.
24.
12.b11.
11.2a11.
10.a2.a10.
7.10a7.
7.a8ba7.
6.b10ab6.
6.12a6.
4.5ad5ad4a4.
4.16a4.
4.16a4.
4.8a2b6a4.
4.16a4.
4.16a4.
7.10a7.
7.10a7.
7.2a2.2a2.2a7.
7.2a2.2a2.2a7.
7.2a2.2a2.2a7.
24.
24.
24.
24.
24.
24.
24.
12.b11.
11.2a11.
10.a2.a10.
7.10a7.
7.a8ba7.
6.b10ab6.
6.12a6.
4.5ab5ab4a4.
4.16a4.
4.16a4.
4.8a2b6a4.
4.16a4.
4.16a4.
7.10a7.
7.10a7.
7.2a2.2a2.2a7.
7.2a2.2a2.2a7.
7.2a2.2a2.2a7.
24.
24.
24.
24.
24.
24.
24.
12.b11.
11.2a11.
10.a2.a10.
7.10a7.
7.a8ba7.
6.b10ab6.
6.12a6.
4.5ad5ad4a4.
4.16a4.
4.16a4.
4.8a2b6a4.
4.16a4.
4.16a4.
7.10a7.
7.10a7.
7.2a2.2a2.2a7.
7.2a2.2a2.2a7.
7.2a2.2a2.2a7.
24.
`;
const CLAUDE_CODING_SPRITE = `CBA1
24 24 4 4
4
#FF8F6F
#D45F4C
#FFD1C2
#070504
24.
24.
24.
24.
12.b11.
11.2a11.
10.a2.a6.c3.
3.c3.10a4.c2.
7.a8ba7.
3.a2.b10ab6.
4.14a6.
4.5ad5ad2a6.
4.16a4.
4.16a4.
4.8a2b6a4.
6.14a4.
6.14a4.
7.10a3.a3.
7.10a7.
7.2a2.2a2.2a7.
7.2a2.2a2.2a7.
7.2a2.2a2.2a7.
24.
24.
24.
24.
24.
24.
12.b11.
11.2a7.c3.
10.a2.a10.
7.10a7.
2.c4.a8ba4.c2.
6.b10ab2.a3.
6.14a4.
6.3ad5ad4a4.
4.16a4.
4.16a4.
4.8a2b6a4.
4.14a6.
4.14a6.
3.a3.10a7.
7.10a7.
7.2a2.2a2.2a7.
7.2a2.2a2.2a7.
7.2a2.2a2.2a7.
24.
24.
24.
24.
24.
12.b11.
11.2a11.
3.c6.a2.a8.c.
7.10a3.c3.
7.a8ba7.
3.a2.b10ab6.
4.14a6.
4.5ad5ad2a6.
4.16a4.
4.16a4.
4.8a2b6a4.
6.14a4.
6.14a4.
7.10a3.a3.
7.10a7.
7.2a2.2a2.2a7.
7.2a2.2a2.2a7.
7.2a2.2a2.2a7.
24.
24.
24.
24.
24.
24.
24.
12.b11.
11.2a8.c2.
10.a2.a10.
2.c4.10a7.
7.a8ba7.
3.c2.b10ab2.a3.
6.14a4.
6.3ab5ab4a4.
4.16a4.
4.16a4.
4.8a2b6a4.
4.14a6.
4.14a6.
3.a3.10a7.
7.10a7.
7.2a2.2a2.2a7.
7.2a2.2a2.2a7.
7.2a2.2a2.2a7.
24.
24.
`;
const DEFAULT_CLOUD_PIXEL_PALETTE = ["#FFFFFF", "#9DE7F7", "#C7FF68"];
const DEFAULT_CLOUD_PIXEL_ROWS = [
  "5.4a7.",
  "3.2a3b2a6.",
  "2.2a5b2a5.",
  "1.3a5b3a4.",
  "2a4b2c4b3a.",
  "3a8b4a.",
  "1.12a3.",
  "3.8a5.",
  "5.4a7.",
  "16.",
];

function cozyBackgroundSpriteText(): string {
  const width = 120;
  const height = 120;
  const palette = [
    "#9DE7F7",
    "#FFFFFF",
    "#D7F7C8",
    "#B8DF7A",
    "#7FCA69",
    "#54A85E",
    "#3D884E",
    "#FFECA8",
    "#77C7D9",
    "#70431E",
    "#2F7444",
    "#FFE36E",
    "#FF8DB3",
  ];
  const rows = Array.from({ length: height }, (_, y) => cozyBackgroundRow(width, y));
  return `CBI1\n${width} ${height}\n${palette.length}\n${palette.join("\n")}\n${rows.join("\n")}\n`;
}

function cozyBackgroundRow(width: number, y: number): string {
  const tokens: string[] = [];
  let current = "";
  let runLength = 0;
  for (let x = 0; x < width; x += 1) {
    const token = cozyBackgroundToken(x, y);
    if (token === current) {
      runLength += 1;
      continue;
    }
    if (current) {
      tokens.push(`${runLength === 1 ? "" : runLength}${current}`);
    }
    current = token;
    runLength = 1;
  }
  if (current) {
    tokens.push(`${runLength === 1 ? "" : runLength}${current}`);
  }
  return tokens.join("");
}

function cozyBackgroundToken(x: number, y: number): string {
  const cloudA = ((x - 18) * (x - 18)) / 170 + ((y - 14) * (y - 14)) / 22 < 1;
  const cloudB = ((x - 96) * (x - 96)) / 210 + ((y - 19) * (y - 19)) / 26 < 1;
  if (y < 46 && (cloudA || cloudB)) {
    return y % 3 === 0 ? "c" : "b";
  }

  const farHill = 42 + Math.floor(x / 18) + Math.floor(Math.sin(x / 9) * 4);
  const nearHill = 58 + Math.floor(Math.sin((x + 12) / 11) * 5);
  if (y < farHill) {
    return "a";
  }
  if (y < nearHill) {
    return y % 5 === 0 ? "e" : "d";
  }

  for (const tree of [9, 22, 101, 113]) {
    const crown = Math.abs(x - tree) + Math.max(0, y - 48);
    if (y >= 43 && y < 68 && crown < 16) {
      return crown % 5 === 0 ? "e" : "k";
    }
    if (x >= tree - 1 && x <= tree + 1 && y >= 61 && y < 75) {
      return "j";
    }
  }

  if (y > 74) {
    const center = 62 + Math.floor((y - 74) * 0.28) + Math.floor(Math.sin(y / 8) * 3);
    const half = 4 + Math.floor((y - 74) / 8);
    if (Math.abs(x - center) <= half) {
      return y % 4 === 0 ? "h" : "i";
    }
  }

  if (y > 83 && (x * 17 + y * 31) % 47 === 0) {
    return "l";
  }
  if (y > 90 && (x * 13 + y * 19) % 59 === 0) {
    return "m";
  }
  if (y > 70 && (x + y) % 17 === 0) {
    return "k";
  }

  if (y < 76) {
    return y % 7 === 0 ? "g" : "e";
  }
  if (y < 96) {
    return y % 6 === 0 ? "g" : "f";
  }
  return y % 5 === 0 ? "f" : "g";
}

const COZY_MEADOW_SPEC: ThemeSpec = {
  themeSpecVersion: 1,
  themeId: "cozy-meadow",
  themeRev: FIXED_THEME_REV,
  fallbackTheme: FIXED_FALLBACK_THEME,
  bgColor: "#9DE7F7",
  primitives: [
    { type: "sprite", x: 0, y: 0, width: 240, height: 240, assetPath: COZY_BACKGROUND_SPRITE_PATH },
    { type: "sprite", x: 86, y: 7, width: 30, height: 30, bgColor: "#9DE7F7", assetPath: COZY_SUN_SPRITE_PATH },
    { type: "sprite", x: 184, y: 57, width: 20, height: 13, bgColor: "#9DE7F7", assetPath: COZY_BIRDS_SPRITE_PATH },
    { type: "sprite", x: 38, y: 165, width: 18, height: 15, bgColor: "#54A85E", assetPath: COZY_BUTTERFLY_SPRITE_PATH },
    { type: "gif", x: 202, y: 146, width: 24, height: 24, bgColor: "#54A85E", assetPath: "/themes/mini/mini.gif" },
    { type: "sprite", x: 18, y: 188, width: 45, height: 15, bgColor: "#3D884E", assetPath: COZY_FLOWERS_SPRITE_PATH },
    { type: "text", x: 43, y: 64, text: "{date}", fontSize: 3, color: "#FFFFFF" },
    { type: "text", x: 11, y: 147, text: "Session", fontSize: 2, color: "#123522" },
    { type: "text", x: 11, y: 169, text: "{session}%", fontSize: 5, color: "#FFF4B8" },
    { type: "text", x: 154, y: 173, text: "left", fontSize: 2, color: "#E8FFD9" },
    { type: "progress", x: 13, y: 205, width: 154, height: 13, binding: "session", color: "#FFF4B8", bgColor: "#2F7444", borderColor: "#123522" },
    { type: "text", x: 13, y: 222, text: "Reset {reset}", fontSize: 1, color: "#E8FFD9" },
  ],
};
const CLAUDE_CREATURE_SPEC: ThemeSpec = {
  themeSpecVersion: 1,
  themeId: "claude-creature",
  themeRev: FIXED_THEME_REV,
  fallbackTheme: FIXED_FALLBACK_THEME,
  bgColor: "#050403",
  primitives: [
    { type: "text", x: 9, y: 8, text: "Claude Usage", fontSize: 2, color: "#FF9B7B" },
    { type: "text", x: 207, y: 8, text: "AI", fontSize: 2, color: "#FF9B7B" },
    { type: "text", x: 9, y: 34, text: "Session", fontSize: 2, color: "#FFB19B" },
    { type: "text", x: 9, y: 56, text: "{session}%", fontSize: 5, color: "#FF8F6F" },
    { type: "text", x: 10, y: 95, text: "remaining", fontSize: 1, color: "#FFB19B" },
    { type: "text", x: 134, y: 34, text: "Weekly", fontSize: 2, color: "#FFB19B" },
    { type: "text", x: 132, y: 56, text: "{weekly}%", fontSize: 5, color: "#FF8F6F" },
    { type: "text", x: 136, y: 95, text: "remaining", fontSize: 1, color: "#FFB19B" },
    {
      type: "sprite",
      x: 88,
      y: 128,
      width: 64,
      height: 64,
      bgColor: "#050403",
      assetPath: CLAUDE_IDLE_SPRITE_PATH,
      frameCount: 4,
      fps: 4,
      sheetColumns: 4,
      stateAssets: {
        idle: CLAUDE_IDLE_SPRITE_PATH,
        coding: CLAUDE_CODING_SPRITE_PATH,
      },
    },
    { type: "rect", x: 10, y: 218, width: 220, height: 1, color: "#B95D4F" },
    { type: "text", x: 26, y: 224, text: "* Resets in {reset}", fontSize: 1, color: "#FF9B7B" },
  ],
};
const GLCD_FONT_FIRST_CHAR = 32;
const GLCD_FONT_LAST_CHAR = 126;
const GLCD_FONT_COLUMNS = 5;
const GLCD_FONT_ADVANCE = 6;
const GLCD_FONT_HEIGHT = 8;
// TFT_eSPI Font 1: Original Adafruit 5x7 GLCD font. Each byte is one vertical column.
const GLCD_FONT_5X7 = new Uint8Array([
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x5F, 0x00, 0x00,
  0x00, 0x07, 0x00, 0x07, 0x00, 0x14, 0x7F, 0x14, 0x7F, 0x14,
  0x24, 0x2A, 0x7F, 0x2A, 0x12, 0x23, 0x13, 0x08, 0x64, 0x62,
  0x36, 0x49, 0x56, 0x20, 0x50, 0x00, 0x08, 0x07, 0x03, 0x00,
  0x00, 0x1C, 0x22, 0x41, 0x00, 0x00, 0x41, 0x22, 0x1C, 0x00,
  0x2A, 0x1C, 0x7F, 0x1C, 0x2A, 0x08, 0x08, 0x3E, 0x08, 0x08,
  0x00, 0x80, 0x70, 0x30, 0x00, 0x08, 0x08, 0x08, 0x08, 0x08,
  0x00, 0x00, 0x60, 0x60, 0x00, 0x20, 0x10, 0x08, 0x04, 0x02,
  0x3E, 0x51, 0x49, 0x45, 0x3E, 0x00, 0x42, 0x7F, 0x40, 0x00,
  0x72, 0x49, 0x49, 0x49, 0x46, 0x21, 0x41, 0x49, 0x4D, 0x33,
  0x18, 0x14, 0x12, 0x7F, 0x10, 0x27, 0x45, 0x45, 0x45, 0x39,
  0x3C, 0x4A, 0x49, 0x49, 0x31, 0x41, 0x21, 0x11, 0x09, 0x07,
  0x36, 0x49, 0x49, 0x49, 0x36, 0x46, 0x49, 0x49, 0x29, 0x1E,
  0x00, 0x00, 0x14, 0x00, 0x00, 0x00, 0x40, 0x34, 0x00, 0x00,
  0x00, 0x08, 0x14, 0x22, 0x41, 0x14, 0x14, 0x14, 0x14, 0x14,
  0x00, 0x41, 0x22, 0x14, 0x08, 0x02, 0x01, 0x59, 0x09, 0x06,
  0x3E, 0x41, 0x5D, 0x59, 0x4E, 0x7C, 0x12, 0x11, 0x12, 0x7C,
  0x7F, 0x49, 0x49, 0x49, 0x36, 0x3E, 0x41, 0x41, 0x41, 0x22,
  0x7F, 0x41, 0x41, 0x41, 0x3E, 0x7F, 0x49, 0x49, 0x49, 0x41,
  0x7F, 0x09, 0x09, 0x09, 0x01, 0x3E, 0x41, 0x41, 0x51, 0x73,
  0x7F, 0x08, 0x08, 0x08, 0x7F, 0x00, 0x41, 0x7F, 0x41, 0x00,
  0x20, 0x40, 0x41, 0x3F, 0x01, 0x7F, 0x08, 0x14, 0x22, 0x41,
  0x7F, 0x40, 0x40, 0x40, 0x40, 0x7F, 0x02, 0x1C, 0x02, 0x7F,
  0x7F, 0x04, 0x08, 0x10, 0x7F, 0x3E, 0x41, 0x41, 0x41, 0x3E,
  0x7F, 0x09, 0x09, 0x09, 0x06, 0x3E, 0x41, 0x51, 0x21, 0x5E,
  0x7F, 0x09, 0x19, 0x29, 0x46, 0x26, 0x49, 0x49, 0x49, 0x32,
  0x03, 0x01, 0x7F, 0x01, 0x03, 0x3F, 0x40, 0x40, 0x40, 0x3F,
  0x1F, 0x20, 0x40, 0x20, 0x1F, 0x3F, 0x40, 0x38, 0x40, 0x3F,
  0x63, 0x14, 0x08, 0x14, 0x63, 0x03, 0x04, 0x78, 0x04, 0x03,
  0x61, 0x59, 0x49, 0x4D, 0x43, 0x00, 0x7F, 0x41, 0x41, 0x41,
  0x02, 0x04, 0x08, 0x10, 0x20, 0x00, 0x41, 0x41, 0x41, 0x7F,
  0x04, 0x02, 0x01, 0x02, 0x04, 0x40, 0x40, 0x40, 0x40, 0x40,
  0x00, 0x03, 0x07, 0x08, 0x00, 0x20, 0x54, 0x54, 0x78, 0x40,
  0x7F, 0x28, 0x44, 0x44, 0x38, 0x38, 0x44, 0x44, 0x44, 0x28,
  0x38, 0x44, 0x44, 0x28, 0x7F, 0x38, 0x54, 0x54, 0x54, 0x18,
  0x00, 0x08, 0x7E, 0x09, 0x02, 0x18, 0xA4, 0xA4, 0x9C, 0x78,
  0x7F, 0x08, 0x04, 0x04, 0x78, 0x00, 0x44, 0x7D, 0x40, 0x00,
  0x20, 0x40, 0x40, 0x3D, 0x00, 0x7F, 0x10, 0x28, 0x44, 0x00,
  0x00, 0x41, 0x7F, 0x40, 0x00, 0x7C, 0x04, 0x78, 0x04, 0x78,
  0x7C, 0x08, 0x04, 0x04, 0x78, 0x38, 0x44, 0x44, 0x44, 0x38,
  0xFC, 0x18, 0x24, 0x24, 0x18, 0x18, 0x24, 0x24, 0x18, 0xFC,
  0x7C, 0x08, 0x04, 0x04, 0x08, 0x48, 0x54, 0x54, 0x54, 0x24,
  0x04, 0x04, 0x3F, 0x44, 0x24, 0x3C, 0x40, 0x40, 0x20, 0x7C,
  0x1C, 0x20, 0x40, 0x20, 0x1C, 0x3C, 0x40, 0x30, 0x40, 0x3C,
  0x44, 0x28, 0x10, 0x28, 0x44, 0x4C, 0x90, 0x90, 0x90, 0x7C,
  0x44, 0x64, 0x54, 0x4C, 0x44, 0x00, 0x08, 0x36, 0x41, 0x00,
  0x00, 0x00, 0x77, 0x00, 0x00, 0x00, 0x41, 0x36, 0x08, 0x00,
  0x02, 0x01, 0x02, 0x04, 0x02,
]);

const initialSpec: ThemeSpec = {
  themeSpecVersion: 1,
  themeId: "mini-classic",
  themeRev: FIXED_THEME_REV,
  fallbackTheme: FIXED_FALLBACK_THEME,
  bgColor: "#000000",
  primitives: [
    { type: "text", x: 75, y: 4, binding: "label", fontSize: 3, color: "#999999" },
    { type: "text", x: 7, y: 30, text: "Session", fontSize: 2, color: "#999999" },
    { type: "text", x: 7, y: 66, text: "{session}%", fontSize: 5, color: "#CCFF00" },
    { type: "text", x: 20, y: 106, binding: "usageMode", fontSize: 2, color: "#999999" },
    { type: "text", x: 129, y: 30, text: "Weekly", fontSize: 2, color: "#999999" },
    { type: "text", x: 120, y: 66, text: "{weekly}%", fontSize: 5, color: "#CCFF00" },
    { type: "text", x: 132, y: 106, binding: "usageMode", fontSize: 2, color: "#999999" },
    { type: "gif", x: 80, y: 115, width: 80, height: 80, assetPath: "/themes/mini/mini.gif" },
    { type: "text", x: 42, y: 209, text: "Reset {reset}", fontSize: 2, color: "#999999" },
  ],
};

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) {
  throw new Error("missing #app root");
}
const app = appRoot;
let stage: Konva.Stage | null = null;
let gifRedrawAnimation: Konva.Animation | null = null;
let gifPreviewGeneration = 0;
const gifPreviewCache = new Map<string, GifPreview>();

const state: AppState = {
  spec: cloneSpec(initialSpec),
  selectedIndex: -1,
  hoveredIndex: null,
  editingTextIndex: null,
  copiedPrimitive: null,
  gifAssets: {},
  spriteAssets: {},
  jsonText: "",
  jsonDirty: false,
  errors: [],
  warnings: [],
  notice: "",
  targetOrigin: storedTargetOrigin(),
  pixelTool: "move",
  pixelBrushToken: "a",
  undoStack: [],
  redoStack: [],
  savedThemes: loadSavedThemes(),
};
syncJsonFromSpec();
render();
window.addEventListener("keydown", handleGlobalKeydown);
window.addEventListener("pointerup", () => {
  pixelCanvasPaintActive = false;
  pixelInspectorPaintActive = false;
});

let pixelCanvasPaintActive = false;
let pixelInspectorPaintActive = false;

function cloneSpec(spec: ThemeSpec): ThemeSpec {
  return JSON.parse(JSON.stringify(spec)) as ThemeSpec;
}

function minifiedJson(spec: ThemeSpec): string {
  return JSON.stringify(spec);
}

function prettyJson(spec: ThemeSpec): string {
  return JSON.stringify(spec, null, 2);
}

function storedTargetOrigin(): string {
  try {
    return normalizeTargetOrigin(window.localStorage.getItem(TARGET_STORAGE_KEY) ?? DEFAULT_TARGET_ORIGIN);
  } catch {
    return DEFAULT_TARGET_ORIGIN;
  }
}

function persistTargetOrigin() {
  try {
    window.localStorage.setItem(TARGET_STORAGE_KEY, state.targetOrigin);
  } catch {
    // Local storage is optional; sending still works without it.
  }
}

function loadSavedThemes(): SavedTheme[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SAVED_THEMES_STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(isSavedTheme)
      .map((theme) => ({ ...theme, spec: cloneSpec(theme.spec) }))
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  } catch {
    return [];
  }
}

function isSavedTheme(value: unknown): value is SavedTheme {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.savedAt === "string" &&
    isRecord(value.spec) &&
    Array.isArray(value.spec.primitives);
}

function persistSavedThemes() {
  try {
    window.localStorage.setItem(SAVED_THEMES_STORAGE_KEY, JSON.stringify(state.savedThemes));
  } catch {
    state.notice = "Local theme save failed. Browser storage may be full or blocked.";
  }
}

function snapshotState(): ThemeSnapshot {
  return {
    spec: cloneSpec(state.spec),
    selectedIndex: state.selectedIndex,
  };
}

function snapshotsEqual(a: ThemeSnapshot, b: ThemeSnapshot): boolean {
  return a.selectedIndex === b.selectedIndex && minifiedJson(a.spec) === minifiedJson(b.spec);
}

function pushHistory() {
  const snapshot = snapshotState();
  const last = state.undoStack[state.undoStack.length - 1];
  if (last && snapshotsEqual(last, snapshot)) {
    return;
  }
  state.undoStack.push(snapshot);
  if (state.undoStack.length > HISTORY_LIMIT) {
    state.undoStack.shift();
  }
  state.redoStack = [];
}

function restoreSnapshot(snapshot: ThemeSnapshot, notice: string) {
  state.spec = cloneSpec(snapshot.spec);
  state.selectedIndex = Math.max(-1, Math.min(snapshot.selectedIndex, state.spec.primitives.length - 1));
  state.editingTextIndex = null;
  state.notice = notice;
  syncJsonFromSpec();
  render();
}

function undoThemeEdit() {
  const snapshot = state.undoStack.pop();
  if (!snapshot) {
    state.notice = "Nothing to undo.";
    render();
    return;
  }
  state.redoStack.push(snapshotState());
  restoreSnapshot(snapshot, "Undone.");
}

function redoThemeEdit() {
  const snapshot = state.redoStack.pop();
  if (!snapshot) {
    state.notice = "Nothing to redo.";
    render();
    return;
  }
  state.undoStack.push(snapshotState());
  restoreSnapshot(snapshot, "Redone.");
}

function saveThemeLocally() {
  const now = new Date().toISOString();
  const cleanedId = state.spec.themeId.trim() || "theme";
  const existingIndex = state.savedThemes.findIndex((theme) => theme.name === cleanedId);
  const saved: SavedTheme = {
    id: existingIndex >= 0 ? state.savedThemes[existingIndex].id : `${cleanedId}-${Date.now().toString(36)}`,
    name: cleanedId,
    savedAt: now,
    spec: cloneSpec(state.spec),
  };
  if (existingIndex >= 0) {
    state.savedThemes.splice(existingIndex, 1, saved);
  } else {
    state.savedThemes.unshift(saved);
  }
  state.savedThemes.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  persistSavedThemes();
  state.notice = `Saved "${saved.name}" locally.`;
  render();
}

function loadSavedTheme(id: string) {
  const saved = state.savedThemes.find((theme) => theme.id === id);
  if (!saved) {
    state.notice = "Saved theme not found.";
    render();
    return;
  }
  pushHistory();
  state.spec = cloneSpec(saved.spec);
  state.selectedIndex = state.spec.primitives.length > 0 ? 0 : -1;
  state.editingTextIndex = null;
  state.notice = `Loaded "${saved.name}".`;
  syncJsonFromSpec();
  render();
}

function deleteSavedTheme(id: string) {
  const before = state.savedThemes.length;
  state.savedThemes = state.savedThemes.filter((theme) => theme.id !== id);
  if (state.savedThemes.length === before) {
    state.notice = "Saved theme not found.";
  } else {
    persistSavedThemes();
    state.notice = "Saved theme deleted.";
  }
  render();
}

function normalizeTargetOrigin(value: string): string {
  const raw = value.trim() || DEFAULT_TARGET_ORIGIN;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withProtocol.replace(/\/+$/, "");
}

function syncJsonFromSpec() {
  normalizeMiniThemeSpec(state.spec);
  state.jsonText = prettyJson(state.spec);
  state.jsonDirty = false;
  validateCurrentSpec();
}

function normalizeMiniThemeSpec(spec: ThemeSpec) {
  spec.themeSpecVersion = 1;
  spec.themeRev = FIXED_THEME_REV;
  spec.fallbackTheme = FIXED_FALLBACK_THEME;
  if (!Array.isArray(spec.primitives)) {
    spec.primitives = [];
  }
  spec.primitives.forEach((primitive) => {
    delete primitive.rotation;
    if (primitive.type === "pixels") {
      if (isRlePixels(primitive)) {
        primitive.p = normalizePalette(primitive.p ?? []);
        primitive.r = normalizeRleRows(primitive.r ?? []);
        delete primitive.color;
        delete primitive.data;
      } else {
        primitive.data = normalizedBitmapData(primitive.data ?? "", primitive.width ?? 0, primitive.height ?? 0);
        delete primitive.p;
        delete primitive.r;
      }
    }
    if (primitive.type === "sprite") {
      primitive.frameCount = clamp(Math.round(primitive.frameCount ?? 1), 1, MAX_SPRITE_FRAMES);
      primitive.fps = clamp(Math.round(primitive.fps ?? DEFAULT_SPRITE_FPS), 0, 30);
      primitive.sheetColumns = Math.max(1, Math.round(primitive.sheetColumns ?? primitive.frameCount ?? 1));
    }
  });
}

function validateCurrentSpec() {
  const result = validateSpec(state.spec);
  state.errors = result.errors;
  state.warnings = result.warnings;
}

function validateThemeAssetPath(primitive: Primitive, prefix: string, errors: string[]) {
  if (!primitive.assetPath || !primitive.assetPath.startsWith(THEME_ASSET_PATH_PREFIX)) {
    errors.push(`${prefix}: assetPath muss unter ${THEME_ASSET_PATH_PREFIX}... liegen.`);
  }
  if (primitive.assetPath && primitive.assetPath.length > MAX_ESP8266_LITTLEFS_PATH_CHARS) {
    errors.push(`${prefix}: assetPath ist zu lang für ESP8266 LittleFS (${primitive.assetPath.length}/${MAX_ESP8266_LITTLEFS_PATH_CHARS}).`);
  }
}

function validateThemeAssetPaths(primitive: Primitive, prefix: string, errors: string[]) {
  const paths = stateAssetPathsForPrimitive(primitive);
  if (paths.length === 0) {
    errors.push(`${prefix}: assetPath oder stateAssets ist erforderlich.`);
    return;
  }
  for (const [stateName, assetPath] of Object.entries(primitive.stateAssets ?? {})) {
    if (!STATE_NAME_RE.test(stateName)) {
      errors.push(`${prefix}: stateAssets.${stateName} muss klein geschrieben sein und darf nur a-z, 0-9, _ oder - enthalten.`);
    }
    validateThemeAssetPath({ ...primitive, assetPath }, `${prefix} ${stateName}`, errors);
  }
  if (primitive.assetPath) {
    validateThemeAssetPath(primitive, prefix, errors);
  }
}

function validateSpec(spec: ThemeSpec): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (spec.themeSpecVersion !== 1) {
    errors.push("themeSpecVersion muss 1 sein.");
  }
  if (!THEME_ID_RE.test(spec.themeId)) {
    errors.push("themeId muss klein geschrieben sein und 3-64 Zeichen haben.");
  }
  if (spec.themeRev !== FIXED_THEME_REV) {
    errors.push(`themeRev muss ${FIXED_THEME_REV} sein.`);
  }
  if (spec.fallbackTheme !== FIXED_FALLBACK_THEME) {
    errors.push("fallbackTheme muss mini sein.");
  }
  if (spec.bgColor && !COLOR_RE.test(spec.bgColor)) {
    errors.push("Background muss #RRGGBB sein.");
  }
  if (!Array.isArray(spec.primitives) || spec.primitives.length === 0) {
    errors.push("Mindestens ein Primitive ist erforderlich.");
  }
  if (spec.primitives.length > MAX_PRIMITIVES) {
    errors.push(`Zu viele Primitives: ${spec.primitives.length}/${MAX_PRIMITIVES}.`);
  }

  spec.primitives.forEach((primitive, index) => {
    const prefix = `Primitive ${index + 1}`;
    if (!SUPPORTED_PRIMITIVE_TYPES.includes(primitive.type)) {
      errors.push(`${prefix}: type muss ${SUPPORTED_PRIMITIVE_TYPES.join(", ")} sein.`);
    }
    if (!isNonNegativeInteger(primitive.x) || !isNonNegativeInteger(primitive.y)) {
      errors.push(`${prefix}: x/y müssen ganze Zahlen ab 0 sein.`);
    }
    for (const key of ["color", "bgColor", "borderColor"] as const) {
      const value = primitive[key];
      if (value && !COLOR_RE.test(value)) {
        errors.push(`${prefix}: ${key} muss #RRGGBB sein.`);
      }
    }
    if (primitive.type === "text") {
      if ((!primitive.text || primitive.text.trim() === "") && !primitive.binding) {
        errors.push(`${prefix}: text oder binding ist erforderlich.`);
      }
      if (primitive.fontSize !== undefined && (!Number.isInteger(primitive.fontSize) || primitive.fontSize < 1)) {
        errors.push(`${prefix}: fontSize sollte mindestens 1 sein.`);
      }
      if (primitive.font !== undefined && (!Number.isInteger(primitive.font) || primitive.font < 1)) {
        errors.push(`${prefix}: font sollte mindestens 1 sein.`);
      }
    }
    if (primitive.type === "rect" || primitive.type === "progress") {
      if (!isPositiveInteger(primitive.width) || !isPositiveInteger(primitive.height)) {
        errors.push(`${prefix}: width/height müssen größer als 0 sein.`);
      }
    }
    if (primitive.type === "gif") {
      if (!isPositiveInteger(primitive.width) || !isPositiveInteger(primitive.height)) {
        errors.push(`${prefix}: width/height müssen größer als 0 sein.`);
      }
      validateThemeAssetPaths(primitive, prefix, errors);
    }
    if (primitive.type === "sprite") {
      validateThemeAssetPaths(primitive, prefix, errors);
      if (primitive.width !== undefined && (!isPositiveInteger(primitive.width) || primitive.width > DISPLAY_SIZE)) {
        errors.push(`${prefix}: Sprite width muss 1-${DISPLAY_SIZE} sein.`);
      }
      if (primitive.height !== undefined && (!isPositiveInteger(primitive.height) || primitive.height > DISPLAY_SIZE)) {
        errors.push(`${prefix}: Sprite height muss 1-${DISPLAY_SIZE} sein.`);
      }
      if (!isPositiveInteger(primitive.frameCount ?? 1) || (primitive.frameCount ?? 1) > MAX_SPRITE_FRAMES) {
        errors.push(`${prefix}: Sprite frames müssen 1-${MAX_SPRITE_FRAMES} sein.`);
      }
      if (!Number.isInteger(primitive.fps ?? DEFAULT_SPRITE_FPS) || (primitive.fps ?? DEFAULT_SPRITE_FPS) < 0 || (primitive.fps ?? DEFAULT_SPRITE_FPS) > 30) {
        errors.push(`${prefix}: Sprite FPS muss 0-30 sein.`);
      }
      const source = spriteAssetFor(resolveStateAssetPath(primitive));
      const width = source?.width ?? primitive.width ?? estimatePrimitiveWidth(primitive);
      const height = source?.height ?? primitive.height ?? estimatePrimitiveHeight(primitive);
      const frames = primitive.frameCount ?? 1;
      if (width * height * frames > MAX_SPRITE_TOTAL_PIXELS) {
        errors.push(`${prefix}: Sprite ist zu groß (${width * height * frames}/${MAX_SPRITE_TOTAL_PIXELS} Pixel über alle Frames).`);
      }
    }
    if (primitive.type === "pixels") {
      if (!isPositiveInteger(primitive.width) || !isPositiveInteger(primitive.height)) {
        errors.push(`${prefix}: width/height müssen größer als 0 sein.`);
      } else if (primitive.width * primitive.height > 1024) {
        errors.push(`${prefix}: Pixelmasken dürfen maximal 1024 Pixel groß sein.`);
      }
      if (isRlePixels(primitive)) {
        const rleError = validateRlePixels(primitive);
        if (rleError) {
          errors.push(`${prefix}: ${rleError}`);
        }
      } else if (!isValidBitmapData(primitive.data ?? "", primitive.width ?? 0, primitive.height ?? 0)) {
        errors.push(`${prefix}: data muss Hex für width*height Bits enthalten.`);
      }
    }
    const width = primitive.width ?? estimatePrimitiveWidth(primitive);
    const height = primitive.height ?? estimatePrimitiveHeight(primitive);
    if (primitive.x + width > DISPLAY_SIZE || primitive.y + height > DISPLAY_SIZE) {
      warnings.push(`${prefix}: liegt teilweise außerhalb von 240x240.`);
    }
  });

  const bytes = new TextEncoder().encode(JSON.stringify(buildDeviceThemeSpec(spec))).length;
  if (bytes > MAX_SPEC_BYTES) {
    errors.push(`ThemeSpec ist zu groß: ${bytes}/${MAX_SPEC_BYTES} Bytes.`);
  }
  const frameBytes = new TextEncoder().encode(JSON.stringify(buildLiveFramePayload(spec))).length;
  if (frameBytes > MAX_FRAME_BYTES) {
    errors.push(`Payload ist zu groß für Vibe TV: ${frameBytes}/${MAX_FRAME_BYTES} Bytes.`);
  }

  const renderBudget = estimateRenderBudget(spec);
  if (renderBudget.animatedPixelsPerSecond > MAX_ANIMATED_REPAINT_PIXELS_PER_SECOND) {
    errors.push(`Animation ist zu schwer für ESP8266: ${renderBudget.animatedPixelsPerSecond}/${MAX_ANIMATED_REPAINT_PIXELS_PER_SECOND} Pixel pro Sekunde.`);
  }
  if (renderBudget.initialPixels > MAX_INITIAL_RENDER_PIXELS) {
    errors.push(`Initiales Zeichnen ist zu schwer für ESP8266: ca. ${renderBudget.initialPixels}/${MAX_INITIAL_RENDER_PIXELS} Pixel.`);
  }
  if (renderBudget.initialPixels > WARN_INITIAL_RENDER_PIXELS) {
    warnings.push(`Initiales Zeichnen ist schwer: ca. ${renderBudget.initialPixels} Pixel. Besser Details in wenige Sprites bündeln.`);
  }
  renderBudget.spriteWarnings.forEach((warning) => warnings.push(warning));

  return { errors, warnings };
}

function estimateRenderBudget(spec: ThemeSpec): { initialPixels: number; animatedPixelsPerSecond: number; spriteWarnings: string[] } {
  let initialPixels = DISPLAY_SIZE * DISPLAY_SIZE;
  let animatedPixelsPerSecond = 0;
  const spriteWarnings: string[] = [];

  spec.primitives.forEach((primitive, index) => {
    const width = Math.min(DISPLAY_SIZE, Math.max(0, primitive.width ?? estimatePrimitiveWidth(primitive)));
    const height = Math.min(DISPLAY_SIZE, Math.max(0, primitive.height ?? estimatePrimitiveHeight(primitive)));
    const area = width * height;
    if (["rect", "progress", "gif", "sprite", "pixels"].includes(primitive.type)) {
      initialPixels += area;
    }
    if (primitive.type === "sprite") {
      const source = spriteAssetFor(resolveStateAssetPath(primitive));
      const frameCount = source?.frameCount ?? primitive.frameCount ?? 1;
      const fps = source?.fps ?? primitive.fps ?? DEFAULT_SPRITE_FPS;
      if (frameCount > 1 && fps > 0) {
        animatedPixelsPerSecond += area * fps;
        if (!primitive.bgColor) {
          spriteWarnings.push(`Primitive ${index + 1}: animiertes Sprite hat keine Clear-Farbe; das kann Spuren oder Flackern machen.`);
        }
      }
    }
    if (primitive.type === "gif") {
      animatedPixelsPerSecond += area * 10;
    }
  });

  return {
    initialPixels: Math.round(initialPixels),
    animatedPixelsPerSecond: Math.round(animatedPixelsPerSecond),
    spriteWarnings,
  };
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

interface FocusSnapshot {
  selector: string;
  index: number;
  selectionStart: number | null;
  selectionEnd: number | null;
}

function captureFocusSnapshot(): FocusSnapshot | null {
  const active = document.activeElement;
  if (!isFocusableFormElement(active) || !app.contains(active)) {
    return null;
  }

  const selector = focusSelectorFor(active);
  if (!selector) {
    return null;
  }

  const matches = Array.from(app.querySelectorAll(selector));
  return {
    selector,
    index: Math.max(0, matches.indexOf(active)),
    selectionStart: canSelectText(active) ? active.selectionStart : null,
    selectionEnd: canSelectText(active) ? active.selectionEnd : null,
  };
}

function restoreFocusSnapshot(snapshot: FocusSnapshot | null) {
  if (!snapshot) {
    return;
  }

  window.requestAnimationFrame(() => {
    const matches = Array.from(app.querySelectorAll(snapshot.selector));
    const element = matches[snapshot.index] ?? matches[0];
    if (!isFocusableFormElement(element)) {
      return;
    }

    element.focus({ preventScroll: true });
    if (!canSelectText(element) || snapshot.selectionStart === null) {
      return;
    }

    const start = Math.min(snapshot.selectionStart, element.value.length);
    const end = Math.min(snapshot.selectionEnd ?? start, element.value.length);
    element.setSelectionRange(start, end);
  });
}

function isFocusableFormElement(element: Element | null): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
}

function canSelectText(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): element is HTMLInputElement | HTMLTextAreaElement {
  const selectableInputTypes = new Set(["", "email", "password", "search", "tel", "text", "url"]);
  return element instanceof HTMLTextAreaElement || (element instanceof HTMLInputElement && selectableInputTypes.has(element.type));
}

function focusSelectorFor(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string | null {
  for (const attribute of ["data-primitive-field", "data-primitive-state", "data-canvas-field", "data-field", "data-role", "data-inline-text"]) {
    const value = element.getAttribute(attribute);
    if (value !== null) {
      return `[${attribute}="${escapeCssAttribute(value)}"]`;
    }
  }
  return null;
}

function escapeCssAttribute(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function render() {
  const focusSnapshot = captureFocusSnapshot();
  validateCurrentSpec();
  const selected = state.spec.primitives[state.selectedIndex];
  const bytes = new TextEncoder().encode(JSON.stringify(buildDeviceThemeSpec(state.spec))).length;
  const frameBytes = new TextEncoder().encode(JSON.stringify(buildLiveFramePayload())).length;

  app.innerHTML = `
    <section class="studio-shell">
      <header class="appbar">
        <h1>Theme Studio</h1>
        <div class="status-strip">
          ${metric("Theme", bytes, MAX_SPEC_BYTES)}
          ${metric("Live", frameBytes, MAX_FRAME_BYTES)}
          ${metric("Primitives", state.spec.primitives.length, MAX_PRIMITIVES)}
          <span class="health ${state.errors.length ? "bad" : "ok"}">${state.errors.length ? "Invalid" : "Valid"}</span>
        </div>
      </header>

      <section class="workspace">
        <aside class="panel left-panel">
          <div class="panel-head theme-head">
            <h2>Theme</h2>
            <input class="theme-name-input" data-field="themeId" aria-label="Theme name" value="${escapeAttr(state.spec.themeId)}" />
          </div>
          <label>Vibe TV
            <input data-field="targetOrigin" aria-label="Vibe TV URL" value="${escapeAttr(state.targetOrigin)}" />
          </label>
          <label>Background
            <span class="color-row">
              <input type="color" data-field="bgColor" value="${escapeAttr(state.spec.bgColor ?? "#000000")}" />
              <input data-field="bgColor" value="${escapeAttr(state.spec.bgColor ?? "#000000")}" />
            </span>
          </label>
          <div class="history-actions">
            <button data-action="undo" ${state.undoStack.length === 0 ? "disabled" : ""}>Undo</button>
            <button data-action="redo" ${state.redoStack.length === 0 ? "disabled" : ""}>Redo</button>
          </div>
      <button class="full-width" data-action="save-local">Save Local</button>
          ${savedThemeList()}
          <button class="full-width preset-button" data-action="load-claude-creature">Claude Creature</button>
          <button class="full-width preset-button" data-action="load-cozy-meadow">Cozy Meadow</button>
          <div class="divider"></div>
          ${addElementPalette()}
          <div class="divider"></div>
          ${variableGuide()}
          <div class="divider"></div>
          <h2 class="section-title">Elements</h2>
          <div class="primitive-list">
            ${state.spec.primitives.map((primitive, index) => primitiveRow(primitive, index)).join("")}
          </div>
          <input class="hidden-file-input" data-role="gif-input" type="file" accept="image/gif,.gif" />
          <input class="hidden-file-input" data-role="sprite-input" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" />
        </aside>

        <section class="preview-column">
          <div class="device-frame">
            ${renderPreview()}
          </div>
          <div class="preview-actions">
            <button class="primary-action" data-action="send-theme" ${state.errors.length ? "disabled" : ""}>Send to Vibe TV</button>
            <button data-action="download-pack" ${state.errors.length ? "disabled" : ""}>Download Pack</button>
            <button data-action="download-json">Save Theme</button>
            <button data-action="copy-json">Copy JSON</button>
          </div>
          ${messageList()}
        </section>

        <aside class="panel right-panel">
          <details class="inspector-panel" open>
            <summary>${selected ? `${selected.type} ${state.selectedIndex + 1}` : "Inspector"}</summary>
            ${selected ? `<button class="danger-button full-width" data-action="delete-selected">Delete</button>${inspectorFields(selected)}` : `<p class="empty">Select an element.</p>`}
          </details>
          <details class="advanced-panel">
            <summary>Advanced JSON</summary>
            <div class="panel-head compact">
              <h2>Theme JSON</h2>
              <button data-action="apply-json">Apply JSON</button>
            </div>
            <textarea class="json-editor" spellcheck="false" data-role="json-editor">${escapeHtml(state.jsonText)}</textarea>
          </details>
        </aside>
      </section>
    </section>
  `;

  bindEvents();
  mountKonvaPreview();
  focusInlineTextEditor();
  restoreFocusSnapshot(focusSnapshot);
}

function savedThemeList(): string {
  if (state.savedThemes.length === 0) {
    return `<div class="saved-themes"><h2>Local Themes</h2><p class="empty compact-empty">No saved themes.</p></div>`;
  }
  return `
    <div class="saved-themes">
      <h2>Local Themes</h2>
      <div class="saved-theme-list">
        ${state.savedThemes.slice(0, 6).map((theme) => `
          <div class="saved-theme-row">
            <button class="saved-theme-load" data-load-saved-theme="${escapeAttr(theme.id)}">
              <strong>${escapeHtml(theme.name)}</strong>
              <span>${escapeHtml(formatSavedAt(theme.savedAt))}</span>
            </button>
            <button class="small-button" data-delete-saved-theme="${escapeAttr(theme.id)}" aria-label="Delete ${escapeAttr(theme.name)}">Delete</button>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function formatSavedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Saved locally";
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function metric(label: string, value: number, max: number): string {
  const over = value > max;
  return `<span class="metric ${over ? "bad" : ""}"><b>${value}</b><small>${label} / ${max}</small></span>`;
}

function addElementPalette(): string {
  return `
    <section class="add-elements">
      <h2 class="section-title">Add Element</h2>
      <div class="add-card-grid">
        <button class="add-card" data-action="add-text">
          <span class="add-icon text-icon">T</span>
          <strong>Text</strong>
        </button>
        <button class="add-card" data-action="add-progress">
          <span class="add-icon bar-icon"><i></i></span>
          <strong>Bar</strong>
        </button>
        <button class="add-card" data-action="add-rect">
          <span class="add-icon rect-icon"></span>
          <strong>Rect</strong>
        </button>
        <button class="add-card" data-action="add-line">
          <span class="add-icon line-icon"></span>
          <strong>Line</strong>
        </button>
        <button class="add-card" data-action="add-gif">
          <span class="add-icon gif-icon">GIF</span>
          <strong>GIF</strong>
        </button>
        <button class="add-card" data-action="add-sprite">
          <span class="add-icon pixels-icon"></span>
          <strong>Sprite</strong>
        </button>
        <button class="add-card" data-action="add-pixels">
          <span class="add-icon pixels-icon"></span>
          <strong>Pixels</strong>
        </button>
      </div>
    </section>
  `;
}

function variableGuide(): string {
  return `
    <section class="variable-guide">
      <h2 class="section-title">Variables</h2>
      <div class="token-grid">
        ${variableTokens.map((item) => `
          <button class="token-chip" data-insert-token="${escapeAttr(item.token)}" title="Insert ${escapeAttr(item.token)}">
            <strong>${escapeHtml(item.label)}</strong>
            <code>${escapeHtml(item.token)}</code>
            <span>${escapeHtml(item.preview)}</span>
          </button>
        `).join("")}
      </div>
    </section>
  `;
}

function primitiveRow(primitive: Primitive, index: number): string {
  const title = primitiveTitle(primitive);
  return `
    <button class="primitive-row ${index === state.selectedIndex ? "selected" : ""}" data-select="${index}">
      <span>${index + 1}</span>
      <strong>${primitive.type}</strong>
      <em>${escapeHtml(title)}</em>
    </button>
  `;
}

function primitiveTitle(primitive: Primitive): string {
  if (primitive.type === "text") {
    return primitive.text || primitive.binding || "Text";
  }
  if (primitive.type === "progress") {
    return primitive.binding || "session";
  }
  if (primitive.type === "gif") {
    return primitive.assetPath?.split("/").pop() || "GIF";
  }
  if (primitive.type === "sprite") {
    return primitive.assetPath?.split("/").pop() || "Sprite";
  }
  if (primitive.type === "pixels") {
    return `${primitive.width ?? 0}x${primitive.height ?? 0}${isRlePixels(primitive) ? " rle" : ""}`;
  }
  return primitive.color || "Rect";
}

function inspectorFields(primitive: Primitive): string {
  const common = `
    <div class="field-grid">
      <label>X<input type="number" min="0" step="1" data-primitive-field="x" value="${primitive.x}" /></label>
      <label>Y<input type="number" min="0" step="1" data-primitive-field="y" value="${primitive.y}" /></label>
    </div>
  `;

  if (primitive.type === "text") {
    return `
      ${common}
      <label>Text<input data-primitive-field="text" value="${escapeAttr(primitive.text ?? "")}" /></label>
      <div class="field-grid">
        <label>Font
          <select data-primitive-field="font">
            ${[1, 2, 4].map((value) => `<option value="${value}" ${(primitive.font ?? 1) === value ? "selected" : ""}>${fontLabel(value)}</option>`).join("")}
          </select>
        </label>
        <label>Size<input type="number" min="1" step="1" data-primitive-field="fontSize" value="${primitive.fontSize ?? 1}" /></label>
      </div>
      ${colorField("Color", "color", primitive.color ?? "#FFFFFF")}
      ${optionalColorField("Background", "bgColor", primitive.bgColor)}
    `;
  }

  if (primitive.type === "progress") {
    return `
      ${common}
      <div class="field-grid">
        <label>Width<input type="number" min="1" step="1" data-primitive-field="width" value="${primitive.width ?? 100}" /></label>
        <label>Height<input type="number" min="1" step="1" data-primitive-field="height" value="${primitive.height ?? 12}" /></label>
      </div>
      <label>Binding
        <select data-primitive-field="binding">
          ${["session", "weekly"].map((value) => `<option value="${value}" ${primitive.binding === value ? "selected" : ""}>${value}</option>`).join("")}
        </select>
      </label>
      ${colorField("Fill", "color", primitive.color ?? "#FFFFFF")}
      ${colorField("Track", "bgColor", primitive.bgColor ?? "#000000")}
      ${colorField("Border", "borderColor", primitive.borderColor ?? "#7B7B7B")}
    `;
  }

  if (primitive.type === "gif") {
    return `
      ${common}
      <label>Asset<input data-primitive-field="assetPath" value="${escapeAttr(primitive.assetPath ?? "")}" /></label>
      <div class="field-grid">
        <label>Width<input type="number" min="1" step="1" data-primitive-field="width" value="${primitive.width ?? DEFAULT_GIF_SIZE}" /></label>
        <label>Height<input type="number" min="1" step="1" data-primitive-field="height" value="${primitive.height ?? DEFAULT_GIF_SIZE}" /></label>
      </div>
    `;
  }

  if (primitive.type === "sprite") {
    const activeSprite = spriteAssetFor(resolveStateAssetPath(primitive));
    const stateAssetRows = primitive.stateAssets ? `
      <label>Idle asset<input data-primitive-state="idle" value="${escapeAttr(primitive.stateAssets.idle ?? "")}" /></label>
      <label>Coding asset<input data-primitive-state="coding" value="${escapeAttr(primitive.stateAssets.coding ?? "")}" /></label>
    ` : "";
    return `
      ${common}
      <label>Asset<input data-primitive-field="assetPath" value="${escapeAttr(primitive.assetPath ?? "")}" /></label>
      ${stateAssetRows}
      <div class="field-grid">
        <label>Width<input type="number" min="1" max="${MAX_SPRITE_FRAME_WIDTH}" step="1" data-primitive-field="width" value="${primitive.width ?? estimatePrimitiveWidth(primitive)}" /></label>
        <label>Height<input type="number" min="1" max="${MAX_SPRITE_FRAME_HEIGHT}" step="1" data-primitive-field="height" value="${primitive.height ?? estimatePrimitiveHeight(primitive)}" /></label>
      </div>
      <div class="field-grid">
        <label>Frames<input type="number" min="1" max="${MAX_SPRITE_FRAMES}" step="1" data-primitive-field="frameCount" value="${primitive.frameCount ?? activeSprite?.frameCount ?? 1}" /></label>
        <label>FPS<input type="number" min="0" max="30" step="1" data-primitive-field="fps" value="${primitive.fps ?? activeSprite?.fps ?? DEFAULT_SPRITE_FPS}" /></label>
      </div>
      ${optionalColorField("Clear", "bgColor", primitive.bgColor)}
      <label>Columns<input type="number" min="1" max="${MAX_SPRITE_FRAMES}" step="1" data-primitive-field="sheetColumns" value="${primitive.sheetColumns ?? inferredSpriteColumns(primitive)}" /></label>
    `;
  }

  if (primitive.type === "pixels") {
    const rleMode = isRlePixels(primitive);
    return `
      ${common}
      <div class="field-grid">
        <label>Width<input type="number" min="1" step="1" data-primitive-field="width" value="${primitive.width ?? DEFAULT_PIXELS_WIDTH}" /></label>
        <label>Height<input type="number" min="1" step="1" data-primitive-field="height" value="${primitive.height ?? DEFAULT_PIXELS_HEIGHT}" /></label>
      </div>
      ${rleMode ? `
        ${pixelPaintPanel(primitive)}
        <label>Palette<textarea rows="3" data-primitive-field="p" spellcheck="false">${escapeHtml((primitive.p ?? []).join("\n"))}</textarea></label>
        <label>RLE rows<textarea rows="8" data-primitive-field="r" spellcheck="false">${escapeHtml((primitive.r ?? []).join("\n"))}</textarea></label>
      ` : `
        ${colorField("Color", "color", primitive.color ?? "#FFFFFF")}
        ${pixelEditorGrid(primitive)}
        <button type="button" data-action="convert-pixels-rle">Color paint mode</button>
        <label>Bitmap hex<textarea rows="4" data-primitive-field="data" spellcheck="false">${escapeHtml(primitive.data ?? "")}</textarea></label>
      `}
    `;
  }

  return `
    ${common}
    <div class="field-grid">
      <label>Width<input type="number" min="1" step="1" data-primitive-field="width" value="${primitive.width ?? 32}" /></label>
      <label>Height<input type="number" min="1" step="1" data-primitive-field="height" value="${primitive.height ?? 32}" /></label>
    </div>
    ${colorField("Color", "color", primitive.color ?? "#FFFFFF")}
  `;
}

function pixelEditorGrid(primitive: Primitive): string {
  const width = primitive.width ?? 0;
  const height = primitive.height ?? 0;
  if (primitive.type !== "pixels" || width <= 0 || height <= 0 || width * height > 512) {
    return "";
  }
  const data = normalizedBitmapData(primitive.data ?? "", width, height);
  const cells: string[] = [];
  for (let index = 0; index < width * height; index += 1) {
    cells.push(`<button type="button" class="pixel-cell ${bitmapBitSet(data, index) ? "on" : ""}" data-pixel-toggle="${index}" aria-label="Pixel ${index + 1}"></button>`);
  }
  return `
    <div class="pixel-editor" style="--pixel-cols:${width}">
      ${cells.join("")}
    </div>
  `;
}

function pixelPaintPanel(primitive: Primitive): string {
  const width = primitive.width ?? 0;
  const height = primitive.height ?? 0;
  if (primitive.type !== "pixels" || width <= 0 || height <= 0 || width * height > 1024) {
    return "";
  }
  const palette = normalizedRlePalette(primitive);
  const rows = decodeRleTokenRows(primitive);
  const brush = validPixelBrushToken(palette);
  const cells: string[] = [];
  for (let index = 0; index < width * height; index += 1) {
    const token = rows[Math.floor(index / width)]?.[index % width] ?? ".";
    const color = token === "." ? "" : palette[token.charCodeAt(0) - 97] ?? "";
    cells.push(`
      <button
        type="button"
        class="pixel-cell paint-cell ${token !== "." ? "on" : ""}"
        style="${color ? `--pixel-color:${escapeAttr(color)}` : ""}"
        data-pixel-paint="${index}"
        aria-label="Pixel ${index + 1}"
      ></button>
    `);
  }
  return `
    <div class="pixel-tool-panel">
      <div class="segmented pixel-mode">
        ${pixelToolButton("move", "Move")}
        ${pixelToolButton("paint", "Paint")}
        ${pixelToolButton("erase", "Erase")}
      </div>
      <div class="pixel-palette">
        ${palette.map((color, index) => {
          const token = String.fromCharCode(97 + index);
          return `
            <button type="button" class="pixel-swatch ${brush === token ? "selected" : ""}" style="--swatch:${escapeAttr(color)}" data-pixel-brush="${token}" aria-label="Color ${index + 1}"></button>
            <input type="color" value="${escapeAttr(color)}" data-pixel-palette-color="${index}" aria-label="Edit color ${index + 1}" />
          `;
        }).join("")}
        <button type="button" class="small-button" data-action="add-pixel-color" ${palette.length >= 26 ? "disabled" : ""}>+ Color</button>
      </div>
      <div class="pixel-editor pixel-paint-grid" style="--pixel-cols:${width}">
        ${cells.join("")}
      </div>
    </div>
  `;
}

function pixelToolButton(tool: PixelTool, label: string): string {
  return `<button type="button" class="${state.pixelTool === tool ? "selected" : ""}" data-pixel-tool="${tool}">${label}</button>`;
}

function colorField(label: string, key: keyof Primitive, value: string): string {
  return `
    <label>${label}
      <span class="color-row">
        <input type="color" data-primitive-field="${key}" value="${escapeAttr(value)}" />
        <input data-primitive-field="${key}" value="${escapeAttr(value)}" />
      </span>
    </label>
  `;
}

function optionalColorField(label: string, key: keyof Primitive, value: string | undefined): string {
  const colorValue = value ?? "#000000";
  return `
    <label>${label}
      <span class="color-row optional-color-row">
        <input type="color" data-primitive-field="${key}" value="${escapeAttr(colorValue)}" />
        <input data-primitive-field="${key}" value="${escapeAttr(value ?? "")}" placeholder="transparent" />
        <button type="button" class="small-button" data-clear-primitive-field="${key}">Transparent</button>
      </span>
    </label>
  `;
}

function renderPreview(): string {
  return `
    <div class="display preview-stack" aria-label="Theme preview">
      <canvas class="device-canvas" data-role="device-canvas" width="${DISPLAY_SIZE}" height="${DISPLAY_SIZE}"></canvas>
      <div class="konva-overlay" data-role="konva-stage"></div>
    </div>
    ${themeUsesStateAssets() ? `
      <div class="activity-toggle" role="group" aria-label="Activity preview">
        <button class="${frame.activity === "idle" ? "active" : ""}" data-preview-activity="idle">Idle</button>
        <button class="${frame.activity === "coding" ? "active" : ""}" data-preview-activity="coding">Coding</button>
      </div>
    ` : ""}
  `;
}

function mountKonvaPreview() {
  const container = app.querySelector<HTMLDivElement>("[data-role='konva-stage']");
  const deviceCanvas = app.querySelector<HTMLCanvasElement>("[data-role='device-canvas']");
  gifPreviewGeneration += 1;
  stopGifPreviewAnimations();
  gifRedrawAnimation?.stop();
  gifRedrawAnimation = null;
  stage?.destroy();
  stage = null;

  if (!container || !deviceCanvas) {
    return;
  }

  const hasAnimated = renderDeviceCanvas(deviceCanvas);
  const stageSize = previewStageSize(container);
  const previewScale = stageSize / DISPLAY_SIZE;
  const konvaStage = new Konva.Stage({
    container,
    width: stageSize,
    height: stageSize,
  });
  stage = konvaStage;

  const layer = new Konva.Layer();
  layer.scale({ x: previewScale, y: previewScale });
  konvaStage.add(layer);

  const nodes: EditableKonvaNode[] = [];
  state.spec.primitives.forEach((primitive, index) => {
    const result = konvaNodeForPrimitive(primitive, index, konvaStage, previewScale);
    if (!result) {
      return;
    }
    layer.add(result.node);
    nodes[index] = result.node;
  });

  const selected = state.spec.primitives[state.selectedIndex];
  const selectedNode = nodes[state.selectedIndex];
  if (selected && selectedNode) {
    const transformer = new Konva.Transformer({
      nodes: [selectedNode],
      rotateEnabled: false,
      keepRatio: selected.type === "gif",
      borderStroke: "#c7ff68",
      borderStrokeWidth: 1.5,
      anchorFill: "#c7ff68",
      anchorStroke: "#0a0b0d",
      anchorSize: 8,
      anchorCornerRadius: 2,
      boundBoxFunc: (_oldBox, newBox) => {
        if (newBox.width < 4 || newBox.height < 4) {
          return _oldBox;
        }
        return newBox;
      },
    });
    layer.add(transformer);
  }

  let fallbackDrag: { index: number; startX: number; startY: number; originX: number; originY: number } | null = null;

  konvaStage.on("pointerdown", (event) => {
    if (paintSelectedPixelsAtPointer(konvaStage, previewScale)) {
      pixelCanvasPaintActive = true;
      event.cancelBubble = true;
      syncJsonFromSpec();
      render();
      return;
    }
    if (event.target !== konvaStage) {
      return;
    }
    const pointer = logicalStagePointer(konvaStage, previewScale);
    if (!pointer) {
      return;
    }
    const hitIndex = primitiveIndexAtPoint(pointer.x, pointer.y);
    if (hitIndex >= 0) {
      const primitive = state.spec.primitives[hitIndex];
      pushHistory();
      fallbackDrag = {
        index: hitIndex,
        startX: pointer.x,
        startY: pointer.y,
        originX: primitive.x,
        originY: primitive.y,
      };
      state.selectedIndex = hitIndex;
      state.editingTextIndex = null;
      state.notice = "";
      return;
    }
    state.selectedIndex = -1;
    state.editingTextIndex = null;
    state.notice = "";
    render();
  });

  konvaStage.on("pointermove", () => {
    if (pixelCanvasPaintActive && paintSelectedPixelsAtPointer(konvaStage, previewScale)) {
      syncJsonFromSpec();
      render();
      return;
    }
    if (!fallbackDrag) {
      return;
    }
    const primitive = state.spec.primitives[fallbackDrag.index];
    const node = nodes[fallbackDrag.index];
    const pointer = logicalStagePointer(konvaStage, previewScale);
    if (!primitive || !node || !pointer) {
      return;
    }
    const maxX = Math.max(0, DISPLAY_SIZE - estimatePrimitiveWidth(primitive));
    const maxY = Math.max(0, DISPLAY_SIZE - estimatePrimitiveHeight(primitive));
    primitive.x = clamp(Math.round(fallbackDrag.originX + pointer.x - fallbackDrag.startX), 0, maxX);
    primitive.y = clamp(Math.round(fallbackDrag.originY + pointer.y - fallbackDrag.startY), 0, maxY);
    node.position({ x: primitive.x, y: primitive.y });
    layer.batchDraw();
  });

  konvaStage.on("pointerup pointercancel", () => {
    if (!fallbackDrag) {
      return;
    }
    fallbackDrag = null;
    syncJsonFromSpec();
    render();
  });

  layer.draw();
  if (hasAnimated) {
    gifRedrawAnimation = new Konva.Animation(() => {
      renderDeviceCanvas(deviceCanvas);
    }, layer);
    gifRedrawAnimation.start();
  }
}

function renderDeviceCanvas(canvas: HTMLCanvasElement): boolean {
  canvas.width = DISPLAY_SIZE;
  canvas.height = DISPLAY_SIZE;
  const context = canvas.getContext("2d");
  if (!context) {
    return false;
  }
  context.imageSmoothingEnabled = false;
  context.fillStyle = state.spec.bgColor ?? "#000000";
  context.fillRect(0, 0, DISPLAY_SIZE, DISPLAY_SIZE);

  let hasAnimated = false;
  for (const primitive of state.spec.primitives) {
    if (primitive.type === "rect") {
      context.fillStyle = primitive.color ?? "#000000";
      context.fillRect(primitive.x, primitive.y, primitive.width ?? 1, primitive.height ?? 1);
    } else if (primitive.type === "progress") {
      drawDeviceProgress(context, primitive);
    } else if (primitive.type === "text") {
      const text = primitive.binding ? bindingValue(primitive.binding) : renderTemplate(primitive.text ?? "");
      const width = estimatePrimitiveWidth(primitive);
      const height = estimatePrimitiveHeight(primitive);
      context.drawImage(textPreviewCanvas(primitive, text, width, height), primitive.x, primitive.y);
    } else if (primitive.type === "gif") {
      hasAnimated = drawDeviceGif(context, primitive) || hasAnimated;
    } else if (primitive.type === "sprite") {
      hasAnimated = drawDeviceSprite(context, primitive) || hasAnimated;
    } else if (primitive.type === "pixels") {
      drawDevicePixels(context, primitive);
    }
  }
  return hasAnimated;
}

function drawDeviceSprite(context: CanvasRenderingContext2D, primitive: Primitive): boolean {
  const sprite = spriteAssetFor(resolveStateAssetPath(primitive));
  const width = primitive.width ?? sprite?.width ?? 24;
  const height = primitive.height ?? sprite?.height ?? 14;
  if (!sprite) {
    context.fillStyle = "#141922";
    context.fillRect(primitive.x, primitive.y, width, height);
    return false;
  }
  if (primitive.bgColor) {
    context.fillStyle = primitive.bgColor;
    context.fillRect(primitive.x, primitive.y, width, height);
  }
  drawSpriteFrame(context, sprite, currentSpriteFrameIndex(sprite), primitive.x, primitive.y, width, height);
  return sprite.frameCount > 1 && sprite.fps > 0;
}

function drawDeviceProgress(context: CanvasRenderingContext2D, primitive: Primitive) {
  const width = primitive.width ?? 1;
  const height = primitive.height ?? 1;
  const pct = primitive.binding === "weekly" || primitive.binding === "weeklyPercent" ? frame.weekly : frame.session;
  const fillWidth = clamp(Math.floor((width * pct) / 100), 0, Math.max(0, width - 2));

  context.fillStyle = primitive.borderColor ?? "#7B7B7B";
  context.fillRect(primitive.x, primitive.y, width, height);
  context.fillStyle = primitive.bgColor ?? "#000000";
  context.fillRect(primitive.x + 1, primitive.y + 1, Math.max(0, width - 2), Math.max(0, height - 2));
  if (fillWidth > 0) {
    context.fillStyle = primitive.color ?? "#FFFFFF";
    context.fillRect(primitive.x + 1, primitive.y + 1, fillWidth, Math.max(0, height - 2));
  }
}

function drawDeviceGif(context: CanvasRenderingContext2D, primitive: Primitive): boolean {
  const width = primitive.width ?? DEFAULT_GIF_SIZE;
  const height = primitive.height ?? DEFAULT_GIF_SIZE;
  const assetPath = resolveStateAssetPath(primitive);
  const preview = assetPath ? gifPreviewFor(assetPath, gifPreviewGeneration) : null;
  if (!preview) {
    context.fillStyle = "#141922";
    context.fillRect(primitive.x, primitive.y, width, height);
    return false;
  }
  const rect = fitContainRect(primitive.x, primitive.y, width, height, gifAspectRatio(primitive));
  context.imageSmoothingEnabled = false;
  context.drawImage(preview.canvas, rect.x, rect.y, rect.width, rect.height);
  return true;
}

function drawDevicePixels(context: CanvasRenderingContext2D, primitive: Primitive) {
  const width = primitive.width ?? 0;
  const height = primitive.height ?? 0;
  if (isRlePixels(primitive)) {
    drawDeviceRlePixels(context, primitive, width, height);
    return;
  }
  if (!isValidBitmapData(primitive.data ?? "", width, height)) {
    return;
  }
  context.fillStyle = primitive.color ?? "#FFFFFF";
  for (let row = 0; row < height; row += 1) {
    let runStart = -1;
    for (let col = 0; col <= width; col += 1) {
      const on = col < width && bitmapBitSet(primitive.data ?? "", row * width + col);
      if (on && runStart < 0) {
        runStart = col;
      } else if (!on && runStart >= 0) {
        context.fillRect(primitive.x + runStart, primitive.y + row, col - runStart, 1);
        runStart = -1;
      }
    }
  }
}

function drawDeviceRlePixels(context: CanvasRenderingContext2D, primitive: Primitive, width: number, height: number) {
  if (validateRlePixels(primitive)) {
    return;
  }
  const palette = primitive.p ?? [];
  const rows = primitive.r ?? [];
  rows.slice(0, height).forEach((row, rowIndex) => {
    parseRleRow(row, width, (col, count, token) => {
      if (token === ".") {
        return;
      }
      const color = palette[token.charCodeAt(0) - 97];
      if (!color) {
        return;
      }
      context.fillStyle = color;
      context.fillRect(primitive.x + col, primitive.y + rowIndex, count, 1);
    });
  });
}

function previewStageSize(container: HTMLDivElement): number {
  const rect = container.getBoundingClientRect();
  const measured = Math.round(Math.min(rect.width, rect.height));
  return measured > 0 ? measured : DISPLAY_SIZE;
}

function logicalStagePointer(konvaStage: Konva.Stage, previewScale: number): { x: number; y: number } | null {
  const pointer = konvaStage.getPointerPosition();
  if (!pointer || previewScale <= 0) {
    return null;
  }
  return {
    x: pointer.x / previewScale,
    y: pointer.y / previewScale,
  };
}

function primitiveIndexAtPoint(x: number, y: number): number {
  for (let index = state.spec.primitives.length - 1; index >= 0; index -= 1) {
    if (pointInPrimitive(state.spec.primitives[index], x, y)) {
      return index;
    }
  }
  return -1;
}

function pointInPrimitive(primitive: Primitive, x: number, y: number): boolean {
  const width = estimatePrimitiveWidth(primitive);
  const height = estimatePrimitiveHeight(primitive);
  if (width <= 0 || height <= 0) {
    return false;
  }
  const rotation = normalizeRotation(primitive.rotation ?? 0);
  if (rotation === 0) {
    return x >= primitive.x && x <= primitive.x + width && y >= primitive.y && y <= primitive.y + height;
  }
  const radians = (-rotation * Math.PI) / 180;
  const centerX = primitive.x + width / 2;
  const centerY = primitive.y + height / 2;
  const dx = x - centerX;
  const dy = y - centerY;
  const localX = Math.cos(radians) * dx - Math.sin(radians) * dy + width / 2;
  const localY = Math.sin(radians) * dx + Math.cos(radians) * dy + height / 2;
  return localX >= 0 && localX <= width && localY >= 0 && localY <= height;
}

function konvaNodeForPrimitive(primitive: Primitive, index: number, konvaStage: Konva.Stage, previewScale: number): { node: EditableKonvaNode; animated: boolean } | null {
  const node = overlayKonvaRect(primitive, index);
  bindKonvaNodeEvents(node, index, konvaStage, previewScale);
  return { node, animated: false };
}

function commonKonvaProps(primitive: Primitive, index: number) {
  return {
    x: primitive.x,
    y: primitive.y,
    draggable: !(primitive.type === "pixels" && index === state.selectedIndex && state.pixelTool !== "move"),
    id: `primitive-${index}`,
    name: "primitive",
    primitiveIndex: index,
  };
}

function overlayKonvaRect(primitive: Primitive, index: number): Konva.Rect {
  return new Konva.Rect({
    ...commonKonvaProps(primitive, index),
    width: estimatePrimitiveWidth(primitive),
    height: estimatePrimitiveHeight(primitive),
    fill: "rgba(199,255,104,0.001)",
    stroke: index === state.selectedIndex ? "#c7ff68" : "rgba(0,0,0,0)",
    strokeWidth: index === state.selectedIndex ? 1 : 0,
  });
}

function progressKonvaGroup(primitive: Primitive, index: number): Konva.Group {
  const width = primitive.width ?? 1;
  const height = primitive.height ?? 1;
  const pct = primitive.binding === "weekly" || primitive.binding === "weeklyPercent" ? frame.weekly : frame.session;
  const fillWidth = Math.max(0, Math.min(width - 2, Math.floor((width * pct) / 100)));
  const group = new Konva.Group({
    ...commonKonvaProps(primitive, index),
    width,
    height,
  });
  group.add(new Konva.Rect({
    x: 0,
    y: 0,
    width,
    height,
    fill: primitive.bgColor ?? "#000000",
    stroke: primitive.borderColor ?? "#7B7B7B",
    strokeWidth: 1,
  }));
  group.add(new Konva.Rect({
    x: 1,
    y: 1,
    width: fillWidth,
    height: Math.max(0, height - 2),
    fill: primitive.color ?? "#FFFFFF",
  }));
  return group;
}

function textKonvaGroup(primitive: Primitive, index: number): Konva.Group {
  const text = primitive.binding ? bindingValue(primitive.binding) : renderTemplate(primitive.text ?? "");
  const width = estimatePrimitiveWidth(primitive);
  const height = estimatePrimitiveHeight(primitive);
  const group = new Konva.Group({
    ...commonKonvaProps(primitive, index),
    width,
    height,
  });
  const previewCanvas = textPreviewCanvas(primitive, text, width, height);
  group.add(new Konva.Rect({
    x: 0,
    y: 0,
    width,
    height,
    fill: primitive.bgColor ?? "rgba(0,0,0,0)",
  }));
  group.add(new Konva.Image({
    x: 0,
    y: 0,
    width,
    height,
    image: previewCanvas,
    imageSmoothingEnabled: false,
    listening: false,
  }));
  return group;
}

function gifKonvaGroup(primitive: Primitive, index: number): { node: Konva.Group; animated: boolean } {
  const width = primitive.width ?? DEFAULT_GIF_SIZE;
  const height = primitive.height ?? DEFAULT_GIF_SIZE;
  const group = new Konva.Group({
    ...commonKonvaProps(primitive, index),
    width,
    height,
  });
  const assetPath = resolveStateAssetPath(primitive);
  const preview = assetPath ? gifPreviewFor(assetPath, gifPreviewGeneration) : null;
  if (preview) {
    const rect = fitContainRect(0, 0, width, height, gifAspectRatio(primitive));
    group.add(new Konva.Rect({
      x: 0,
      y: 0,
      width,
      height,
      fill: "rgba(0,0,0,0)",
    }));
    group.add(new Konva.Image({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      image: preview.canvas,
      imageSmoothingEnabled: false,
      listening: false,
    }));
    return { node: group, animated: true };
  }

  group.add(new Konva.Rect({
    x: 0,
    y: 0,
    width,
    height,
    fill: "#141922",
    stroke: "#c7ff68",
    strokeWidth: 1,
    dash: [4, 3],
  }));
  group.add(new Konva.Text({
    x: 0,
    y: Math.max(0, height / 2 - 6),
    width,
    height: 14,
    text: "GIF",
    align: "center",
    fontSize: 12,
    fontFamily: PREVIEW_FONT_FAMILY,
    fontStyle: String(PREVIEW_FONT_WEIGHT),
    fill: "#c7ff68",
    listening: false,
  }));
  return { node: group, animated: false };
}

function fitContainRect(x: number, y: number, width: number, height: number, ratio: number) {
  if (width <= 0 || height <= 0 || ratio <= 0) {
    return { x, y, width: Math.max(1, width), height: Math.max(1, height) };
  }
  let drawWidth = width;
  let drawHeight = Math.round(width / ratio);
  if (drawHeight > height) {
    drawHeight = height;
    drawWidth = Math.round(height * ratio);
  }
  return {
    x: x + Math.round((width - drawWidth) / 2),
    y: y + Math.round((height - drawHeight) / 2),
    width: Math.max(1, drawWidth),
    height: Math.max(1, drawHeight),
  };
}

function gifPreviewFor(assetPath: string, generation: number): GifPreview | null {
  const previewUrl = state.gifAssets[assetPath]?.previewUrl ?? builtInGifPreviewUrl(assetPath);
  if (!previewUrl) {
    return null;
  }
  const key = `${assetPath}|${previewUrl}`;
  const cached = gifPreviewCache.get(key);
  if (cached) {
    startGifPreview(cached);
    return cached;
  }

  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const preview: GifPreview = {
    canvas,
    key,
    loading: true,
    animator: null,
    playing: false,
  };
  gifPreviewCache.set(key, preview);

  const giflerApi = (window as Window & { gifler?: GiflerFactory }).gifler;
  if (!giflerApi) {
    preview.loading = false;
    return preview;
  }

  giflerApi(previewUrl).get((animator) => {
    if (gifPreviewCache.get(key) !== preview) {
      animator.stop();
      return;
    }
    preview.loading = false;
    preview.animator = animator;
    if (generation === gifPreviewGeneration) {
      startGifPreview(preview);
    }
  });

  return preview;
}

function startGifPreview(preview: GifPreview) {
  if (!preview.animator) {
    return;
  }
  if (preview.playing) {
    return;
  }
  preview.animator.stop();
  preview.animator.reset();
  preview.animator.animateInCanvas(preview.canvas, true);
  preview.playing = true;
}

function stopGifPreviewAnimations() {
  gifPreviewCache.forEach((preview) => {
    preview.animator?.stop();
    preview.playing = false;
  });
}

function bindKonvaNodeEvents(node: Konva.Node, index: number, konvaStage: Konva.Stage, previewScale: number) {
  node.on("pointerdown", (event) => {
    if (index === state.selectedIndex && paintPixelsAtPointer(index, konvaStage, previewScale)) {
      pixelCanvasPaintActive = true;
      event.cancelBubble = true;
      syncJsonFromSpec();
      render();
      return;
    }
    state.selectedIndex = index;
    state.editingTextIndex = null;
    state.notice = "";
  });
  node.on("click tap", () => {
    state.selectedIndex = index;
    state.editingTextIndex = null;
    state.notice = "";
    render();
  });
  node.on("dblclick dbltap", () => {
    const primitive = state.spec.primitives[index];
    if (primitive?.type === "text") {
      state.selectedIndex = index;
      state.editingTextIndex = index;
      state.notice = "";
      render();
    }
  });
  node.on("dragend", () => {
    commitKonvaTransform(node, index);
  });
  node.on("transformend", () => {
    commitKonvaTransform(node, index);
  });
}

function commitKonvaTransform(node: Konva.Node, index: number) {
  const primitive = state.spec.primitives[index];
  if (!primitive) {
    return;
  }
  pushHistory();

  const scaleX = node.scaleX();
  const scaleY = node.scaleY();
  const baseWidth = estimatePrimitiveWidth(primitive);
  const baseHeight = estimatePrimitiveHeight(primitive);
  const nextWidth = Math.max(1, Math.round(baseWidth * Math.abs(scaleX || 1)));
  const nextHeight = Math.max(1, Math.round(baseHeight * Math.abs(scaleY || 1)));

  primitive.x = clamp(Math.round(node.x()), 0, DISPLAY_SIZE - 1);
  primitive.y = clamp(Math.round(node.y()), 0, DISPLAY_SIZE - 1);

  if (primitive.type === "text") {
    const nextSize = Math.max(Math.abs(scaleX || 1), Math.abs(scaleY || 1));
    primitive.fontSize = clamp(Math.round((primitive.fontSize ?? 1) * nextSize), 1, 12);
  } else if (primitive.type === "gif") {
    const ratio = gifAspectRatio(primitive);
    if (Math.abs(scaleY) > Math.abs(scaleX)) {
      applyGifHeight(primitive, ratio, nextHeight);
    } else {
      applyGifWidth(primitive, ratio, nextWidth);
    }
  } else {
    primitive.width = clamp(nextWidth, 1, DISPLAY_SIZE - primitive.x);
    primitive.height = clamp(nextHeight, 1, DISPLAY_SIZE - primitive.y);
  }

  node.scale({ x: 1, y: 1 });
  state.selectedIndex = index;
  state.editingTextIndex = null;
  syncJsonFromSpec();
  render();
}

function renderPrimitive(primitive: Primitive, index: number): string {
  const selected = index === state.selectedIndex;
  const active = selected || index === state.hoveredIndex;
  const handle = active ? selectionHandle(primitive, index) : "";
  const hitTarget = primitiveHitTarget(primitive, index);
  const transform = rotationTransform(primitive);
  if (primitive.type === "rect") {
    return `
      <g${transform}>
        <rect class="${selected ? "selected-shape" : ""}" x="${primitive.x}" y="${primitive.y}" width="${primitive.width ?? 1}" height="${primitive.height ?? 1}" fill="${escapeAttr(primitive.color ?? "#000000")}"></rect>
        ${hitTarget}
      </g>
      ${handle}
    `;
  }
  if (primitive.type === "progress") {
    const width = primitive.width ?? 1;
    const height = primitive.height ?? 1;
    const pct = primitive.binding === "weekly" || primitive.binding === "weeklyPercent" ? frame.weekly : frame.session;
    const fillWidth = Math.max(0, Math.min(width, Math.round((width * pct) / 100)));
    return `
      <g${transform}>
        <rect x="${primitive.x}" y="${primitive.y}" width="${width}" height="${height}" fill="${escapeAttr(primitive.bgColor ?? "#000000")}" stroke="${escapeAttr(primitive.borderColor ?? "#7B7B7B")}" stroke-width="1"></rect>
        <rect x="${primitive.x + 2}" y="${primitive.y + 2}" width="${Math.max(0, fillWidth - 4)}" height="${Math.max(0, height - 4)}" fill="${escapeAttr(primitive.color ?? "#FFFFFF")}"></rect>
        ${hitTarget}
      </g>
      ${handle}
    `;
  }
  if (primitive.type === "gif") {
    const width = primitive.width ?? 64;
    const height = primitive.height ?? 64;
    const assetPath = resolveStateAssetPath(primitive);
    const previewUrl = assetPath ? state.gifAssets[assetPath]?.previewUrl ?? builtInGifPreviewUrl(assetPath) : undefined;
    const placeholder = `
      <rect x="${primitive.x}" y="${primitive.y}" width="${width}" height="${height}" fill="#141922" stroke="#c7ff68" stroke-width="1" stroke-dasharray="4 3"></rect>
      <text x="${primitive.x + width / 2}" y="${primitive.y + height / 2 + 4}" text-anchor="middle" font-size="12" fill="#c7ff68" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-weight="800">GIF</text>
    `;
    return `
      <g${transform}>
        ${previewUrl ? `<image href="${escapeAttr(previewUrl)}" x="${primitive.x}" y="${primitive.y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"></image>` : placeholder}
        ${hitTarget}
      </g>
      ${handle}
    `;
  }
  if (primitive.type === "sprite") {
    const sprite = spriteAssetFor(resolveStateAssetPath(primitive));
    const width = primitive.width ?? sprite?.width ?? 24;
    const height = primitive.height ?? sprite?.height ?? 14;
    const frame = sprite?.frames[currentSpriteFrameIndex(sprite)];
    const pixels = sprite && frame ? frame.map((row, rowIndex) => {
      const rects: string[] = [];
      parseRleRow(row, sprite.width, (col, count, token) => {
        if (token === ".") {
          return;
        }
        const color = sprite.palette[token.charCodeAt(0) - 97] ?? "#FFFFFF";
        const x1 = primitive.x + Math.floor((col * width) / sprite.width);
        const x2 = primitive.x + Math.ceil(((col + count) * width) / sprite.width);
        const y1 = primitive.y + Math.floor((rowIndex * height) / sprite.height);
        const y2 = primitive.y + Math.ceil(((rowIndex + 1) * height) / sprite.height);
        rects.push(`<rect x="${x1}" y="${y1}" width="${Math.max(1, x2 - x1)}" height="${Math.max(1, y2 - y1)}" fill="${escapeAttr(color)}"></rect>`);
      });
      return rects.join("");
    }).join("") : `
      <rect x="${primitive.x}" y="${primitive.y}" width="${width}" height="${height}" fill="#141922" stroke="#c7ff68" stroke-width="1" stroke-dasharray="4 3"></rect>
    `;
    return `
      <g${transform}>
        ${pixels}
        ${hitTarget}
      </g>
      ${handle}
    `;
  }

  const fontPx = textPixelSize(primitive);
  const text = primitive.binding ? bindingValue(primitive.binding) : renderTemplate(primitive.text ?? "");
  const isEditing = state.editingTextIndex === index;
  return `
    <g${transform}>
      ${isEditing ? inlineTextEditor(primitive, index) : `<text class="preview-text ${selected ? "selected-text" : ""}" x="${primitive.x}" y="${primitive.y}" dominant-baseline="hanging" font-size="${fontPx}" fill="${escapeAttr(primitive.color ?? "#FFFFFF")}" font-family="${escapeAttr(PREVIEW_FONT_FAMILY)}" font-weight="${PREVIEW_FONT_WEIGHT}">${escapeHtml(text)}</text>`}
      ${isEditing ? "" : hitTarget}
    </g>
    ${handle}
  `;
}

function inlineTextEditor(primitive: Primitive, index: number): string {
  const width = Math.min(DISPLAY_SIZE - primitive.x, Math.max(42, estimatePrimitiveWidth(primitive) + 10));
  const height = Math.max(18, estimatePrimitiveHeight(primitive) + 6);
  return `
    <foreignObject class="inline-text-editor" x="${primitive.x}" y="${primitive.y}" width="${width}" height="${height}">
      <input xmlns="http://www.w3.org/1999/xhtml" style="font-family:${escapeAttr(PREVIEW_FONT_FAMILY)};font-weight:${PREVIEW_FONT_WEIGHT}" data-inline-text="${index}" value="${escapeAttr(primitive.text ?? "")}" />
    </foreignObject>
  `;
}

function primitiveHitTarget(primitive: Primitive, index: number): string {
  const width = estimatePrimitiveWidth(primitive);
  const height = estimatePrimitiveHeight(primitive);
  return `<rect class="primitive-hit" data-drag="${index}" x="${primitive.x}" y="${primitive.y}" width="${width}" height="${height}" fill="transparent"></rect>`;
}

function selectionHandle(primitive: Primitive, index: number): string {
  const width = estimatePrimitiveWidth(primitive);
  const height = estimatePrimitiveHeight(primitive);
  const box = `<rect class="selection-box" x="${primitive.x}" y="${primitive.y}" width="${width}" height="${height}" fill="none"></rect>`;
  const handles = primitive.type === "text"
    ? resizeHandle(index, "se", primitive.x + width, primitive.y + height)
    : [
        resizeHandle(index, "e", primitive.x + width, primitive.y + height / 2),
        resizeHandle(index, "s", primitive.x + width / 2, primitive.y + height),
        resizeHandle(index, "se", primitive.x + width, primitive.y + height),
      ].join("");
  return `<g${rotationTransform(primitive)}>${box}${handles}</g>${canvasToolbar(primitive)}`;
}

function canvasToolbar(primitive: Primitive): string {
  const width = primitive.type === "text" ? 128 : primitive.type === "progress" ? 110 : primitive.type === "gif" ? 48 : 74;
  const height = 22;
  const x = clamp(primitive.x, 0, Math.max(0, DISPLAY_SIZE - width));
  const y = primitive.y > height + 4 ? primitive.y - height - 4 : primitive.y + estimatePrimitiveHeight(primitive) + 6;

  if (primitive.type === "text") {
    return `
      <foreignObject class="canvas-toolbar" x="${x}" y="${clamp(y, 0, DISPLAY_SIZE - height)}" width="${width}" height="${height}">
        <div xmlns="http://www.w3.org/1999/xhtml" class="canvas-toolbar-inner">
          ${rotationControls(primitive)}
          <span class="toolbar-separator"></span>
          <button class="toolbar-icon" data-font-size-delta="-1" title="Smaller text" aria-label="Smaller text">A-</button>
          <button class="toolbar-icon" data-font-size-delta="1" title="Bigger text" aria-label="Bigger text">A+</button>
          <span class="toolbar-separator"></span>
          <input data-canvas-field="color" type="color" value="${escapeAttr(primitive.color ?? "#FFFFFF")}" aria-label="Text color" />
          <input data-canvas-field="bgColor" type="color" value="${escapeAttr(primitive.bgColor ?? "#000000")}" aria-label="Text background" />
        </div>
      </foreignObject>
    `;
  }

  if (primitive.type === "progress") {
    return `
      <foreignObject class="canvas-toolbar" x="${x}" y="${clamp(y, 0, DISPLAY_SIZE - height)}" width="${width}" height="${height}">
        <div xmlns="http://www.w3.org/1999/xhtml" class="canvas-toolbar-inner">
          ${rotationControls(primitive)}
          <span class="toolbar-separator"></span>
          <input data-canvas-field="color" type="color" value="${escapeAttr(primitive.color ?? "#FFFFFF")}" aria-label="Fill color" />
          <input data-canvas-field="bgColor" type="color" value="${escapeAttr(primitive.bgColor ?? "#000000")}" aria-label="Track color" />
          <input data-canvas-field="borderColor" type="color" value="${escapeAttr(primitive.borderColor ?? "#7B7B7B")}" aria-label="Border color" />
        </div>
      </foreignObject>
    `;
  }

  if (primitive.type === "gif") {
    return `
      <foreignObject class="canvas-toolbar" x="${x}" y="${clamp(y, 0, DISPLAY_SIZE - height)}" width="${width}" height="${height}">
        <div xmlns="http://www.w3.org/1999/xhtml" class="canvas-toolbar-inner">
          ${rotationControls(primitive)}
        </div>
      </foreignObject>
    `;
  }

  return `
    <foreignObject class="canvas-toolbar" x="${x}" y="${clamp(y, 0, DISPLAY_SIZE - height)}" width="${width}" height="${height}">
      <div xmlns="http://www.w3.org/1999/xhtml" class="canvas-toolbar-inner">
        ${rotationControls(primitive)}
        <span class="toolbar-separator"></span>
        <input data-canvas-field="color" type="color" value="${escapeAttr(primitive.color ?? "#FFFFFF")}" aria-label="Color" />
      </div>
    </foreignObject>
  `;
}

function rotationControls(primitive: Primitive): string {
  return `
    <button class="toolbar-icon" data-rotate-delta="-15" title="Rotate left" aria-label="Rotate left">↶</button>
    <button class="toolbar-icon" data-rotate-delta="15" title="Rotate right" aria-label="Rotate right">↷</button>
  `;
}

function rotationTransform(primitive: Primitive): string {
  const rotation = normalizeRotation(primitive.rotation ?? 0);
  if (rotation === 0) {
    return "";
  }
  const center = primitiveCenter(primitive);
  return ` transform="rotate(${rotation} ${center.x} ${center.y})"`;
}

function primitiveCenter(primitive: Primitive): { x: number; y: number } {
  return {
    x: primitive.x + estimatePrimitiveWidth(primitive) / 2,
    y: primitive.y + estimatePrimitiveHeight(primitive) / 2,
  };
}

function resizeHandle(index: number, handle: ResizeHandle, x: number, y: number): string {
  const size = 7;
  return `<rect class="resize-handle resize-${handle}" data-resize-index="${index}" data-resize-handle="${handle}" x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}" rx="1.5"></rect>`;
}

function estimatePrimitiveWidth(primitive: Primitive): number {
  if (primitive.type === "text") {
    const text = primitive.binding ? bindingValue(primitive.binding) : renderTemplate(primitive.text ?? "");
    return Math.max(1, firmwareTextWidth(text, primitive.font, primitive.fontSize));
  }
  if (primitive.type === "sprite") {
    return primitive.width ?? spriteDimensions(resolveStateAssetPath(primitive)).width;
  }
  return primitive.width ?? 1;
}

function estimatePrimitiveHeight(primitive: Primitive): number {
  if (primitive.type === "text") {
    return Math.max(8, textPixelSize(primitive));
  }
  if (primitive.type === "sprite") {
    return primitive.height ?? spriteDimensions(resolveStateAssetPath(primitive)).height;
  }
  return primitive.height ?? 1;
}

function textPixelSize(primitive: Primitive): number {
  return firmwareFontHeight(primitive.font, primitive.fontSize);
}

function firmwareFontHeight(fontValue: number | undefined, fontSizeValue: number | undefined): number {
  const size = Math.max(1, fontSizeValue ?? 1);
  const font = fontValue ?? 1;
  if (font === 2) {
    return size * 16;
  }
  if (font === 4) {
    return size * 26;
  }
  return size * GLCD_FONT_HEIGHT;
}

function firmwareTextWidth(text: string, fontValue: number | undefined, fontSizeValue: number | undefined): number {
  const size = Math.max(1, fontSizeValue ?? 1);
  const font = fontValue ?? 1;
  if (font === 2) {
    return text.length * 8 * size;
  }
  if (font === 4) {
    return text.length * 15 * size;
  }
  return text.length * GLCD_FONT_ADVANCE * size;
}

function textPreviewCanvas(
  primitive: Primitive,
  text: string,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  const context = canvas.getContext("2d");
  if (!context) {
    return canvas;
  }
  context.imageSmoothingEnabled = false;
  if (primitive.bgColor) {
    context.fillStyle = primitive.bgColor;
    context.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    context.clearRect(0, 0, canvas.width, canvas.height);
  }
  context.fillStyle = primitive.color ?? "#FFFFFF";
  const size = Math.max(1, primitive.fontSize ?? 1);
  const font = primitive.font ?? 1;
  if (font !== 1) {
    const px = firmwareFontHeight(font, size);
    context.imageSmoothingEnabled = true;
    context.font = `700 ${px}px Arial, sans-serif`;
    context.textBaseline = "top";
    context.fillText(text, 0, 0);
    return canvas;
  }
  for (let charIndex = 0; charIndex < text.length; charIndex += 1) {
    const charX = charIndex * GLCD_FONT_ADVANCE * size;
    const code = text.charCodeAt(charIndex);
    for (let column = 0; column < GLCD_FONT_ADVANCE; column += 1) {
      let bits = column < GLCD_FONT_COLUMNS ? glcdGlyphColumn(code, column) : 0;
      for (let row = 0; row < GLCD_FONT_HEIGHT; row += 1) {
        if ((bits & 0x01) !== 0) {
          context.fillRect(charX + column * size, row * size, size, size);
        }
        bits >>= 1;
      }
    }
  }
  return canvas;
}

function glcdGlyphColumn(code: number, column: number): number {
  const normalizedCode = code >= GLCD_FONT_FIRST_CHAR && code <= GLCD_FONT_LAST_CHAR ? code : 63;
  const index = (normalizedCode - GLCD_FONT_FIRST_CHAR) * GLCD_FONT_COLUMNS + column;
  return GLCD_FONT_5X7[index] ?? 0;
}

function isRlePixels(primitive: Primitive): boolean {
  return Array.isArray(primitive.r) || Array.isArray(primitive.p);
}

function normalizePalette(palette: string[]): string[] {
  return palette.map((color) => color.trim().toUpperCase()).filter(Boolean);
}

function normalizeRleRows(rows: string[]): string[] {
  return rows.map((row) => row.trim()).filter(Boolean);
}

function normalizedRlePalette(primitive: Primitive): string[] {
  const palette = (primitive.p ?? [])
    .map((color) => color.trim().toUpperCase())
    .filter((color) => COLOR_RE.test(color))
    .slice(0, 26);
  if (palette.length > 0) {
    return palette;
  }
  const fallback = primitive.color && COLOR_RE.test(primitive.color) ? primitive.color : "#FFFFFF";
  return [fallback.toUpperCase()];
}

function validPixelBrushToken(palette: string[]): string {
  const requested = state.pixelBrushToken;
  const index = requested.length === 1 ? requested.charCodeAt(0) - 97 : -1;
  if (index >= 0 && index < palette.length) {
    return requested;
  }
  state.pixelBrushToken = "a";
  return "a";
}

function decodeRleTokenRows(primitive: Primitive): string[][] {
  const width = primitive.width ?? 0;
  const height = primitive.height ?? 0;
  const rows = Array.from({ length: Math.max(0, height) }, () => Array.from({ length: Math.max(0, width) }, () => "."));
  if (width <= 0 || height <= 0) {
    return rows;
  }

  if (!isRlePixels(primitive)) {
    const data = normalizedBitmapData(primitive.data ?? "", width, height);
    for (let index = 0; index < width * height; index += 1) {
      if (bitmapBitSet(data, index)) {
        rows[Math.floor(index / width)][index % width] = "a";
      }
    }
    return rows;
  }

  const rawRows = primitive.r ?? [];
  rawRows.slice(0, height).forEach((row, rowIndex) => {
    parseRleRow(row, width, (col, count, token) => {
      for (let offset = 0; offset < count && col + offset < width; offset += 1) {
        rows[rowIndex][col + offset] = token;
      }
    });
  });
  return rows;
}

function ensureRlePixelPrimitive(primitive: Primitive): string[][] {
  const rows = decodeRleTokenRows(primitive);
  primitive.p = normalizedRlePalette(primitive);
  primitive.r = rows.map(encodeRleTokenRow);
  delete primitive.color;
  delete primitive.data;
  return rows;
}

function encodeRleTokenRow(tokens: string[]): string {
  if (tokens.length === 0) {
    return "";
  }
  let output = "";
  let current = tokens[0] || ".";
  let count = 1;
  for (let index = 1; index <= tokens.length; index += 1) {
    const token = tokens[index] || ".";
    if (token === current && index < tokens.length) {
      count += 1;
      continue;
    }
    output += `${count > 1 ? count : ""}${current}`;
    current = token;
    count = 1;
  }
  return output;
}

function paintSelectedPixelCell(index: number) {
  const primitive = selectedPrimitive();
  if (!primitive || primitive.type !== "pixels") {
    return;
  }
  pushHistory();
  if (!setRlePixelToken(primitive, index)) {
    return;
  }
  syncJsonFromSpec();
  render();
}

function paintSelectedPixelsAtPointer(konvaStage: Konva.Stage, previewScale: number): boolean {
  if (state.selectedIndex < 0) {
    return false;
  }
  return paintPixelsAtPointer(state.selectedIndex, konvaStage, previewScale);
}

function paintPixelsAtPointer(index: number, konvaStage: Konva.Stage, previewScale: number): boolean {
  if (state.pixelTool === "move") {
    return false;
  }
  const primitive = state.spec.primitives[index];
  if (primitive?.type !== "pixels") {
    return false;
  }
  const pointer = logicalStagePointer(konvaStage, previewScale);
  if (!pointer || !pointInPrimitive(primitive, pointer.x, pointer.y)) {
    return false;
  }
  const col = Math.floor(pointer.x - primitive.x);
  const row = Math.floor(pointer.y - primitive.y);
  pushHistory();
  setRlePixelToken(primitive, row * (primitive.width ?? 0) + col);
  return true;
}

function setRlePixelToken(primitive: Primitive, index: number): boolean {
  const width = primitive.width ?? 0;
  const height = primitive.height ?? 0;
  if (width <= 0 || height <= 0 || index < 0 || index >= width * height) {
    return false;
  }
  const rows = ensureRlePixelPrimitive(primitive);
  const palette = primitive.p ?? ["#FFFFFF"];
  const token = state.pixelTool === "erase" ? "." : validPixelBrushToken(palette);
  const row = Math.floor(index / width);
  const col = index % width;
  if (rows[row]?.[col] === token) {
    return false;
  }
  rows[row][col] = token;
  primitive.r = rows.map(encodeRleTokenRow);
  return true;
}

function nextPaletteColor(index: number): string {
  const colors = ["#C7FF68", "#FFFFFF", "#9DE7F7", "#FFDE59", "#FF667A", "#8A7CFF", "#111827"];
  return colors[index % colors.length];
}

function validateRlePixels(primitive: Primitive): string {
  const width = primitive.width ?? 0;
  const height = primitive.height ?? 0;
  const palette = primitive.p ?? [];
  const rows = primitive.r ?? [];
  if (!Array.isArray(palette) || palette.length === 0 || palette.length > 26) {
    return "RLE braucht 1-26 Palette-Farben.";
  }
  if (!palette.every((color) => COLOR_RE.test(color))) {
    return "Palette muss #RRGGBB-Farben enthalten.";
  }
  if (!Array.isArray(rows) || rows.length !== height) {
    return `RLE braucht exakt ${height} Zeilen.`;
  }
  for (const [index, row] of rows.entries()) {
    const result = parseRleRow(row, width);
    if (!result.ok) {
      return `RLE-Zeile ${index + 1}: ${result.error}`;
    }
    if (result.maxPaletteIndex >= palette.length) {
      return `RLE-Zeile ${index + 1}: Palette-Farbe fehlt.`;
    }
  }
  return "";
}

function parseRleRow(
  row: string,
  width: number,
  onRun?: (col: number, count: number, token: string) => void,
): { ok: boolean; error: string; maxPaletteIndex: number } {
  let col = 0;
  let index = 0;
  let maxPaletteIndex = -1;
  while (index < row.length) {
    let count = 0;
    let hasCount = false;
    while (index < row.length && row[index] >= "0" && row[index] <= "9") {
      hasCount = true;
      count = count * 10 + Number(row[index]);
      index += 1;
    }
    if (hasCount && count <= 0) {
      return { ok: false, error: "Run-Length muss größer als 0 sein.", maxPaletteIndex };
    }
    if (!hasCount) {
      count = 1;
    }
    const token = row[index];
    if (!token) {
      return { ok: false, error: "Run ohne Token.", maxPaletteIndex };
    }
    index += 1;
    const paletteIndex = token === "." ? -1 : token.charCodeAt(0) - 97;
    if (token !== "." && (paletteIndex < 0 || paletteIndex > 25)) {
      return { ok: false, error: "Token muss . oder a-z sein.", maxPaletteIndex };
    }
    if (col + count > width) {
      return { ok: false, error: "Zeile ist breiter als width.", maxPaletteIndex };
    }
    if (paletteIndex >= 0) {
      maxPaletteIndex = Math.max(maxPaletteIndex, paletteIndex);
    }
    onRun?.(col, count, token);
    col += count;
  }
  if (col !== width) {
    return { ok: false, error: `Zeile ist ${col}px statt ${width}px breit.`, maxPaletteIndex };
  }
  return { ok: true, error: "", maxPaletteIndex };
}

function bitmapHexLength(width: number, height: number): number {
  if (width <= 0 || height <= 0) {
    return 0;
  }
  return Math.ceil((width * height) / 8) * 2;
}

function normalizedBitmapData(data: string, width: number, height: number): string {
  const expected = bitmapHexLength(width, height);
  const cleaned = data.replace(/[^A-Fa-f0-9]/g, "").toUpperCase();
  return cleaned.padEnd(expected, "0").slice(0, expected);
}

function isValidBitmapData(data: string, width: number, height: number): boolean {
  const expected = bitmapHexLength(width, height);
  return expected > 0 && data.length === expected && /^[A-Fa-f0-9]+$/.test(data);
}

function bitmapBitSet(data: string, bitIndex: number): boolean {
  const byteIndex = Math.floor(bitIndex / 8);
  const hex = data.slice(byteIndex * 2, byteIndex * 2 + 2);
  if (hex.length !== 2) {
    return false;
  }
  const value = Number.parseInt(hex, 16);
  if (Number.isNaN(value)) {
    return false;
  }
  return (value & (0x80 >> (bitIndex % 8))) !== 0;
}

function toggleBitmapBit(data: string, width: number, height: number, bitIndex: number): string {
  const expectedBits = width * height;
  if (bitIndex < 0 || bitIndex >= expectedBits) {
    return normalizedBitmapData(data, width, height);
  }
  const bytes = new Uint8Array(Math.ceil(expectedBits / 8));
  const normalized = normalizedBitmapData(data, width, height);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  bytes[Math.floor(bitIndex / 8)] ^= 0x80 >> (bitIndex % 8);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function renderTemplate(text: string): string {
  return text.replace(/\{([a-zA-Z]+)\}/g, (_, key: string) => {
    return bindingValue(key);
  });
}

function bindingValue(key: string): string {
  const values: Record<string, string> = {
    label: frame.label,
    providerLabel: frame.label,
    provider: frame.provider,
    session: String(frame.session),
    sessionPercent: String(frame.session),
    weekly: String(frame.weekly),
    weeklyPercent: String(frame.weekly),
    reset: frame.reset,
    resetCountdown: frame.reset,
    usageMode: frame.usageMode,
    activity: frame.activity,
    time: frame.time,
    date: frame.date,
    sessionTokens: String(frame.sessionTokens),
    weekTokens: String(frame.weekTokens),
    totalTokens: String(frame.totalTokens),
  };
  return values[key] ?? "";
}

function fontLabel(value: number): string {
  if (value === 2) {
    return "Smooth small";
  }
  if (value === 4) {
    return "Large digits";
  }
  return "Pixel 5x7";
}

function builtInGifPreviewUrl(assetPath: string): string | undefined {
  if (assetPath === "/themes/mini/mini.gif") {
    return assetPath;
  }
  return undefined;
}

function builtInSpriteText(assetPath: string | undefined): string | undefined {
  if (assetPath === DEFAULT_CLOUD_SPRITE_PATH) {
    return DEFAULT_CLOUD_SPRITE;
  }
  if (assetPath === COZY_BACKGROUND_SPRITE_PATH) {
    return cozyBackgroundSpriteText();
  }
  if (assetPath === COZY_SUN_SPRITE_PATH) {
    return COZY_SUN_SPRITE;
  }
  if (assetPath === COZY_TREE_SPRITE_PATH) {
    return COZY_TREE_SPRITE;
  }
  if (assetPath === COZY_FLOWERS_SPRITE_PATH) {
    return COZY_FLOWERS_SPRITE;
  }
  if (assetPath === COZY_BIRDS_SPRITE_PATH) {
    return COZY_BIRDS_SPRITE;
  }
  if (assetPath === COZY_BUTTERFLY_SPRITE_PATH) {
    return COZY_BUTTERFLY_SPRITE;
  }
  if (assetPath === CLAUDE_IDLE_SPRITE_PATH) {
    return CLAUDE_IDLE_SPRITE;
  }
  if (assetPath === CLAUDE_CODING_SPRITE_PATH) {
    return CLAUDE_CODING_SPRITE;
  }
  return undefined;
}

function stateAssetPathsForPrimitive(primitive: Primitive): string[] {
  const paths = new Set<string>();
  if (primitive.assetPath) {
    paths.add(primitive.assetPath);
  }
  for (const assetPath of Object.values(primitive.stateAssets ?? {})) {
    if (assetPath) {
      paths.add(assetPath);
    }
  }
  return Array.from(paths);
}

function resolveStateAssetPath(primitive: Primitive, activity: string = frame.activity): string | undefined {
  const stateAssets = primitive.stateAssets;
  if (stateAssets) {
    return stateAssets[activity] ?? stateAssets.idle ?? primitive.assetPath;
  }
  return primitive.assetPath;
}

function spriteAssetFor(assetPath: string | undefined): SpriteAsset | null {
  if (!assetPath) {
    return null;
  }
  return state.spriteAssets[assetPath]?.sprite ?? parseSpriteAsset(builtInSpriteText(assetPath));
}

function spriteDimensions(assetPath: string | undefined): { width: number; height: number } {
  const sprite = spriteAssetFor(assetPath);
  return sprite ? { width: sprite.width, height: sprite.height } : { width: 24, height: 14 };
}

function parseSpriteAsset(raw: string | undefined): SpriteAsset | null {
  if (!raw) {
    return null;
  }
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines[0] === "CBI1") {
    const [widthRaw, heightRaw] = (lines[1] ?? "").split(/\s+/);
    const width = Number(widthRaw);
    const height = Number(heightRaw);
    const paletteSize = Number(lines[2]);
    if (!validSpriteHeader(width, height, 1, 0, paletteSize)) {
      return null;
    }
    const palette = lines.slice(3, 3 + paletteSize);
    const rows = lines.slice(3 + paletteSize, 3 + paletteSize + height);
    if (palette.length !== paletteSize || rows.length !== height) {
      return null;
    }
    return { width, height, frameCount: 1, fps: 0, palette, frames: [rows] };
  }
  if (lines[0] !== "CBA1") {
    return null;
  }
  const [widthRaw, heightRaw, frameCountRaw, fpsRaw] = (lines[1] ?? "").split(/\s+/);
  const width = Number(widthRaw);
  const height = Number(heightRaw);
  const frameCount = Number(frameCountRaw);
  const fps = Number(fpsRaw);
  const paletteSize = Number(lines[2]);
  if (!validSpriteHeader(width, height, frameCount, fps, paletteSize)) {
    return null;
  }
  const palette = lines.slice(3, 3 + paletteSize);
  const rowStart = 3 + paletteSize;
  const frameRows = lines.slice(rowStart, rowStart + frameCount * height);
  if (palette.length !== paletteSize || frameRows.length !== frameCount * height) {
    return null;
  }
  const frames: string[][] = [];
  for (let index = 0; index < frameCount; index += 1) {
    frames.push(frameRows.slice(index * height, (index + 1) * height));
  }
  return { width, height, frameCount, fps, palette, frames };
}

function validSpriteHeader(width: number, height: number, frameCount: number, fps: number, paletteSize: number): boolean {
  return Number.isInteger(width) &&
    Number.isInteger(height) &&
    Number.isInteger(frameCount) &&
    Number.isInteger(fps) &&
    Number.isInteger(paletteSize) &&
    width > 0 &&
    height > 0 &&
    frameCount > 0 &&
    paletteSize > 0 &&
    paletteSize <= 26;
}

function currentSpriteFrameIndex(sprite: SpriteAsset): number {
  if (sprite.frameCount <= 1 || sprite.fps <= 0) {
    return 0;
  }
  return Math.floor((Date.now() / 1000) * sprite.fps) % sprite.frameCount;
}

function drawSpriteFrame(context: CanvasRenderingContext2D, sprite: SpriteAsset, frameIndex: number, x: number, y: number, targetWidth = sprite.width, targetHeight = sprite.height) {
  const rows = sprite.frames[frameIndex] ?? sprite.frames[0] ?? [];
  rows.forEach((row, rowIndex) => {
    parseRleRow(row, sprite.width, (col, count, token) => {
      if (token === ".") {
        return;
      }
      const color = sprite.palette[token.charCodeAt(0) - 97];
      if (!color) {
        return;
      }
      const x1 = x + Math.floor((col * targetWidth) / sprite.width);
      const x2 = x + Math.ceil(((col + count) * targetWidth) / sprite.width);
      const y1 = y + Math.floor((rowIndex * targetHeight) / sprite.height);
      const y2 = y + Math.ceil(((rowIndex + 1) * targetHeight) / sprite.height);
      context.fillStyle = color;
      context.fillRect(x1, y1, Math.max(1, x2 - x1), Math.max(1, y2 - y1));
    });
  });
}

function inferredSpriteColumns(primitive: Primitive): number {
  const assetPath = resolveStateAssetPath(primitive);
  const source = assetPath ? state.spriteAssets[assetPath]?.source : undefined;
  const width = primitive.width ?? estimatePrimitiveWidth(primitive);
  if (!source || width <= 0) {
    return Math.max(1, primitive.sheetColumns ?? primitive.frameCount ?? 1);
  }
  return Math.max(1, Math.floor(source.sheetWidth / width));
}

function encodeSpriteAsset(sprite: SpriteAsset): string {
  if (sprite.frameCount <= 1) {
    return [
      "CBI1",
      `${sprite.width} ${sprite.height}`,
      String(sprite.palette.length),
      ...sprite.palette,
      ...(sprite.frames[0] ?? []),
      "",
    ].join("\n");
  }
  return [
    "CBA1",
    `${sprite.width} ${sprite.height} ${sprite.frameCount} ${sprite.fps}`,
    String(sprite.palette.length),
    ...sprite.palette,
    ...sprite.frames.flat(),
    "",
  ].join("\n");
}

function rebuildSpriteAssetForPrimitive(primitive: Primitive) {
  if (primitive.type !== "sprite" || !primitive.assetPath) {
    return;
  }
  const entry = state.spriteAssets[primitive.assetPath];
  if (!entry?.source) {
    return;
  }
  const sprite = spriteFromSource(entry.source, primitive);
  const rawText = encodeSpriteAsset(sprite);
  entry.rawText = rawText;
  entry.sprite = sprite;
  entry.file = builtInAssetFile(primitive.assetPath, rawText, "text/plain", "sprite.cba");
}

function spriteFromSource(source: SpriteSource, primitive: Primitive): SpriteAsset {
  const width = clamp(Math.round(source.frameWidth), 1, Math.min(MAX_SPRITE_FRAME_WIDTH, source.sheetWidth));
  const height = clamp(Math.round(source.frameHeight), 1, Math.min(MAX_SPRITE_FRAME_HEIGHT, source.sheetHeight));
  const columns = clamp(Math.round(primitive.sheetColumns ?? Math.max(1, Math.floor(source.sheetWidth / width))), 1, MAX_SPRITE_FRAMES);
  const rows = Math.max(1, Math.floor(source.sheetHeight / height));
  const availableFrames = Math.max(1, Math.min(MAX_SPRITE_FRAMES, columns * rows));
  const requestedFrames = clamp(Math.round(primitive.frameCount ?? availableFrames), 1, availableFrames);
  const maxByTotalPixels = Math.max(1, Math.floor(MAX_SPRITE_TOTAL_PIXELS / Math.max(1, width * height)));
  const frameCount = Math.min(requestedFrames, maxByTotalPixels);
  const fps = clamp(Math.round(primitive.fps ?? DEFAULT_SPRITE_FPS), 0, 30);
  primitive.sheetColumns = columns;
  primitive.fps = fps;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return { width, height, frameCount: 1, fps: 0, palette: ["#FFFFFF"], frames: [Array.from({ length: height }, () => `${width}.`)] };
  }

  const rawFrames: Array<Array<string | null>> = [];
  const colorCounts = new Map<string, number>();
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const sx = (frameIndex % columns) * width;
    const sy = Math.floor(frameIndex / columns) * height;
    context.clearRect(0, 0, width, height);
    context.drawImage(source.bitmap, sx, sy, width, height, 0, 0, width, height);
    const image = context.getImageData(0, 0, width, height).data;
    const pixels: Array<string | null> = [];
    for (let offset = 0; offset < image.length; offset += 4) {
      const alpha = image[offset + 3];
      if (alpha < 128) {
        pixels.push(null);
        continue;
      }
      const color = quantizedHexColor(image[offset], image[offset + 1], image[offset + 2]);
      colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1);
      pixels.push(color);
    }
    rawFrames.push(pixels);
  }

  const nonEmptyFrames = rawFrames.filter((pixels) => pixels.some((color) => color !== null));
  const framesToEncode = nonEmptyFrames.length > 0 ? nonEmptyFrames : rawFrames.slice(0, 1);
  primitive.frameCount = framesToEncode.length;

  const palette = Array.from(colorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 26)
    .map(([color]) => color);
  if (palette.length === 0) {
    palette.push("#FFFFFF");
  }
  const frames = framesToEncode.map((pixels) => {
    const rows: string[] = [];
    for (let row = 0; row < height; row += 1) {
      const tokens: string[] = [];
      for (let col = 0; col < width; col += 1) {
        const color = pixels[row * width + col];
        tokens.push(color ? paletteTokenForColor(color, palette) : ".");
      }
      rows.push(encodeRleTokenRow(tokens));
    }
    return rows;
  });
  return { width, height, frameCount: frames.length, fps, palette, frames };
}

function quantizedHexColor(r: number, g: number, b: number): string {
  const q = (value: number) => clamp(Math.round(value / 17) * 17, 0, 255);
  return `#${[q(r), q(g), q(b)].map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function paletteTokenForColor(color: string, palette: string[]): string {
  const exact = palette.indexOf(color);
  const index = exact >= 0 ? exact : nearestPaletteIndex(color, palette);
  return String.fromCharCode(97 + clamp(index, 0, palette.length - 1));
}

function nearestPaletteIndex(color: string, palette: string[]): number {
  const [r, g, b] = rgbFromHex(color);
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  palette.forEach((candidate, index) => {
    const [cr, cg, cb] = rgbFromHex(candidate);
    const distance = ((r - cr) ** 2) + ((g - cg) ** 2) + ((b - cb) ** 2);
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

function messageList(): string {
  const notices = state.notice ? [`<li class="notice">${escapeHtml(state.notice)}</li>`] : [];
  const errors = state.errors.map((msg) => `<li class="error">${escapeHtml(msg)}</li>`);
  const warnings = state.warnings.map((msg) => `<li class="warning">${escapeHtml(msg)}</li>`);
  const items = [...notices, ...errors, ...warnings];
  if (items.length === 0) {
    return `<ul class="messages"><li class="ok-message">Ready to send to Vibe TV.</li></ul>`;
  }
  return `<ul class="messages">${items.join("")}</ul>`;
}

function bindEvents() {
  app.querySelectorAll<HTMLElement>("[data-select]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedIndex = Number(button.dataset.select);
      state.editingTextIndex = null;
      state.notice = "";
      render();
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-preview-activity]").forEach((button) => {
    button.addEventListener("click", () => {
      frame.activity = button.dataset.previewActivity ?? "idle";
      render();
    });
  });

  app.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-field]").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.dataset.field;
      if (key === "themeId") {
        pushHistory();
        state.spec.themeId = input.value.trim().toLowerCase();
      }
      if (key === "targetOrigin") {
        state.targetOrigin = input.value.trim();
        persistTargetOrigin();
      }
      if (key === "bgColor") {
        pushHistory();
        state.spec.bgColor = input.value.trim();
      }
      syncJsonFromSpec();
      render();
    });
  });

  app.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("[data-primitive-field]").forEach((input) => {
    input.addEventListener("input", () => {
      pushHistory();
      updateSelectedPrimitive(input.dataset.primitiveField ?? "", input.value);
      if (isColorInput(input)) {
        syncStateWithoutRender();
        return;
      }
      syncJsonFromSpec();
      render();
    });
    input.addEventListener("change", () => {
      if (!isColorInput(input)) {
        return;
      }
      pushHistory();
      updateSelectedPrimitive(input.dataset.primitiveField ?? "", input.value);
      syncJsonFromSpec();
      render();
    });
  });

  app.querySelectorAll<HTMLInputElement>("[data-primitive-state]").forEach((input) => {
    input.addEventListener("input", () => {
      const primitive = selectedPrimitive();
      if (!primitive) {
        return;
      }
      pushHistory();
      const stateName = input.dataset.primitiveState ?? "";
      primitive.stateAssets = primitive.stateAssets ?? {};
      const value = input.value.trim();
      if (value) {
        primitive.stateAssets[stateName] = value;
      } else {
        delete primitive.stateAssets[stateName];
      }
      if (Object.keys(primitive.stateAssets).length === 0) {
        delete primitive.stateAssets;
      }
      syncJsonFromSpec();
      render();
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-clear-primitive-field]").forEach((button) => {
    button.addEventListener("click", () => {
      pushHistory();
      clearSelectedPrimitiveField(button.dataset.clearPrimitiveField ?? "");
      syncJsonFromSpec();
      render();
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-pixel-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const primitive = selectedPrimitive();
      if (!primitive || primitive.type !== "pixels") {
        return;
      }
      pushHistory();
      const index = toInt(button.dataset.pixelToggle ?? "0", 0);
      primitive.data = toggleBitmapBit(primitive.data ?? "", primitive.width ?? 0, primitive.height ?? 0, index);
      syncJsonFromSpec();
      render();
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-pixel-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      state.pixelTool = (button.dataset.pixelTool ?? "move") as PixelTool;
      render();
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-pixel-brush]").forEach((button) => {
    button.addEventListener("click", () => {
      state.pixelBrushToken = button.dataset.pixelBrush ?? "a";
      state.pixelTool = "paint";
      render();
    });
  });

  app.querySelectorAll<HTMLInputElement>("[data-pixel-palette-color]").forEach((input) => {
    input.addEventListener("input", () => {
      const primitive = selectedPrimitive();
      if (!primitive || primitive.type !== "pixels") {
        return;
      }
      pushHistory();
      const index = toInt(input.dataset.pixelPaletteColor ?? "0", 0);
      ensureRlePixelPrimitive(primitive);
      const palette = primitive.p ?? [];
      if (index < 0 || index >= palette.length) {
        return;
      }
      palette[index] = input.value.toUpperCase();
      syncStateWithoutRender();
      renderDeviceCanvas(app.querySelector<HTMLCanvasElement>("[data-role='device-canvas']") ?? document.createElement("canvas"));
    });
    input.addEventListener("change", () => {
      syncJsonFromSpec();
      render();
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-pixel-paint]").forEach((button) => {
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      pixelInspectorPaintActive = true;
      paintSelectedPixelCell(toInt(button.dataset.pixelPaint ?? "0", 0));
    });
    button.addEventListener("pointerenter", () => {
      if (pixelInspectorPaintActive) {
        paintSelectedPixelCell(toInt(button.dataset.pixelPaint ?? "0", 0));
      }
    });
  });

  app.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-canvas-field]").forEach((input) => {
    input.addEventListener("pointerdown", (event) => event.stopPropagation());
    input.addEventListener("input", (event) => {
      event.stopPropagation();
      pushHistory();
      updateSelectedPrimitive(input.dataset.canvasField ?? "", input.value);
      if (isColorInput(input)) {
        syncStateWithoutRender();
        return;
      }
      syncJsonFromSpec();
      render();
    });
    input.addEventListener("change", (event) => {
      event.stopPropagation();
      if (!isColorInput(input)) {
        return;
      }
      pushHistory();
      updateSelectedPrimitive(input.dataset.canvasField ?? "", input.value);
      syncJsonFromSpec();
      render();
    });
  });

  app.querySelectorAll<HTMLInputElement>("[data-inline-text]").forEach((input) => {
    input.addEventListener("pointerdown", (event) => event.stopPropagation());
    input.addEventListener("input", () => {
      const index = Number(input.dataset.inlineText);
      const primitive = state.spec.primitives[index];
      if (primitive?.type === "text") {
        pushHistory();
        primitive.text = input.value;
        normalizeMiniThemeSpec(state.spec);
        state.jsonText = prettyJson(state.spec);
        state.jsonDirty = false;
        validateCurrentSpec();
      }
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === "Escape") {
        finishInlineTextEdit();
      }
    });
    input.addEventListener("blur", finishInlineTextEdit);
  });

  app.querySelector<HTMLTextAreaElement>("[data-role='json-editor']")?.addEventListener("input", (event) => {
    state.jsonText = (event.target as HTMLTextAreaElement).value;
    state.jsonDirty = true;
  });

  app.querySelector<HTMLInputElement>("[data-role='gif-input']")?.addEventListener("change", (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      addGifPrimitive(file);
    }
    (event.target as HTMLInputElement).value = "";
  });

  app.querySelector<HTMLInputElement>("[data-role='sprite-input']")?.addEventListener("change", (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      void addSpritePrimitive(file);
    }
    (event.target as HTMLInputElement).value = "";
  });

  app.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      void handleAction(button.dataset.action ?? "");
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-load-saved-theme]").forEach((button) => {
    button.addEventListener("click", () => {
      loadSavedTheme(button.dataset.loadSavedTheme ?? "");
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-delete-saved-theme]").forEach((button) => {
    button.addEventListener("click", () => {
      deleteSavedTheme(button.dataset.deleteSavedTheme ?? "");
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-insert-token]").forEach((button) => {
    button.addEventListener("click", () => {
      insertToken(button.dataset.insertToken ?? "");
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-rotate-delta]").forEach((button) => {
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      pushHistory();
      rotateSelectedPrimitive(toInt(button.dataset.rotateDelta ?? "0", 0));
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-font-size-delta]").forEach((button) => {
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      pushHistory();
      adjustSelectedTextSize(toInt(button.dataset.fontSizeDelta ?? "0", 0));
    });
  });

  app.querySelectorAll<SVGElement>("[data-drag]").forEach((element) => {
    element.addEventListener("mouseenter", () => {
      state.hoveredIndex = Number(element.dataset.drag);
      render();
    });
    element.addEventListener("mouseleave", () => {
      const index = Number(element.dataset.drag);
      if (state.hoveredIndex === index) {
        state.hoveredIndex = null;
        render();
      }
    });
    element.addEventListener("click", () => {
      const index = Number(element.dataset.drag);
      state.selectedIndex = index;
      state.editingTextIndex = state.spec.primitives[index]?.type === "text" ? index : null;
      state.notice = "";
      render();
    });
    element.addEventListener("dblclick", () => {
      const index = Number(element.dataset.drag);
      if (state.spec.primitives[index]?.type === "text") {
        state.selectedIndex = index;
        state.editingTextIndex = index;
        state.notice = "";
        render();
      }
    });
    element.addEventListener("pointerdown", startDrag);
  });

  app.querySelectorAll<SVGElement>("[data-resize-index]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    element.addEventListener("pointerdown", startResize);
  });
}

function focusInlineTextEditor() {
  if (state.editingTextIndex === null) {
    return;
  }
  window.requestAnimationFrame(() => {
    const input = app.querySelector<HTMLInputElement>(`[data-inline-text="${state.editingTextIndex}"]`);
    input?.focus();
    input?.select();
  });
}

function syncStateWithoutRender() {
  normalizeMiniThemeSpec(state.spec);
  state.jsonText = prettyJson(state.spec);
  state.jsonDirty = false;
  validateCurrentSpec();
}

function isColorInput(input: Element): input is HTMLInputElement {
  return input instanceof HTMLInputElement && input.type === "color";
}

function finishInlineTextEdit() {
  if (state.editingTextIndex === null) {
    return;
  }
  state.editingTextIndex = null;
  syncJsonFromSpec();
  render();
}

function insertToken(token: string) {
  if (!token) {
    return;
  }
  pushHistory();
  const primitive = state.spec.primitives[state.selectedIndex];
  if (primitive?.type === "text") {
    primitive.text = `${primitive.text ?? ""}${token}`;
    state.editingTextIndex = state.selectedIndex;
  } else {
    state.spec.primitives.push({ type: "text", x: 24, y: 24, text: token, fontSize: 2, color: "#FFFFFF" });
    state.selectedIndex = state.spec.primitives.length - 1;
    state.editingTextIndex = state.selectedIndex;
  }
  state.notice = "Variable inserted.";
  syncJsonFromSpec();
  render();
}

function handleGlobalKeydown(event: KeyboardEvent) {
  const key = event.key.toLowerCase();
  const usesCommandKey = event.metaKey || event.ctrlKey;
  const typing = isTypingTarget(event.target);

  if (usesCommandKey && key === "z" && !typing) {
    event.preventDefault();
    if (event.shiftKey) {
      redoThemeEdit();
    } else {
      undoThemeEdit();
    }
    return;
  }

  if (key === "escape" && state.editingTextIndex !== null) {
    event.preventDefault();
    finishInlineTextEdit();
    return;
  }

  if (usesCommandKey && key === "d") {
    event.preventDefault();
    duplicateSelectedPrimitive();
    return;
  }

  if (typing) {
    return;
  }

  if (usesCommandKey && key === "c") {
    event.preventDefault();
    copySelectedPrimitive();
    return;
  }

  if (usesCommandKey && key === "v") {
    event.preventDefault();
    pasteCopiedPrimitive();
    return;
  }

  if (key === "backspace" || key === "delete") {
    event.preventDefault();
    deleteSelectedPrimitive();
    return;
  }

  const moveBy = event.shiftKey ? 10 : 1;
  if (key === "arrowleft") {
    event.preventDefault();
    moveSelectedPrimitive(-moveBy, 0);
  } else if (key === "arrowright") {
    event.preventDefault();
    moveSelectedPrimitive(moveBy, 0);
  } else if (key === "arrowup") {
    event.preventDefault();
    moveSelectedPrimitive(0, -moveBy);
  } else if (key === "arrowdown") {
    event.preventDefault();
    moveSelectedPrimitive(0, moveBy);
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.matches("input, textarea, select, [contenteditable='true']");
}

function selectedPrimitive(): Primitive | null {
  return state.spec.primitives[state.selectedIndex] ?? null;
}

function clonePrimitive(primitive: Primitive): Primitive {
  return JSON.parse(JSON.stringify(primitive)) as Primitive;
}

function copySelectedPrimitive() {
  const primitive = selectedPrimitive();
  if (!primitive) {
    return;
  }
  state.copiedPrimitive = clonePrimitive(primitive);
  state.notice = "Element copied.";
  render();
}

function pasteCopiedPrimitive() {
  if (!state.copiedPrimitive) {
    state.notice = "No copied element.";
    render();
    return;
  }
  addPrimitive(copyWithOffset(state.copiedPrimitive), "Element pasted.");
}

function duplicateSelectedPrimitive() {
  const primitive = selectedPrimitive();
  if (!primitive) {
    return;
  }
  state.copiedPrimitive = clonePrimitive(primitive);
  addPrimitive(copyWithOffset(primitive), "Element duplicated.");
}

function copyWithOffset(primitive: Primitive): Primitive {
  const copy = clonePrimitive(primitive);
  const width = estimatePrimitiveWidth(copy);
  const height = estimatePrimitiveHeight(copy);
  copy.x = clamp(copy.x + 8, 0, Math.max(0, DISPLAY_SIZE - width));
  copy.y = clamp(copy.y + 8, 0, Math.max(0, DISPLAY_SIZE - height));
  return copy;
}

function deleteSelectedPrimitive() {
  if (!selectedPrimitive()) {
    return;
  }
  pushHistory();
  state.spec.primitives.splice(state.selectedIndex, 1);
  state.selectedIndex = Math.max(0, Math.min(state.selectedIndex, state.spec.primitives.length - 1));
  state.editingTextIndex = null;
  state.notice = "Element deleted.";
  syncJsonFromSpec();
  render();
}

function moveSelectedPrimitive(deltaX: number, deltaY: number) {
  const primitive = selectedPrimitive();
  if (!primitive) {
    return;
  }
  pushHistory();
  const maxX = Math.max(0, DISPLAY_SIZE - estimatePrimitiveWidth(primitive));
  const maxY = Math.max(0, DISPLAY_SIZE - estimatePrimitiveHeight(primitive));
  primitive.x = clamp(primitive.x + deltaX, 0, maxX);
  primitive.y = clamp(primitive.y + deltaY, 0, maxY);
  state.editingTextIndex = null;
  syncJsonFromSpec();
  render();
}

function rotateSelectedPrimitive(delta: number) {
  const primitive = selectedPrimitive();
  if (!primitive) {
    return;
  }
  primitive.rotation = normalizeRotation((primitive.rotation ?? 0) + delta);
  state.editingTextIndex = null;
  syncJsonFromSpec();
  render();
}

function adjustSelectedTextSize(delta: number) {
  const primitive = selectedPrimitive();
  if (!primitive || primitive.type !== "text") {
    return;
  }
  primitive.fontSize = clamp((primitive.fontSize ?? 1) + delta, 1, 12);
  state.editingTextIndex = null;
  syncJsonFromSpec();
  render();
}

function updateSelectedPrimitive(key: string, value: string) {
  const primitive = state.spec.primitives[state.selectedIndex];
  if (!primitive) {
    return;
  }
  if ((key === "width" || key === "height") && primitive.type === "gif") {
    resizeGifPrimitive(primitive, key, toInt(value, DEFAULT_GIF_SIZE));
    return;
  }
  if (primitive.type === "sprite" && ["width", "height"].includes(key)) {
    const fallback = key === "fps" ? DEFAULT_SPRITE_FPS : 1;
    primitive[key as "width"] = Math.max(key === "fps" ? 0 : 1, toInt(value, fallback));
    return;
  }
  if (primitive.type === "sprite" && ["frameCount", "fps", "sheetColumns"].includes(key)) {
    const fallback = key === "fps" ? DEFAULT_SPRITE_FPS : 1;
    primitive[key as "frameCount"] = Math.max(key === "fps" ? 0 : 1, toInt(value, fallback));
    rebuildSpriteAssetForPrimitive(primitive);
    return;
  }
  if (["x", "y", "width", "height", "fontSize", "font"].includes(key)) {
    primitive[key as "x"] = Math.max(key === "x" || key === "y" ? 0 : 1, toInt(value, key === "x" || key === "y" ? 0 : 1));
    return;
  }
  if (["color", "bgColor", "borderColor"].includes(key)) {
    const trimmed = value.trim();
    if (key === "bgColor" && trimmed === "") {
      delete primitive.bgColor;
      return;
    }
    primitive[key as "color"] = trimmed;
    return;
  }
  if (key === "binding") {
    primitive.binding = value as BindingKey;
    return;
  }
  if (key === "assetPath") {
    primitive.assetPath = value.trim();
    if (primitive.type === "sprite") {
      const sprite = spriteAssetFor(resolveStateAssetPath(primitive));
      if (sprite) {
        primitive.width = sprite.width;
        primitive.height = sprite.height;
        primitive.frameCount = sprite.frameCount;
        primitive.fps = sprite.fps;
      }
    }
    return;
  }
  if (key === "data") {
    primitive.data = value.trim();
    delete primitive.p;
    delete primitive.r;
    return;
  }
  if (key === "p") {
    primitive.p = normalizePalette(value.split(/[\n,]+/));
    delete primitive.color;
    delete primitive.data;
    return;
  }
  if (key === "r") {
    primitive.r = normalizeRleRows(value.split(/\n+/));
    delete primitive.color;
    delete primitive.data;
    return;
  }
  if (key === "text") {
    primitive.text = value;
  }
}

function clearSelectedPrimitiveField(key: string) {
  const primitive = state.spec.primitives[state.selectedIndex];
  if (!primitive) {
    return;
  }
  if (key === "bgColor") {
    delete primitive.bgColor;
  }
}

async function handleAction(action: string) {
  if (action === "undo") {
    undoThemeEdit();
    return;
  }
  if (action === "redo") {
    redoThemeEdit();
    return;
  }
  if (action === "save-local") {
    saveThemeLocally();
    return;
  }
  if (action === "reset") {
    pushHistory();
    state.spec = cloneSpec(initialSpec);
    state.selectedIndex = -1;
    state.editingTextIndex = null;
    state.notice = "Sample restored.";
    syncJsonFromSpec();
    render();
    return;
  }
  if (action === "load-cozy-meadow") {
    pushHistory();
    state.spec = cloneSpec(COZY_MEADOW_SPEC);
    state.selectedIndex = state.spec.primitives.findIndex((primitive) => primitive.type === "sprite");
    state.editingTextIndex = null;
    state.notice = "Cozy Meadow loaded.";
    syncJsonFromSpec();
    render();
    return;
  }
  if (action === "load-claude-creature") {
    pushHistory();
    state.spec = cloneSpec(CLAUDE_CREATURE_SPEC);
    state.selectedIndex = state.spec.primitives.findIndex((primitive) => primitive.type === "sprite");
    state.editingTextIndex = null;
    state.notice = "Claude Creature loaded.";
    syncJsonFromSpec();
    render();
    return;
  }
  if (action === "add-rect") {
    addPrimitive({ type: "rect", x: 24, y: 24, width: 64, height: 38, color: "#1E2738" });
  }
  if (action === "add-line") {
    addPrimitive({ type: "rect", x: 24, y: 120, width: 96, height: 2, color: "#C7FF68" }, "Line added.");
  }
  if (action === "add-text") {
    addPrimitive({ type: "text", x: 24, y: 24, text: "{label}", fontSize: 2, color: "#FFFFFF" });
  }
  if (action === "add-progress") {
    addPrimitive({ type: "progress", x: 24, y: 190, width: 160, height: 16, binding: "session", color: "#C7FF68", bgColor: "#202632", borderColor: "#667084" });
  }
  if (action === "add-gif") {
    app.querySelector<HTMLInputElement>("[data-role='gif-input']")?.click();
  }
  if (action === "add-sprite") {
    app.querySelector<HTMLInputElement>("[data-role='sprite-input']")?.click();
  }
  if (action === "add-pixels") {
    state.pixelTool = "paint";
    addPrimitive({
      type: "pixels",
      x: 8,
      y: 8,
      width: DEFAULT_PIXELS_WIDTH,
      height: DEFAULT_PIXELS_HEIGHT,
      p: [...DEFAULT_CLOUD_PIXEL_PALETTE],
      r: [...DEFAULT_CLOUD_PIXEL_ROWS],
    }, "Pixel shape placed.");
  }
  if (action === "convert-pixels-rle") {
    const primitive = selectedPrimitive();
    if (primitive?.type === "pixels") {
      ensureRlePixelPrimitive(primitive);
      state.pixelTool = "paint";
      state.notice = "Color paint mode enabled.";
      syncJsonFromSpec();
      render();
    }
  }
  if (action === "add-pixel-color") {
    const primitive = selectedPrimitive();
    if (primitive?.type === "pixels") {
      ensureRlePixelPrimitive(primitive);
      const palette = primitive.p ?? [];
      if (palette.length < 26) {
        palette.push(nextPaletteColor(palette.length));
        state.pixelBrushToken = String.fromCharCode(96 + palette.length);
        state.pixelTool = "paint";
        syncJsonFromSpec();
        render();
      }
    }
  }
  if (action === "delete-selected") {
    deleteSelectedPrimitive();
  }
  if (action === "apply-json") {
    applyJson();
  }
  if (action === "copy-json") {
    await copyText(prettyJson(state.spec), "JSON copied.");
  }
  if (action === "download-json") {
    downloadTheme();
  }
  if (action === "download-pack") {
    await downloadThemePack();
  }
  if (action === "send-theme") {
    await sendThemeToVibeTV();
  }
}

function addPrimitive(primitive: Primitive, notice = "Element added.") {
  pushHistory();
  state.spec.primitives.push(primitive);
  state.selectedIndex = state.spec.primitives.length - 1;
  state.editingTextIndex = primitive.type === "text" ? state.selectedIndex : null;
  state.notice = notice;
  syncJsonFromSpec();
  render();
}

function addGifPrimitive(file: File) {
  if (file.type && file.type !== "image/gif") {
    state.notice = "Please choose a GIF file.";
    render();
    return;
  }
  const assetPath = themeAssetPathForFile(file.name);
  const existing = state.gifAssets[assetPath];
  if (existing) {
    URL.revokeObjectURL(existing.previewUrl);
  }
  state.gifAssets[assetPath] = {
    file,
    previewUrl: URL.createObjectURL(file),
  };
  addPrimitive({ type: "gif", x: 24, y: 24, width: DEFAULT_GIF_SIZE, height: DEFAULT_GIF_SIZE, assetPath }, "GIF placed.");
}

async function addSpritePrimitive(file: File) {
  if (file.type && !file.type.startsWith("image/")) {
    state.notice = "Please choose a PNG, JPEG, or WebP sprite sheet.";
    render();
    return;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const frame = inferSpriteSheetFrame(bitmap.width, bitmap.height);
    const assetPath = spriteAssetPathForFile(file.name);
    const existing = state.spriteAssets[assetPath]?.source;
    if (existing) {
      URL.revokeObjectURL(existing.previewUrl);
    }
    const source: SpriteSource = {
      file,
      previewUrl: URL.createObjectURL(file),
      bitmap,
      sheetWidth: bitmap.width,
      sheetHeight: bitmap.height,
      frameWidth: frame.width,
      frameHeight: frame.height,
    };
    const primitive: Primitive = {
      type: "sprite",
      x: 176,
      y: 26,
      width: frame.width,
      height: frame.height,
      frameCount: frame.frameCount,
      fps: DEFAULT_SPRITE_FPS,
      sheetColumns: frame.columns,
      assetPath,
    };
    const sprite = spriteFromSource(source, primitive);
    const rawText = encodeSpriteAsset(sprite);
    state.spriteAssets[assetPath] = {
      file: builtInAssetFile(assetPath, rawText, "text/plain", "sprite.cba"),
      rawText,
      sprite,
      source,
    };
    addPrimitive(primitive, "Sprite sheet placed.");
  } catch (error) {
    state.notice = error instanceof Error ? error.message : "Could not read sprite sheet.";
    render();
  }
}

function inferSpriteSheetFrame(width: number, height: number): { width: number; height: number; columns: number; frameCount: number } {
  let frameWidth = width;
  let frameHeight = height;
  if (width !== height || width > MAX_SPRITE_FRAME_WIDTH || height > MAX_SPRITE_FRAME_HEIGHT) {
    const commonSizes = [64, 48, 32, 24, 16, 8];
    const squareCell = commonSizes.find((size) => {
      const frames = (width / size) * (height / size);
      return width % size === 0 &&
        height % size === 0 &&
        frames >= 2 &&
        frames <= MAX_SPRITE_FRAMES &&
        size <= MAX_SPRITE_FRAME_WIDTH &&
        size <= MAX_SPRITE_FRAME_HEIGHT;
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
  frameWidth = clamp(frameWidth, 1, Math.min(MAX_SPRITE_FRAME_WIDTH, width));
  frameHeight = clamp(frameHeight, 1, Math.min(MAX_SPRITE_FRAME_HEIGHT, height));
  const columns = Math.max(1, Math.floor(width / frameWidth));
  const rows = Math.max(1, Math.floor(height / frameHeight));
  const frameCount = Math.min(MAX_SPRITE_FRAMES, columns * rows, Math.max(1, Math.floor(MAX_SPRITE_TOTAL_PIXELS / (frameWidth * frameHeight))));
  return { width: frameWidth, height: frameHeight, columns, frameCount };
}

function themeAssetPathForFile(name: string): string {
  return `/themes/u/${safeAssetName(name, ".gif")}`;
}

function spriteAssetPathForFile(name: string): string {
  return `/themes/u/${safeAssetName(name, ".cba")}`;
}

function safeAssetName(name: string, extension: ".gif" | ".cba"): string {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const withoutExtension = cleaned.replace(/\.[a-z0-9]+$/i, "");
  const withExtension = cleaned.endsWith(extension) ? cleaned : `${withoutExtension || "asset"}${extension}`;
  if (withExtension.length <= 21) {
    return withExtension;
  }
  const base = withExtension.slice(0, -extension.length);
  const maxBase = 21 - extension.length;
  return `${base.slice(0, maxBase).replace(/[._-]+$/g, "") || "asset"}${extension}`;
}

function applyJson() {
  try {
    const imported = importThemeSpec(JSON.parse(state.jsonText));
    normalizeMiniThemeSpec(imported);
    const result = validateSpec(imported);
    if (result.errors.length > 0) {
      state.notice = `JSON not applied: ${result.errors.slice(0, 3).join(" ")}`;
      render();
      return;
    }
    pushHistory();
    state.spec = imported;
    state.selectedIndex = imported.primitives.length > 0 ? Math.max(0, Math.min(state.selectedIndex, imported.primitives.length - 1)) : -1;
    state.editingTextIndex = null;
    state.notice = "JSON applied.";
    syncJsonFromSpec();
  } catch (error) {
    state.notice = error instanceof Error ? error.message : "Invalid JSON.";
  }
  render();
}

function importThemeSpec(value: unknown): ThemeSpec {
  if (!isRecord(value)) {
    throw new Error("JSON not applied: root must be an object.");
  }
  const primitives = arrayValue(value.primitives) ?? arrayValue(value.p);
  if (!primitives) {
    throw new Error("JSON not applied: primitives array is required.");
  }
  return {
    themeSpecVersion: 1,
    themeId: stringValue(value.themeId) ?? stringValue(value.id) ?? "",
    themeRev: numberValue(value.themeRev) ?? numberValue(value.rev) ?? FIXED_THEME_REV,
    fallbackTheme: (stringValue(value.fallbackTheme) ?? stringValue(value.fb) ?? FIXED_FALLBACK_THEME) as ThemeSpec["fallbackTheme"],
    bgColor: stringValue(value.bgColor) ?? stringValue(value.bg),
    primitives: primitives.map(importPrimitive),
  };
}

function importPrimitive(value: unknown): Primitive {
  if (!isRecord(value)) {
    throw new Error("JSON not applied: every primitive must be an object.");
  }
  const type = expandPrimitiveType(stringValue(value.type) ?? stringValue(value.t) ?? "");
  const primitive: Primitive = {
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
  const text = stringValue(value.text) ?? stringValue(value.v);
  if (text !== undefined) {
    primitive.text = text;
  }
  const binding = stringValue(value.binding) ?? stringValue(value.b);
  if (binding !== undefined) {
    primitive.binding = expandBinding(binding) as BindingKey;
  }
  const fontSize = numberValue(value.fontSize) ?? numberValue(value.s);
  if (fontSize !== undefined) {
    primitive.fontSize = fontSize;
  }
  const font = numberValue(value.font) ?? numberValue(value.f);
  if (font !== undefined) {
    primitive.font = font;
  }
  primitive.color = stringValue(value.color) ?? stringValue(value.c);
  primitive.bgColor = stringValue(value.bgColor) ?? stringValue(value.bg);
  primitive.borderColor = stringValue(value.borderColor) ?? stringValue(value.bc);
  primitive.assetPath = stringValue(value.assetPath) ?? stringValue(value.a);
  const stateAssets = stateAssetsValue(value.stateAssets) ?? stateAssetsValue(value.sa);
  if (stateAssets) {
    primitive.stateAssets = stateAssets;
  }
  const frameCount = numberValue(value.frameCount);
  if (frameCount !== undefined) {
    primitive.frameCount = frameCount;
  }
  const fps = numberValue(value.fps);
  if (fps !== undefined) {
    primitive.fps = fps;
  }
  const sheetColumns = numberValue(value.sheetColumns);
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

function expandPrimitiveType(value: string): PrimitiveType {
  const map: Record<string, PrimitiveType> = {
    tx: "text",
    r: "rect",
    p: "progress",
    g: "gif",
    sp: "sprite",
    img: "sprite",
    px: "pixels",
  };
  return map[value] ?? value as PrimitiveType;
}

function expandBinding(value: string): BindingKey | string {
  const map: Record<string, BindingKey> = {
    l: "label",
    pr: "provider",
    s: "session",
    w: "weekly",
    r: "reset",
    u: "usageMode",
    act: "activity",
    st: "sessionTokens",
    wt: "weekTokens",
    tt: "totalTokens",
  };
  return map[value] ?? value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return Number.isInteger(value) ? value as number : undefined;
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function stringArrayValue(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
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

function startDrag(event: PointerEvent) {
  const index = Number((event.currentTarget as SVGElement).dataset.drag);
  const primitive = state.spec.primitives[index];
  if (!primitive) {
    return;
  }
  state.selectedIndex = index;
  pushHistory();
  const svg = (event.currentTarget as SVGElement).closest("svg");
  if (!svg) {
    return;
  }
  const start = pointerPosition(svg, event);
  const originX = primitive.x;
  const originY = primitive.y;
  (event.currentTarget as SVGElement).setPointerCapture(event.pointerId);

  const onMove = (moveEvent: PointerEvent) => {
    const liveSvg = app.querySelector<SVGSVGElement>(".display") ?? svg;
    const point = pointerPosition(liveSvg, moveEvent);
    const maxX = Math.max(0, DISPLAY_SIZE - estimatePrimitiveWidth(primitive));
    const maxY = Math.max(0, DISPLAY_SIZE - estimatePrimitiveHeight(primitive));
    primitive.x = clamp(Math.round(originX + point.x - start.x), 0, maxX);
    primitive.y = clamp(Math.round(originY + point.y - start.y), 0, maxY);
    syncJsonFromSpec();
    render();
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function startResize(event: PointerEvent) {
  event.preventDefault();
  event.stopPropagation();

  const target = event.currentTarget as SVGElement;
  const index = Number(target.dataset.resizeIndex);
  const handle = target.dataset.resizeHandle as ResizeHandle;
  const primitive = state.spec.primitives[index];
  if (!primitive || !handle) {
    return;
  }

  state.selectedIndex = index;
  pushHistory();
  const svg = target.closest("svg");
  if (!svg) {
    return;
  }

  const start = pointerPosition(svg, event);
  const originWidth = estimatePrimitiveWidth(primitive);
  const originHeight = estimatePrimitiveHeight(primitive);
  const originFontSize = Math.max(1, primitive.fontSize ?? 1);
  target.setPointerCapture(event.pointerId);

  const onMove = (moveEvent: PointerEvent) => {
    const liveSvg = app.querySelector<SVGSVGElement>(".display") ?? svg;
    const point = pointerPosition(liveSvg, moveEvent);
    const deltaX = point.x - start.x;
    const deltaY = point.y - start.y;

    if (primitive.type === "text") {
      const nextSize = clamp(Math.round(originFontSize + deltaY / 10), 1, 12);
      primitive.fontSize = nextSize;
    } else if (primitive.type === "gif") {
      resizeGifFromPointer(primitive, handle, originWidth, originHeight, deltaX, deltaY);
    } else {
      if (handle === "e" || handle === "se") {
        primitive.width = clamp(Math.round(originWidth + deltaX), 1, DISPLAY_SIZE - primitive.x);
      }
      if (handle === "s" || handle === "se") {
        primitive.height = clamp(Math.round(originHeight + deltaY), 1, DISPLAY_SIZE - primitive.y);
      }
    }

    syncJsonFromSpec();
    render();
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function resizeGifPrimitive(primitive: Primitive, key: "width" | "height", rawValue: number) {
  const ratio = gifAspectRatio(primitive);
  if (key === "width") {
    applyGifWidth(primitive, ratio, rawValue);
    return;
  }

  applyGifHeight(primitive, ratio, rawValue);
}

function resizeGifFromPointer(
    primitive: Primitive,
    handle: ResizeHandle,
    originWidth: number,
    originHeight: number,
    deltaX: number,
    deltaY: number) {
  const ratio = gifAspectRatio(primitive);
  if (handle === "s") {
    applyGifHeight(primitive, ratio, Math.round(originHeight + deltaY));
    return;
  }

  if (handle === "e") {
    applyGifWidth(primitive, ratio, Math.round(originWidth + deltaX));
    return;
  }

  const widthFromPointer = Math.round(originWidth + deltaX);
  const heightFromPointer = Math.round(originHeight + deltaY);
  if (Math.abs(deltaY) > Math.abs(deltaX)) {
    applyGifHeight(primitive, ratio, heightFromPointer);
    return;
  }

  applyGifWidth(primitive, ratio, widthFromPointer);
}

function applyGifWidth(primitive: Primitive, ratio: number, rawWidth: number) {
  const maxWidth = Math.max(1, DISPLAY_SIZE - primitive.x);
  const maxHeight = Math.max(1, DISPLAY_SIZE - primitive.y);
  let width = clamp(rawWidth, 1, maxWidth);
  let height = Math.max(1, Math.round(width / ratio));
  if (height > maxHeight) {
    height = maxHeight;
    width = clamp(Math.round(height * ratio), 1, maxWidth);
  }
  primitive.width = width;
  primitive.height = height;
}

function applyGifHeight(primitive: Primitive, ratio: number, rawHeight: number) {
  const maxWidth = Math.max(1, DISPLAY_SIZE - primitive.x);
  const maxHeight = Math.max(1, DISPLAY_SIZE - primitive.y);
  let height = clamp(rawHeight, 1, maxHeight);
  let width = Math.max(1, Math.round(height * ratio));
  if (width > maxWidth) {
    width = maxWidth;
    height = clamp(Math.round(width / ratio), 1, maxHeight);
  }
  primitive.width = width;
  primitive.height = height;
}

function gifAspectRatio(primitive: Primitive): number {
  if (primitive.assetPath === "/themes/mini/mini.gif") {
    return 1;
  }
  const width = primitive.width ?? DEFAULT_GIF_SIZE;
  const height = primitive.height ?? DEFAULT_GIF_SIZE;
  if (width <= 0 || height <= 0) {
    return 1;
  }
  return width / height;
}

function pointerPosition(svg: SVGSVGElement, event: PointerEvent): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: ((event.clientX - rect.left) / rect.width) * DISPLAY_SIZE,
    y: ((event.clientY - rect.top) / rect.height) * DISPLAY_SIZE,
  };
}

function downloadTheme() {
  const blob = new Blob([prettyJson(state.spec)], { type: "application/json" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = `${state.spec.themeId}.json`;
  link.click();
  URL.revokeObjectURL(href);
  state.notice = "Download prepared.";
  render();
}

type ThemePackManifest = {
  kind: "vibetv-theme-pack";
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  minFirmware: string;
  themeSpec: ThemePackFileEntry;
  assets: ThemePackFileEntry[];
};

type ThemePackFileEntry = {
  path: string;
  file: string;
  bytes: number;
  sha256: string;
  contentType?: string;
};

async function downloadThemePack() {
  validateCurrentSpec();
  if (state.errors.length > 0) {
    state.notice = "Theme is invalid. Fix the errors before downloading a pack.";
    render();
    return;
  }

  try {
    const files: Record<string, Uint8Array> = {};
    const assets: ThemePackFileEntry[] = [];
    const usedPackFiles = new Set<string>(["manifest.json", "theme.json"]);

    const themeSpecPath = themeSpecAssetPath(state.spec);
    const themeSpecData = strToU8(deviceThemeSpecJson(state.spec));
    const themeSpecEntry: ThemePackFileEntry = {
      path: themeSpecPath,
      file: "theme.json",
      bytes: themeSpecData.byteLength,
      sha256: await sha256Hex(themeSpecData),
      contentType: "application/json",
    };
    files[themeSpecEntry.file] = themeSpecData;

    for (const assetPath of uniqueAssetPaths("gif")) {
      const asset = state.gifAssets[assetPath] ?? await builtInGifAsset(assetPath);
      if (!asset) {
        throw new Error(`Missing GIF asset for ${assetPath}.`);
      }
      const data = new Uint8Array(await asset.file.arrayBuffer());
      const packFile = uniquePackAssetFile(assetPath, usedPackFiles);
      files[packFile] = data;
      assets.push({
        path: assetPath,
        file: packFile,
        bytes: data.byteLength,
        sha256: await sha256Hex(data),
        contentType: asset.file.type || "image/gif",
      });
    }

    for (const assetPath of uniqueAssetPaths("sprite")) {
      const asset = state.spriteAssets[assetPath] ?? builtInSpriteAsset(assetPath);
      if (!asset) {
        throw new Error(`Missing sprite asset for ${assetPath}.`);
      }
      const data = new Uint8Array(await asset.file.arrayBuffer());
      const packFile = uniquePackAssetFile(assetPath, usedPackFiles);
      files[packFile] = data;
      assets.push({
        path: assetPath,
        file: packFile,
        bytes: data.byteLength,
        sha256: await sha256Hex(data),
        contentType: asset.file.type || "text/plain",
      });
    }

    const manifest: ThemePackManifest = {
      kind: "vibetv-theme-pack",
      schemaVersion: 1,
      id: state.spec.themeId,
      name: displayThemeName(state.spec.themeId),
      version: `${state.spec.themeRev}.0.0`,
      minFirmware: "1.0.0",
      themeSpec: themeSpecEntry,
      assets,
    };
    files["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

    const zip = zipSync(files, { level: 0 });
    const blob = new Blob([arrayBufferFor(zip)], { type: "application/zip" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `${state.spec.themeId}.zip`;
    link.click();
    URL.revokeObjectURL(href);
    state.notice = "Theme pack prepared.";
  } catch (error) {
    state.notice = error instanceof Error ? error.message : "Theme pack download failed.";
  }
  render();
}

function uniquePackAssetFile(devicePath: string, used: Set<string>): string {
  const fallback = `asset-${used.size}`;
  const fileName = (devicePath.split("/").pop() || fallback)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
  const dot = fileName.lastIndexOf(".");
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : "";
  let candidate = `assets/${fileName}`;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `assets/${base}-${counter}${ext}`;
    counter += 1;
  }
  used.add(candidate);
  return candidate;
}

function displayThemeName(themeId: string): string {
  return themeId
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ") || "VibeTV Theme";
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", arrayBufferFor(data));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function arrayBufferFor(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

async function sendThemeToVibeTV() {
  validateCurrentSpec();
  if (state.errors.length > 0) {
    state.notice = "Theme is invalid. Fix the errors before sending.";
    render();
    return;
  }

  try {
    const targetOrigin = normalizeTargetOrigin(state.targetOrigin);
    state.targetOrigin = targetOrigin;
    persistTargetOrigin();
    state.notice = "Sending theme to Vibe TV.";
    render();
    await uploadThemeAssets(targetOrigin);
    const themePath = themeSpecAssetPath(state.spec);
    await uploadThemeAsset(targetOrigin, themePath, themeSpecUploadAsset(state.spec), "ThemeSpec");
    const response = await activateStoredTheme(targetOrigin, themePath);

    if (response.type !== "opaque" && (response.status === 404 || response.status === 405 || response.status === 501)) {
      await sendLegacyInlineTheme(targetOrigin);
      render();
      return;
    }

    if (response.type === "opaque") {
      state.notice = "Theme sent to Vibe TV. Local dev mode cannot read the device confirmation.";
      render();
      return;
    }

    if (!response.ok) {
      state.notice = await responseFailureMessage(response, "Vibe TV rejected the theme");
      render();
      return;
    }

    const liveFrame = await postFramePayload(targetOrigin, buildLiveFramePayload());
    if (liveFrame.type !== "opaque" && !liveFrame.ok) {
      state.notice = await responseFailureMessage(liveFrame, "Theme activated, but Vibe TV rejected the live frame");
      render();
      return;
    }

    const confirmation = await confirmThemeApplied(targetOrigin, state.spec);
    const cleaned = await cleanupStoredThemeVersions(targetOrigin, state.spec);
    state.notice = `${confirmation ?? "Theme sent to Vibe TV."}${cleanupNotice(cleaned)}`;
  } catch (error) {
    state.notice = error instanceof Error ? error.message : `Could not reach Vibe TV at ${normalizeTargetOrigin(state.targetOrigin)}. Check Wi-Fi/mDNS, then try again.`;
  }
  render();
}

async function sendLegacyInlineTheme(targetOrigin: string) {
  const inlineBytes = new TextEncoder().encode(JSON.stringify(buildFramePayload())).length;
  if (inlineBytes > MAX_FRAME_BYTES) {
    throw new Error("This Vibe TV firmware does not support stored themes yet. Update the firmware, then send this larger theme again.");
  }

  const response = await postFramePayload(targetOrigin, buildFramePayload());
  if (response.type !== "opaque" && !response.ok) {
    throw new Error(await responseFailureMessage(response, "Vibe TV rejected the theme"));
  }
  const confirmation = await confirmThemeApplied(targetOrigin, state.spec);
  state.notice = confirmation ?? "Theme sent to Vibe TV.";
}

async function clearDeviceThemeSpec(targetOrigin: string) {
  const response = await postFramePayload(targetOrigin, buildThemeSpecClearPayload());
  if (response.type !== "opaque" && !response.ok) {
    throw new Error(await responseFailureMessage(response, "Theme clear failed"));
  }
}

async function postFramePayload(targetOrigin: string, payload: Record<string, unknown>): Promise<Response> {
  return fetchWithCorsFallback(`${targetOrigin}/frame`, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });
}

async function activateStoredTheme(targetOrigin: string, path: string): Promise<Response> {
  return fetchWithCorsFallback(`${targetOrigin}/theme/active`, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ path }),
  });
}

async function uploadThemeAssets(targetOrigin: string) {
  for (const path of uniqueAssetPaths("gif")) {
    await uploadThemeAsset(targetOrigin, path, state.gifAssets[path] ?? await builtInGifAsset(path), "GIF");
  }
  for (const path of uniqueAssetPaths("sprite")) {
    await uploadThemeAsset(targetOrigin, path, state.spriteAssets[path] ?? builtInSpriteAsset(path), "Sprite");
  }
}

async function uploadThemeAsset(targetOrigin: string, path: string, asset: UploadableAsset | null, label: string) {
  if (!asset) {
    return;
  }
  const body = new FormData();
  body.append("asset", asset.file, asset.file.name);
  const response = await fetchWithCorsFallback(`${targetOrigin}/assets?path=${encodeURIComponent(path)}`, {
    method: "POST",
    body,
  });
  if (response.type !== "opaque" && !response.ok) {
    throw new Error(await responseFailureMessage(response, `${label} upload failed`));
  }
}

async function cleanupStoredThemeVersions(targetOrigin: string, spec: ThemeSpec): Promise<number> {
  const activePath = themeSpecAssetPath(spec);
  const stalePaths = await staleStoredThemePaths(targetOrigin, spec, activePath);
  let deleted = 0;
  for (const path of stalePaths) {
    const response = await deleteThemeAsset(targetOrigin, path);
    if (response.type === "opaque" || response.ok || response.status === 404) {
      deleted += 1;
    }
  }
  return deleted;
}

async function staleStoredThemePaths(targetOrigin: string, spec: ThemeSpec, activePath: string): Promise<string[]> {
  const assets = await fetchDeviceAssets(targetOrigin);
  if (!assets?.assets) {
    return [];
  }
  const hashedPrefix = themeSpecAssetHashPrefix(spec);
  const legacyPath = legacyThemeSpecAssetPath(spec);
  return assets.assets
    .map((asset) => asset.path ?? "")
    .filter((path) => path.length > 0)
    .filter((path) => path !== activePath)
    .filter((path) => path === legacyPath || (path.startsWith(hashedPrefix) && path.endsWith(".json")));
}

async function fetchDeviceAssets(targetOrigin: string): Promise<DeviceAssets | null> {
  const response = await fetchWithCorsFallback(`${targetOrigin}/assets`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (response.type === "opaque") {
    return null;
  }
  if (!response.ok) {
    return null;
  }
  return await response.json() as DeviceAssets;
}

async function deleteThemeAsset(targetOrigin: string, path: string): Promise<Response> {
  return fetchWithCorsFallback(`${targetOrigin}/assets?path=${encodeURIComponent(path)}`, {
    method: "DELETE",
  });
}

function cleanupNotice(count: number): string {
  if (count <= 0) {
    return "";
  }
  return ` Cleaned ${count} old theme ${count === 1 ? "file" : "files"}.`;
}

async function confirmThemeApplied(targetOrigin: string, spec: ThemeSpec): Promise<string | null> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const health = await fetchDeviceHealth(targetOrigin);
    if (!health) {
      return "Theme sent to Vibe TV. Local dev mode cannot read the device confirmation.";
    }
    const confirmed = themeAppliedFromHealth(health, spec);
    if (confirmed.ok) {
      return confirmed.message;
    }
    if (attempt < 9) {
      await delay(750);
    }
  }
  throw new Error("Theme was sent, but Vibe TV health still reports the fallback theme.");
}

async function fetchDeviceHealth(targetOrigin: string): Promise<DeviceHealth | null> {
  const response = await fetchWithCorsFallback(`${targetOrigin}/health`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (response.type === "opaque") {
    return null;
  }
  if (!response.ok) {
    throw new Error(await responseFailureMessage(response, "Theme was sent, but Vibe TV health check failed"));
  }
  return await response.json() as DeviceHealth;
}

async function responseFailureMessage(response: Response, fallback: string): Promise<string> {
  const detail = await response.text().catch(() => "");
  const cleanDetail = detail.trim().replace(/\s+/g, " ");
  const suffix = cleanDetail ? `: ${cleanDetail}` : "";
  if (response.status === 0) {
    return `${fallback}. Browser could not read the device response.`;
  }
  if (response.status === 401 || response.status === 403) {
    return `${fallback} (${response.status})${suffix}. Pairing or device permission may be missing.`;
  }
  if (response.status === 404) {
    return `${fallback} (${response.status})${suffix}. The firmware may be too old or the file path is missing.`;
  }
  if (response.status === 413) {
    return `${fallback} (${response.status})${suffix}. The theme is too large for this firmware.`;
  }
  if (response.status >= 500) {
    return `${fallback} (${response.status})${suffix}. Check device health and free storage.`;
  }
  return `${fallback} (${response.status})${suffix}.`;
}

function themeAppliedFromHealth(health: DeviceHealth, spec: ThemeSpec): { ok: boolean; message: string } {
  const themeSpec = health.display?.themeSpec;
  if (themeSpec?.renderOk === false) {
    return { ok: false, message: `Vibe TV could not render the theme (${themeSpec.renderError ?? "render_failed"}).` };
  }
  if (themeSpec?.active) {
    const sameId = !themeSpec.id || themeSpec.id === spec.themeId;
    const sameRev = !themeSpec.rev || themeSpec.rev === spec.themeRev;
    const expectedHash = themeSpecHash(spec);
    const sameHash = !themeSpec.hash || themeSpec.hash === expectedHash;
    const samePath = !themeSpec.path || themeSpec.path === themeSpecAssetPath(spec);
    if (sameId && sameRev && sameHash && samePath) {
      if (typeof health.system?.freeHeap === "number" && health.system.freeHeap < 6000) {
        return { ok: true, message: `Theme sent to Vibe TV and confirmed active. Warning: device heap is low (${health.system.freeHeap} bytes).` };
      }
      return { ok: true, message: "Theme sent to Vibe TV and confirmed active." };
    }
  }

  const activePath = health.display?.gif?.activePath;
  const expectedGifPaths = uniqueGifAssetPathsForSpec(spec);
  if (activePath && expectedGifPaths.includes(activePath) && health.display?.gif?.lastError == null) {
    return { ok: true, message: `Theme sent to Vibe TV and confirmed via ${activePath}.` };
  }

  return { ok: false, message: "" };
}

function uniqueGifAssetPathsForSpec(spec: ThemeSpec): string[] {
  return uniqueAssetPaths("gif", spec);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchWithCorsFallback(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchWithTimeout(url, { ...init, mode: "cors" });
  } catch {
    return fetchWithTimeout(url, { ...init, mode: "no-cors" });
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

function uniqueAssetPaths(type: "gif" | "sprite", spec: ThemeSpec = state.spec): string[] {
  const paths = new Set<string>();
  for (const primitive of spec.primitives) {
    if (primitive.type === type) {
      for (const assetPath of stateAssetPathsForPrimitive(primitive)) {
        paths.add(assetPath);
      }
    }
  }
  return Array.from(paths);
}

function uniqueGifAssetPaths(): string[] {
  return uniqueAssetPaths("gif");
}

function themeUsesStateAssets(spec: ThemeSpec = state.spec): boolean {
  return spec.primitives.some((primitive) => primitive.stateAssets && Object.keys(primitive.stateAssets).length > 0);
}

function builtInAssetFile(path: string, content: BlobPart, type: string, fallbackName: string): File {
  return new File([content], path.split("/").pop() || fallbackName, { type });
}

function themeSpecUploadAsset(spec: ThemeSpec): UploadableAsset {
  const path = themeSpecAssetPath(spec);
  return {
    file: builtInAssetFile(path, deviceThemeSpecJson(spec), "application/json", "theme.json"),
  };
}

function themeSpecAssetPath(spec: ThemeSpec): string {
  const prefix = USER_THEME_ASSET_PATH_PREFIX;
  const extension = ".json";
  const maxSegmentLength = Math.max(1, MAX_ESP8266_LITTLEFS_PATH_CHARS - prefix.length - extension.length);
  const revSuffix = `-${spec.themeRev || 1}-${themeSpecHash(spec).slice(0, 6)}`;
  const maxBaseLength = Math.max(1, maxSegmentLength - revSuffix.length);
  const cleaned = spec.themeId
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "theme";
  const base = `${cleaned.slice(0, maxBaseLength)}${revSuffix}`.slice(0, maxSegmentLength);
  return `${prefix}${base}${extension}`;
}

function themeSpecAssetHashPrefix(spec: ThemeSpec): string {
  const activePath = themeSpecAssetPath(spec);
  return activePath.replace(/[0-9a-f]{6}\.json$/i, "");
}

function legacyThemeSpecAssetPath(spec: ThemeSpec): string {
  const prefix = USER_THEME_ASSET_PATH_PREFIX;
  const extension = ".json";
  const maxSegmentLength = Math.max(1, MAX_ESP8266_LITTLEFS_PATH_CHARS - prefix.length - extension.length);
  const revSuffix = `-${spec.themeRev || 1}`;
  const maxBaseLength = Math.max(1, maxSegmentLength - revSuffix.length);
  const cleaned = spec.themeId
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "theme";
  const base = `${cleaned.slice(0, maxBaseLength)}${revSuffix}`.slice(0, maxSegmentLength);
  return `${prefix}${base}${extension}`;
}

function deviceThemeSpecJson(spec: ThemeSpec): string {
  return JSON.stringify(buildDeviceThemeSpec(spec));
}

function themeSpecHash(spec: ThemeSpec): string {
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

function builtInSpriteAsset(path: string): UploadableAsset | null {
  const raw = builtInSpriteText(path);
  if (!raw) {
    return null;
  }
  return {
    file: builtInAssetFile(path, raw, "text/plain", "sprite.cbi"),
  };
}

async function builtInGifAsset(path: string): Promise<UploadableAsset | null> {
  const previewUrl = builtInGifPreviewUrl(path);
  if (!previewUrl) {
    return null;
  }
  const response = await fetch(previewUrl);
  if (!response.ok) {
    throw new Error(`Built-in GIF missing (${response.status}).`);
  }
  const blob = await response.blob();
  return {
    file: builtInAssetFile(path, blob, "image/gif", "theme.gif"),
    previewUrl,
  };
}

function buildLiveFramePayload(spec: ThemeSpec = state.spec) {
  const payload: Record<string, unknown> = {
    v: 2,
    provider: frame.provider,
    label: frame.label,
    session: frame.session,
    weekly: frame.weekly,
    resetSecs: frame.resetSecs,
    usageMode: frame.usageMode,
    time: frame.time,
    date: frame.date,
  };
  const bindings = usedThemeBindings(spec);
  if (themeUsesStateAssets(spec)) {
    payload.activity = frame.activity;
  }
  if (bindings.has("sessionTokens") || themeUsesStateAssets(spec)) {
    payload.sessionTokens = frame.sessionTokens;
  }
  if (bindings.has("weekTokens") || themeUsesStateAssets(spec)) {
    payload.weekTokens = frame.weekTokens;
  }
  if (bindings.has("totalTokens") || themeUsesStateAssets(spec)) {
    payload.totalTokens = frame.totalTokens;
  }
  return payload;
}

function buildFramePayload(spec: ThemeSpec = state.spec) {
  return {
    ...buildLiveFramePayload(spec),
    themeSpec: buildDeviceThemeSpec(spec),
  };
}

function buildDeviceThemeSpec(spec: ThemeSpec): Record<string, unknown> {
  const compact: Record<string, unknown> = {
    v: spec.themeSpecVersion,
    id: spec.themeId,
    rev: spec.themeRev,
    p: spec.primitives.map(buildDevicePrimitive),
  };
  if (spec.fallbackTheme) {
    compact.fb = spec.fallbackTheme;
  }
  if (spec.bgColor) {
    compact.bg = spec.bgColor;
  }
  return compact;
}

function buildDevicePrimitive(primitive: Primitive): Record<string, unknown> {
  const compact: Record<string, unknown> = {
    t: compactPrimitiveType(primitive.type),
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
    compact.b = compactBinding(primitive.binding);
  }
  if (primitive.fontSize !== undefined) {
    compact.s = primitive.fontSize;
  }
  if (primitive.font !== undefined) {
    compact.f = primitive.font;
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

function compactPrimitiveType(type: PrimitiveType): string {
  const values: Record<PrimitiveType, string> = {
    rect: "r",
    text: "tx",
    progress: "p",
    gif: "g",
    sprite: "sp",
    pixels: "px",
  };
  return values[type];
}

function compactBinding(binding: BindingKey): string {
  const values: Record<BindingKey, string> = {
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
  return values[binding] ?? binding;
}

function buildThemeSpecClearPayload(): Record<string, unknown> {
  return {
    v: 2,
    provider: frame.provider,
    label: frame.label,
    session: frame.session,
    weekly: frame.weekly,
    resetSecs: frame.resetSecs,
    usageMode: frame.usageMode,
    theme: FIXED_FALLBACK_THEME,
    themeSpec: null,
  };
}

function usedThemeBindings(spec: ThemeSpec = state.spec): Set<string> {
  const bindings = new Set<string>();
  for (const primitive of spec.primitives) {
    if (primitive.binding) {
      bindings.add(primitive.binding);
    }
    if (primitive.text) {
      for (const match of primitive.text.matchAll(/\{([a-zA-Z]+)\}/g)) {
        bindings.add(match[1]);
      }
    }
  }
  return bindings;
}

async function copyText(text: string, notice: string) {
  try {
    await navigator.clipboard.writeText(text);
    state.notice = notice;
  } catch {
    state.notice = "Clipboard copy failed. Use Save Theme or select the JSON manually.";
  }
  render();
}

function toInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeRotation(value: number): number {
  const rotation = Math.round(value) % 360;
  return rotation < 0 ? rotation + 360 : rotation;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    };
    return entities[char];
  });
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
