#!/usr/bin/env node
// Original, procedural artwork: three glossy pebbles orbit in a tilted plane.
// No source images or third-party assets. Rebuild with this script, then
// scripts/build-theme-packs.mjs; the device uses the existing CBA renderer.
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "theme-packs/orbit-pebbles");
const size = 32, count = 32, fps = 8;
const bases = [[24, 162, 230], [235, 61, 121], [246, 172, 42]];
const palette = ["#000000", ...bases.flatMap((base) =>
  Array.from({ length: 8 }, (_, i) => "#" + base.map((c) => {
    const lit = c * (0.18 + 0.82 * Math.min(i / 5, 1));
    return Math.round(lit + (255 - lit) * Math.max(0, (i - 5) / 2))
      .toString(16).padStart(2, "0");
  }).join("")).map((c) => c.toUpperCase()))];

function frame(index) {
  const angle = index / count * Math.PI * 2;
  const balls = bases.map((_, i) => {
    const t = angle + i * Math.PI * 2 / 3;
    return [0.62 * Math.cos(t), 0.44 * Math.sin(t), 0.46 * Math.sin(t)];
  });
  return Array.from({ length: size * size }, (_, pixel) => {
    const x = ((pixel % size) + 0.5) / size * 2 - 1;
    const y = 1 - (Math.floor(pixel / size) + 0.5) / size * 2;
    let closest = -Infinity, color = 0;
    balls.forEach(([cx, cy, cz], ball) => {
      const radius = 0.28;
      const nx = (x - cx) / radius, ny = (y - cy) / radius;
      const square = 1 - nx * nx - ny * ny;
      if (square <= 0) return;
      const nz = Math.sqrt(square), depth = cz + radius * nz;
      if (depth <= closest) return;
      closest = depth;
      const diffuse = Math.max(0, -0.42 * nx + 0.56 * ny + 0.714 * nz);
      const gloss = Math.max(0, -0.23 * nx + 0.30 * ny + 0.926 * nz) ** 32;
      color = 1 + ball * 8 + Math.min(7, Math.round(diffuse * 5 + gloss * 3));
    });
    return color;
  });
}

function rows(pixels) {
  return Array.from({ length: size }, (_, y) => {
    let row = "";
    for (let x = 0; x < size;) {
      const color = pixels[y * size + x];
      let run = 1;
      while (x + run < size && pixels[y * size + x + run] === color) run++;
      row += (run > 1 ? run : "") + String.fromCharCode(97 + color);
      x += run;
    }
    return row;
  });
}

const animation = ["CBA1", `${size} ${size} ${count} ${fps}`, palette.length,
  ...palette, ...Array.from({ length: count }, (_, i) => rows(frame(i))).flat(), ""].join("\n");
const spec = JSON.stringify({ v: 1, id: "orbit-pebbles", rev: 2, bg: "#000000",
  p: [{ t: "sp", x: 80, y: 80, w: 80, h: 80, bg: "#000000", a: "/themes/s/op-orbit.cba" }],
}) + "\n";
const hash = (text) => createHash("sha256").update(text).digest("hex");
const manifest = {
  kind: "vibetv-theme-pack", schemaVersion: 1, id: "orbit-pebbles", name: "Orbit Pebbles",
  version: "0.1.0", minFirmware: "1.0.40", usage: "screensaver",
  requiredCapabilities: ["usage-slots-v1"],
  themeSpec: { path: `/themes/s/op-2-${hash(spec).slice(0, 8)}.json`, file: "theme.json",
    bytes: Buffer.byteLength(spec), sha256: hash(spec), contentType: "application/json" },
  assets: [{ path: "/themes/s/op-orbit.cba", file: "assets/op-orbit.cba",
    bytes: Buffer.byteLength(animation), sha256: hash(animation), contentType: "text/plain" }],
};
await mkdir(path.join(dir, "assets"), { recursive: true });
await writeFile(path.join(dir, "assets/op-orbit.cba"), animation);
await writeFile(path.join(dir, "theme.json"), spec);
await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Orbit Pebbles: ${count} frames, ${count / fps}s loop, ${Buffer.byteLength(animation)} bytes`);
