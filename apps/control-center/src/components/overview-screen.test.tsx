import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OverviewScreen } from "./overview-screen";

describe("OverviewScreen", () => {
  it("does not describe a rejected pairing token as live or provider setup", () => {
    const html = renderToStaticMarkup(
      <OverviewScreen
        companionStatus="online"
        device={{
          connected: true,
          deviceId: "14799300",
          paired: false,
          ready: false,
          stream: {
            errorCode: "device_pairing_required",
            healthy: false,
            running: true,
          },
        }}
      />,
    );

    expect(html).toContain("Not connected");
    expect(html).toContain("Waiting for a fresh image from VibeTV.");
    expect(html).not.toContain("Start using any AI provider.");
  });

  it("keeps a genuinely disconnected selected VibeTV not connected", () => {
    const html = renderToStaticMarkup(
      <OverviewScreen
        companionStatus="online"
        device={{
          active: true,
          connected: false,
          deviceId: "14799300",
          paired: true,
          ready: false,
          connectionState: "reconnecting",
        }}
      />,
    );

    expect(html).toContain("VibeTV status");
    expect(html).toContain("Not connected");
    expect(html).not.toContain("VibeTV is connected");
  });

  it("does not treat a cached frame as a live connection or display", () => {
    const html = renderToStaticMarkup(
      <OverviewScreen
        companionStatus="online"
        device={{
          active: true,
          connected: false,
          paired: true,
          ready: false,
          connectionState: "reconnecting",
        }}
        displayFrame={{
          ok: true,
          savedAt: "2026-08-05T08:00:00Z",
          frame: {
            v: 1,
            provider: "codex",
            label: "Codex",
            session: 12,
          },
        }}
      />,
    );

    expect(html).toContain("Not connected");
    expect(html).toContain("Waiting for first image");
    expect(html).not.toContain("VibeTV is connected");
    expect(html).not.toContain(">Live<");
  });

  it("does not show reconnect instructions inside an available Overview", () => {
    const html = renderToStaticMarkup(
      <OverviewScreen
        companionStatus="online"
        device={{
          active: true,
          connected: false,
          deviceId: "14799300",
          paired: true,
          ready: false,
          connectionState: "setup_required",
        }}
      />,
    );

    expect(html).not.toContain("Reconnecting to VibeTV");
    expect(html).not.toContain("VibeTV-Setup");
    expect(html).not.toContain("Pair VibeTV again");
  });

  it("keeps a reachable VibeTV connected while usage is loading", () => {
    const html = renderToStaticMarkup(
      <OverviewScreen
        companionStatus="online"
        device={{
          active: true,
          connected: true,
          paired: true,
          ready: false,
          stream: {
            healthy: false,
            running: true,
          },
        }}
      />,
    );

    expect(html).toContain("VibeTV is connected");
    expect(html).toContain("Waiting for usage");
    expect(html).toContain("This can take up to 60 seconds.");
    expect(html).not.toContain("Reconnect VibeTV to continue");
    expect(html).not.toContain("Reconnecting to VibeTV");
  });
});
