// Theme tags for the Features and Providers filters. The vocabulary is the
// schema enum in protocol/theme_tags.json; these constants mirror it, and
// theme-tags.test.ts fails when they drift apart.
export const THEME_FEATURE_TAGS = [
  "agent-states",
  "animated",
  "clock",
  "usage-stats",
  "pixel-art",
] as const;

// How many providers the theme shows at once: one provider line, or two provider slots.
export const THEME_PROVIDER_TAGS = ["providers-1", "providers-2", "providers-3plus"] as const;

export type ThemeTag =
  | (typeof THEME_FEATURE_TAGS)[number]
  | (typeof THEME_PROVIDER_TAGS)[number];

const KNOWN_THEME_TAGS = new Set<string>([
  ...THEME_FEATURE_TAGS,
  ...THEME_PROVIDER_TAGS,
]);

// Strict check for the catalog generator and tests: returns the tags that are
// not in the vocabulary.
export function findUnknownThemeTags(tags: readonly string[]): string[] {
  return tags.filter((tag) => !KNOWN_THEME_TAGS.has(tag));
}

// Readers keep only known tags. A tag from a newer catalog is ignored, and a
// catalog without tags gives no tags.
export function readThemeTags(value: unknown): ThemeTag[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (tag): tag is ThemeTag => typeof tag === "string" && KNOWN_THEME_TAGS.has(tag),
  );
}
