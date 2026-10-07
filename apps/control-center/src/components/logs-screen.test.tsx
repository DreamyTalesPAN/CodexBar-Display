import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
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
