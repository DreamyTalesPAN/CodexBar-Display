// The Appearance page filters what it already has: the library rows (catalog
// plus the customer's own) by name, by install status and, once the catalog
// carries them, by theme tags. Within one group the options are OR, across
// groups they are AND.
import type { ThemeProduct } from "./themes";

export type FilterOption = { id: string; label: string };
export type FilterGroup = { id: string; title: string; options: FilterOption[] };

/** What a library row offers the filters. Own themes carry no tags. */
export type FilterableRow = {
  name: string;
  installed: boolean;
  updateAvailable: boolean;
  tags: readonly string[];
};

// The tag ids are the vocabulary of the theme catalog (protocol/theme_tags.json).
export const FILTER_GROUPS: FilterGroup[] = [
  {
    id: "status",
    title: "Status",
    options: [
      { id: "installed", label: "Installed" },
      { id: "update-available", label: "Update available" },
    ],
  },
  {
    id: "features",
    title: "Features",
    options: [
      { id: "agent-states", label: "Agent states" },
      { id: "animated", label: "Animated" },
      { id: "clock", label: "Clock" },
      { id: "usage-stats", label: "Usage stats" },
      { id: "pixel-art", label: "Pixel art" },
    ],
  },
  {
    id: "providers",
    title: "Providers shown",
    options: [
      { id: "providers-1", label: "1 provider" },
      { id: "providers-2", label: "2 providers" },
      { id: "providers-3plus", label: "3 or more" },
    ],
  },
];

/** The tags a catalog theme carries; none while the catalog has no tags. */
export function productTags(
  product: ThemeProduct & { tags?: readonly string[] },
): readonly string[] {
  return product.tags ?? [];
}

function optionMatches(row: FilterableRow, optionId: string): boolean {
  if (optionId === "installed") return row.installed;
  if (optionId === "update-available") return row.updateAvailable;
  return row.tags.includes(optionId);
}

/**
 * The groups worth showing: Status always, the tag groups only when some row
 * carries one of their tags (a catalog without tags has nothing to filter by).
 */
export function visibleFilterGroups(rows: readonly FilterableRow[]): FilterGroup[] {
  return FILTER_GROUPS.filter(
    (group) =>
      group.id === "status" ||
      group.options.some((option) => rows.some((row) => optionMatches(row, option.id))),
  );
}

export function matchesQuery(name: string, query: string): boolean {
  const wanted = query.trim().toLowerCase();
  return wanted === "" || name.toLowerCase().includes(wanted);
}

export function matchesFilters(
  row: FilterableRow,
  groups: readonly FilterGroup[],
  selected: readonly string[],
): boolean {
  return groups.every((group) => {
    const picked = group.options.filter((option) => selected.includes(option.id));
    return picked.length === 0 || picked.some((option) => optionMatches(row, option.id));
  });
}

export function optionCount(rows: readonly FilterableRow[], optionId: string): number {
  return rows.filter((row) => optionMatches(row, optionId)).length;
}
