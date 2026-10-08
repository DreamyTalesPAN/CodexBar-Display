import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
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

  it("names a theme VibeTV cannot draw instead of waiting for an image (#498)", () => {
    const html = renderToStaticMarkup(
      <OverviewScreen
        companionStatus="online"
        device={{
          active: true,
          connected: true,
          deviceId: "14799300",
          paired: true,
          ready: false,
          connectionState: "display_render_failed",
        }}
      />,
    );

    expect(html).toContain("VibeTV is connected");
    expect(html).toContain("Theme not shown");
    expect(html).toContain(
      "VibeTV can&#x27;t show this theme. Choose another theme.",
    );
    expect(html).not.toContain("Waiting for first image");
  });

  // Issue #265: the Mac App decides that the signal is weak; the page says so.
  it("names a weak WiFi signal and what to do about it (#265)", () => {
    const overview = (connected: boolean, health?: { ok: boolean; wifi?: { rssi: number; weak?: boolean } }) =>
      renderToStaticMarkup(
        <OverviewScreen
          companionStatus="online"
          device={{ active: true, connected, paired: true, ready: connected, health }}
        />,
      );

    const weak = overview(true, { ok: true, wifi: { rssi: -82, weak: true } });
    expect(weak).toContain("VibeTV is connected");
    expect(weak).toContain("Weak WiFi signal");
    expect(weak).toContain("Move VibeTV closer to your router.");

    // A good signal, a low reading the Mac App has not named weak, a VibeTV
    // that reports no signal (the Cable, older firmware), and a reading kept
    // from a VibeTV that has gone away.
    for (const html of [
      overview(true, { ok: true, wifi: { rssi: -48 } }),
      overview(true, { ok: true, wifi: { rssi: -85 } }),
      overview(true, { ok: true }),
      overview(true),
      overview(false, { ok: true, wifi: { rssi: -82, weak: true } }),
    ]) {
      expect(html).not.toContain("Weak WiFi signal");
      expect(html).not.toContain("closer to your router");
    }
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
        firmwareUpdateStatus={{
          phase: "error",
          stage: "rediscovering",
        }}
      />,
    );

    expect(html).toContain("VibeTV status");
    expect(html).toContain("Not connected");
    expect(html).toContain("Reconnect VibeTV to continue");
    expect(html).not.toContain("VibeTV is restarting");
    expect(html).not.toContain("VibeTV is connected");
  });

  it("keeps an update-owned reboot distinct from a real disconnect", () => {
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
        firmwareUpdateStatus={{
          phase: "installing",
          stage: "rebooting",
        }}
      />,
    );

    expect(html).toContain("VibeTV is restarting");
    expect(html).toContain("Keep VibeTV connected to power and wait");
    expect(html).toContain("No action is required");
    expect(html).not.toContain("Not connected");
    expect(html).not.toContain("Reconnect VibeTV to continue");
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

  it("does not add a connection-mode banner to the overview", () => {
    const html = renderToStaticMarkup(
      <OverviewScreen
        companionStatus="online"
        device={{ active: true, connected: true, paired: true, ready: true }}
      />,
    );

    expect(html).toContain("VibeTV is connected");
    expect(html).not.toContain("Connected by Cable");
    expect(html).not.toContain("Change connection");
  });

  // Issue #558: while the screensaver is on screen, VibeTV does not show live
  // usage, and the Display tile must not say it does.
  it("names the screensaver on the Display tile while it is on screen (#558)", () => {
    const overview = (standby?: { active?: boolean; screensaverPath?: string }) =>
      renderToStaticMarkup(
        <OverviewScreen
          companionStatus="online"
          device={{ active: true, connected: true, paired: true, ready: true, standby }}
        />,
      );

    const screensaver = overview({ active: true, screensaverPath: "/themes/s/r3-2.json" });
    expect(screensaver).toContain("VibeTV is connected");
    expect(screensaver).toContain(">Screensaver<");
    expect(screensaver).not.toContain(">Live<");

    // The screensaver is installed but not on screen, and firmware that
    // reports no standby state at all.
    for (const html of [
      overview({ active: false, screensaverPath: "/themes/s/r3-2.json" }),
      overview(),
    ]) {
      expect(html).toContain(">Live<");
      expect(html).not.toContain(">Screensaver<");
    }
  });

  // Issues #438/#460: the Windows app must not call itself a Mac App. The
  // Mac wording is asserted too, because it must not change at all.
  it.each([
    [false, "Mac App", "Mac App offline", "Waiting for Mac App"],
    [true, "App", "App offline", "Waiting for app"],
  ])("names the app for the platform (windows=%s)", (windowsHost, label, offline, waiting) => {
    const device = { active: true, connected: false, paired: true, ready: false };
    const missing = renderToStaticMarkup(
      <OverviewScreen companionStatus="missing" device={device} windowsHost={windowsHost} />,
    );
    const unknown = renderToStaticMarkup(
      <OverviewScreen companionStatus="unknown" device={device} windowsHost={windowsHost} />,
    );

    expect(missing).toContain(`>${label}<`);
    expect(missing).toContain(offline);
    expect(unknown).toContain(waiting);
    expect(missing.includes("Mac")).toBe(!windowsHost);
    expect(unknown.includes("Mac")).toBe(!windowsHost);
  });

  it.each([true, false])("has no accessibility violations (connected=%s)", async (connected) => {
    await expectNoAxeViolations(
      renderToStaticMarkup(
        <OverviewScreen
          companionStatus="online"
          device={{ active: true, connected, deviceId: "14799300", paired: true, ready: connected }}
        />,
      ),
    );
  });
});
