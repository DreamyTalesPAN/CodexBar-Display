import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { LogsScreen } from "./logs-screen";

// Issue #498: a theme that fails to render left the device "not ready", and
// the Support page called that "Not connected".
it("shows a connected VibeTV as connected while its theme fails to render", () => {
  const html = renderToStaticMarkup(
    <LogsScreen
      device={{
        active: true,
        connected: true,
        paired: true,
        ready: false,
        connectionState: "display_render_failed",
      }}
    />,
  );

  expect(html).toContain("The VibeTV currently controlled by this Mac.");
  expect(html).not.toContain("Not connected");
  expect(html).not.toContain("No VibeTV is currently connected.");
});

// Seen on a real VibeTV in standby: Support named the screensaver as the
// active theme while the customer's live theme was Mini Classic.
it("names the live theme while the screensaver is on screen", () => {
  const html = renderToStaticMarkup(
    <LogsScreen
      device={{
        active: true,
        connected: true,
        paired: true,
        ready: true,
        activeTheme: "night-clock",
        standby: {
          active: true,
          liveThemePath: "/themes/u/mini-cl-9-6d1af3.json",
          screensaverPath: "/themes/s/nc-3-e18e4217.json",
        },
      }}
      themes={[
        {
          id: "mini-classic",
          isFree: true,
          priceLabel: "Free",
          source: "github-catalog",
          themeId: "mini-classic",
          themeSpecPath: "/themes/u/mini-cl-9-6d1af3.json",
          title: "Mini Classic",
        },
      ]}
    />,
  );

  expect(html).toContain("Mini Classic");
  expect(html).not.toContain("Night Clock");
});

it("does not name the screensaver as active theme when a Theme Studio theme is live", () => {
  const html = renderToStaticMarkup(
    <LogsScreen
      device={{
        active: true,
        connected: true,
        paired: true,
        ready: true,
        activeTheme: "retro-3d",
        standby: {
          active: true,
          liveThemePath: "/themes/u/my-the-1-0a1b2c.json",
          screensaverPath: "/themes/s/r3d-2-d2a77fd8.json",
        },
      }}
      themes={[]}
    />,
  );

  expect(html).toContain("Custom theme");
  expect(html).not.toContain("Retro 3d");
});

// Issue #265: Support names the signal of a VibeTV on WiFi the way the Mac App
// judged it.
it("shows the WiFi signal of a connected VibeTV, and none where there is no reading", () => {
  const support = (connected: boolean, wifi?: { rssi: number; weak?: boolean }) =>
    renderToStaticMarkup(
      <LogsScreen
        device={{ active: true, connected, paired: true, ready: connected, health: { ok: true, wifi } }}
      />,
    );

  expect(support(true, { rssi: -82, weak: true })).toContain("Weak (-82 dBm)");
  // One low reading is not yet a weak signal, and it is not a good one either.
  expect(support(true, { rssi: -48 })).toContain(">-48 dBm<");
  expect(support(true, { rssi: -85 })).not.toContain("Good");
  // The Cable and older firmware report no signal.
  expect(support(true)).not.toContain("WiFi signal");
  expect(support(false, { rssi: -48 })).not.toContain("WiFi signal");
});

it("has no accessibility violations with diagnostics, recent activity and an error", async () => {
  await expectNoAxeViolations(
    renderToStaticMarkup(
      <LogsScreen
        device={{ active: true, connected: true, paired: true, ready: true }}
        diagnostics={{
          ok: true,
          generatedAt: "2026-10-07T06:58:00.000Z",
          usageEngine: { status: "outdated", version: "0.17.0", minimumVersion: "0.23.0" },
          checks: [{ name: "device_hello", status: "attention", detail: "VibeTV did not answer.", nextAction: "Check that VibeTV is on." }],
        }}
        onLoadDiagnostics={() => undefined}
        onRepairUsageEngine={() => undefined}
        events={[{ id: "1", label: "Settings loaded", detail: "Brightness 70%" }]}
        lastError={{ code: "usage_failed", message: "Usage needs attention.", nextAction: "Try again." }}
        onRefresh={() => undefined}
        onRunSetupAgain={() => undefined}
      />,
    ),
  );
});
