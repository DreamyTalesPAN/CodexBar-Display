import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildFrameData, paceBarMarks, ThemeSpecPreview, type ThemeRenderPack,
} from "@/components/live-vibetv-preview";

// The eight themes of the approved page "Pace - alle Themes": what each shows in
// reserve, in deficit, on pace and without a pace (an engine that sends none).
const root = path.resolve(process.cwd(), "../..");
const clock = new Date("2026-10-19T12:00:00Z");
const reserve = [{ delta: -6, state: "reserve", lasts: true }, { delta: -35, state: "reserve", lasts: true }];
const deficit = [{ delta: 14, state: "deficit", lasts: false }, { delta: 0, state: "on pace" }];
const onPace = [{ delta: 0, state: "on pace" }, { delta: 0, state: "on pace" }];

function renderPack(id: string, pace: Array<Record<string, unknown>> | null, percent = [91, 87]) {
  const pack = JSON.parse(readFileSync(path.join(root, `dist/theme-packs/render/${id}.json`), "utf8")) as ThemeRenderPack;
  const frame = buildFrameData(clock.toISOString(), {
    provider: "claude", label: "Claude", usageMode: "remaining",
    usageSlots: [
      { id: "session", label: "Session", percent: percent[0], resetSecs: 12840, pace: pace?.[0] },
      { id: "weekly", label: "Weekly", percent: percent[1], resetSecs: 484800, pace: pace?.[1] },
    ],
  }, clock);
  const svg = renderToStaticMarkup(createElement(ThemeSpecPreview, { pack, themeId: id, status: "ready", animate: false, frame }));
  return { svg, text: svg.replace(/<[^>]*>/g, "") };
}
const manifestOf = (id: string) => JSON.parse(readFileSync(path.join(root, `theme-packs/${id}/manifest.json`), "utf8"));

const PACE_THEMES = ["pace-meter", "gauge", "claude-creature", "clippy", "mini-classic", "pixel-battery", "synthwave", "tiny-office"];
// Themes with a pace bar (or ring); Claude Creature and Mini Classic have only the short text.
const HAS_BAR = ["pace-meter", "gauge", "clippy", "pixel-battery", "synthwave", "tiny-office"];
const HAS_SENTENCE: Record<string, [string, string, string]> = {
  "pace-meter": ["6% reserve", "14% deficit", "On pace"],
  gauge: ["6% reserve", "14% deficit", "On pace"],
  clippy: ["6% reserve", "14% deficit", "On pace"],
  "pixel-battery": ["6% reserve", "14% deficit", "On pace"],
  synthwave: ["6% reserve", "14% deficit", "On pace"],
  "claude-creature": ["6% reserve", "14% deficit", "on pace"],
  "mini-classic": ["6% reserve", "14% deficit", "on pace"],
};

describe("the Pace themes", () => {
  it.each(HAS_BAR)("%s uses the same exact 40% deficit and 6% reserve boundaries", (id) => {
    const pack = JSON.parse(readFileSync(path.join(root, `dist/theme-packs/render/${id}.json`), "utf8")) as ThemeRenderPack;
    const bars = pack.spec!.p!.filter((p) => /Pace$/.test(p.b || p.binding || ""));
    expect(bars.length).toBeGreaterThan(0);
    for (const [percent, delta, state, fillTo, pieceTo] of [
      [96, 40, "deficit", 56, 96], [50, -6, "reserve", 50, 56],
    ] as const) {
      const frame = buildFrameData(clock.toISOString(), {
        provider: "claude", usageMode: "used", usageSlots: ["session", "weekly"].map((id) => ({
          id, label: id, percent, resetSecs: 12000, pace: { delta, state },
        })),
      }, clock);
      for (const bar of bars) {
        expect(paceBarMarks(bar, frame, percent)).toEqual({ fillTo, pieceTo, planAt: 56, hatched: state === "deficit" });
      }
    }
  });

  it.each(PACE_THEMES)("%s needs usage-pace-v1 and the firmware that ships it", (id) => {
    const manifest = manifestOf(id);
    expect(manifest.requiredCapabilities).toContain("usage-pace-v1");
    expect(manifest.minFirmware).toBe("1.0.50");
  });

  it.each(Object.keys(HAS_SENTENCE))("%s says reserve, deficit and on pace as drawn on the page", (id) => {
    const [inReserve, inDeficit, atPace] = HAS_SENTENCE[id];
    expect(renderPack(id, reserve).text).toContain(inReserve);
    expect(renderPack(id, deficit, [38, 61]).text).toContain(inDeficit);
    expect(renderPack(id, onPace).text).toContain(atPace);
    // Without a pace no pace sentence is drawn at all.
    const none = renderPack(id, null).text;
    for (const sentence of [inReserve, inDeficit, atPace, "reserve", "deficit"]) {
      expect(none, `${id} without pace`).not.toContain(sentence);
    }
  });

  it.each(HAS_BAR)("%s draws the plan tick, the piece and the hatch only with a pace", (id) => {
    const tick = (svg: string) => (svg.match(/fill="#FFFFFF"[^>]*width="2"|width="2"[^>]*fill="#FFFFFF"|stroke="#FFFFFF"[^>]*stroke-width="2"/g) || []).length;
    expect(tick(renderPack(id, null).svg)).toBe(0);
    // One tick per bar; Gauge has the ring of the session only.
    const ticks = id === "gauge" ? 1 : 2;
    expect(tick(renderPack(id, reserve).svg)).toBe(ticks);
    expect(tick(renderPack(id, onPace).svg)).toBe(ticks);
    expect(renderPack(id, reserve).svg).not.toContain("<pattern");
    expect(renderPack(id, deficit, [38, 61]).svg).toContain("<pattern");
    // On pace has the tick and no piece: no hatch either.
    expect(renderPack(id, onPace).svg).not.toContain("<pattern");
  });

  it.each(["claude-creature", "mini-classic"])("%s gets no bar, only the short text", (id) => {
    expect(renderPack(id, reserve).svg).not.toContain('width="2"');
    expect(manifestOf(id).requiredCapabilities).not.toContain("progress-arc-v1");
    const spec = JSON.parse(readFileSync(path.join(root, `theme-packs/${id}/theme.json`), "utf8"));
    expect(spec.p.filter((p: { t: string }) => p.t === "p")).toEqual([]);
  });

  it("Pace Meter is one provider with a session and a weekly lane and the run-out note", () => {
    const { text } = renderPack("pace-meter", deficit, [38, 61]);
    expect(text).toBe("Claude38%Session leftresets 3h 34m14% deficitruns out61%Weekly leftresets 5d 14hOn pace");
    expect(renderPack("pace-meter", reserve).text).toBe("Claude91%Session leftresets 3h 34m6% reserve87%Weekly leftresets 5d 14h35% reserve");
    // Without a pace: percentage, label, countdown and the plain bar stay.
    expect(renderPack("pace-meter", null).text).toBe("Claude91%Session leftresets 3h 34m87%Weekly leftresets 5d 14h");
  });

  it("Pixel Battery keeps the traffic-light colours of what is left under the piece", () => {
    const { svg } = renderPack("pixel-battery", deficit, [38, 61]);
    expect(svg).toContain('fill="#F97316"'); // 38 % left
    expect(svg).toContain('fill="#FACC15"'); // 61 % left
  });
});
