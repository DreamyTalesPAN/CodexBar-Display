#!/usr/bin/env node
// Compile the approved AI artwork into bounded, palette-indexed device assets.
// npm ci --prefix apps/control-center, then node scripts/build-tiny-office-theme.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "apps/control-center/package.json"));
const sharp = require("sharp");
const packDir = path.join(root, "theme-packs/tiny-office");
await mkdir(path.join(packDir, "assets"), { recursive: true });

function encodeRows(width, height, tokens) {
  assert.equal(tokens.length, width * height);
  const rows = [];
  for (let y = 0; y < height; y++) {
    let row = "";
    for (let x = 0; x < width;) {
      const index = tokens[y * width + x];
      let count = 1;
      while (x + count < width && tokens[y * width + x + count] === index) count++;
      row += (count > 1 ? String(count) : "") + String.fromCharCode(97 + index);
      x += count;
    }
    rows.push(row);
  }
  return rows;
}

function encodeSprite(width, height, palette, tokens) {
  assert(palette.length > 0 && palette.length <= 26);
  return ["CBI1", `${width} ${height}`, String(palette.length), ...palette, ...encodeRows(width, height, tokens), ""].join("\n");
}

function encodeAnimation(width, height, fps, palette, frames) {
  assert(palette.length > 0 && palette.length <= 26);
  assert(width <= 64 && height <= 64 && width * height * frames.length <= 32768);
  const rows = frames.flatMap((tokens) => encodeRows(width, height, tokens));
  return ["CBA1", `${width} ${height} ${frames.length} ${fps}`, String(palette.length), ...palette, ...rows, ""].join("\n");
}

// Area-average the reference once before palette reduction; never snap RGB
// channels independently or dither. The reference is framed at 120x72, then
// the top 5 and bottom 13 rows (ceiling/floor) are dropped so the scene is
// 120x54 and the device can give the numbers a taller font. Drawn 2x.
const FRAME_H = 72, TOP_CUT = 5, SCENE_H = 54;
async function compileScene(state) {
  const { data, info } = await sharp(path.join(root, `docs/assets/tiny-office/${state}.png`))
    .flatten({ background: "#101020" })
    // The night-office reference reads too dark and pastel on the 1.54" panel.
    .modulate({ brightness: 1.15, saturation: 1.35 })
    .linear(1.1, -6)
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 3);
  const width = 120, height = FRAME_H;
  const cropHeight = Math.min(info.height, Math.floor(info.width * height / width));
  const cropWidth = Math.min(info.width, Math.floor(info.height * width / height));
  const left = Math.floor((info.width - cropWidth) / 2);
  const top = Math.floor((info.height - cropHeight) / 2);
  const reduced = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x0 = left + Math.floor(x * cropWidth / width);
      const x1 = left + Math.floor((x + 1) * cropWidth / width);
      const y0 = top + Math.floor(y * cropHeight / height);
      const y1 = top + Math.floor((y + 1) * cropHeight / height);
      assert(x1 > x0 && y1 > y0, "source must be larger than device asset");
      const sum = [0, 0, 0];
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          for (let c = 0; c < 3; c++) sum[c] += data[(sy * info.width + sx) * 3 + c];
        }
      }
      for (let c = 0; c < 3; c++) reduced[(y * width + x) * 3 + c] = Math.round(sum[c] / ((x1 - x0) * (y1 - y0)));
    }
  }
  const visible = reduced.subarray(TOP_CUT * width * 3, (TOP_CUT + SCENE_H) * width * 3);
  const indexed = await sharp(visible, { raw: { width, height: SCENE_H, channels: 3 } })
    .png({ palette: true, colours: 24, dither: 0, effort: 10 }).toBuffer();
  const pixels = await sharp(indexed).removeAlpha().raw().toBuffer();
  const palette = [], paletteIndex = new Map(), tokens = [];
  for (let i = 0; i < pixels.length; i += 3) {
    const color = "#" + pixels.subarray(i, i + 3).toString("hex").toUpperCase();
    if (!paletteIndex.has(color)) {
      paletteIndex.set(color, palette.length);
      palette.push(color);
    }
    tokens.push(paletteIndex.get(color));
  }
  if (state === "coding") drawCode({ width, height: SCENE_H, palette, tokens });
  assert(width * SCENE_H < 10000, "keep individual scene assets below the guide's risk threshold");
  return { width, height: SCENE_H, palette, tokens };
}

// Palette reduction of the graded reference flattens the code lines on the
// monitor into the screen color. Redraw a legible code listing with two extra
// palette entries (dark keyword blocks, light text) so the scroll animation has
// something to move. Rows alternate indentation like real code.
function drawCode(scene) {
  const dark = scene.palette.push("#0C4F86") - 1;
  const light = scene.palette.push("#D9F6FF") - 1;
  assert(scene.palette.length <= 26);
  const screen = { x: 56, y: 20 - TOP_CUT, w: 23, h: 16 };
  const lines = [[0, 8], [2, 6], [2, 11], [4, 7], [2, 5], [0, 9], [2, 12], [4, 6]];
  lines.forEach(([indent, len], i) => {
    const y = screen.y + 1 + i * 2;
    for (let x = 0; x < len; x++) {
      const px = screen.x + 1 + indent + x;
      if (px >= screen.x + screen.w - 1) break;
      scene.tokens[y * scene.width + px] = x < 3 && indent === 0 ? dark : light;
    }
  });
}

// One animated window per scene: head, monitor and hands (source 40x32, drawn
// 80x64 at the same 2x scale as the scene, inside the firmware's 80x80 CBA
// buffer). Frames are edited copies of the scene pixels, so the overlay lands
// seamlessly on the static art underneath.
// Coordinates below are in the 120x72 reference frame; local() removes TOP_CUT.
const WIN = { x: 40, y: 13 - TOP_CUT, w: 40, h: 32 };
const FPS = 4;

function cutWindow(scene) {
  const out = [];
  for (let y = 0; y < WIN.h; y++) {
    for (let x = 0; x < WIN.w; x++) out.push(scene.tokens[(WIN.y + y) * scene.width + WIN.x + x]);
  }
  return out;
}

function local(sx, sy) { return { x: sx - WIN.x, y: sy - TOP_CUT - WIN.y }; }
function at(frame, x, y) { return frame[y * WIN.w + x]; }
function set(frame, x, y, index) { if (x >= 0 && x < WIN.w && y >= 0 && y < WIN.h) frame[y * WIN.w + x] = index; }

// Shift a rectangle by one pixel vertically; the row that scrolls in repeats
// its neighbour so no hole appears.
function shiftRect(frame, rect, dy) {
  const copy = frame.slice();
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const sy = Math.min(rect.y + rect.h - 1, Math.max(rect.y, y - dy));
      set(frame, x, y, at(copy, x, sy));
    }
  }
}

// Palette roles are derived from the pixels inside the monitor, so color
// grading changes do not need hard-coded hex values.
function screenColors(frame, rect) {
  const counts = new Map();
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) counts.set(at(frame, x, y), (counts.get(at(frame, x, y)) || 0) + 1);
  }
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return { dominant, count: (index) => counts.get(index) || 0 };
}
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function animateCoding(scene) {
  const base = cutWindow(scene);
  // Monitor interior (inside the bright bezel). The code text scrolls up one
  // pixel per frame and wraps, so 16 frames loop seamlessly over 16 rows.
  const screen = { ...local(55, 21), w: 25, h: 16 };
  const hand = { ...local(50, 39), w: 9, h: 5 };
  const frames = [];
  for (let f = 0; f < screen.h; f++) {
    const frame = base.slice();
    for (let y = 0; y < screen.h; y++) {
      const sy = screen.y + ((y + f) % screen.h);
      for (let x = screen.x; x < screen.x + screen.w; x++) set(frame, x, screen.y + y, at(base, x, sy));
    }
    if (f % 2 === 1) shiftRect(frame, hand, -1); // typing taps
    frames.push(frame);
  }
  return frames;
}

function animateIdle(scene) {
  const base = cutWindow(scene);
  const screen = { ...local(56, 21), w: 23, h: 15 };
  const body = { ...local(40, 18), w: 18, h: 19 };
  const colors = screenColors(base, screen);
  const screenBg = colors.dominant;
  // The face is the brightest color that actually appears on the screen.
  const bright = scene.palette
    .map((hex, index) => ({ index, lum: luminance(hex), n: colors.count(index) }))
    .filter((c) => c.n > 0 && c.index !== screenBg)
    .sort((a, b) => b.lum - a.lum)[0].index;
  // Collect the sleepy face pixels drawn on the screen, then let them drift
  // like a screensaver and blink once per loop.
  const face = [];
  for (let y = screen.y; y < screen.y + screen.h; y++) {
    for (let x = screen.x; x < screen.x + screen.w; x++) {
      if (at(base, x, y) === bright) { face.push({ x, y }); set(base, x, y, screenBg); }
    }
  }
  assert(face.length > 0, "idle screen face not found");
  const drift = [-3, -2, 0, 2, 3, 2, 0, -2];
  const FRAMES = drift.length;
  const frames = [];
  for (let f = 0; f < FRAMES; f++) {
    const frame = base.slice();
    const dx = drift[f];
    const dy = f >= 3 && f <= 5 ? 1 : 0;
    for (const p of face) {
      const y = p.y + dy;
      if (f === 6) {
        // blink: collapse the face to its middle row
        const mid = Math.round(face.reduce((s, q) => s + q.y, 0) / face.length) + dy;
        set(frame, p.x + dx, mid, bright);
      } else if (x_in(p.x + dx, screen) && y < screen.y + screen.h) {
        set(frame, p.x + dx, y, bright);
      }
    }
    if (f >= 4) shiftRect(frame, body, 1); // slow breathing
    frames.push(frame);
  }
  return frames;
}

function x_in(x, rect) { return x >= rect.x && x < rect.x + rect.w; }

const backdrop = Array(60 * 60).fill(0);
// A full-canvas static background with restrained header/scene separators.
for (const y of [4, 32]) for (let x = 0; x < 60; x++) backdrop[y * 60 + x] = 1;
const idle = await compileScene("idle");
const coding = await compileScene("coding");
const assets = [
  { name: "to-bg.cbi", data: encodeSprite(60, 60, ["#0E0C1E", "#3A2F5C"], backdrop) },
  { name: "to-i.cbi", data: encodeSprite(idle.width, idle.height, idle.palette, idle.tokens) },
  { name: "to-c.cbi", data: encodeSprite(coding.width, coding.height, coding.palette, coding.tokens) },
  { name: "to-ia.cba", data: encodeAnimation(WIN.w, WIN.h, FPS, idle.palette, animateIdle(idle)) },
  { name: "to-ca.cba", data: encodeAnimation(WIN.w, WIN.h, FPS, coding.palette, animateCoding(coding)) },
];
const hash = (data) => createHash("sha256").update(data).digest("hex");
for (const asset of assets) {
  await writeFile(path.join(packDir, "assets", asset.name), asset.data);
}
const specBytes = await readFile(path.join(packDir, "theme.json"));
const spec = JSON.parse(specBytes);
assert.equal(spec.id, "tiny-office");
assert(specBytes.length < 2048);
assert(spec.p.length < 16);
const manifest = {
  kind: "vibetv-theme-pack", schemaVersion: 1, id: "tiny-office", name: "Tiny Office",
  version: "0.5.0", minFirmware: "1.0.40", usage: "live", requiredCapabilities: ["usage-slots-v1"],
  themeSpec: {
    path: `/themes/u/to-${spec.rev}-${hash(specBytes).slice(0, 8)}.json`, file: "theme.json",
    bytes: specBytes.length, sha256: hash(specBytes), contentType: "application/json",
  },
  assets: assets.map(({ name, data }) => ({
    path: `/themes/u/${name}`, file: `assets/${name}`, bytes: Buffer.byteLength(data),
    sha256: hash(data), contentType: "text/plain",
  })),
};
assert(manifest.themeSpec.path.length <= 31);
await writeFile(path.join(packDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Tiny Office: ${specBytes.length} ThemeSpec bytes, ${spec.p.length} primitives, ${assets.length} assets (2 animated)`);
