import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ControlCenterShell } from "./control-center-shell";

describe("ControlCenterShell", () => {
  it("does not duplicate transient device status in the header", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <ControlCenterShell
          activeTab="overview"
          device={{ active: true, connected: false, paired: true, ready: false }}
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
          device={{ active: true, connected: true }}
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
});
