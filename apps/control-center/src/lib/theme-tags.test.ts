import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  findUnknownThemeTags,
  readThemeTags,
  THEME_FEATURE_TAGS,
  THEME_PROVIDER_TAGS,
} from "./theme-tags";

const root = path.resolve(process.cwd(), "../..");
const registry = JSON.parse(
  readFileSync(path.join(root, "protocol/theme_tags.json"), "utf8"),
) as {
  vocabulary: { features: string[]; providers: string[] };
  packs: Record<string, string[]>;
};
const catalog = JSON.parse(
  readFileSync(path.join(root, "dist/theme-packs/vibetv-theme-packs-v2.json"), "utf8"),
) as { themes: Array<{ id: string; tags?: string[] }> };

describe("theme tag schema", () => {
  it("accepts tags from the vocabulary", () => {
    expect(findUnknownThemeTags(["animated", "clock", "providers-2"])).toEqual([]);
  });

  it("rejects an unknown tag", () => {
    expect(findUnknownThemeTags(["animated", "wizard"])).toEqual(["wizard"]);
  });

  it("ignores unknown tags and non-string values at read time", () => {
    expect(readThemeTags(["animated", "wizard", 3, null, "providers-1"])).toEqual(["animated", "providers-1"]);
  });

  it("gives no tags when the catalog has none", () => {
    expect(readThemeTags(undefined)).toEqual([]);
    expect(readThemeTags("animated")).toEqual([]);
  });

  it("keeps the TypeScript vocabulary equal to protocol/theme_tags.json", () => {
    expect([...THEME_FEATURE_TAGS]).toEqual(registry.vocabulary.features);
    expect([...THEME_PROVIDER_TAGS]).toEqual(registry.vocabulary.providers);
  });
});

describe("theme pack tags", () => {
  it("uses only vocabulary tags for every pack", () => {
    for (const [themeId, tags] of Object.entries(registry.packs)) {
      expect(findUnknownThemeTags(tags), themeId).toEqual([]);
      expect(new Set(tags).size, themeId).toBe(tags.length);
    }
  });

  it("gives each pack at most one provider-count tag", () => {
    for (const [themeId, tags] of Object.entries(registry.packs)) {
      const counts = tags.filter((tag) => tag.startsWith("providers-"));
      expect(counts.length, themeId).toBeLessThanOrEqual(1);
    }
  });

  it("names only packs that exist in theme-packs/", () => {
    const packs = readdirSync(path.join(root, "theme-packs"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    for (const themeId of Object.keys(registry.packs)) {
      expect(packs, themeId).toContain(themeId);
      expect(existsSync(path.join(root, "theme-packs", themeId, "manifest.json")), themeId).toBe(true);
    }
  });

  it("ships the same tags in the generated catalog", () => {
    for (const theme of catalog.themes) {
      expect(theme.tags ?? [], theme.id).toEqual(registry.packs[theme.id] ?? []);
      expect(findUnknownThemeTags(theme.tags ?? []), theme.id).toEqual([]);
    }
  });
});
