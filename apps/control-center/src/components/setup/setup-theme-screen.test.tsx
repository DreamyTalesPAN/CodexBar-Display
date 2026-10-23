import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SetupThemeScreen, type SetupThemeOption } from "./setup-theme-screen";
import { THEME_CARD_TITLE_CLASS, THEME_GRID_CLASS, THEME_GRID_STYLE } from "@/lib/theme-grid";

// The four live themes of the shipped catalog. A screensaver cannot be the
// first install: it leaves the live slot empty and setup could never finish.
const themes: SetupThemeOption[] = [
  { id: "claude-creature", name: "Claude Creature" },
  { id: "clippy", name: "Clippy" },
  { id: "mini-classic", name: "Mini Classic" },
  { id: "synthwave", name: "Synthwave" },
];

function render(props: Partial<Parameters<typeof SetupThemeScreen>[0]> = {}) {
  return renderToStaticMarkup(
    <SetupThemeScreen
      onInstall={vi.fn()}
      onSelect={vi.fn()}
      selectedThemeId="clippy"
      themes={themes}
      {...props}
    />,
  );
}

describe("SetupThemeScreen", () => {
  it("offers every theme it was given", () => {
    const html = render();

    for (const theme of themes) {
      expect(html).toContain(theme.name);
    }
  });

  it("keeps the theme title at the shared 28px step and shows a square preview", () => {
    const html = render();

    expect(html).toContain("text-[28px]");
    expect(html).not.toContain("text-[40px]");
    expect(html).toContain("aspect-square w-full rounded-[6px]");
  });

  it("shows the themes in the Appearance grid: one card per theme, as many across as fit", () => {
    const html = render();

    expect(html).toContain(THEME_GRID_CLASS);
    expect(html).toContain(THEME_GRID_STYLE.gridTemplateColumns);
    expect(html.match(/role="radio"/g)).toHaveLength(themes.length);
  });

  it("wraps a long theme name to a second line instead of cutting it off", () => {
    const html = render({
      themes: [{ id: "long", name: "Fixture Future Firmware Theme" }],
    });

    expect(html).toContain(THEME_CARD_TITLE_CLASS);
    expect(html).not.toContain("truncate");
  });

  it("scrolls the grid inside the screen so Continue stays in view at 1280x800", () => {
    const html = render();

    const group = html.match(/<div[^>]*role="radiogroup"[^>]*>/)?.[0] ?? "";
    expect(group).toMatch(/class="[^"]*overflow-y-auto/);
  });

  it("keeps the install action to the one word, whichever theme is chosen", () => {
    for (const selectedThemeId of ["clippy", "synthwave"]) {
      const html = render({ selectedThemeId });

      expect(html).toContain("<span>Install</span>");
      expect(html).not.toContain("Install Clippy");
      expect(html).not.toContain("Install Synthwave");
    }
  });

  it("marks only the selected theme", () => {
    expect(render().match(/aria-checked="true"/g)).toHaveLength(1);
  });

  it("cannot install before a theme is chosen", () => {
    const html = render({ selectedThemeId: null });

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*<span>Install<\/span>/);
  });

  it("says it is installing while the install runs", () => {
    const html = render({ installing: true });

    expect(html).toContain("<span>Installing</span>");
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });

  it("says why a theme this VibeTV cannot take is not installable", () => {
    const html = render({
      themes: themes.map((theme) =>
        theme.id === "clippy"
          ? { ...theme, blockedReason: "Update VibeTV first." }
          : theme,
      ),
    });

    expect(html).toContain("Update VibeTV first.");
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>[^<]*<span>Install<\/span>/,
    );
  });

  it("still offers every theme when one of them is blocked", () => {
    const html = render({
      themes: themes.map((theme) =>
        theme.id === "clippy"
          ? { ...theme, blockedReason: "Update VibeTV first." }
          : theme,
      ),
    });

    for (const theme of themes) {
      expect(html).toContain(theme.name);
    }
  });

  it("installs a theme the device can take", () => {
    const html = render({
      themes: themes.map((theme) => ({ ...theme, blockedReason: null })),
    });

    expect(html).not.toMatch(
      /<button[^>]*disabled=""[^>]*>[^<]*<span>Install<\/span>/,
    );
    expect(html).not.toContain('data-slot="theme-blocked-reason"');
  });

  it("shows the newest install step the companion reported", () => {
    const html = render({
      installLogs: ["Uploading theme", "Activating theme"],
      installing: true,
    });

    expect(html).toContain("&gt; Activating theme");
    expect(html).not.toContain("Uploading theme");
  });

  it("reserves the log area before the install has said anything", () => {
    const html = render();

    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("&gt;");
  });

  // The log used to sit under the button and the theme box gave its room up
  // line by line: the button climbed 132 px while the install ran and the
  // second row of cards was cut at the fade. The screen is now laid out the
  // same before, during and after the install.
  it("lays the theme box out the same while the install runs", () => {
    const box = (html: string) => html.match(/<div[^>]*role="radiogroup"[^>]*>/)?.[0];
    const running = render({
      installLogs: ["Preparing theme install.", "Uploading theme files."],
      installing: true,
    });

    expect(box(running)).toBeDefined();
    expect(box(running)).toBe(box(render()));
  });

  it("keeps the log above the button, in the button's 460 px column at the bottom of the window", () => {
    for (const html of [
      render(),
      render({ installLogs: ["Uploading theme files."], installing: true }),
    ]) {
      const bar = html.match(/<div[^>]*data-slot="theme-install-bar"[^>]*>/)?.[0] ?? "";
      expect(bar).toContain("mt-auto");
      expect(bar).toContain("max-w-[460px]");
      const log = html.indexOf('role="status"');
      const button = html.search(/<span>Install(ing)?<\/span>/);
      expect(html.indexOf("data-slot=\"theme-install-bar\"")).toBeLessThan(log);
      expect(log).toBeLessThan(button);
    }
  });

  it("shows why a theme is blocked above the button too, so the button does not move for it", () => {
    const html = render({
      themes: themes.map((theme) =>
        theme.id === "clippy" ? { ...theme, blockedReason: "Update VibeTV first." } : theme,
      ),
    });

    expect(html.indexOf("Update VibeTV first.")).toBeLessThan(html.search(/<span>Install<\/span>/));
  });

  // Install is closed while one runs, so a new pick has nothing to act on: the
  // running install still activates the theme it started with, and its status
  // poll puts that one back as selected. All the customer got was a card that
  // answered and then changed its mind.
  it("does not take another theme while one is installing", () => {
    const html = render({ installing: true });

    expect(html.match(/<button[^>]*role="radio"/g)?.length).toBe(themes.length);
    expect(html.match(/<button[^>]*disabled=""[^>]*role="radio"/g)?.length).toBe(
      themes.length,
    );
  });

});
