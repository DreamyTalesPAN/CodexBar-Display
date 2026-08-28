import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SetupWizardScreen } from "./setup-wizard-screen";

function render(props: Partial<Parameters<typeof SetupWizardScreen>[0]> = {}) {
  return renderToStaticMarkup(
    <SetupWizardScreen label="Step" {...props}>
      <p>content</p>
    </SetupWizardScreen>,
  );
}

function sectionClass(html: string): string {
  return html.match(/<section[^>]*class="([^"]*)"/)?.[1] ?? "";
}

function contentClass(html: string): string {
  return html.match(/<section[^>]*><div class="([^"]*)"/)?.[1] ?? "";
}

function cornerClasses(html: string): string[] {
  return [...html.matchAll(/<div class="(fixed[^"]*)"/g)].map(
    (match) => match[1],
  );
}

describe("SetupWizardScreen", () => {
  // The app window has no minimum size, so a step whose content outgrows the
  // viewport has to scroll. Centring the flex child instead would clip its top
  // and put it out of reach.
  it("centres its content without clipping it when it does not fit", () => {
    const html = render();

    expect(contentClass(html)).toContain("my-auto");
    expect(sectionClass(html)).not.toContain("justify-center");
    expect(sectionClass(html)).toContain("min-h-svh");
  });

  it("keeps the corner controls in the viewport, not at the end of the content", () => {
    const corners = cornerClasses(render({ onBack: vi.fn() }));

    expect(corners).toHaveLength(2);
    for (const corner of corners) {
      expect(corner).toContain("bottom-5");
    }
    expect(corners.some((corner) => corner.includes("left-5"))).toBe(true);
    expect(corners.some((corner) => corner.includes("right-5"))).toBe(true);
  });

  it("keeps both corner controls above the dialog overlay", () => {
    for (const corner of cornerClasses(render({ onBack: vi.fn() }))) {
      const layer = Number(corner.match(/z-(\d+)/)?.[1]);
      expect(layer).toBeGreaterThan(50);
    }
  });

  it("offers no way back unless the step has one", () => {
    expect(render()).not.toContain(">Back<");
    expect(render({ onBack: vi.fn() })).toContain(">Back<");
  });
});
