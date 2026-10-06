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
