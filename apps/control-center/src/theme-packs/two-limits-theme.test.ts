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
      label: "Claude + Codex",
      usageMode: "used",
      usageWindows: [
        {
          id: "claude:weekly",
          label: "Claude Weekly",
          percent: 72,
          resetSecs: 360000,
          ...(pace ? { pace: { delta: 31, state: "deficit" } } : {}),
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
  });

  // Settings reads the same answer to say what the theme has room for.
  it("has room for two limits and the reserve or deficit", () => {
    expect(themeLimitsFromPack(pack)).toEqual({
      limits: 2,
      name: "Two Limits",
      showsPace: true,
    });
  });

  it("shows both providers with the deficit the usage engine sent", () => {
    const screen = screenText(render());

    expect(screen).toContain("Claude + Codex");
    expect(screen).toContain("Claude Weekly");
    expect(screen).toContain("Codex Weekly");
    expect(screen).toContain("72% used");
    expect(screen).toContain("+31%deficit");
  });

  it("leaves the pace out when the usage engine sent none", () => {
    const screen = screenText(render(pairFrame(false)));

    expect(screen).toContain("72% used");
    expect(screen).not.toContain("deficit");
  });
});

describe("theme room for limits", () => {
  const packOf = (id: string) =>
    JSON.parse(read(`dist/theme-packs/render/${id}.json`)) as ThemeRenderPack;

  it("counts the usage limits a shipped theme shows", () => {
    expect(themeLimitsFromPack(packOf("mini-classic"))).toMatchObject({ limits: 2, showsPace: false });
    expect(themeLimitsFromPack(packOf("reset-countdown"))).toMatchObject({ limits: 1 });
    // Provider slots name a provider's next reset, not the customer's limits.
    expect(themeLimitsFromPack(packOf("night-clock"))).toMatchObject({ limits: 0 });
  });
});
