import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ControlCenterShell } from "./control-center-shell";

describe("ControlCenterShell", () => {
  it("keeps Appearance children hidden until Appearance is opened", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <ControlCenterShell
          activeAppearanceSection="screensavers"
          activeTab="theme-library"
          device={{ connected: true, paired: true, ready: true }}
          onTabChange={vi.fn()}
        >
          <div>Appearance content</div>
        </ControlCenterShell>
      </TooltipProvider>,
    );

    expect(html).toContain(">Appearance<");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain(">Themes<");
    expect(html).not.toContain(">Screensavers<");
    expect(html).not.toContain('data-sidebar="menu-sub"');
    expect(html).not.toContain(">Theme Library<");
  });

  it("does not call a merely reachable device connected", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <ControlCenterShell
          activeTab="overview"
          device={{ connected: true, paired: true, ready: false }}
          onTabChange={vi.fn()}
        >
          <div>Overview</div>
        </ControlCenterShell>
      </TooltipProvider>,
    );

    expect(html).toContain("VibeTV not connected");
    expect(html).not.toContain("VibeTV connected");
  });

  it("shows connected only for ready=true", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <ControlCenterShell
          activeTab="overview"
          device={{ connected: true, paired: true, ready: true }}
          onTabChange={vi.fn()}
        >
          <div>Overview</div>
        </ControlCenterShell>
      </TooltipProvider>,
    );

    expect(html).toContain("VibeTV connected");
  });
});
