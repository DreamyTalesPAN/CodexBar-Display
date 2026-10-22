import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  buildFrameData, decodeSprite, primitiveUsageSlotVisible, renderTextPrimitive,
  themeFirmwareTextMetrics, themeTextAlignedY, themeTextFit, themeTextValignBoxHeight,
  type FrameData, type ThemePrimitive, type ThemeRenderPack,
} from "@/components/live-vibetv-preview";

const root = path.resolve(process.cwd(), "../..");
const renderDir = path.join(root, "dist/theme-packs/render");
const themeIds = readdirSync(renderDir).filter((file) => file.endsWith(".json")).map((file) => file.slice(0, -5));
const clock = new Date("2026-10-22T12:00:00Z");
const PACE_TICK_OVERHANG = 3; // kPaceTickOverhang in usage_window_contract.h

type Rect = { x: number; y: number; w: number; h: number };
const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const show = (r: Rect) => `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}x${Math.round(r.h)}`;

// The rows of a glyph cell that carry ink in TFT_eSPI 2.5.43 Font16 (font 2) and Font32rle (font 4): caps, digits and
// ascenders reach the top, lowercase without ascenders starts at the x-height, g j p q y and brackets reach the
// descender. GLCD (font 1) fills its 8 rows. Within one row of the real glyphs.
function inkRows(text: string, font: number): [number, number] {
  if (font === 1) return [0, 7];
  const tall = /[^aceimnorsuvwxz ]/.test(text) ? (font === 4 ? 1 : 3) : 6;
  const low = /[gjpqy,;()[\]{}|]/.test(text) ? (font === 4 ? 24 : 15) : (font === 4 ? 18 : 12);
  return [tall, low];
}

// What the text of a primitive paints: the cell width of the fitted lines, the rows that carry ink.
function textInk(p: ThemePrimitive, text: string): Rect {
  const maxSize = p.s ?? 1, lane = p.w ?? 0;
  const { font, size, lines } = themeTextFit(text, p.f ?? 1, maxSize, lane, p.ft === "shrink", p.h ?? 0);
  const cell = (font === 4 ? 26 : font === 2 ? 16 : 8) * size;
  const width = Math.max(...lines.map((line) => themeFirmwareTextMetrics(line, font, size)?.width ?? line.length * cell * 0.6));
  const x = (p.x ?? 0) + (p.al === "right" ? lane - width : p.al === "center" ? (lane - width) / 2 : 0);
  const y = themeTextAlignedY(p.y ?? 0, themeTextValignBoxHeight(p.h ?? 0, p.f ?? 1, maxSize), cell * lines.length, p.va);
  const top = y + inkRows(lines[0], font)[0] * size;
  const bottom = y + cell * (lines.length - 1) + (inkRows(lines[lines.length - 1], font)[1] + 1) * size;
  return { x, y: top, w: width, h: bottom - top };
}

// Dividers painted into a static background sprite (Clippy's etched line): a band of at most 8 px, at least 40 px
// long, between two rows of one and the same plain colour. Scene art does not have this shape.
function bakedDividers(pack: ThemeRenderPack): Rect[] {
  return (pack.spec?.p ?? []).flatMap((p) => {
    if (p.t !== "sp") return [];
    return [...new Set([p.a, ...Object.values(p.sa ?? {})])].flatMap((assetPath) => {
      const asset = assetPath ? pack.assets?.[assetPath] : undefined;
      const sprite = asset?.data.startsWith("CBI1") ? decodeSprite(asset.data) : null;
      if (!sprite) return [];
      const sx = (p.w ?? sprite.width) / sprite.width, sy = (p.h ?? sprite.height) / sprite.height;
      const rows = new Map<number, typeof sprite.frames[0]>();
      for (const run of sprite.frames[0]) rows.set(run.y, [...(rows.get(run.y) ?? []), run]);
      const cover = (row: number, x0: number, x1: number) => rows.get(row)?.find((run) => run.x <= x0 && run.x + run.width >= x1);
      return sprite.frames[0].flatMap((run) => {
        const x1 = run.x + run.width, plain = cover(run.y - 1, run.x, x1);
        if (run.width * sx < 40 || !plain || plain.color === run.color) return [];
        let end = run.y;
        while ((end - run.y + 2) * sy <= 8 && cover(end + 1, run.x, x1) && cover(end + 1, run.x, x1)?.color !== plain.color) end++;
        return cover(end + 1, run.x, x1)?.color === plain.color
          ? [{ x: (p.x ?? 0) + run.x * sx, y: (p.y ?? 0) + run.y * sy, w: run.width * sx, h: (end - run.y + 1) * sy }] : [];
      });
    });
  });
}

// The colour the first background sprite (a full-screen CBI) paints under a pixel; rows and columns map the way the
// device scales a sprite: sprite row r covers the pixels floor(r*H/h) up to floor((r+1)*H/h).
function backgroundColourAt(pack: ThemeRenderPack): (x: number, y: number) => string | undefined {
  const p = (pack.spec?.p ?? []).find((q) => q.t === "sp" && q.a?.endsWith(".cbi") && (q.w ?? 0) >= 200 && (q.h ?? 0) >= 200);
  const asset = p?.a ? pack.assets?.[p.a] : undefined;
  const sprite = asset?.data.startsWith("CBI1") ? decodeSprite(asset.data) : null;
  if (!p || !sprite) return () => undefined;
  const at = (v: number, size: number, spriteSize: number) => Math.ceil(((v + 1) * spriteSize) / size) - 1;
  return (x, y) => {
    const col = at(x - (p.x ?? 0), p.w ?? 0, sprite.width), row = at(y - (p.y ?? 0), p.h ?? 0, sprite.height);
    return sprite.frames[0].find((run) => run.y === row && run.x <= col && col < run.x + run.width)?.color;
  };
}

// Sum of the channel differences of two #RRGGBB colours: a frame line of #141418 on #0A0A0B is not an edge anyone sees.
const contrast = (a: string, b: string) => [1, 3, 5].reduce((sum, i) => sum + Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)), 0);

function frameFor(two: boolean, usageMode: string, pace: boolean, footer: number | undefined): FrameData {
  const ids = two ? ["claude:session", "codex:weekly"] : ["session", "weekly"];
  const labels = two ? ["Claude Session", "Codex Weekly"] : ["Session", "Weekly"];
  const widest = { delta: -14, state: "reserve", lasts: true }; // "14% reserve", the widest pace text of two digits
  return buildFrameData(clock.toISOString(), {
    provider: two ? "claude+codex" : "claude", label: two ? "" : "Claude", usageMode, resetSecs: 9100,
    footerWindow: footer === undefined ? undefined : ids[footer],
    usageWindows: ids.map((id, i) => ({
      id, label: labels[i], percent: usageMode === "used" ? 100 - [73, 43][i] : [73, 43][i],
      resetSecs: [9100, 424000][i], pace: pace ? widest : undefined,
    })),
    sessionTokens: 1234567, weekTokens: 98765432, totalTokens: 987654321, tokenTotalsKnown: true,
  }, clock);
}

const loadPack = (themeId: string) => JSON.parse(readFileSync(path.join(renderDir, `${themeId}.json`), "utf8")) as ThemeRenderPack;

// The box the firmware repaints on every animation tick: a GIF, or a sprite with a CBA asset.
const animationBoxes = (pack: ThemeRenderPack) => (pack.spec?.p ?? [])
  .filter((p) => p.t === "g" || (p.t === "sp" && [p.a, ...Object.values(p.sa ?? {})].some((a) => a?.endsWith(".cba"))))
  .map((p) => ({ name: p.a ?? "", x: p.x ?? 0, y: p.y ?? 0, w: p.w ?? 0, h: p.h ?? 0 }));

function layoutViolations(pack: ThemeRenderPack): string[] {
  const prims = pack.spec?.p ?? [];
  const animations = animationBoxes(pack);
  const backgroundAt = backgroundColourAt(pack);
  const dividers = [
    ...prims.filter((p) => p.t === "r" && Math.min(p.w ?? 0, p.h ?? 0) <= 4).map((p) => ({ x: p.x ?? 0, y: p.y ?? 0, w: p.w ?? 0, h: p.h ?? 0 })),
    ...bakedDividers(pack),
  ];
  const found = new Map<string, string>();
  for (const two of [false, true]) for (const usageMode of ["used", "remaining"]) for (const pace of [false, true]) {
    for (const footer of [undefined, 0, 1]) {
      const state = `${two ? "Two at once" : "One provider"}, ${usageMode}, pace ${pace ? "on" : "off"}, footer ${footer === undefined ? "off" : footer}`;
      const frame = frameFor(two, usageMode, pace, footer);
      const texts = prims.filter((p) => p.t === "tx" && primitiveUsageSlotVisible(p, frame))
        .map((p) => ({ text: renderTextPrimitive(p, frame, prims), p })).filter(({ text }) => text.trim())
        .map(({ text, p }) => ({ text, ...textInk(p, text) }));
      const bars = prims.filter((p) => p.t === "p" && primitiveUsageSlotVisible(p, frame)).map((p) => {
        const o = pace && (p.b ?? "").includes("Pace") ? PACE_TICK_OVERHANG : 0;
        return { x: (p.x ?? 0) - o, y: (p.y ?? 0) - o, w: (p.w ?? 0) + 2 * o, h: (p.h ?? 0) + 2 * o };
      });
      const note = (key: string, detail: string) => found.has(key) || found.set(key, `${detail} (first in: ${state})`);
      for (const a of animations) {
        for (const t of texts) if (hit(a, t)) note(`${a.name} x "${t.text}"`, `animation ${a.name} [${show(a)}] overlaps text "${t.text}" [${show(t)}]`);
        for (const b of bars) if (hit(a, b)) note(`${a.name} x bar ${show(b)}`, `animation ${a.name} [${show(a)}] overlaps a bar [${show(b)}]`);
        for (const d of dividers) if (hit(a, d)) note(`${a.name} x divider ${show(d)}`, `animation ${a.name} [${show(a)}] overlaps a divider [${show(d)}]`);
      }
      // A glyph that starts on one flat band of the background and ends on another (a descender below the title bar);
      // the ink rect is within one row of the real glyphs, so the rows next to its edges stay out of it.
      for (const t of texts) {
        const cols = [t.x + 1, t.x + t.w / 2, t.x + t.w - 2].map(Math.floor);
        const top = cols.map((x) => backgroundAt(x, t.y + 1)), bottom = cols.map((x) => backgroundAt(x, t.y + t.h - 2));
        if (top[0] && bottom[0] && top.every((c) => c === top[0]) && bottom.every((c) => c === bottom[0]) && contrast(top[0], bottom[0]) >= 96) {
          note(`"${t.text}" crosses a band edge`, `text "${t.text}" [${show(t)}] starts on ${top[0]} and ends on ${bottom[0]}, across the edge of a background band`);
        }
      }
      texts.forEach((a, i) => texts.slice(i + 1).forEach((b) => {
        if (hit(a, b)) note(`"${a.text}" x "${b.text}"`, `text "${a.text}" [${show(a)}] overlaps text "${b.text}" [${show(b)}]`);
      }));
    }
  }
  return [...found.values()];
}

describe("animations, dividers, bars and text of every catalog theme stay apart", () => {
  it("covers the animated themes", () => {
    const animated = themeIds.filter((id) => animationBoxes(loadPack(id)).length > 0);
    expect(animated).toEqual(expect.arrayContaining(["claude-creature", "clippy", "mini-classic", "tiny-office", "token-fire"]));
  });

  it.each(themeIds)("%s: no animation box on a divider, text or bar, no two texts on each other, no glyph across a band edge", (themeId) => {
    expect(layoutViolations(loadPack(themeId))).toEqual([]);
  });
});
