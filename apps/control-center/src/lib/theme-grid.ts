/**
 * The theme grid of the Appearance tab, shared with the setup theme step: cards
 * are 200 px wide with 32 px between them, as many in a row as the width fits,
 * as a group in the middle of the page (7197 review, point 8). gap-8!: ItemGroup's
 * own gap for small items (gap-2.5) would win.
 */
export const THEME_GRID_CLASS = "mx-auto grid justify-center gap-8!";

export const THEME_GRID_STYLE = { gridTemplateColumns: "repeat(auto-fill, 200px)" };

/** A card title wraps to a second line; it is never cut off or shrunk. */
export const THEME_CARD_TITLE_CLASS = "min-w-0 break-words";
