#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const themePackRoot = path.join(repoRoot, "theme-packs");
const mainTs = await readFile(path.join(repoRoot, "tools/theme-studio/src/main.ts"), "utf8");
const clippySpritesTs = await readFile(path.join(repoRoot, "tools/theme-studio/src/clippy-sprites.ts"), "utf8");

const USER_THEME_ASSET_PATH_PREFIX = "/themes/u/";
const MAX_ESP8266_LITTLEFS_PATH_CHARS = 31;

const paths = {
  claudeIdle: "/themes/u/cld-i.cba",
  claudeCoding: "/themes/u/cld-c.cba",
  clippyBg: "/themes/u/cp-bg.cbi",
  clippyIdle: "/themes/u/cp-i.cba",
  clippyCoding: "/themes/u/cp-c.cba",
  synthTop: "/themes/u/syn-top.cbi",
  synthUi: "/themes/u/syn-ui.cbi",
};

const themes = [
  {
    id: "synthwave",
    name: "Synthwave",
    version: "1.0.0",
    minFirmware: "1.0.24",
    spec: {
      v: 1,
      id: "synthwave",
      rev: 1,
      fb: "mini",
      bg: "#050014",
      p: [
        { t: "sp", x: 0, y: 0, w: 240, h: 128, a: paths.synthTop },
        { t: "sp", x: 0, y: 128, w: 240, h: 95, a: paths.synthUi },
        { t: "tx", x: 35, y: 18, b: "l", f: 4, s: 1, al: "center", c: "#FF4FA3" },
        { t: "tx", x: 67, y: 48, v: "USAGE", f: 4, s: 1, c: "#FF4FA3" },
        { t: "p", x: 18, y: 157, w: 153, h: 20, b: "s", c: "#FF4FA3", bg: "#1D073B", bc: "#FF4FA3" },
        { t: "tx", x: 181, y: 147, v: "{session}%", f: 4, s: 1, c: "#FF4FA3" },
        { t: "p", x: 18, y: 212, w: 153, h: 20, b: "w", c: "#35C9FF", bg: "#101145", bc: "#4D8CFF" },
        { t: "tx", x: 181, y: 202, v: "{weekly}%", f: 4, s: 1, c: "#35C9FF" },
      ],
    },
    assets: [
      { path: paths.synthTop, file: "assets/syn-top.cbi", contentType: "text/plain", data: synthwaveTopSprite() },
      { path: paths.synthUi, file: "assets/syn-ui.cbi", contentType: "text/plain", data: synthwaveUiSprite() },
    ],
  },
  {
    id: "claude-creature",
    name: "Claude Creature",
    version: "1.0.0",
    minFirmware: "1.0.24",
    spec: {
      v: 1,
      id: "claude-creature",
      rev: 1,
      fb: "mini",
      bg: "#000000",
      p: [
        { t: "tx", x: 9, y: 8, v: "{label} Usage", f: 2, s: 1, c: "#FF9B7B" },
        { t: "tx", x: 9, y: 42, v: "Session", f: 2, s: 1, c: "#FFB19B" },
        { t: "tx", x: 9, y: 62, v: "{session}%", f: 2, s: 3, c: "#FF8F6F" },
        { t: "tx", x: 10, y: 105, v: "remaining", f: 2, s: 1, c: "#FFB19B" },
        { t: "tx", x: 134, y: 42, v: "Weekly", f: 2, s: 1, c: "#FFB19B" },
        { t: "tx", x: 132, y: 62, v: "{weekly}%", f: 2, s: 3, c: "#FF8F6F" },
        { t: "tx", x: 136, y: 105, v: "remaining", f: 2, s: 1, c: "#FFB19B" },
        {
          t: "sp",
          x: 82,
          y: 126,
          w: 77,
          h: 77,
          bg: "#000000",
          a: paths.claudeIdle,
          sa: { idle: paths.claudeIdle, coding: paths.claudeCoding },
        },
        { t: "r", x: 10, y: 216, w: 220, h: 1, c: "#B95D4F" },
        { t: "tx", x: 34, y: 221, v: "* Resets in {reset}", f: 2, s: 1, c: "#FF9B7B" },
      ],
    },
    assets: [
      { path: paths.claudeIdle, file: "assets/cld-i.cba", contentType: "text/plain", data: extractBacktickConst(mainTs, "CLAUDE_IDLE_SPRITE") },
      { path: paths.claudeCoding, file: "assets/cld-c.cba", contentType: "text/plain", data: extractBacktickConst(mainTs, "CLAUDE_CODING_SPRITE") },
    ],
  },
  {
    id: "clippy",
    name: "Clippy",
    version: "1.0.0",
    minFirmware: "1.0.24",
    spec: {
      v: 1,
      id: "clippy",
      rev: 1,
      fb: "mini",
      bg: "#000000",
      p: [
        { t: "sp", x: 0, y: 0, w: 240, h: 240, a: paths.clippyBg },
        { t: "tx", x: 26, y: 28, v: "{label} Usage", f: 2, s: 2, c: "#FFFFFF" },
        {
          t: "sp",
          x: 83,
          y: 54,
          w: 74,
          h: 74,
          bg: "#C6C3BD",
          a: paths.clippyIdle,
          sa: { idle: paths.clippyIdle, coding: paths.clippyCoding },
        },
        { t: "p", x: 27, y: 166, w: 146, h: 14, b: "s", ps: "segments", sg: 28, gg: 1, c: "#0FA514", bg: "#DAD7D0", bc: "#FFFFFF" },
        { t: "tx", x: 181, y: 158, v: "{session}%", f: 2, s: 2, c: "#111111" },
        { t: "tx", x: 172, y: 178, v: "remaining", f: 2, s: 1, c: "#111111" },
        { t: "p", x: 27, y: 212, w: 146, h: 14, b: "w", ps: "segments", sg: 28, gg: 1, c: "#0FA514", bg: "#DAD7D0", bc: "#FFFFFF" },
        { t: "tx", x: 181, y: 204, v: "{weekly}%", f: 2, s: 2, c: "#111111" },
        { t: "tx", x: 172, y: 224, v: "remaining", f: 2, s: 1, c: "#111111" },
      ],
    },
    assets: [
      { path: paths.clippyBg, file: "assets/cp-bg.cbi", contentType: "text/plain", data: clippyBackgroundSprite() },
      { path: paths.clippyIdle, file: "assets/cp-i.cba", contentType: "text/plain", data: extractBacktickConst(clippySpritesTs, "CLIPPY_IDLE_SPRITE") },
      { path: paths.clippyCoding, file: "assets/cp-c.cba", contentType: "text/plain", data: extractBacktickConst(clippySpritesTs, "CLIPPY_CODING_SPRITE") },
    ],
  },
];

for (const theme of themes) {
  await writeThemePack(theme);
  console.log(`synced theme-pack source: ${theme.id}`);
}

async function writeThemePack(theme) {
  const dir = path.join(themePackRoot, theme.id);
  await rm(dir, { recursive: true, force: true });
  await mkdir(path.join(dir, "assets"), { recursive: true });

  const themeJson = `${JSON.stringify(theme.spec)}\n`;
  await writeFile(path.join(dir, "theme.json"), themeJson);
  for (const asset of theme.assets) {
    await writeFile(path.join(dir, asset.file), ensureTrailingNewline(asset.data));
  }

  const themeSpecEntry = await entryFor(dir, themeSpecAssetPath(theme.spec), "theme.json", "application/json");
  const assetEntries = [];
  for (const asset of theme.assets) {
    assetEntries.push(await entryFor(dir, asset.path, asset.file, asset.contentType));
  }
  const manifest = {
    kind: "vibetv-theme-pack",
    schemaVersion: 1,
    id: theme.id,
    name: theme.name,
    version: theme.version,
    minFirmware: theme.minFirmware,
    themeSpec: themeSpecEntry,
    assets: assetEntries,
  };
  await writeFile(path.join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function entryFor(dir, devicePath, file, contentType) {
  const data = await readFile(path.join(dir, file));
  return {
    path: devicePath,
    file,
    bytes: data.byteLength,
    sha256: createHash("sha256").update(data).digest("hex"),
    contentType,
  };
}

function extractBacktickConst(source, name) {
  const match = source.match(new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*\`([\\s\\S]*?)\`;`));
  if (!match) {
    throw new Error(`Could not find ${name}`);
  }
  return match[1];
}

function themeSpecAssetPath(spec) {
  const prefix = USER_THEME_ASSET_PATH_PREFIX;
  const extension = ".json";
  const maxSegmentLength = Math.max(1, MAX_ESP8266_LITTLEFS_PATH_CHARS - prefix.length - extension.length);
  const revSuffix = `-${spec.rev || 1}-${fnv1aHex8(JSON.stringify(spec)).slice(0, 6)}`;
  const maxBaseLength = Math.max(1, maxSegmentLength - revSuffix.length);
  const cleaned = spec.id.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "theme";
  const base = `${cleaned.slice(0, maxBaseLength)}${revSuffix}`.slice(0, maxSegmentLength);
  return `${prefix}${base}${extension}`;
}

function fnv1aHex8(value) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function ensureTrailingNewline(value) {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function encodeRleTokenRow(row) {
  const tokens = [];
  let current = row[0] ?? ".";
  let runLength = 0;
  for (const token of row) {
    if (token === current) {
      runLength += 1;
      continue;
    }
    tokens.push(`${runLength === 1 ? "" : runLength}${current}`);
    current = token;
    runLength = 1;
  }
  if (runLength > 0) {
    tokens.push(`${runLength === 1 ? "" : runLength}${current}`);
  }
  return tokens.join("");
}

function clippyBackgroundSprite() {
  const width = 106;
  const height = 105;
  const palette = ["#C6C3BD", "#FFFFFF", "#808080", "#404040", "#000080", "#DAD7D0", "#111111", "#A5A19A", "#EDEAE4", "#B8B4AE"];
  const rows = Array.from({ length: height }, () => Array.from({ length: width }, () => "a"));
  const setPixel = (x, y, token) => {
    if (x >= 0 && x < width && y >= 0 && y < height) rows[y][x] = token;
  };
  const fillRect = (x, y, w, h, token) => {
    for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) setPixel(xx, yy, token);
  };
  const line = (x, y, w, token) => fillRect(x, y, w, 1, token);
  const bevelRect = (x, y, w, h, fill) => {
    fillRect(x, y, w, h, fill);
    line(x, y, w, "b");
    fillRect(x, y, 1, h, "b");
    line(x, y + h - 1, w, "d");
    fillRect(x + w - 1, y, 1, h, "d");
    line(x + 1, y + h - 2, w - 2, "c");
    fillRect(x + w - 2, y + 1, 1, h - 2, "c");
  };
  line(0, 0, width, "b");
  fillRect(0, 0, 1, height, "b");
  line(1, 1, width - 2, "i");
  fillRect(1, 1, 1, height - 2, "i");
  line(0, height - 1, width, "d");
  fillRect(width - 1, 1, 1, height - 1, "d");
  fillRect(2, 3, width - 4, 11, "e");
  [78, 87, 96].forEach((x) => bevelRect(x, 4, 8, 8, "f"));
  fillRect(80, 10, 4, 1, "g");
  fillRect(90, 6, 4, 4, "g");
  fillRect(91, 7, 2, 2, "f");
  for (let i = 0; i < 5; i += 1) {
    setPixel(98 + i, 6 + i, "g");
    setPixel(102 - i, 6 + i, "g");
  }
  fillRect(14, 56, 78, 1, "c");
  line(14, 57, 78, "b");
  fillRect(14, 84, 78, 1, "c");
  line(14, 85, 78, "b");
  return ["CBI1", `${width} ${height}`, String(palette.length), ...palette, ...rows.map(encodeRleTokenRow)].join("\n");
}

function synthwaveTopSprite() {
  const width = 240;
  const height = 128;
  const rows = Array.from({ length: height }, () => Array.from({ length: width }, () => "."));
  const setPixel = (x, y, token) => {
    if (x >= 0 && x < width && y >= 0 && y < height) rows[y][x] = token;
  };
  const fillRect = (x, y, w, h, token) => {
    for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) setPixel(xx, yy, token);
  };
  const drawLine = (x0, y0, x1, y1, token) => {
    const dx = Math.abs(x1 - x0);
    const sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0);
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      setPixel(x0, y0, token);
      if (x0 === x1 && y0 === y1) break;
      const twice = err * 2;
      if (twice >= dy) {
        err += dy;
        x0 += sx;
      }
      if (twice <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  };
  const centerX = 120;
  const centerY = 98;
  const radius = 30;
  for (let y = centerY - radius; y <= centerY; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      if (dx * dx + dy * dy <= radius * radius) setPixel(x, y, y < 83 ? "e" : y < 92 ? "d" : "c");
    }
  }
  for (const y of [82, 89, 96, 102]) {
    fillRect(82, y, 76, 3, ".");
    fillRect(84, y + 2, 72, 1, "c");
  }
  for (const [x, y] of [[28, 38], [52, 54], [207, 34], [214, 72], [189, 93], [36, 93]]) fillRect(x, y, 2, 2, "d");
  for (const [x, y] of [[24, 61], [208, 91]]) {
    fillRect(x, y, 5, 2, "g");
    fillRect(x + 1, y - 2, 2, 6, "g");
  }
  fillRect(6, 107, 228, 2, "j");
  fillRect(18, 115, 204, 1, "b");
  fillRect(0, 126, 240, 1, "a");
  for (const x of [72, 104, 120, 136, 168]) drawLine(120, 108, x, 127, "j");
  for (const x of [16, 53, 86, 154, 187, 224]) drawLine(x, 116, x - 30, 127, "a");
  return ["CBI1", `${width} ${height}`, "10", "#9E35FF", "#2B0A62", "#FF4FA3", "#FF76B7", "#FF7A5C", "#35C9FF", "#12052D", "#FF6AB5", "#4D8CFF", "#5611A3", ...rows.map(encodeRleTokenRow)].join("\n");
}

function synthwaveUiSprite() {
  const width = 240;
  const height = 95;
  const rows = Array.from({ length: height }, () => Array.from({ length: width }, () => "."));
  const fillRect = (x, y, w, h, token) => {
    for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) {
      if (rows[yy]?.[xx] !== undefined) rows[yy][xx] = token;
    }
  };
  fillRect(14, 55, 212, 2, "b");
  fillRect(18, 28, 153, 20, "b");
  fillRect(18, 83, 153, 12, "i");
  fillRect(18, 7, 84, 2, "a");
  fillRect(18, 62, 70, 2, "h");
  fillRect(182, 49, 40, 2, "a");
  fillRect(182, 86, 40, 2, "h");
  return ["CBI1", `${width} ${height}`, "9", "#9E35FF", "#5611A3", "#1D073B", "#FF4FA3", "#101145", "#4D8CFF", "#A245FF", "#35C9FF", "#050014", ...rows.map(encodeRleTokenRow)].join("\n");
}
