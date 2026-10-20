// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
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

  // Clicking the tab that is already open is a request to start over at its
  // top; the page does not change tab, so only the click can move it back.
  it("scrolls to the top when the current sidebar entry is clicked again", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    const onTabChange = vi.fn();
    const { getByRole } = render(
      <TooltipProvider>
        <ControlCenterShell activeTab="settings" onTabChange={onTabChange}>
          <div>Content</div>
        </ControlCenterShell>
      </TooltipProvider>,
    );
    const page = document.documentElement;
    page.scrollTop = 1086;
    fireEvent.click(getByRole("button", { name: "Settings" }));
    expect(page.scrollTop).toBe(0);
    expect(onTabChange).toHaveBeenCalledWith("settings");
  });

  // Codex review of #677: Appearance is open and its entry is clicked again;
  // the submenu toggles and the page starts over at the top.
  it("scrolls the open Appearance entry to the top when it is clicked again", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    const onTabChange = vi.fn();
    const { getByRole } = render(
      <TooltipProvider>
        <ControlCenterShell activeTab="theme-library" onTabChange={onTabChange}>
          <div>Content</div>
        </ControlCenterShell>
      </TooltipProvider>,
    );
    const page = document.documentElement;
    page.scrollTop = 1086;
    fireEvent.click(getByRole("button", { name: "Appearance" }));
    expect(page.scrollTop).toBe(0);
    expect(onTabChange).toHaveBeenCalledWith("theme-library");
  });

  // 7197 review, point 3: only Usage has the page margin that grows with the window.
  it("gives the Usage page a margin of 48 px that grows to 96 px with the window", () => {
    const render = (activeTab: ActiveTab) =>
      renderToStaticMarkup(
        <TooltipProvider>
          <ControlCenterShell activeTab={activeTab} onTabChange={vi.fn()}>
            <div>Content</div>
          </ControlCenterShell>
        </TooltipProvider>,
      );
    expect(render("usage")).toContain("lg:px-[clamp(48px,4vw,96px)]");
    expect(render("settings")).not.toContain("clamp(48px,4vw,96px)");
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
