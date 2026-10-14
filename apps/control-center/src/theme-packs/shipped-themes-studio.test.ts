import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ThemeRenderPack } from "@/components/live-vibetv-preview";
import { importThemeSpec, validateThemeSpec } from "@/lib/theme-studio";

const root = path.resolve(process.cwd(), "../..");
const catalog = JSON.parse(readFileSync(path.join(root, "dist/theme-packs/vibetv-theme-packs-v2.json"), "utf8")) as {
  themes: { id: string; usage: string }[];
};

// Theme Studio opens every shipped theme as a starting point, so its checks
// must accept whatever the catalog ships to VibeTV.
describe("shipped themes in Theme Studio", () => {
  it.each(catalog.themes)("$id passes validation", ({ id, usage }) => {
    const pack = JSON.parse(readFileSync(path.join(root, "dist/theme-packs/render", `${id}.json`), "utf8")) as ThemeRenderPack;
    const spec = JSON.parse(readFileSync(path.join(root, "theme-packs", id, "theme.json"), "utf8"));
    expect(validateThemeSpec(importThemeSpec(spec), pack.assets || {}, usage === "screensaver" ? "screensaver" : "live").errors).toEqual([]);
  });
});
