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
    expect(render().match(/aria-pressed="true"/g)).toHaveLength(1);
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

  it("shows the install steps the companion reported", () => {
    const html = render({
      installLogs: ["Uploading theme", "Activating theme"],
      installing: true,
    });

    expect(html).toContain("&gt; Uploading theme");
    expect(html).toContain("&gt; Activating theme");
  });

  it("shows no log area before an install has said anything", () => {
    expect(render()).not.toContain('aria-live="polite"');
  });
});
