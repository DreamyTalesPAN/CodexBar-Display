import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  buildFrameData, decodeSprite, paceBinding, primitiveUsageSlotVisible, renderTextPrimitive,
  themeProgressArc, themeTextFit,
  type FrameData, type ThemePrimitive, type ThemeRenderPack,
} from "@/components/live-vibetv-preview";
import { cellHeight, textInk, type Rect } from "./text-ink";

const root = path.resolve(process.cwd(), "../..");
const renderDir = path.join(root, "dist/theme-packs/render");
const themeIds = readdirSync(renderDir).filter((file) => file.endsWith(".json")).map((file) => file.slice(0, -5));
// The themes a customer can install: the render folder also keeps retired packs (Cozy Meadow) that no catalog lists any more.
const catalogIds: string[] = JSON.parse(readFileSync(path.join(root, "dist/theme-packs/vibetv-theme-packs-v2.json"), "utf8")).themes.map((theme: { id: string }) => theme.id);
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
function staticArt(pack: ThemeRenderPack, drawn: (p: ThemePrimitive) => boolean = () => true): (x: number, y: number) => string {
  const screen: string[] = new Array(240 * 240).fill(pack.spec?.bg ?? "#000000");
  for (const p of (pack.spec?.p ?? []).filter(drawn)) {
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
// The pace is clamped at 100, so "100% reserve" is the widest sentence a screen is ever asked to draw.
const WIDE_PACES = {
  "100% reserve": { delta: -100, state: "reserve", lasts: true },
  "100% deficit": { delta: 100, state: "deficit", lasts: false },
};
const ALL_PACES = { ...PACES, ...WIDE_PACES };
type PaceName = keyof typeof ALL_PACES;

// Limit names as the Companion sends them, the long ones included: "Fable only" with a real 100% (Two: "Claude Fable only"), and
// Codex as the only provider (one limit, "Weekly", in slot 1).
type Limit = [id: string, label: string, percent: number];
type Scenario = { name: string; solo: { provider: string; label: string; limits: Limit[] }; pair?: Limit[] };
const SCENARIOS: Scenario[] = [
  {
    name: "Session and Weekly", solo: { provider: "claude", label: "Claude", limits: [["session", "Session", 73], ["weekly", "Weekly", 100]] },
    pair: [["claude:session", "Claude Session", 73], ["codex:weekly", "Codex Weekly", 100]], // 100: the widest number in the second limit
  },
  {
    name: "Fable only", solo: { provider: "claude", label: "Claude", limits: [["weekly", "Weekly", 32], ["claude-weekly-scoped-fable", "Fable only", 100]] },
    pair: [["claude:claude-weekly-scoped-fable", "Claude Fable only", 100], ["codex:weekly", "Codex Weekly", 99]],
  },
  { name: "Codex alone", solo: { provider: "codex", label: "Codex", limits: [["weekly", "Weekly", 99]] } },
];
// Names that are only reached by the no-shrink guard below: Codex limits that carry the provider ("Codex Weekly remaining" is the
// longest label there is) and the longest provider names for the title.
const NAME_SCENARIOS: Scenario[] = [
  { name: "Codex limit names", solo: { provider: "codex", label: "Codex", limits: [["weekly", "Codex Weekly", 99], ["session", "Codex Session", 99]] } },
  {
    name: "Antigravity", solo: { provider: "antigravity", label: "Antigravity", limits: [["weekly", "Weekly", 99], ["session", "Session", 50]] },
    pair: [["antigravity:weekly", "Antigravity Weekly", 99], ["perplexity:session", "Perplexity Session", 50]], // the two longest provider names, with descenders
  },
  { name: "Perplexity", solo: { provider: "perplexity", label: "Perplexity", limits: [["weekly", "Weekly", 99], ["session", "Session", 50]] } },
];

function frameFor(two: boolean, usageMode: string, pace: PaceName | undefined, footer: number | undefined, percents?: number[], weeklySecs = 424000, scenario = SCENARIOS[0], firstSecs = 9100, now = clock, wideTokens = false): FrameData {
  const limits = (two ? scenario.pair : scenario.solo.limits) ?? [];
  return buildFrameData(now.toISOString(), {
    provider: two ? "claude+codex" : scenario.solo.provider, label: two ? "" : scenario.solo.label, usageMode, resetSecs: firstSecs,
    footerWindow: footer === undefined ? undefined : limits[footer]?.[0],
    usageWindows: limits.map(([id, label, percent], i) => ({
      id, label, percent: percents?.[i] ?? percent,
      resetSecs: [firstSecs, weeklySecs][i], pace: pace ? ALL_PACES[pace] : undefined,
    })),
    ...(wideTokens ? { sessionTokens: 8_880_000, weekTokens: 88_800_000, totalTokens: 888_000_000 } : { sessionTokens: 1234567, weekTokens: 98765432, totalTokens: 987654321 }),
    tokenTotalsKnown: true,
  }, now);
}

// [footer limit, seconds to the second limit's reset, seconds to the first limit's reset]
const FOOTERS = [[undefined, 424000, 9100], [0, 424000, 9100], [0, 424000, 2820], [1, 424000, 9100], [1, 2820, 9100]] as const;

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

// Empty pixels between a text's ink box and the nearest pixel of a progress ring (counted the Chebyshev way, like the gap beside a
// ring seen on a device). The ring is the band of the arc between its inner and outer radius, from its start angle (clockwise
// from 12 o'clock) over its sweep.
function ringGap(t: Rect, arc: NonNullable<ReturnType<typeof themeProgressArc>>): number {
  // The firmware centres a text in whole pixels: a half pixel goes to the left.
  const x0 = Math.floor(t.x), y0 = Math.round(t.y), x1 = x0 + Math.round(t.w) - 1, y1 = y0 + Math.round(t.h) - 1;
  const inner = arc.radius - arc.thickness / 2, outer = arc.radius + arc.thickness / 2;
  let best = Infinity;
  for (let y = y0 - CLEAR - 1; y <= y1 + CLEAR + 1; y++) for (let x = x0 - CLEAR - 1; x <= x1 + CLEAR + 1; x++) {
    const dx = x + 0.5 - arc.cx, dy = y + 0.5 - arc.cy, radius = Math.hypot(dx, dy);
    const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (radius < inner || radius > outer || (angle - arc.start + 720) % 360 > arc.sweep) continue;
    const distance = Math.max(x0 - x, x - x1, y0 - y, y - y1, 0);
    if (distance > 0) best = Math.min(best, distance - 1);
  }
  return best;
}

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
  for (const two of [false, true]) for (const scenario of SCENARIOS.filter((s) => !two || s.pair)) for (const usageMode of ["used", "remaining"]) for (const pace of [undefined, ...(Object.keys(PACES) as PaceName[])]) {
    // The weekly footer also with minutes ("Weekly reset 47m"), the widest sentence with a descender; the first limit's own with minutes.
    for (const [footer, weeklySecs, firstSecs] of FOOTERS) {
      const state = `${two ? "Two at once" : "One provider"}, ${scenario.name}, ${usageMode}, pace ${pace ?? "off"}, footer ${footer === undefined ? "off" : `${footer} (${footer === 0 ? firstSecs : weeklySecs} s)`}`;
      const frame = frameFor(two, usageMode, pace, footer, undefined, weeklySecs, scenario, firstSecs);
      const texts = prims.filter((p) => p.t === "tx" && primitiveUsageSlotVisible(p, frame))
        .map((p) => ({ text: renderTextPrimitive(p, frame, prims), p })).filter(({ text }) => text.trim())
        .map(({ text, p }) => ({ text, p, ...textInk(p, text) }));
      const bars = prims.filter((p) => p.t === "p" && primitiveUsageSlotVisible(p, frame)).map((p) => {
        const o = pace && (p.b ?? "").includes("Pace") ? PACE_TICK_OVERHANG : 0;
        return { x: p.x ?? 0, y: (p.y ?? 0) - o, w: p.w ?? 0, h: (p.h ?? 0) + o, slot: slotOf(p), body: { x: p.x ?? 0, y: p.y ?? 0, w: p.w ?? 0, h: p.h ?? 0 } };
      });
      const note = (key: string, detail: string) => found.has(key) || found.set(key, `${detail} (first in: ${state})`);
      for (const a of animations) {
        for (const t of texts) if ((facingGap(a, t) ?? CLEAR) < CLEAR) note(`${a.name} x "${t.text}"`, `animation ${a.name} [${show(a)}] is under ${CLEAR} px from text "${t.text}" [${show(t)}]`);
        for (const b of bars) if ((facingGap(a, b) ?? CLEAR) < CLEAR) note(`${a.name} x bar ${show(b)}`, `animation ${a.name} [${show(a)}] is under ${CLEAR} px from a bar [${show(b)}]`);
        for (const d of dividers) if ((facingGap(a, d) ?? CLEAR) < CLEAR) note(`${a.name} x divider ${show(d)}`, `animation ${a.name} [${show(a)}] is under ${CLEAR} px from a divider [${show(d)}]`);
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
      // 40 px (not open picture) is the "0 px beside 10 px" look. The pace tick is left out, it has its own check (tickHits);
      // a number beside its bar is part of the bar's row.
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

// Every text is drawn at the font and size its theme declares, whatever it says. Shrinking to fit makes "100% reserve" stand beside
// "35% deficit" at half the height (Mini Classic), "TOTAL TOKENS" and a clock come out smaller than their spec says, and "Fable only
// remaining" shrinks beside "Weekly remaining". A long text is wrapped (a box of two lines) or given room, never made smaller. All
// the reachable texts are tried: limit names (the long ones: "Claude Fable only", "Codex Weekly remaining"), both modes, every pace
// sentence up to "100% reserve" / "100% deficit", every footer ("Fable only reset 4d", minutes), provider names, token counts, the clock.
//
// Not tried: status lines that are sentences on purpose and shrink to say so ("No active session", "Reset unavailable") and the update
// notice that takes the title's place ("Open VibeTV Mac App"); those states are not built here.
const CLOCKS = [new Date(2026, 9, 22, 8, 8), new Date(2026, 9, 22, 20, 28), new Date(2026, 9, 22, 11, 11)];

// Decisions that are still open with Paul: these texts shrink today and the second test below fails the day one of them stops, so
// no entry outlives its decision.
const SHRINK_PENDING: Array<{ theme: string; source: RegExp; why: string }> = [
  { theme: "pace-meter", source: /Label/, why: "Paul decision pending 2.20/2.21: the mode word in the limit name" },
  { theme: "synthwave", source: /Label/, why: "Paul decision pending 2.20/2.21: the mode word in the limit name" },
  { theme: "reset-countdown", source: /ResetFull/, why: "open decision: the countdown is declared at 4 and drawn at 2 (a widened box or a declared 2)" },
];

// Paul's decision, 23.10.2026 (question 6): "Pixel Battery: Name behalten, 'Session reset 55m' verkleinern (bewusste Ausnahme von
// nie-verkleinern, Paul-Entscheidung; Text muss trotzdem 3 px Abstand halten)." The one text that may be drawn smaller than its pack
// declares is Pixel Battery's footer sentence with a two-digit count ("Session reset 55m"); it keeps the limit's name (kn) and
// the guard below measures the 3 px to the frame line at every reset value.
const SHRINK_DECIDED = { theme: "pixel-battery", source: /^Reset in /, text: /^Session reset \d\d[mh]$/ };

// Every state a screen is asked to draw, shared by the size guard, the screen edge guard and the ink guard.
const REACHABLE_FRAMES = (() => {
  const frames: Array<[string, FrameData]> = [];
  for (const two of [false, true]) for (const scenario of [...SCENARIOS, ...NAME_SCENARIOS].filter((s) => !two || s.pair)) for (const usageMode of ["used", "remaining"]) {
    for (const pace of [undefined, ...(Object.keys(ALL_PACES) as PaceName[])]) for (const [footer, weeklySecs, firstSecs] of FOOTERS) {
      frames.push([`${two ? "Two at once" : "One provider"}, ${scenario.name}, ${usageMode}, pace ${pace ?? "off"}, footer ${footer ?? "off"} (${firstSecs}/${weeklySecs} s)`,
        frameFor(two, usageMode, pace, footer, undefined, weeklySecs, scenario, firstSecs)]);
    }
  }
  // Every number from 0% to 100% in both limits: "100%" is the widest, but each digit pair has its own ink.
  for (const two of [false, true]) for (const pace of [undefined, "on pace" as const]) for (let percent = 0; percent <= 100; percent++) {
    frames.push([`${two ? "Two at once" : "One provider"}, ${percent}%, pace ${pace ?? "off"}`, frameFor(two, "used", pace, undefined, [percent, percent])]);
  }
  for (const now of CLOCKS) for (const wideTokens of [false, true]) {
    frames.push([`${now.toTimeString().slice(0, 5)}, ${wideTokens ? "wide" : "normal"} token counts`, frameFor(false, "used", undefined, undefined, undefined, 424000, SCENARIOS[0], 9100, now, wideTokens)]);
  }
  return frames;
})();

function shrunkTexts(themeId: string, pack: ThemeRenderPack, pending = false): string[] {
  const prims = pack.spec?.p ?? [];
  const open = (p: ThemePrimitive) => SHRINK_PENDING.some((entry) => entry.theme === themeId && entry.source.test(source(p)));
  const found = new Map<string, string>();
  for (const [state, frame] of REACHABLE_FRAMES) {
    for (const p of prims.filter((q) => q.t === "tx" && primitiveUsageSlotVisible(q, frame) && open(q) === pending)) {
      const text = renderTextPrimitive(p, frame, prims);
      if (!text.trim()) continue;
      if (themeId === SHRINK_DECIDED.theme && SHRINK_DECIDED.source.test(source(p)) && SHRINK_DECIDED.text.test(text)) continue;
      const fit = themeTextFit(text, p.f ?? 1, p.s ?? 1, p.w ?? 0, p.ft === "shrink", p.h ?? 0);
      if (fit.font !== (p.f ?? 1) || fit.size !== (p.s ?? 1)) {
        found.set(`${source(p)} ${text}`, `"${text}" (${source(p)}) is drawn at font ${fit.font} size ${fit.size}, declared font ${p.f ?? 1} size ${p.s ?? 1} (first in: ${state})`);
      }
    }
  }
  return [...found.values()];
}

// No ink of any text comes within 3 px of the screen edge, in any reachable state: the descender of "On pace" stood on the last pixel row
// of Gauge's second limit (7214) because no guard looked at the edge.
function edgeHits(pack: ThemeRenderPack): string[] {
  const prims = pack.spec?.p ?? [];
  const found = new Map<string, string>();
  // The update notice takes the title's place (and the footer's) in every state; it is a sentence on purpose and may shrink.
  const notices = [false, true].map((two): [string, FrameData] => [`${two ? "Two at once" : "One provider"}, update notice`, { ...frameFor(two, "used", "on pace", 0), updateNotice: "Open VibeTV Mac App" }]);
  for (const [state, frame] of [...REACHABLE_FRAMES, ...notices]) {
    for (const p of prims.filter((q) => q.t === "tx" && primitiveUsageSlotVisible(q, frame))) {
      const text = renderTextPrimitive(p, frame, prims);
      if (!text.trim()) continue;
      const ink = textInk(p, text);
      const gap = Math.floor(Math.min(ink.x, ink.y, 240 - ink.x - ink.w, 240 - ink.y - ink.h));
      if (gap < CLEAR) found.set(`${source(p)} ${text}`, `"${text}" (${source(p)}) [${show(ink)}] is ${gap} px from the screen edge, under ${CLEAR} px (first in: ${state})`);
    }
  }
  return [...found.values()];
}

// No ink of any text comes within 3 px of ink that is not text: a divider, a frame line or battery outline painted into the background, a
// bar or a ring (the pace tick is left out, tickHits measures it). The descender of "On pace" 2 px above a
// divider, "Weekly reset" on a frame line, "Fable only reset 4d" 2 px beside the ends of Gauge's ring and the "%" of Gauge's "100%" on
// its ring were all seen on a device. Every reachable state counts: the long strings, every number, One and Two.
function inkHits(pack: ThemeRenderPack): string[] {
  const prims = pack.spec?.p ?? [];
  const artAt = staticArt(pack);
  const dividers = [
    ...prims.filter((p) => p.t === "r" && Math.min(p.w ?? 0, p.h ?? 0) <= 4).map((p) => ({ x: p.x ?? 0, y: p.y ?? 0, w: p.w ?? 0, h: p.h ?? 0 })),
    ...bakedDividers(pack),
  ];
  const found = new Map<string, string>(), seen = new Set<string>();
  for (const [state, frame] of REACHABLE_FRAMES) {
    const bars = prims.filter((p) => p.t === "p" && primitiveUsageSlotVisible(p, frame));
    for (const p of prims.filter((q) => q.t === "tx" && primitiveUsageSlotVisible(q, frame))) {
      const text = renderTextPrimitive(p, frame, prims);
      if (!text.trim()) continue;
      const t = textInk(p, text);
      // The same ink in the same place is judged once, not once per state.
      const key = `${prims.indexOf(p)} ${text} ${bars.map((b) => prims.indexOf(b))}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const note = (what: string, detail: string) => found.has(`"${text}" x ${what}`) || found.set(`"${text}" x ${what}`, `${detail} (first in: ${state})`);
      for (const d of dividers) if ((facingGap(t, d) ?? CLEAR) < CLEAR) note(`divider ${show(d)}`, `text "${text}" [${show(t)}] is under ${CLEAR} px from a divider [${show(d)}]`);
      const art = artNearText(t, artAt);
      if (art) note("art", `text "${text}" [${show(t)}] is under ${CLEAR} px from background art ${art}`);
      for (const b of bars) {
        const arc = (b.progressStyle ?? b.ps) === "arc" ? themeProgressArc(b, 0) : null;
        const box = { x: b.x ?? 0, y: b.y ?? 0, w: b.w ?? 0, h: b.h ?? 0 };
        const gap = arc ? ringGap(t, arc) : Math.max(box.x - (t.x + t.w), t.x - (box.x + box.w), box.y - (t.y + t.h), t.y - (box.y + box.h));
        if (gap < CLEAR) note(arc ? "ring" : `bar ${show(box)}`, `text "${text}" [${show(t)}] is ${gap} px from ${arc ? "the ring" : `a bar [${show(box)}]`}, under ${CLEAR} px`);
      }
    }
  }
  return [...found.values()];
}

// The pixels of the plan tick of a pace bar at every plan position 0..100, as the firmware draws it. On a bar (DrawPaceBar) the tick is a
// column 2 px wide from PACE_TICK_OVERHANG above the bar down to its bottom edge. On a ring (DrawProgressArc) it is the strip 2 px wide
// across the ring at the plan in whole degrees, inside the ring and inside its sweep, so it never stands on the open part of the ring.
function planTicks(b: ThemePrimitive): Array<Array<[number, number]>> {
  const arc = (b.progressStyle ?? b.ps) === "arc" ? themeProgressArc(b, 0) : null;
  if (!arc) {
    const x = b.x ?? 0, y = b.y ?? 0, h = b.h ?? 0, w = b.w ?? 0;
    return Array.from({ length: 101 }, (_, plan) => {
      const column = x + Math.floor(((w - 2) * plan) / 100);
      return [column, column + 1].flatMap((cx) => Array.from({ length: h + Math.min(y, PACE_TICK_OVERHANG) }, (_, row): [number, number] => [cx, y - Math.min(y, PACE_TICK_OVERHANG) + row]));
    });
  }
  const inner = arc.radius - arc.thickness / 2, outer = arc.radius + arc.thickness / 2;
  const band: Array<{ x: number; y: number; dx: number; dy: number }> = [];
  for (let y = Math.floor(arc.cy - outer); y <= Math.ceil(arc.cy + outer); y++) for (let x = Math.floor(arc.cx - outer); x <= Math.ceil(arc.cx + outer); x++) {
    const dx = x + 0.5 - arc.cx, dy = y + 0.5 - arc.cy, radius = Math.hypot(dx, dy);
    const turned = ((((Math.atan2(dx, -dy) * 180) / Math.PI - arc.start) % 360) + 360) % 360;
    if (radius >= inner && radius <= outer && (turned <= arc.sweep + 1e-6 || turned >= 360 - 1e-6)) band.push({ x, y, dx, dy });
  }
  return Array.from({ length: 101 }, (_, plan) => {
    const angle = ((arc.start + Math.floor((arc.sweep * plan) / 100)) * Math.PI) / 180, ux = Math.sin(angle), uy = -Math.cos(angle);
    return band.filter((q) => q.dx * ux + q.dy * uy > 0 && Math.abs(ux * q.dy - uy * q.dx) <= 1 + 1e-9).map((q): [number, number] => [q.x, q.y]);
  });
}

// Empty pixels between a text's ink and the nearest pixel of a tick (counted the Chebyshev way), -1 where they overlap.
function tickGap(t: Rect, tick: Array<[number, number]>): number {
  const x0 = Math.floor(t.x), y0 = Math.round(t.y), x1 = x0 + Math.round(t.w) - 1, y1 = y0 + Math.round(t.h) - 1;
  return tick.reduce((best, [x, y]) => Math.min(best, Math.max(x0 - x, x - x1, y0 - y, y - y1, 0) - 1), Infinity);
}

type Pace = (typeof PACES)[keyof typeof PACES];
// Every pace CodexBar sends: a reserve or a deficit of 1..100 %, and "on pace" (the use itself, a delta of at most 2 either way).
const PACE_STEPS: Pace[] = Array.from({ length: 201 }, (_, i) => i - 100).flatMap((delta): Pace[] => [
  { delta, state: delta < 0 ? "reserve" : delta > 0 ? "deficit" : "on pace", lasts: delta <= 0 },
  ...(Math.abs(delta) === 1 || Math.abs(delta) === 2 ? [{ delta, state: "on pace", lasts: true }] : []),
]);

// No ink of any text comes within 3 px of the plan tick of a pace bar, wherever the plan stands. The plan is the percent moved by the pace
// delta (against the use in "used", with it in "remaining") and cut to 0..100, so plan 54 is reached by 54% on pace, by 40% with a 14%
// deficit and by 68% with a 14% reserve: every position comes with the percent and the pace sentence that lead to it, not with every
// text. The tick of Gauge stood 1 px from the "%" of "100%" at plan 67, Clippy's reached the pace sentence, Synthwave's and Tiny Office's
// the limit names.
function tickHits(pack: ThemeRenderPack): string[] {
  const prims = pack.spec?.p ?? [];
  const ticks = new Map(prims.flatMap((p, i): Array<[number, ReturnType<typeof planTicks>]> => p.t === "p" && paceBinding(p.b ?? p.binding ?? "")?.field === "" ? [[i, planTicks(p)]] : []));
  const found = new Map<number, { gap: number; plans: Set<number>; detail: string }>();
  const rows = new Map<string, number[]>();
  for (const two of [false, true]) for (const scenario of SCENARIOS.filter((q) => !two || q.pair)) for (const usageMode of ["used", "remaining"]) {
    const frameAt = (percent: number, pace: Pace, [footer, weeklySecs, firstSecs]: (typeof FOOTERS)[number] = FOOTERS[0]): FrameData => {
      const frame = frameFor(two, usageMode, undefined, footer, [percent, percent], weeklySecs, scenario, firstSecs);
      return { ...frame, usageWindows: frame.usageWindows.map((w) => ({ ...w, pace })) };
    };
    const shown = (frame: FrameData) => prims.flatMap((p, i) => p.t === "tx" && primitiveUsageSlotVisible(p, frame) ? [{ i, text: renderTextPrimitive(p, frame, prims) }] : []).filter(({ text }) => text.trim());
    const onPace = PACE_STEPS.find((pace) => pace.delta === 0)!;
    const bars = [...ticks.keys()].filter((i) => primitiveUsageSlotVisible(prims[i], frameAt(50, onPace)));
    // The gap of a text to the tick at each plan, the nearest of the bars on screen.
    const row = ({ i, text }: { i: number; text: string }) => {
      const key = `${bars} ${i} ${text}`, ink = textInk(prims[i], text);
      if (!rows.has(key)) rows.set(key, Array.from({ length: 101 }, (_, plan) => Math.min(...bars.map((b) => tickGap(ink, ticks.get(b)![plan])))));
      return { i, text, ink, gaps: rows.get(key)! };
    };
    // A text is either fixed in a state (names, footers), or follows the percent, or follows the pace.
    const byPercent = Array.from({ length: 101 }, (_, percent) => shown(frameAt(percent, onPace)));
    const byPace = PACE_STEPS.map((pace) => shown(frameAt(50, pace)));
    const varies = (all: ReturnType<typeof shown>[], i: number) => new Set(all.map((texts) => texts.find((q) => q.i === i)?.text)).size > 1;
    const followsPercent = prims.map((_, i) => varies(byPercent, i)), followsPace = prims.map((_, i) => varies(byPace, i));
    const fixed = FOOTERS.flatMap((footers) => shown(frameAt(50, onPace, footers))).filter(({ i }) => !followsPercent[i] && !followsPace[i]).map(row);
    const percentRows = byPercent.map((texts) => texts.filter(({ i }) => followsPercent[i]).map(row));
    const paceRows = byPace.map((texts) => texts.filter(({ i }) => followsPace[i]).map(row));
    PACE_STEPS.forEach((pace, k) => percentRows.forEach((own, percent) => {
      const plan = Math.max(0, Math.min(100, percent + (usageMode === "used" ? -pace.delta : pace.delta)));
      for (const q of [...fixed, ...own, ...paceRows[k]]) {
        if (q.gaps[plan] >= CLEAR) continue;
        // One line per text of the theme, with its nearest case.
        const entry = found.get(q.i) ?? { gap: Infinity, plans: new Set<number>(), detail: "" };
        if (q.gaps[plan] < entry.gap) entry.detail = `text "${q.text}" (${source(prims[q.i])}) [${show(q.ink)}] is ${q.gaps[plan]} px from the plan tick, under ${CLEAR} px (first in: ${two ? "Two at once" : "One provider"}, ${scenario.name}, ${usageMode}, ${percent}% with ${pace.state} ${pace.delta})`;
        entry.gap = Math.min(entry.gap, q.gaps[plan]);
        entry.plans.add(plan);
        found.set(q.i, entry);
      }
    }));
  }
  return [...found.values()].map(({ plans, detail }) => `${detail}; the tick is that close at ${plans.size} plan positions, ${Math.min(...plans)} to ${Math.max(...plans)}`);
}

// Captions are read as one typeset row. Mini Classic drew "remaining" under both numbers in GLCD at size 2 (12 px cells filling a
// 108 px lane) between limit names and pace sentences in Font16: two words 12 px apart read as one phrase, in a heavier hand (7216).
// A mode word beside a limit's name is drawn in that name's font and size; the same-named texts of the two columns of a row keep one
// caption line (a Font16 cell, 16 px) between their ink; a limit's name and its value in one row stand on one baseline (Gauge's
// "Weekly" was centred on the stack of "23%" and its pace sentence, 8 px below the number's baseline); and a number keeps 4 px above its
// own pace sentence (Gauge and Synthwave were at 3 and 4, the review reads a 3 px gap as 2.8); a pace sentence stays on one line ("100% reserve"
// wrapped to "100%" and "reserve" in Mini Classic's 80 px lane beside "on pace").
const COLUMN_GAP = 16, NUMBER_OVER_PACE = 4;

function modeWordHits(pack: ThemeRenderPack): string[] {
  const prims = pack.spec?.p ?? [];
  const font = (p: ThemePrimitive) => `font ${p.f ?? 1} size ${p.s ?? 1}`;
  return prims.filter((p) => p.t === "tx" && source(p) === "{usageModeStandalone}" && slotOf(p) !== undefined).flatMap((mode) => {
    const name = prims.find((q) => q.t === "tx" && /Label/.test(source(q)) && slotOf(q) === slotOf(mode));
    return name && font(name) !== font(mode) ? [`the mode word of limit ${slotOf(mode)} is drawn at ${font(mode)}, its limit name at ${font(name)}`] : [];
  });
}

function captionRowHits(pack: ThemeRenderPack): string[] {
  const prims = pack.spec?.p ?? [];
  const found = new Map<string, string>(), seen = new Set<string>();
  const baseline = (t: { p: ThemePrimitive }) => { const h = textInk(t.p, "H"); return h.y + h.h; };
  for (const [state, frame] of REACHABLE_FRAMES) {
    const texts = prims.filter((p) => p.t === "tx" && primitiveUsageSlotVisible(p, frame))
      .map((p) => ({ p, text: renderTextPrimitive(p, frame, prims) })).filter(({ text }) => text.trim())
      .map(({ p, text }) => ({ p, text, ...textInk(p, text) }));
    const key = texts.map((t) => `${prims.indexOf(t.p)} ${t.text}`).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const note = (what: string, detail: string) => found.has(what) || found.set(what, `${detail} (first in: ${state})`);
    const role = (p: ThemePrimitive) => source(p).replace(/usageSlot\d/g, "usageSlot#");
    for (const t of texts) {
      if (/Pace(Text|Short)/.test(source(t.p)) && themeTextFit(t.text, t.p.f ?? 1, t.p.s ?? 1, t.p.w ?? 0, t.p.ft === "shrink", t.p.h ?? 0).lines.length > 1) note(`wrap ${source(t.p)}`, `the pace sentence "${t.text}" [${show(t)}] wraps to two lines`);
    }
    texts.forEach((a, i) => texts.slice(i + 1).forEach((b) => {
      const sameRows = a.y < b.y + b.h && b.y < a.y + a.h, sameColumns = a.x < b.x + b.w && b.x < a.x + a.w;
      if (sameRows && slotOf(a.p) !== slotOf(b.p) && role(a.p) === role(b.p)) {
        const [left, right] = a.x < b.x ? [a, b] : [b, a];
        if (right.x - (left.x + left.w) < COLUMN_GAP) note(`columns ${role(a.p)}`, `"${left.text}" [${show(left)}] and "${right.text}" [${show(right)}] stand ${Math.round(right.x - (left.x + left.w))} px apart in one row, under ${COLUMN_GAP} px`);
      }
      for (const [name, value] of [[a, b], [b, a]]) {
        if (sameRows && /Label/.test(source(name.p)) && /Percent/.test(source(value.p)) && slotOf(name.p) === slotOf(value.p) && Math.abs(baseline(name) - baseline(value)) > 1) {
          note(`baseline ${source(name.p)}`, `"${name.text}" stands on row ${baseline(name)}, its value "${value.text}" on row ${baseline(value)}: no common baseline`);
        }
        const gap = verticalGap(name, value);
        if (sameColumns && !sameRows && /Percent/.test(source(name.p)) && /Pace(Text|Short)/.test(source(value.p)) && slotOf(name.p) === slotOf(value.p) && value.y > name.y && gap < NUMBER_OVER_PACE) {
          note(`number over pace ${source(name.p)}`, `"${name.text}" [${show(name)}] is ${gap} px above its pace sentence "${value.text}" [${show(value)}], under ${NUMBER_OVER_PACE} px`);
        }
      }
    }));
  }
  return [...found.values()];
}

// A pace sentence follows the colour of its limit's row: where a theme colours the numbers of its two limits differently (Synthwave: pink,
// then cyan), "On pace" under the pink limit was cyan (7216), as if it belonged to the other row.
function paceColourHits(pack: ThemeRenderPack): string[] {
  const prims = pack.spec?.p ?? [];
  const rowColour = (slot: unknown) => prims.find((q) => q.t === "tx" && /Percent/.test(source(q)) && slotOf(q) === slot)?.c?.toUpperCase();
  const slots = prims.filter((q) => q.t === "tx" && /Percent/.test(source(q)) && slotOf(q) !== undefined).map(slotOf);
  if (new Set(slots.map(rowColour)).size < 2) return [];
  return prims.filter((p) => p.t === "tx" && /Pace(Text|Short)/.test(source(p)) && slotOf(p) !== undefined).flatMap((p) => {
    const neutral = (p.cs?.find((stop) => stop.gte === 50)?.c ?? p.c)?.toUpperCase();
    return neutral === rowColour(slotOf(p)) ? [] : [`the pace sentence of limit ${slotOf(p)} is ${neutral} when it is on pace, its row ${rowColour(slotOf(p))}`];
  });
}

type Blob = { x0: number; y0: number; x1: number; y1: number; n: number };
// The 4-connected regions of the pixels that share one key (an undefined key belongs to no region), inside an area.
function blobs(keyAt: (x: number, y: number) => string | undefined, [ax0, ay0, ax1, ay1]: [number, number, number, number] = [0, 0, 239, 239]): Blob[] {
  const done = new Set<number>(), out: Blob[] = [];
  for (let y = ay0; y <= ay1; y++) for (let x = ax0; x <= ax1; x++) {
    const key = keyAt(x, y);
    if (key === undefined || done.has(y * 240 + x)) continue;
    const blob: Blob = { x0: x, y0: y, x1: x, y1: y, n: 0 }, todo: Array<[number, number]> = [[x, y]];
    done.add(y * 240 + x);
    while (todo.length) {
      const [cx, cy] = todo.pop()!;
      blob.n++; blob.x0 = Math.min(blob.x0, cx); blob.x1 = Math.max(blob.x1, cx); blob.y0 = Math.min(blob.y0, cy); blob.y1 = Math.max(blob.y1, cy);
      for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
        if (nx < ax0 || nx > ax1 || ny < ay0 || ny > ay1 || done.has(ny * 240 + nx) || keyAt(nx, ny) !== key) continue;
        done.add(ny * 240 + nx); todo.push([nx, ny]);
      }
    }
    out.push(blob);
  }
  return out;
}

// The controls on a bar painted into the background (Clippy's title bar, a flat band at least 100 px wide and 20 to 48 px high that
// stands free of the screen edge): they
// are one width, and they keep the same margin to the bar's right, top and bottom edge (within 1 px), at least 3 px. Clippy's three
// buttons were 18, 19 and 18 px wide and the last stood on the bar's right end (7216).
function barControlHits(pack: ThemeRenderPack): string[] {
  const artAt = staticArt(pack);
  return blobs(artAt).filter((b) => b.x0 > 0 && b.y0 > 0 && b.x1 < 239 && b.y1 < 239 && b.x1 - b.x0 >= 99 && b.y1 - b.y0 >= 19 && b.y1 - b.y0 <= 47 && b.n >= 0.6 * (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1)).flatMap((bar) => {
    const colour = artAt(bar.x0, bar.y0);
    const controls = blobs((x, y) => (artAt(x, y) === colour ? undefined : "control"), [bar.x0, bar.y0, bar.x1, bar.y1]);
    const where = `on the bar [${bar.x0},${bar.y0} ${bar.x1 - bar.x0 + 1}x${bar.y1 - bar.y0 + 1}]`;
    const widths = new Set(controls.map((c) => c.x1 - c.x0 + 1));
    const margins = controls.length ? [bar.x1 - Math.max(...controls.map((c) => c.x1)), ...controls.flatMap((c) => [c.y0 - bar.y0, bar.y1 - c.y1])] : [];
    return [
      ...(controls.length > 1 && widths.size > 1 ? [`the controls ${where} are ${controls.map((c) => c.x1 - c.x0 + 1).join(", ")} px wide, not one width`] : []),
      ...(margins.length > 0 && (Math.min(...margins) < CLEAR || Math.max(...margins) - Math.min(...margins) > 1) ? [`the controls ${where} keep margins of ${margins.join(", ")} px (right end, then top and bottom of each), not one margin of at least ${CLEAR} px`] : []),
    ];
  });
}

describe("no text is drawn smaller than its theme declares", () => {
  it.each(catalogIds)("%s", (themeId) => {
    expect(shrunkTexts(themeId, loadPack(themeId))).toEqual([]);
  });

  it.each(SHRINK_PENDING)("$theme still shrinks $source ($why): drop the entry from SHRINK_PENDING once fixed", (entry) => {
    expect(shrunkTexts(entry.theme, loadPack(entry.theme), true)).not.toEqual([]);
  });
});

describe("animations, dividers, bars and text of every catalog theme stay apart and calm", () => {
  it("covers the animated themes", () => {
    const animated = themeIds.filter((id) => animationBoxes(loadPack(id)).length > 0);
    expect(animated).toEqual(expect.arrayContaining(["claude-creature", "clippy", "mini-classic", "tiny-office", "token-fire"]));
  });

  it.each(themeIds)("%s: 3 px clear of animation, no glyph across a band edge, no 0 px gap beside a roomy one, pace beside its own bar, equal numbers", (themeId) => {
    expect(layoutViolations(loadPack(themeId))).toEqual([]);
  });
});

describe("no text ink comes within 3 px of the screen edge", () => {
  it.each(catalogIds)("%s", (themeId) => {
    expect(edgeHits(loadPack(themeId))).toEqual([]);
  });
});

describe("no text ink comes within 3 px of a divider, frame line, bar or ring", () => {
  it.each(catalogIds)("%s", (themeId) => {
    expect(inkHits(loadPack(themeId))).toEqual([]);
  });
});

// Paul decision 23.10.2026 (question 6): "Pixel Battery: Name behalten, 'Session reset 55m' verkleinern (bewusste Ausnahme von
// nie-verkleinern, Paul-Entscheidung; Text muss trotzdem 3 px Abstand halten)." The footer of Pixel Battery keeps the limit's name
// and is drawn one size smaller exactly where its full-size sentence would come within 3 px of the frame line of the background.
// Every other footer, and every other text, stays at its declared size (shrunkTexts).
describe("the Pixel Battery footer keeps 3 px from the frame line at every reset value and shrinks only where it has to", () => {
  const resets: Array<[string, number]> = [
    ...Array.from({ length: 59 }, (_, i): [string, number] => [`${i + 1}m`, (i + 1) * 60]),
    ...Array.from({ length: 23 }, (_, i): [string, number] => [`${i + 1}h`, (i + 1) * 3600]),
    ...Array.from({ length: 6 }, (_, i): [string, number] => [`${i + 1}d`, (i + 1) * 86400]),
  ];
  it.each([false, true])("Two at once: %s", (two) => {
    const pack = loadPack("pixel-battery"), prims = pack.spec?.p ?? [], artAt = staticArt(pack);
    const footer = prims.find((p) => p.t === "tx" && /^Resets? in /.test(p.v ?? ""))!;
    const tooClose: string[] = [], shrunk: string[] = [], wouldBeTooClose: string[] = [];
    for (const [label, secs] of resets) {
      const frame = frameFor(two, "remaining", undefined, 0, undefined, 424000, SCENARIOS[0], secs);
      const text = renderTextPrimitive(footer, frame, prims);
      expect(text, label).toBe(`Session reset ${label}`);
      if (artNearText(textInk(footer, text), artAt)) tooClose.push(label);
      if (artNearText(textInk({ ...footer, ft: undefined }, text), artAt)) wouldBeTooClose.push(label);
      if (themeTextFit(text, footer.f ?? 1, footer.s ?? 1, footer.w ?? 0, true, footer.h ?? 0).size < (footer.s ?? 1)) shrunk.push(label);
    }
    expect(tooClose).toEqual([]);
    expect(shrunk).toEqual(wouldBeTooClose);
    expect(wouldBeTooClose.length).toBeGreaterThan(0);
  });
});

describe("no text ink comes within 3 px of the plan tick of a pace bar, at any plan position", () => {
  it.each(catalogIds)("%s", (themeId) => {
    expect(tickHits(loadPack(themeId))).toEqual([]);
  });
});

describe("a row of captions reads as one typeset line", () => {
  it.each(catalogIds)("%s: a mode word shares its limit name's font and size", (themeId) => {
    expect(modeWordHits(loadPack(themeId))).toEqual([]);
  });

  it.each(catalogIds)("%s: columns, baseline of a name and its value, number over its pace sentence, pace on one line", (themeId) => {
    expect(captionRowHits(loadPack(themeId))).toEqual([]);
  });

  it.each(catalogIds)("%s: a pace sentence follows the colour of its limit's row", (themeId) => {
    expect(paceColourHits(loadPack(themeId))).toEqual([]);
  });
});

describe("the controls on a painted bar keep one width and one margin", () => {
  it.each(catalogIds)("%s", (themeId) => {
    expect(barControlHits(loadPack(themeId))).toEqual([]);
  });
});

// Codex as the only provider has one window, so one limit. What stands for a second limit that is not there is not drawn: Clippy's etched
// divider, Gauge's footer divider and Pixel Battery's second battery belong to slot 2 (7215: a divider over an empty lower half, an empty battery
// without a name).
describe("one window draws nothing of a second limit", () => {
  const one = frameFor(false, "remaining", undefined, undefined, undefined, 424000, SCENARIOS[2]);
  const two = frameFor(false, "remaining", undefined, undefined, undefined, 424000, SCENARIOS[0]);

  it.each([["clippy", 2], ["gauge", 1]])("%s's divider is drawn between two limits only", (themeId, dividers) => {
    const prims = loadPack(themeId).spec?.p ?? [];
    const rects = (frame: FrameData) => prims.filter((p) => p.t === "r" && primitiveUsageSlotVisible(p, frame));
    expect(rects(one)).toEqual([]);
    expect(rects(two)).toHaveLength(dividers);
  });

  it.each(catalogIds)("%s: no art around the second limit's bar", (themeId) => {
    const pack = loadPack(themeId), prims = pack.spec?.p ?? [];
    const artAt = staticArt(pack, (p) => primitiveUsageSlotVisible(p, one));
    for (const bar of prims.filter((p) => p.t === "p" && slotOf(p) === 2)) {
      const colours = new Set<string>();
      for (let y = (bar.y ?? 0) - 4; y < (bar.y ?? 0) + (bar.h ?? 0) + 4; y++) for (let x = (bar.x ?? 0) - 4; x < (bar.x ?? 0) + (bar.w ?? 0) + 4; x++) colours.add(artAt(x, y));
      expect([...colours]).toHaveLength(1);
    }
  });

  it("Pixel Battery draws the second battery with two windows", () => {
    const prims = loadPack("pixel-battery").spec?.p ?? [];
    const second = (frame: FrameData) => prims.filter((p) => p.a === "/themes/u/pba-b2.cbi" && primitiveUsageSlotVisible(p, frame));
    expect(second(one)).toEqual([]);
    expect(second(two)).toHaveLength(1);
  });
});
