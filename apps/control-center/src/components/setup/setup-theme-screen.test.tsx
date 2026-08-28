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

  it("names the selected theme in the install button", () => {
    expect(render()).toContain("Install Clippy");
    expect(render({ selectedThemeId: "synthwave" })).toContain(
      "Install Synthwave",
    );
  });

  it("marks only the selected theme", () => {
    expect(render().match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it("cannot install before a theme is chosen", () => {
    const html = render({ selectedThemeId: null });

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*<span>Install<\/span>/);
  });

  it("replaces the install label with the running phase while installing", () => {
    const html = render({ busyLabel: "Restarting VibeTV", installing: true });

    expect(html).toContain("Restarting VibeTV");
    expect(html).not.toContain("Install Clippy");
  });

  it("shows the thumbnail the caller passed for a theme", () => {
    const html = render({
      themes: [
        {
          ...themes[1],
          preview: <span data-testid="clippy-preview" />,
        },
      ],
    });

    expect(html).toContain('data-testid="clippy-preview"');
  });
});
