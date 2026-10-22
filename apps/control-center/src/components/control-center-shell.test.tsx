// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
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

  // Windows click run 1018b, finding N1: collapsed to icons, the Appearance
  // chevron still showed beside its icon, stuck out of the active pill and
  // was cut by the sidebar edge. It is decorative, so the icon-only sidebar
  // hides it.
  it("hides the Appearance chevron when the sidebar is collapsed to icons", () => {
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
    const chevron = within(nav).getByText("Appearance").closest("button")?.querySelector("svg.lucide-chevron-down");
    expect(chevron).not.toBeNull();
    expect(chevron?.getAttribute("class")).toContain(
      "group-data-[collapsible=icon]:hidden",
    );
  });

  // Windows click run 1018b, finding N11: the Themes and Screensavers
  // sub-items rendered at 14 px while the calm rule sets nav entries at 13 px.
  // The base sub-button class sets 14 px for md size, so the override must
  // be important to win.
  it("sets the Appearance sub-items at 13 px like the main nav entries", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    render(
      <TooltipProvider>
        <ControlCenterShell activeTab="overview" onTabChange={vi.fn()}>
          <div>Overview content</div>
        </ControlCenterShell>
      </TooltipProvider>,
    );

    const nav = screen.getByRole("navigation", { name: "Control Center" });
    fireEvent.click(within(nav).getByRole("button", { name: "Appearance" }));
    for (const label of ["Themes", "Screensavers"]) {
      expect(within(nav).getByRole("button", { name: label }).className).toContain(
        "text-[13px]!",
      );
    }
  });

  // Codex review on f9c14aa7 (P2): the weak hover tint also applied to the
  // current page, so hovering it looked like an inactive entry. Only inactive
  // entries get the weak tint; the active entry keeps its full fill.
  it("keeps the active nav entry at its full fill on hover", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    render(
      <TooltipProvider>
        <ControlCenterShell activeTab="overview" onTabChange={vi.fn()}>
          <div>Overview content</div>
        </ControlCenterShell>
      </TooltipProvider>,
    );
    const nav = screen.getByRole("navigation", { name: "Control Center" });
    expect(within(nav).getByRole("button", { name: "Overview" }).className).not.toContain(
      "hover:bg-sidebar-accent/45",
    );
    expect(within(nav).getByRole("button", { name: "Usage" }).className).toContain(
      "hover:bg-sidebar-accent/45",
    );
  });

  // Codex review on a7bd8d47 (P2): collapsed to icons, the 44 px pill kept
  // start alignment, so the 16 px icon sat 6 px left of the pill center.
  it("centers the nav icons in the icon-only pills", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    render(
      <TooltipProvider>
        <ControlCenterShell activeTab="overview" onTabChange={vi.fn()}>
          <div>Overview content</div>
        </ControlCenterShell>
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const nav = screen.getByRole("navigation", { name: "Control Center" });
    expect(within(nav).getByRole("button", { name: "Usage" }).className).toContain(
      "group-data-[collapsible=icon]:justify-center",
    );
  });

  // Codex review on f9c14aa7 (P2): size-5 on the sidebar toggle shrank its
  // hit target to 20 px. The button keeps a 28 px hit area; the negative
  // margin keeps its layout footprint at 20 px, so the page title does not move.
  it("keeps the sidebar toggle hit area at 28 px without moving the header", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    render(
      <TooltipProvider>
        <ControlCenterShell activeTab="overview" onTabChange={vi.fn()}>
          <div>Overview content</div>
        </ControlCenterShell>
      </TooltipProvider>,
    );
    const toggle = screen.getByRole("button", { name: "Open navigation" });
    expect(toggle.className).toContain("size-7");
    expect(toggle.className).toContain("-m-1");
  });

  // Windows click run 1018b, finding N9: the page title read "Appearance" and
  // a second title "Themes" sat under it. The page title is the open
  // sub-page; Theme Studio keeps its own header ("Appearance").
  it("titles the Appearance page with the open sub-page name", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    const titleOf = (props: Partial<ComponentProps<typeof ControlCenterShell>>) => {
      const { unmount } = render(
        <TooltipProvider>
          <ControlCenterShell activeTab="theme-library" onTabChange={vi.fn()} {...props}>
            <div>Content</div>
          </ControlCenterShell>
        </TooltipProvider>,
      );
      const title = screen.getByRole("heading", { level: 1 }).textContent;
      unmount();
      return title;
    };

    expect(titleOf({ activeAppearanceSection: "themes" })).toBe("Themes");
    expect(titleOf({ activeAppearanceSection: "screensavers" })).toBe("Screensavers");
    expect(titleOf({ activeAppearanceSection: "themes", themeStudioOpen: true })).toBe("Appearance");
    expect(titleOf({ activeTab: "overview" })).toBe("Overview");
  });

  // Build 2 QA: the open Studio drew a second row ("Appearance") above its
  // own header. The approved template has one row.
  it("draws no header row while the Studio is open: the Studio's own row is the header, the title stays for screen readers", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    render(
      <TooltipProvider>
        <ControlCenterShell activeTab="theme-library" themeStudioOpen onTabChange={vi.fn()}>
          <div>Studio</div>
        </ControlCenterShell>
      </TooltipProvider>,
    );
    const title = screen.getByRole("heading", { level: 1 });
    expect(title.textContent).toBe("Appearance");
    expect(title.className).toContain("sr-only");
    expect(document.querySelector(".control-center-shell__header")).toBeNull();
    expect(screen.getByRole("navigation", { name: "Control Center" })).toBeTruthy();
  });

  // Build 2b QA against the approved template: Updates and Support draw no
  // sidebar toggle beside the title (a narrow window keeps it).
  it("hides the sidebar toggle beside the title on Updates and Support only", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    for (const [tab, hidden] of [["updates", true], ["logs", true], ["overview", false], ["settings", false]] as const) {
      const { unmount } = render(
        <TooltipProvider>
          <ControlCenterShell activeTab={tab} onTabChange={vi.fn()}>
            <div>content</div>
          </ControlCenterShell>
        </TooltipProvider>,
      );
      const toggle = screen.getByRole("button", { name: "Open navigation" });
      expect(toggle.className.split(" ").includes("md:hidden")).toBe(hidden);
      unmount();
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
