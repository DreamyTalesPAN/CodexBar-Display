// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ControlCenterShell } from "./control-center-shell";
import type { ActiveTab, AppearanceSection } from "./control-center-types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ControlCenterShell", () => {
  // Issue #558: a button far down in Settings opened Support 1086 px down,
  // and Choose screensaver cut off the heading Screensavers. The window
  // scrolls, so it kept the place of the last tab.
  it("opens a tab and an Appearance section at the top of the page", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    const shell = (activeTab: ActiveTab, section: AppearanceSection = "themes") => (
      <TooltipProvider>
        <ControlCenterShell
          activeAppearanceSection={section}
          activeTab={activeTab}
          onTabChange={vi.fn()}
        >
          <div>Content</div>
        </ControlCenterShell>
      </TooltipProvider>
    );
    const page = document.documentElement;
    const { rerender } = render(shell("settings"));

    // The status the app reads every few seconds draws the same tab again.
    page.scrollTop = 1086;
    rerender(shell("settings"));
    expect(page.scrollTop).toBe(1086);

    rerender(shell("logs"));
    expect(page.scrollTop).toBe(0);

    page.scrollTop = 300;
    rerender(shell("theme-library"));
    expect(page.scrollTop).toBe(0);

    page.scrollTop = 300;
    rerender(shell("theme-library", "screensavers"));
    expect(page.scrollTop).toBe(0);
  });

  it("does not duplicate transient device status in the header", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <ControlCenterShell
          activeTab="overview"
          onTabChange={vi.fn()}
        >
          <div>Overview content</div>
        </ControlCenterShell>
      </TooltipProvider>,
    );

    expect(html).toContain("Overview content");
    expect(html).not.toContain("VibeTV not connected");
    expect(html).not.toContain("VibeTV connected");
  });

  it("hides controls that cannot work on the active connection", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <ControlCenterShell
          activeTab="overview"
          hiddenTabs={["settings", "theme-library", "updates"]}
          onTabChange={vi.fn()}
        >
          <div>Overview content</div>
        </ControlCenterShell>
      </TooltipProvider>,
    );

    expect(html).not.toContain(">Settings<");
    expect(html).not.toContain(">Appearance<");
    expect(html).not.toContain(">Updates<");
    expect(html).toContain(">Usage<");
    expect(html).toContain(">Support<");
  });

  // Mac click run 7161, finding 1: collapsed to icons, the first letter of
  // each nav label still showed beside its icon. The label stays in the DOM
  // for screen readers and is visually hidden in the icon-only sidebar.
  it("hides the nav labels when the sidebar is collapsed to icons", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    const { container } = render(
      <TooltipProvider>
        <ControlCenterShell activeTab="overview" onTabChange={vi.fn()}>
          <div>Overview content</div>
        </ControlCenterShell>
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(container.querySelector('[data-collapsible="icon"]')).not.toBeNull();

    const nav = screen.getByRole("navigation", { name: "Control Center" });
    for (const label of ["Overview", "Usage", "Settings", "Appearance", "Updates", "Support"]) {
      expect(within(nav).getByText(label).className).toContain(
        "group-data-[collapsible=icon]:sr-only",
      );
    }
  });

  it("has no accessibility violations with an update waiting", async () => {
    await expectNoAxeViolations(
      renderToStaticMarkup(
        <TooltipProvider>
          <ControlCenterShell
            activeTab="overview"
            onTabChange={vi.fn()}
            updateAvailable
          >
            <div>Overview content</div>
          </ControlCenterShell>
        </TooltipProvider>,
      ),
    );
  });
});
