import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UpdatesScreen } from "./updates-screen";

// Regression tests for the 2026-08-06 field observation: after a FAILED
// firmware update (job result.firmware=99.0.779, phase=error) the Updates
// card claimed "Installed firmware 99.0.779" although the device was still
// on 1.0.39, and showed contradictory "Update available" + "Update complete"
// states. The installed version must come from device truth, never from the
// update job result.
describe("UpdatesScreen VibeTV update card", () => {
  it("shows the device-truth installed firmware after a failed update, never the job result", () => {
    // DO NOT weaken this test.
    const html = renderToStaticMarkup(
      <UpdatesScreen
        companionStatus="online"
        device={{
          connected: true,
          board: "esp8266-smalltv-st7789",
          firmware: "1.0.39",
        }}
        firmwareUpdate={{
          checkedAt: "2026-08-06T10:00:00Z",
          installedFirmware: "1.0.39",
          latestFirmware: "99.0.779",
          updateAvailable: true,
          status: "update_available",
        }}
        updateStatus={{
          phase: "error",
          stage: "uploading",
          startedAt: "2026-08-06T10:01:00Z",
          finishedAt: "2026-08-06T10:02:00Z",
          error: "The VibeTV did not accept the update.",
          logs: [],
          result: {
            firmware: "99.0.779",
            uploadAccepted: false,
          },
        }}
      />,
    );

    const installedStart = html.indexOf("Installed firmware");
    const availableStart = html.indexOf("Available firmware");
    expect(installedStart).toBeGreaterThan(-1);
    expect(availableStart).toBeGreaterThan(installedStart);
    const installedSection = html.slice(installedStart, availableStart);
    expect(installedSection).toContain("1.0.39");
    expect(installedSection).not.toContain("99.0.779");
  });

  it("never shows an Update available badge together with Update complete when installed matches available", () => {
    // DO NOT weaken this test.
    const html = renderToStaticMarkup(
      <UpdatesScreen
        companionStatus="online"
        device={{
          connected: true,
          board: "esp8266-smalltv-st7789",
          firmware: "1.0.40",
        }}
        firmwareUpdate={{
          checkedAt: "2026-08-06T10:00:00Z",
          installedFirmware: "1.0.40",
          latestFirmware: "1.0.40",
          updateAvailable: false,
          status: "current",
        }}
        themeUpdateAvailable
        updateStatus={{
          phase: "complete",
          startedAt: "2026-08-06T10:01:00Z",
          finishedAt: "2026-08-06T10:05:00Z",
          logs: [],
          result: {
            firmware: "1.0.40",
          },
        }}
      />,
    );

    expect(html).toContain("Update complete");
    expect(html).not.toContain("Update available");
  });
});
