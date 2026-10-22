/**
 * The theme grid of the Appearance tab, shared with the setup theme step: cards
 * are 200 px wide with 32 px between them, three in a row at most, as a group in
 * the middle of the page (7197 review, point 8). gap-8!: ItemGroup's own gap for
 * small items (gap-2.5) would win.
 */
export const THEME_GRID_CLASS = "mx-auto grid max-w-[664px] justify-center gap-8!";

export const THEME_GRID_STYLE = { gridTemplateColumns: "repeat(auto-fill, 200px)" };
