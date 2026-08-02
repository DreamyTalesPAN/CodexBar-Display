import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ControlCenterShell } from "./control-center-shell";

describe("ControlCenterShell", () => {
  it("shows a selected reachable device connected while display readiness waits", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <ControlCenterShell
          activeTab="overview"
          device={{ active: true, connected: true, paired: true, ready: false }}
          onTabChange={vi.fn()}
        >
          <div>Overview</div>
        </ControlCenterShell>
      </TooltipProvider>,
    );

    expect(html).toContain("VibeTV connected");
    expect(html).not.toContain("VibeTV not connected");
  });

  it("keeps a genuinely disconnected selected device not connected", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <ControlCenterShell
          activeTab="overview"
          device={{ active: true, connected: false, paired: true, ready: false }}
          onTabChange={vi.fn()}
        >
          <div>Overview</div>
        </ControlCenterShell>
      </TooltipProvider>,
    );

    expect(html).toContain("VibeTV not connected");
    expect(html).not.toContain("VibeTV connected");
  });

  it("also shows connected when display readiness is complete", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <ControlCenterShell
          activeTab="overview"
          device={{ active: true, connected: true, paired: true, ready: true }}
          onTabChange={vi.fn()}
        >
          <div>Overview</div>
        </ControlCenterShell>
      </TooltipProvider>,
    );

    expect(html).toContain("VibeTV connected");
  });
});
