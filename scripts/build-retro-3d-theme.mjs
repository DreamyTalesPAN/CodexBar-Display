#!/usr/bin/env node
// Render the Retro 3D screensaver sprite: one glossy torus that flips about a
// tilted axis. There is no source artwork; every pixel comes from the shading
// below. node scripts/build-retro-3d-theme.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packDir = path.join(root, "theme-packs/retro-3d");

// 40x40 drawn 2x fills the firmware's 80x80 animated-sprite box, and 20 frames
// stay inside Theme Studio's 32768-pixel budget for one animated sprite.
const SIZE = 40, FRAMES = 20, FPS = 6, SAMPLES = 4;
const RING = 0.6, TUBE = 0.3;
// Brightness stops of the plastic: background, shadow, body, lit, highlight.
// Entry 0 is the black background, so an anti-aliased edge is just a darker
// step of the same ramp and one palette of 25 colours covers every frame.
const RAMP = [[0, [0, 0, 0]], [0.12, [0, 18, 96]], [0.45, [0, 112, 255]], [0.72, [72, 220, 255]], [1, [255, 255, 255]]];
const SHADES = 24;

function rotate([x, y, z], axis, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  if (axis === "x") return [x, c * y - s * z, s * y + c * z];
  if (axis === "y") return [c * x + s * z, y, c * z - s * x];
  return [c * x - s * y, s * x + c * y, z];
}
const unit = (v) => v.map((c) => c / Math.hypot(...v));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Screen space to torus space. The torus flips about its own X axis, which is
// tilted out of the screen plane so the ring never faces the viewer head-on. A
// torus looks the same after half a turn, so the frames only cover 180 degrees
// and the loop closes without a jump. Frame 0 is a three-quarter view, because
// that is the frame a static preview shows.
const toTorus = (v, frame) =>
  rotate(rotate(rotate(v, "y", -0.5), "z", -0.45), "x", -Math.PI * (frame / FRAMES + 0.15));

const LIGHT = unit([-0.55, 0.65, 0.75]);
const HALFWAY = unit([LIGHT[0], LIGHT[1], LIGHT[2] + 1]); // between the light and the viewer on +z

function renderFrame(frame) {
  const ray = toTorus([0, 0, -1], frame), light = toTorus(LIGHT, frame), halfway = toTorus(HALFWAY, frame);
  const brightness = (x, y) => {
    const origin = toTorus([x, y, 2], frame);
    for (let travelled = 0, step = 0; step < 64 && travelled < 4; step++) {
      const p = origin.map((c, i) => c + ray[i] * travelled);
      const fromAxis = Math.hypot(p[0], p[2]);
      const distance = Math.hypot(fromAxis - RING, p[1]) - TUBE;
      if (distance < 0.002) {
        const normal = unit([p[0] * (1 - RING / fromAxis), p[1], p[2] * (1 - RING / fromAxis)]);
        return Math.min(1, 0.14 + 0.6 * Math.max(0, dot(normal, light)) + 0.75 * Math.max(0, dot(normal, halfway)) ** 40);
      }
      travelled += distance;
    }
    return 0;
  };
  const tokens = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let sum = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          sum += brightness(((x + (sx + 0.5) / SAMPLES) / SIZE) * 2 - 1, 1 - ((y + (sy + 0.5) / SAMPLES) / SIZE) * 2);
        }
      }
      tokens.push(Math.round((sum / SAMPLES ** 2) * SHADES));
    }
  }
  return tokens;
}

function rampColor(t) {
  const upper = RAMP.findIndex(([stop]) => t <= stop) || 1;
  const [t0, c0] = RAMP[upper - 1], [t1, c1] = RAMP[upper];
  return "#" + c0.map((c, i) => Math.round(c + ((c1[i] - c) * (t - t0)) / (t1 - t0)).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function encodeRows(tokens) {
  const rows = [];
  for (let y = 0; y < SIZE; y++) {
    let row = "";
    for (let x = 0; x < SIZE;) {
      const index = tokens[y * SIZE + x];
      let count = 1;
      while (x + count < SIZE && tokens[y * SIZE + x + count] === index) count++;
      row += (count > 1 ? String(count) : "") + String.fromCharCode(97 + index);
      x += count;
    }
    rows.push(row);
  }
  return rows;
}

const palette = Array.from({ length: SHADES + 1 }, (_, i) => rampColor(i / SHADES));
assert(palette.length <= 26 && SIZE * SIZE * FRAMES <= 32768 && FPS <= 8);
const rows = Array.from({ length: FRAMES }, (_, frame) => encodeRows(renderFrame(frame))).flat();
const sprite = ["CBA1", `${SIZE} ${SIZE} ${FRAMES} ${FPS}`, String(palette.length), ...palette, ...rows, ""].join("\n");
const asset = { name: "r3d-spin.cba", data: sprite };

await mkdir(path.join(packDir, "assets"), { recursive: true });
await writeFile(path.join(packDir, "assets", asset.name), asset.data);
const hash = (data) => createHash("sha256").update(data).digest("hex");
const specBytes = await readFile(path.join(packDir, "theme.json"));
const spec = JSON.parse(specBytes);
assert.equal(spec.id, "retro-3d");
assert(specBytes.length < 2048, "screensaver ThemeSpecs are capped at 2048 bytes");
const manifest = {
  kind: "vibetv-theme-pack", schemaVersion: 1, id: "retro-3d", name: "Retro 3D",
  version: "0.1.0", minFirmware: "1.0.40", usage: "screensaver", requiredCapabilities: ["usage-slots-v1"],
  themeSpec: {
    path: `/themes/s/r3d-${spec.rev}-${hash(specBytes).slice(0, 8)}.json`, file: "theme.json",
    bytes: specBytes.length, sha256: hash(specBytes), contentType: "application/json",
  },
  assets: [{
    path: `/themes/s/${asset.name}`, file: `assets/${asset.name}`, bytes: Buffer.byteLength(asset.data),
    sha256: hash(asset.data), contentType: "text/plain",
  }],
};
assert(manifest.themeSpec.path.length <= 31);
await writeFile(path.join(packDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Retro 3D: ${specBytes.length} ThemeSpec bytes, ${spec.p.length} primitives, ${FRAMES} frames at ${FPS} fps, ${Buffer.byteLength(asset.data)} sprite bytes`);
