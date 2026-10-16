// The theme that came with the VibeTV the customer bought, from the shop link
// /install/<id> (#234). Setup preselects it; the customer still installs it
// with Install. Kept here so the choice survives an app restart during setup,
// which opens the app without the link. Forgotten once a theme is installed or
// the VibeTV already shows it.

const STORAGE_KEY = "vibetv.controlCenter.orderedTheme";

// recordedAt lets an install that finished before the order (one the Companion
// still reports from earlier) be told apart from the customer's answer to it.
export type OrderedTheme = { themeId: string; recordedAt: number };

export function storedOrderedTheme(): OrderedTheme | null {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
    return typeof stored?.themeId === "string" && typeof stored?.recordedAt === "number"
      ? { themeId: stored.themeId, recordedAt: stored.recordedAt }
      : null;
  } catch {
    // localStorage may be unavailable in private or restricted browser contexts.
    return null;
  }
}

export function rememberOrderedTheme(themeId: string): OrderedTheme {
  const ordered = { themeId, recordedAt: Date.now() };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ordered));
  } catch {
    // See above.
  }
  return ordered;
}

export function forgetOrderedTheme() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // See above.
  }
}
