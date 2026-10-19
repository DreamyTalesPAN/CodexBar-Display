import { describe, expect, it } from "vitest";
import {
  matchesFilters,
  matchesQuery,
  optionCount,
  productTags,
  visibleFilterGroups,
  type FilterableRow,
} from "./appearance-filters";
import type { ThemeProduct } from "./themes";

const row = (name: string, over: Partial<FilterableRow> = {}): FilterableRow => ({
  name,
  installed: false,
  updateAvailable: false,
  tags: [],
  ...over,
});

// Tags as the theme catalog carries them (protocol/theme_tags.json).
const tagged = [
  row("Claude Creature", { installed: true, tags: ["animated", "pixel-art", "providers-1"] }),
  row("Clippy", { updateAvailable: true, tags: ["animated", "agent-states", "providers-2"] }),
  row("Night Clock", { tags: ["clock", "providers-2"] }),
  row("Token Counter", { tags: ["usage-stats", "providers-1"] }),
];
const untagged = [row("Gauge"), row("Synthwave", { installed: true })];

const ids = (rows: FilterableRow[], selected: string[]) => {
  const groups = visibleFilterGroups(rows);
  return rows.filter((r) => matchesFilters(r, groups, selected)).map((r) => r.name);
};

describe("visibleFilterGroups", () => {
  it("shows Features and Providers shown only when the catalog carries tags", () => {
    expect(visibleFilterGroups(untagged).map((group) => group.title)).toEqual(["Status"]);
    expect(visibleFilterGroups(tagged).map((group) => group.title)).toEqual([
      "Status",
      "Features",
      "Providers shown",
    ]);
  });

  it("labels the options as the Appearance page draws them", () => {
    const groups = visibleFilterGroups(tagged);
    expect(groups.map((group) => group.options.map((option) => option.label))).toEqual([
      ["Installed", "Update available"],
      ["Agent states", "Animated", "Clock", "Usage stats", "Pixel art"],
      ["1 provider", "2 providers", "3 or more"],
    ]);
  });
});

describe("matchesFilters", () => {
  it("matches any option of one group (OR)", () => {
    expect(ids(tagged, ["clock", "usage-stats"])).toEqual(["Night Clock", "Token Counter"]);
  });

  it("needs every picked group (AND)", () => {
    expect(ids(tagged, ["animated", "providers-2"])).toEqual(["Clippy"]);
    expect(ids(tagged, ["animated", "installed"])).toEqual(["Claude Creature"]);
  });

  it("filters by status from what the app knows", () => {
    expect(ids(untagged, ["installed"])).toEqual(["Synthwave"]);
    expect(ids(tagged, ["update-available"])).toEqual(["Clippy"]);
  });

  it("lists everything while nothing is picked, tags or not", () => {
    expect(ids(untagged, [])).toEqual(["Gauge", "Synthwave"]);
  });

  it("ignores a picked tag whose group is not shown (a catalog without tags)", () => {
    expect(ids(untagged, ["animated"])).toEqual(["Gauge", "Synthwave"]);
  });
});

describe("optionCount", () => {
  it("counts the rows that carry an option", () => {
    expect(optionCount(tagged, "animated")).toBe(2);
    expect(optionCount(tagged, "providers-2")).toBe(2);
    expect(optionCount(tagged, "providers-3plus")).toBe(0);
    expect(optionCount(tagged, "installed")).toBe(1);
    expect(optionCount(tagged, "update-available")).toBe(1);
  });
});

describe("matchesQuery", () => {
  it("matches the name only, ignoring case and surrounding spaces", () => {
    expect(matchesQuery("Claude Creature", "  creAT ")).toBe(true);
    expect(matchesQuery("Claude Creature", "pixel")).toBe(false);
    expect(matchesQuery("Claude Creature", "")).toBe(true);
  });
});

describe("productTags", () => {
  it("reads the tags of a catalog theme and gives none for a catalog without", () => {
    const base = { id: "x", title: "X" } as ThemeProduct;
    expect(productTags(base)).toEqual([]);
    expect(productTags({ ...base, tags: ["clock"] })).toEqual(["clock"]);
  });
});
