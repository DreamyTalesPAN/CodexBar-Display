// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { createBlankThemeSpec, validateThemeSpec } from "@/lib/theme-studio";
import { OverviewScreen } from "./overview-screen";

// The themes the customer saved in Theme Studio.
const saved = vi.hoisted(() => ({ themes: [] as unknown[] }));
vi.mock("@/lib/theme-studio-storage", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadUserThemes: () => ({ ok: true, value: { themes: saved.themes } }),
}));
afterEach(() => {
  saved.themes = [];
});

// These were Support tests while Support showed the active theme; the Overview
// "Display" figure names the theme the same way.
// Seen on a real VibeTV in standby: Support named the screensaver as the
// active theme while the customer's live theme was Mini Classic.
it("names the live theme while the screensaver is on screen", () => {
  const html = renderToStaticMarkup(
    <OverviewScreen companionStatus="online"
      device={{
        active: true,
        connected: true,
        paired: true,
        ready: true,
        activeTheme: "night-clock",
        standby: {
          active: true,
          liveThemePath: "/themes/u/mini-cl-9-6d1af3.json",
          screensaverPath: "/themes/s/nc-3-e18e4217.json",
        },
      }}
      themes={[
        {
          id: "mini-classic",
          isFree: true,
          priceLabel: "Free",
          source: "github-catalog",
          themeId: "mini-classic",
          themeSpecPath: "/themes/u/mini-cl-9-6d1af3.json",
          title: "Mini Classic",
        },
      ]}
    />,
  );

  expect(html).toContain("Mini Classic");
  expect(html).not.toContain("Night Clock");
});

it("does not name the screensaver as active theme when a Theme Studio theme is live", () => {
  const html = renderToStaticMarkup(
    <OverviewScreen companionStatus="online"
      device={{
        active: true,
        connected: true,
        paired: true,
        ready: true,
        activeTheme: "retro-3d",
        standby: {
          active: true,
          liveThemePath: "/themes/u/my-the-1-0a1b2c.json",
          screensaverPath: "/themes/s/r3d-2-d2a77fd8.json",
        },
      }}
      themes={[]}
    />,
  );

  expect(html).toContain("Custom theme");
  expect(html).not.toContain("Retro 3d");
});

// Seen on the Mac app on 2026-10-09: a theme saved as "New Theme" was called
// "My Theme" here, made up from its id, while Themes called it "New Theme".
it("calls a theme the customer saved by the name they gave it", () => {
  const spec = { ...createBlankThemeSpec(), themeId: "my-theme-3" };
  saved.themes = [
    { id: "u-1", updatedAt: "2026-10-09T00:00:00Z", document: { assets: {}, packName: "New Theme", spec } },
  ];
  const themeLabel = (device: Record<string, unknown>) =>
    renderToStaticMarkup(
      <OverviewScreen companionStatus="online" device={{ active: true, connected: true, paired: true, ready: true, ...device }} themes={[]} />,
    );

  const awake = themeLabel({ activeTheme: "my-theme-3" });
  expect(awake).toContain("New Theme");
  expect(awake).not.toContain("My Theme 3");

  // In standby VibeTV reports the live theme as its file only.
  const asleep = themeLabel({
    activeTheme: "retro-3d",
    standby: { active: true, liveThemePath: validateThemeSpec(spec, {}, "live").themeSpecPath },
  });
  expect(asleep).toContain("New Theme");
  expect(asleep).not.toContain("Custom theme");

  // A theme that is not in the library keeps the name made from its id.
  expect(themeLabel({ activeTheme: "other-theme" })).toContain("Other Theme");
});

// Found in review: a later catalog can give one of its themes the id of a
// theme the customer saved. Awake, VibeTV reports that id for both, and the
// customer's theme was then called by the catalog theme's name. The file
// VibeTV holds tells them apart.
it("tells the customer's theme from a catalog theme of the same id by the file VibeTV holds", () => {
  const spec = { ...createBlankThemeSpec(), themeId: "mini-classic" };
  saved.themes = [
    { id: "u-1", updatedAt: "2026-10-09T00:00:00Z", document: { assets: {}, packName: "Night Shift", spec } },
  ];
  const catalogPath = "/themes/u/mini-cl-9-6d1af3.json";
  const themeLabel = (path: string) =>
    renderToStaticMarkup(
      <OverviewScreen companionStatus="online"
        device={{
          active: true, connected: true, paired: true, ready: true,
          activeTheme: "mini-classic",
          display: { themeSpec: { path } },
        }}
        themes={[
          {
            id: "mini-classic", isFree: true, priceLabel: "Free", source: "github-catalog",
            themeId: "mini-classic", themeSpecPath: catalogPath, title: "Mini Classic",
          },
        ]}
      />,
    );

  const own = themeLabel(validateThemeSpec(spec, {}, "live").themeSpecPath);
  expect(own).toContain("Night Shift");
  expect(own).not.toContain("Mini Classic");

  const catalog = themeLabel(catalogPath);
  expect(catalog).toContain("Mini Classic");
  expect(catalog).not.toContain("Night Shift");
});

// Found in review: a later catalog can give one of its themes the id of a
// theme the customer saved. Awake, VibeTV reports that id for both, and the
// customer's theme was then called by the catalog theme's name. The file
// VibeTV holds tells them apart.
it("tells the customer's theme from a catalog theme of the same id by the file VibeTV holds", () => {
  const spec = { ...createBlankThemeSpec(), themeId: "mini-classic" };
  saved.themes = [
    { id: "u-1", updatedAt: "2026-10-09T00:00:00Z", document: { assets: {}, packName: "Night Shift", spec } },
  ];
  const catalogPath = "/themes/u/mini-cl-9-6d1af3.json";
  const themeLabel = (path: string) =>
    renderToStaticMarkup(
      <OverviewScreen companionStatus="online"
        device={{
          active: true, connected: true, paired: true, ready: true,
          activeTheme: "mini-classic",
          display: { themeSpec: { path } },
        }}
        themes={[
          {
            id: "mini-classic", isFree: true, priceLabel: "Free", source: "github-catalog",
            themeId: "mini-classic", themeSpecPath: catalogPath, title: "Mini Classic",
          },
        ]}
      />,
    );

  const own = themeLabel(validateThemeSpec(spec, {}, "live").themeSpecPath);
  expect(own).toContain("Night Shift");
  expect(own).not.toContain("Mini Classic");

  const catalog = themeLabel(catalogPath);
  expect(catalog).toContain("Mini Classic");
  expect(catalog).not.toContain("Night Shift");
});


// Codex review: a catalog theme is called by its title, not by a name made up
// from its id.
it("calls a catalog theme by its title", () => {
  const html = renderToStaticMarkup(
    <OverviewScreen
      companionStatus="online"
      device={{ active: true, connected: true, paired: true, ready: true, activeTheme: "synthwave" }}
      themes={[
        {
          id: "synthwave", isFree: true, priceLabel: "Free", source: "github-catalog",
          themeId: "synthwave", title: "Synthwave Shop",
        },
      ]}
    />,
  );

  expect(html).toContain("Synthwave Shop");
  expect(html).not.toContain(">Synthwave<");
});
