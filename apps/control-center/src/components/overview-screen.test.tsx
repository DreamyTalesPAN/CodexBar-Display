import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OverviewScreen } from "./overview-screen";

vi.mock("./vibetv-3d-preview", () => ({
  VibeTV3DPreview: ({
    device,
    displayFrame,
    updateOwnedDisconnect,
  }: {
    device: { connected: boolean } | null;
    displayFrame: { frame?: { label?: string } } | null;
    updateOwnedDisconnect?: boolean;
  }) => (
    <div
      data-connected={device?.connected ?? false}
      data-frame-label={displayFrame?.frame?.label}
      data-update-owned-disconnect={updateOwnedDisconnect}
      data-testid="vibetv-3d-preview"
    />
  ),
}));

describe("OverviewScreen", () => {
  it("shows only the device preview and live session surface", () => {
    const now = Date.now();
    const html = renderToStaticMarkup(
      <OverviewScreen
        agents={{
          generatedAt: now,
          health: "ready",
          sessions: [{ id: "one", source: "codex", phase: "tool_use", observedAt: now - 46_000 }],
          sources: [{ id: "codex", name: "Codex CLI" }],
        }}
        companionStatus="online"
        device={{ active: true, connected: true, paired: true, ready: true }}
        displayFrame={{ ok: true, frame: { v: 1, provider: "codex", label: "Codex", session: 12 } }}
      />,
    );

    expect(html).toContain('data-testid="vibetv-3d-preview"');
    expect(html).toContain('data-frame-label="Codex"');
    expect(html).toContain("Codex CLI");
    expect(html).toContain("Running a tool");
    expect(html).not.toContain("VibeTV is connected");
    expect(html).not.toContain("VibeTV firmware");
  });

  it("passes update-owned reboots through without treating them as a connected device", () => {
    const html = renderToStaticMarkup(
      <OverviewScreen
        companionStatus="online"
        device={{ active: true, connected: false, paired: true, ready: false, connectionState: "reconnecting" }}
        firmwareUpdateStatus={{ phase: "installing", stage: "rebooting" }}
      />,
    );

    expect(html).toContain('data-connected="false"');
    expect(html).toContain('data-update-owned-disconnect="true"');
    expect(html).toContain("Agent status unavailable");
  });

  it("does not present cached sessions when the companion is offline", () => {
    const now = Date.now();
    const html = renderToStaticMarkup(
      <OverviewScreen
        agents={{
          generatedAt: now,
          health: "ready",
          sessions: [{ id: "one", source: "codex", phase: "working", observedAt: now }],
          sources: [{ id: "codex", name: "Codex CLI" }],
        }}
        companionStatus="missing"
        device={null}
      />,
    );

    expect(html).toContain("Agent status unavailable");
    expect(html).not.toContain("Codex CLI");
  });
});
