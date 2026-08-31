import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SetupThemeScreen, type SetupThemeOption } from "./setup-theme-screen";

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

  it("shows the install steps the companion reported", () => {
    const html = render({
      installLogs: ["Uploading theme", "Activating theme"],
      installing: true,
    });

    expect(html).toContain("&gt; Uploading theme");
    expect(html).toContain("&gt; Activating theme");
  });

  it("reserves the log area before the install has said anything", () => {
    const html = render();

    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("&gt;");
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
