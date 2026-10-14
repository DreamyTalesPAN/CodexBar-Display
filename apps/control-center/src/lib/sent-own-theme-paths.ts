// The files this app sent to VibeTV for themes and screensavers the customer
// made. The library alone does not name them all: a theme edited and saved
// since is sent under another path, and a deleted one has none, while VibeTV
// still holds the file that was sent.

const STORAGE_KEY = "vibetv.controlCenter.sentOwnThemePaths";
const KEPT = 50;

export function sentOwnThemePaths(): string[] {
  try {
    const stored: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) || "[]",
    );
    return Array.isArray(stored)
      ? stored.filter((path): path is string => typeof path === "string")
      : [];
  } catch {
    // localStorage may be unavailable in private or restricted browser contexts.
    return [];
  }
}

export function rememberSentOwnThemePath(path: string) {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        [...sentOwnThemePaths().filter((sent) => sent !== path), path].slice(
          -KEPT,
        ),
      ),
    );
  } catch {
    // See above.
  }
}
