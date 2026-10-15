// The theme that came with the VibeTV the customer bought, from the shop link
// /install/<id> (#234). Setup preselects it; the customer still installs it
// with Install. Kept here so the choice survives an app restart during setup,
// which opens the app without the link. Forgotten once a theme is installed or
// the VibeTV already shows it.

const STORAGE_KEY = "vibetv.controlCenter.orderedTheme";

export function storedOrderedTheme(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    // localStorage may be unavailable in private or restricted browser contexts.
    return "";
  }
}

export function rememberOrderedTheme(themeId: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, themeId);
  } catch {
    // See above.
  }
}

export function forgetOrderedTheme() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // See above.
  }
}
