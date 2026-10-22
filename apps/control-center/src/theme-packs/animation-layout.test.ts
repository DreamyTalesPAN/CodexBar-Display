import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  buildFrameData, decodeSprite, primitiveUsageSlotVisible, renderTextPrimitive,
  themeTextFit,
  type FrameData, type ThemePrimitive, type ThemeRenderPack,
} from "@/components/live-vibetv-preview";
import { cellHeight, textInk, type Rect } from "./text-ink";

const root = path.resolve(process.cwd(), "../..");
const renderDir = path.join(root, "dist/theme-packs/render");
const themeIds = readdirSync(renderDir).filter((file) => file.endsWith(".json")).map((file) => file.slice(0, -5));
const clock = new Date("2026-10-22T12:00:00Z");
const PACE_TICK_OVERHANG = 3; // kPaceTickOverhang in usage_window_contract.h

const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const show = (r: Rect) => `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}x${Math.round(r.h)}`;

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

// The colour every pixel of the screen shows from the static sprites (CBI) of a theme, painted in spec order; a pixel no
// sprite paints shows the spec background. A sprite row r covers the pixels floor(r*H/h) up to floor((r+1)*H/h), the way
// the device scales a sprite.
function staticArt(pack: ThemeRenderPack): (x: number, y: number) => string {
  const screen: string[] = new Array(240 * 240).fill(pack.spec?.bg ?? "#000000");
  for (const p of pack.spec?.p ?? []) {
    const asset = p.t === "sp" && p.a?.endsWith(".cbi") ? pack.assets?.[p.a] : undefined;
    const sprite = asset?.data.startsWith("CBI1") ? decodeSprite(asset.data) : null;
    if (!sprite) continue;
    const colours: string[] = new Array(sprite.width * sprite.height);
    for (const run of sprite.frames[0]) colours.fill(run.color, run.y * sprite.width + run.x, run.y * sprite.width + run.x + run.width);
    const at = (v: number, size: number, spriteSize: number) => Math.ceil(((v + 1) * spriteSize) / size) - 1;
    for (let y = p.y ?? 0; y < (p.y ?? 0) + (p.h ?? 0); y++) for (let x = p.x ?? 0; x < (p.x ?? 0) + (p.w ?? 0); x++) {
      const colour = colours[at(y - (p.y ?? 0), p.h ?? 0, sprite.height) * sprite.width + at(x - (p.x ?? 0), p.w ?? 0, sprite.width)];
      if (colour && x < 240 && y < 240) screen[y * 240 + x] = colour;
    }
  }
  return (x, y) => screen[y * 240 + x];
}

// Art within 2 px (CLEAR - 1) of a text, or under it: frame lines, stripes, battery outlines, a mantel. Only where the text stands on a
// flat background (at most a fifth of its box and ring is another colour); text over a picture is left to the band edge check.
function artNearText(t: Rect, artAt: (x: number, y: number) => string): string | undefined {
  const x0 = Math.max(0, Math.round(t.x)), y0 = Math.max(0, Math.round(t.y)), x1 = Math.min(239, Math.round(t.x + t.w) - 1), y1 = Math.min(239, Math.round(t.y + t.h) - 1);
  const counts = new Map<string, number>();
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) counts.set(artAt(x, y), (counts.get(artAt(x, y)) ?? 0) + 1);
  const flat = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (flat[1] < 0.8 * (x1 - x0 + 1) * (y1 - y0 + 1)) return undefined;
  for (let y = Math.max(0, y0 - CLEAR); y <= Math.min(239, y1 + CLEAR); y++) for (let x = Math.max(0, x0 - CLEAR); x <= Math.min(239, x1 + CLEAR); x++) {
    const corner = (x < x0 || x > x1) && (y < y0 || y > y1);
    if (!corner && artAt(x, y) !== flat[0]) return `${artAt(x, y)} at ${x},${y}`;
  }
  return undefined;
}

// Sum of the channel differences of two #RRGGBB colours: a frame line of #141418 on #0A0A0B is not an edge anyone sees.
const contrast = (a: string, b: string) => [1, 3, 5].reduce((sum, i) => sum + Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)), 0);

// The three pace sentences; "On pace" carries a descender (p), the others none.
const PACES = {
  reserve: { delta: -14, state: "reserve", lasts: true }, // "14% reserve", the widest of two digits
  deficit: { delta: 33, state: "deficit", lasts: false },
  "on pace": { delta: 0, state: "on pace", lasts: true },
};
type PaceName = keyof typeof PACES;

function frameFor(two: boolean, usageMode: string, pace: PaceName | undefined, footer: number | undefined, percents?: number[], weeklySecs = 424000): FrameData {
  const ids = two ? ["claude:session", "codex:weekly"] : ["session", "weekly"];
  const labels = two ? ["Claude Session", "Codex Weekly"] : ["Session", "Weekly"];
  return buildFrameData(clock.toISOString(), {
    provider: two ? "claude+codex" : "claude", label: two ? "" : "Claude", usageMode, resetSecs: 9100,
    footerWindow: footer === undefined ? undefined : ids[footer],
    usageWindows: ids.map((id, i) => ({
      id, label: labels[i], percent: percents?.[i] ?? [73, 100][i], // the widest number in the second limit
      resetSecs: [9100, weeklySecs][i], pace: pace ? PACES[pace] : undefined,
    })),
    sessionTokens: 1234567, weekTokens: 98765432, totalTokens: 987654321, tokenTotalsKnown: true,
  }, clock);
}

const loadPack = (themeId: string) => JSON.parse(readFileSync(path.join(renderDir, `${themeId}.json`), "utf8")) as ThemeRenderPack;

// The box the firmware repaints on every animation tick: a GIF, or a sprite with a CBA asset.
const animationBoxes = (pack: ThemeRenderPack) => (pack.spec?.p ?? [])
  .filter((p) => p.t === "g" || (p.t === "sp" && [p.a, ...Object.values(p.sa ?? {})].some((a) => a?.endsWith(".cba"))))
  .map((p) => ({ name: p.a ?? "", x: p.x ?? 0, y: p.y ?? 0, w: p.w ?? 0, h: p.h ?? 0 }));

const source = (p: ThemePrimitive) => `${p.b ?? ""}${p.v ?? ""}`;
const slotOf = (p: ThemePrimitive) => p.sl ?? p.slot;
// Empty pixel rows between two boxes, 0 when they touch, also 0 when they share rows.
const verticalGap = (a: Rect, b: Rect) => Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h), 0);
// Empty pixels between two boxes that face each other (rows when they share columns, columns when they share rows), -1 when
// they overlap, undefined when they only meet diagonally.
function facingGap(a: Rect, b: Rect): number | undefined {
  const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w)), dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  return dx < 0 && dy < 0 ? -1 : dx < 0 ? dy : dy < 0 ? dx : undefined;
}
const CLEAR = 3; // px an animation box, a divider or a frame line keeps from a text

// A bar with the art that frames it (Pixel Battery's outline): the body grown down over every row that is not the flat
// colour just above the text beneath it.
function framed(body: Rect, below: Rect, artAt: (x: number, y: number) => string): Rect {
  const flat = artAt(Math.round(below.x + below.w / 2), Math.max(0, Math.round(below.y) - 1));
  let bottom = body.y + body.h;
  while (bottom < below.y && Array.from({ length: body.w }, (_, i) => artAt(body.x + i, bottom)).some((colour) => colour !== flat)) bottom++;
  return { ...body, h: bottom - body.y };
}

// The vertical rhythm of a screen: boxes that share pixel rows are one row (a value beside its bar), the gaps are the
// empty pixel rows between neighbouring rows.
function rowGaps(items: Array<Rect & { name: string }>) {
  const rows: Array<{ top: number; bottom: number; names: string[] }> = [];
  for (const item of [...items].sort((a, b) => a.y - b.y)) {
    const last = rows[rows.length - 1];
    if (last && item.y < last.bottom) {
      last.bottom = Math.max(last.bottom, item.y + item.h);
      last.names.push(item.name);
    } else rows.push({ top: item.y, bottom: item.y + item.h, names: [item.name] });
  }
  return rows.slice(1).map((row, i) => ({ gap: row.top - rows[i].bottom, above: rows[i].names.join(" + "), below: row.names.join(" + ") }));
}

function layoutViolations(pack: ThemeRenderPack): string[] {
  const prims = pack.spec?.p ?? [];
  const animations = animationBoxes(pack);
  const artAt = staticArt(pack);
  const dividers = [
    ...prims.filter((p) => p.t === "r" && Math.min(p.w ?? 0, p.h ?? 0) <= 4).map((p) => ({ x: p.x ?? 0, y: p.y ?? 0, w: p.w ?? 0, h: p.h ?? 0 })),
    ...bakedDividers(pack),
  ];
  const found = new Map<string, string>();
  for (const two of [false, true]) for (const usageMode of ["used", "remaining"]) for (const pace of [undefined, ...(Object.keys(PACES) as PaceName[])]) {
    // The weekly footer also with minutes ("Weekly reset 47m"), the widest sentence with a descender.
    for (const [footer, weeklySecs] of [[undefined, 424000], [0, 424000], [1, 424000], [1, 2820]] as const) {
      const state = `${two ? "Two at once" : "One provider"}, ${usageMode}, pace ${pace ?? "off"}, footer ${footer === undefined ? "off" : `${footer} (${weeklySecs} s)`}`;
      const frame = frameFor(two, usageMode, pace, footer, undefined, weeklySecs);
      const texts = prims.filter((p) => p.t === "tx" && primitiveUsageSlotVisible(p, frame))
        .map((p) => ({ text: renderTextPrimitive(p, frame, prims), p })).filter(({ text }) => text.trim())
        .map(({ text, p }) => ({ text, p, ...textInk(p, text) }));
      const bars = prims.filter((p) => p.t === "p" && primitiveUsageSlotVisible(p, frame)).map((p) => {
        const o = pace && (p.b ?? "").includes("Pace") ? PACE_TICK_OVERHANG : 0;
        return { x: (p.x ?? 0) - o, y: (p.y ?? 0) - o, w: (p.w ?? 0) + 2 * o, h: (p.h ?? 0) + 2 * o, slot: slotOf(p), body: { x: p.x ?? 0, y: p.y ?? 0, w: p.w ?? 0, h: p.h ?? 0 } };
      });
      const note = (key: string, detail: string) => found.has(key) || found.set(key, `${detail} (first in: ${state})`);
      for (const a of animations) {
        for (const t of texts) if ((facingGap(a, t) ?? CLEAR) < CLEAR) note(`${a.name} x "${t.text}"`, `animation ${a.name} [${show(a)}] is under ${CLEAR} px from text "${t.text}" [${show(t)}]`);
        for (const b of bars) if ((facingGap(a, b) ?? CLEAR) < CLEAR) note(`${a.name} x bar ${show(b)}`, `animation ${a.name} [${show(a)}] is under ${CLEAR} px from a bar [${show(b)}]`);
        for (const d of dividers) if ((facingGap(a, d) ?? CLEAR) < CLEAR) note(`${a.name} x divider ${show(d)}`, `animation ${a.name} [${show(a)}] is under ${CLEAR} px from a divider [${show(d)}]`);
      }
      // A text keeps 3 px from every divider and from art painted into the background (frame line, stripe, battery outline):
      // the descender of "On pace" 2 px above a divider and "Weekly reset" on the bottom frame line were both seen on a device.
      for (const t of texts) {
        for (const d of dividers) if ((facingGap(t, d) ?? CLEAR) < CLEAR) note(`"${t.text}" x divider ${show(d)}`, `text "${t.text}" [${show(t)}] is under ${CLEAR} px from a divider [${show(d)}]`);
        const art = artNearText(t, artAt);
        if (art) note(`"${t.text}" x art`, `text "${t.text}" [${show(t)}] is under ${CLEAR} px from background art ${art}`);
      }
      // A glyph that starts on one flat band of the background and ends on another (a descender below the title bar);
      // the first and the last inked row are both looked at, no row of ink across an edge is tolerated.
      for (const t of texts) {
        const cols = [t.x + 1, t.x + t.w / 2, t.x + t.w - 2].map(Math.floor);
        const top = cols.map((x) => artAt(x, Math.floor(t.y))), bottom = cols.map((x) => artAt(x, Math.floor(t.y + t.h - 1)));
        if (top.every((c) => c === top[0]) && bottom.every((c) => c === bottom[0]) && contrast(top[0], bottom[0]) >= 96) {
          note(`"${t.text}" crosses a band edge`, `text "${t.text}" [${show(t)}] starts on ${top[0]} and ends on ${bottom[0]}, across the edge of a background band`);
        }
      }
      texts.forEach((a, i) => texts.slice(i + 1).forEach((b) => {
        if (hit(a, b)) note(`"${a.text}" x "${b.text}"`, `text "${a.text}" [${show(a)}] overlaps text "${b.text}" [${show(b)}]`);
      }));
      // Calm rhythm: two texts or a text and a bar that all but touch (under 3 px) while another gap of the screen is 8 to
      // 40 px (not open picture) is the "0 px beside 10 px" look. The pace tick is left out, it only reaches 3 px beyond the
      // bar at one column; a number beside its bar is part of the bar's row.
      const beside = (t: { p: ThemePrimitive }) => /Percent/.test(source(t.p)) && bars.some((b) => b.slot === slotOf(t.p));
      const gaps = rowGaps([...texts.filter((t) => !beside(t)).map((t) => ({ ...t, name: `"${t.text}"` })), ...bars.map((b) => ({ ...b.body, name: "a bar" }))]);
      const roomy = gaps.find((g) => g.gap >= 8 && g.gap <= 40);
      for (const g of gaps) if (g.gap < 3 && roomy) note(`gap ${g.above} / ${g.below}`, `${g.gap} px between ${g.above} and ${g.below}, next to ${roomy.gap} px between ${roomy.above} and ${roomy.below}`);
      // A pace text belongs to its own bar: nearer to it than to the label or bar of any other limit.
      for (const t of texts.filter((q) => /Pace(Text|Short)/.test(source(q.p)))) {
        const own = bars.find((b) => b.slot === slotOf(t.p))?.body;
        if (!own) continue;
        const near = verticalGap(t, framed(own, t, artAt));
        const others = [
          ...texts.filter((q) => /Label/.test(source(q.p)) && slotOf(q.p) !== slotOf(t.p)).map((q) => ({ name: `"${q.text}"`, box: q as Rect })),
          ...bars.filter((b) => b.slot !== undefined && b.slot !== slotOf(t.p)).map((b) => ({ name: "the bar of the other limit", box: b.body })),
        ];
        for (const o of others) if (verticalGap(t, o.box) <= near) note(`pace "${t.text}" ${slotOf(t.p)} near ${o.name}`, `pace text "${t.text}" is ${near} px from its own bar but ${verticalGap(t, o.box)} px from ${o.name}`);
      }
    }
  }
  // Numbers of one role are drawn at one size, whatever they say: "100%" next to "68%" is not half as high.
  for (const two of [false, true]) for (const first of [0, 9, 68, 100]) for (const second of [0, 9, 68, 100]) {
    const frame = frameFor(two, "used", undefined, undefined, [first, second]);
    const values = prims.filter((p) => p.t === "tx" && /Percent/.test(source(p)) && primitiveUsageSlotVisible(p, frame)).map((p) => {
      const text = renderTextPrimitive(p, frame, prims);
      const { font, size } = themeTextFit(text, p.f ?? 1, p.s ?? 1, p.w ?? 0, p.ft === "shrink", p.h ?? 0);
      return { text, role: `${source(p).replace(/usageSlot\d/, "usageSlot#")} ${p.f} ${p.s}`, height: cellHeight(font) * size };
    }).filter((v) => v.text.trim());
    for (const a of values) for (const b of values) {
      if (a.role === b.role && a.height < b.height) {
        const key = `value ${a.role}`;
        if (!found.has(key)) found.set(key, `value "${a.text}" is drawn ${a.height} px high, its sibling "${b.text}" ${b.height} px (first in: ${two ? "Two at once" : "One provider"}, ${first}% and ${second}%)`);
      }
    }
  }
  return [...found.values()];
}

describe("animations, dividers, bars and text of every catalog theme stay apart and calm", () => {
  it("covers the animated themes", () => {
    const animated = themeIds.filter((id) => animationBoxes(loadPack(id)).length > 0);
    expect(animated).toEqual(expect.arrayContaining(["claude-creature", "clippy", "mini-classic", "tiny-office", "token-fire"]));
  });

  it.each(themeIds)("%s: 3 px clear of dividers, frames and animation, no glyph across a band edge, no 0 px gap beside a roomy one, pace beside its own bar, equal numbers", (themeId) => {
    expect(layoutViolations(loadPack(themeId))).toEqual([]);
  });
});
