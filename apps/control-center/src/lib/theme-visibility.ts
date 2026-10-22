import type { ThemeProduct } from "./themes";

// A theme its pack marks "listed": false, such as a theme made for one company
// (#935), is installed through its setup link, not picked from a list. It shows
// only while it is one of the given themes: the one from the link, the one
// selected, or the one VibeTV has installed, so the customer can switch away
// and back.
export function listedThemes(
  themes: ThemeProduct[],
  shownThemeIds: Array<string | null | undefined>,
): ThemeProduct[] {
  const shown = new Set(shownThemeIds.filter(Boolean));
  return themes.filter(
    (theme) => theme.listed !== false || shown.has(theme.themeId),
  );
}
