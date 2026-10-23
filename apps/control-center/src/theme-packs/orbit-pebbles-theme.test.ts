import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { importThemeSpec, validateThemeSpec } from "@/lib/theme-studio";

const root = path.resolve(process.cwd(), "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const source = "theme-packs/orbit-pebbles/";
const manifest = JSON.parse(read(source + "manifest.json"));
const spec = JSON.parse(read(source + "theme.json"));
const pack = JSON.parse(read("dist/theme-packs/render/orbit-pebbles.json"));
const lines = read(source + manifest.assets[0].file).trim().split("\n");
const [width, height, count, fps] = lines[1].split(" ").map(Number);
const paletteSize = Number(lines[2]);
const rows = lines.slice(3 + paletteSize).map((line) => {
  const pixels: number[] = [];
  for (const match of line.matchAll(/(\d*)([a-z])/g)) {
    pixels.push(...Array(Number(match[1] || 1)).fill(match[2].charCodeAt(0) - 97));
  }
  return pixels;
});
const frames = Array.from({ length: count }, (_, i) => rows.slice(i * height, (i + 1) * height).flat());

describe("Orbit Pebbles screensaver", () => {
  it("uses the existing screensaver slot and passes Studio validation", () => {
    expect(manifest.usage).toBe("screensaver");
    expect(manifest.themeSpec.path).toMatch(/^\/themes\/s\//);
    expect(manifest.assets.every((asset: { path: string }) => asset.path.startsWith("/themes/s/"))).toBe(true);
    expect(validateThemeSpec(importThemeSpec(spec), pack.assets, "screensaver").errors).toEqual([]);
    const catalog = JSON.parse(read("dist/theme-packs/vibetv-theme-packs-v2.json"));
    expect(catalog.themes.find((theme: { id: string }) => theme.id === manifest.id)?.usage).toBe("screensaver");
  });

  it("keeps one animated region within the device and repaint budgets", () => {
    expect(spec.p).toHaveLength(1);
    const sprite = spec.p[0];
    expect(sprite.t).toBe("sp");
    expect(sprite.a).toBe(manifest.assets[0].path);
    expect(sprite.w).toBeLessThanOrEqual(80);
    expect(sprite.h).toBeLessThanOrEqual(80);
    expect(sprite.x + sprite.w).toBeLessThanOrEqual(240);
    expect(sprite.y + sprite.h).toBeLessThanOrEqual(240);
    expect(sprite.w * sprite.h * fps).toBeLessThanOrEqual(51200);
    expect(width * height * count).toBeLessThanOrEqual(32768);
    expect(paletteSize).toBeLessThanOrEqual(26);
    expect(rows).toHaveLength(height * count);
    expect(rows.every((row) => row.length === width && row.every((pixel) => pixel < paletteSize))).toBe(true);
  });

  it("has no permanently lit pixels and no larger motion jump at the seam", () => {
    expect(count).toBeGreaterThan(1);
    expect(fps).toBeGreaterThan(0);
    expect(new Set(frames.map((pixels) => pixels.join(","))).size).toBe(count);
    expect(frames[0].every((_, pixel) => frames.some((frame) => frame[pixel] === 0))).toBe(true);
    const changes = frames.map((frame, i) => frame.filter((pixel, j) => pixel !== frames[(i + 1) % count][j]).length);
    expect(changes[count - 1]).toBeGreaterThan(0);
    expect(changes[count - 1]).toBeLessThanOrEqual(Math.max(...changes.slice(0, -1)));
  });

  it("publishes the exact source spec and animation with matching hashes", () => {
    for (const asset of [manifest.themeSpec, ...manifest.assets]) {
      const data = read(source + asset.file);
      expect(Buffer.byteLength(data)).toBe(asset.bytes);
      expect(createHash("sha256").update(data).digest("hex")).toBe(asset.sha256);
    }
    expect(pack.spec).toEqual(spec);
    expect(pack.assets[manifest.assets[0].path].data).toBe(read(source + manifest.assets[0].file));
  });
});
