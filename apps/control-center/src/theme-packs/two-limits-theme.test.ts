import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildFrameData,
  themeLimitsFromPack,
  ThemeSpecPreview,
  type ThemeRenderPack,
} from "@/components/live-vibetv-preview";
import { importThemeSpec, validateThemeSpec } from "@/lib/theme-studio";

const root = path.resolve(process.cwd(), "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const pack = JSON.parse(read("dist/theme-packs/render/two-limits.json")) as ThemeRenderPack;
const rawSpec = read("theme-packs/two-limits/theme.json");
const manifest = JSON.parse(read("theme-packs/two-limits/manifest.json"));
const clock = new Date("2026-10-09T08:00:00Z");
// What the screen reads: the preview sets every glyph on its own.
const screenText = (html: string) => html.replace(/<[^>]+>/g, "");

// Two at once as the companion sends it: each provider's first shown limit,
// named after its provider, with CodexBar's pace where it sent one.
function pairFrame(pace = true) {
  return buildFrameData(
    clock.toISOString(),
    {
      provider: "claude+codex",
      label: "",
      usageMode: "used",
      usageWindows: [
        {
          id: "claude:weekly",
          label: "Claude Weekly",
          percent: 72,
          resetSecs: 360000,
          ...(pace ? { pace: { delta: 31, state: "deficit", lasts: false } } : {}),
        },
        { id: "codex:weekly", label: "Codex Weekly", percent: 32, resetSecs: 420000 },
      ],
    },
    clock,
  );
}

function render(frame = pairFrame()) {
  return renderToStaticMarkup(
    createElement(ThemeSpecPreview, {
      animate: false,
      frame,
      pack,
      status: "ready",
      themeId: "two-limits",
    }),
  );
}

describe("Two Limits theme pack", () => {
  it("passes Theme Studio validation and declares what it needs", () => {
    const spec = importThemeSpec(JSON.parse(rawSpec));
    expect(validateThemeSpec(spec, {}, "live").errors).toEqual([]);
    expect(Buffer.byteLength(rawSpec)).toBeLessThan(2048);
    expect(manifest.requiredCapabilities).toEqual(
      expect.arrayContaining(["usage-slots-v1", "color-stops-v1", "usage-pace-v1"]),
    );
    // The pace firmware of the other Pace themes.
    expect(manifest.minFirmware).toBe("1.0.50");
  });

  // Settings reads the same answer to say what the theme has room for.
  it("has room for two limits", () => {
    expect(themeLimitsFromPack(pack)).toEqual({ limits: 2, name: "Two Limits" });
  });

  it("shows both providers with the deficit the usage engine sent", () => {
    const screen = screenText(render());

    expect(screen).not.toContain("Claude + Codex");
    // The wire contract offers a combined provider/window label, not two fields.
    expect(screen).toContain("Claude Weekly used");
    expect(screen).toContain("Codex Weekly used");
    expect(screen).toContain("72%");
    expect(screen).toContain("32%");
    expect(screen).not.toMatch(/\d+% (used|left|remaining)/);
    expect(screen).not.toMatch(/resets/i);
    // The sentence and the pace bar are the ones of the other Pace themes.
    expect(screen).toContain("31% in deficit");
    const html = render();
    expect(html).toContain("<pattern");
    expect(html).toMatch(/<pattern\b[^>]*>[\s\S]*?fill="#E7A3AC"[\s\S]*?<\/pattern>/);
    expect(html).toMatch(/fill="#FFFFFF"[^>]*width="2"|width="2"[^>]*fill="#FFFFFF"/);
  });

  it.each([
    { state: "reserve", delta: -6, sentence: "6% in reserve", color: "#C9F26B" },
    { state: "on pace", delta: 0, sentence: "On pace", color: "#EDEDED" },
    { state: "deficit", delta: 14, sentence: "14% in deficit", color: "#E7A3AC" },
  ])("shows small $state sentences in the state colour for both limits", ({ state, delta, sentence, color }) => {
    const frame = pairFrame();
    frame.usageWindows.forEach((window) => { window.pace = { state, delta }; });
    const html = render(frame);
    const sentences = [...html.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)]
      .filter(([, , text]) => screenText(text) === sentence);

    expect(sentences).toHaveLength(2);
    for (const [, attributes] of sentences) {
      expect(attributes).toContain(`fill="${color}"`);
      expect(attributes).toContain('font-size="8"');
    }
  });

  it("leaves the pace out when the usage engine sent none", () => {
    const screen = screenText(render(pairFrame(false)));

    expect(screen).toContain("72%");
    expect(screen).not.toContain("deficit");
    expect(render(pairFrame(false))).not.toContain("<pattern");
  });

  it("hides absent limits without inventing percentages or pace", () => {
    const frame = buildFrameData(clock.toISOString(), {
      provider: "claude+codex", label: "", usageWindows: [],
    }, clock);
    const html = render(frame);

    // Existing slot visibility hides missing data; it has no dash binding.
    expect(screenText(html)).toBe("");
    expect(screenText(html)).not.toMatch(/\d+%|reserve|deficit|On pace/);
    expect(html).not.toContain("<pattern");
  });

  it("keeps device notices visible without adding a reset line", () => {
    const html = render({ ...pairFrame(), updateNotice: "Update available" });
    expect(screenText(html)).toContain("Update available");
    expect(screenText(html)).not.toMatch(/resets/i);
  });
});

describe("theme room for limits", () => {
  const packOf = (id: string) =>
    JSON.parse(read(`dist/theme-packs/render/${id}.json`)) as ThemeRenderPack;

  it("counts the usage limits a shipped theme shows", () => {
    expect(themeLimitsFromPack(packOf("mini-classic"))).toMatchObject({ limits: 2 });
    expect(themeLimitsFromPack(packOf("reset-countdown"))).toMatchObject({ limits: 1 });
    // Provider slots name a provider's next reset, not the customer's limits.
    expect(themeLimitsFromPack(packOf("night-clock"))).toMatchObject({ limits: 0 });
  });
});
