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
  it("tells the customer to wait during the update-owned reboot", () => {
    const html = renderToStaticMarkup(
      <UpdatesScreen
        companionStatus="online"
        device={{
          connected: false,
          board: "esp8266-smalltv-st7789",
          firmware: "1.0.39",
        }}
        firmwareUpdate={{
          checkedAt: "2026-08-24T10:00:00Z",
          installedFirmware: "1.0.39",
          latestFirmware: "1.0.40",
          updateAvailable: true,
          status: "update_available",
        }}
        updateStatus={{
          phase: "installing",
          stage: "rediscovering",
          startedAt: "2026-08-24T10:01:00Z",
          message: "Finding VibeTV again.",
          logs: [],
        }}
      />,
    );

    expect(html).toContain("VibeTV is restarting");
    expect(html).toContain("Keep VibeTV connected to power and wait");
    expect(html).toContain("No action is required");
    expect(html).toContain(">VibeTV is restarting</h2>");
    expect(html).not.toContain("Reconnect VibeTV");
  });

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

  // A completed job must not gate future releases: status polling restores
  // the completed job indefinitely, so a later check that discovers a
  // DIFFERENT release has to surface it.
  it("shows a newly discovered release after an earlier completed update", () => {
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
          checkedAt: "2026-08-09T21:00:00Z",
          installedFirmware: "1.0.40",
          latestFirmware: "1.0.41",
          updateAvailable: true,
          status: "update_available",
        }}
        updateStatus={{
          phase: "complete",
          startedAt: "2026-08-06T10:01:00Z",
          finishedAt: "2026-08-06T10:05:00Z",
          logs: [],
          result: {
            firmware: "1.0.40",
          },
        }}
        onInstallUpdate={() => true}
      />,
    );

    expect(html).toContain("Update available");
    expect(html).toContain("1.0.41");
  });

  // Regression test for the 2026-08-07 hardware observation: after a stalled
  // upload the card kept showing "Update failed - Disconnect VibeTV from power
  // for 10 seconds" while the same card reported Installed firmware 1.0.39 and
  // Available firmware 1.0.39. Nothing was pending any more, so the customer
  // was told to power-cycle for an update that no longer existed.
  it("drops a finished update failure once the firmware check says nothing is pending", () => {
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
          checkedAt: "2026-08-07T09:20:00Z",
          installedFirmware: "1.0.39",
          latestFirmware: "1.0.39",
          updateAvailable: false,
          status: "current",
        }}
        updateStatus={{
          phase: "error",
          stage: "uploading",
          startedAt: "2026-08-07T09:13:00Z",
          finishedAt: "2026-08-07T09:15:00Z",
          error:
            "Disconnect VibeTV from power for 10 seconds, reconnect it, and wait until the picture returns before trying again.",
          logs: [],
          result: {
            firmware: "9999.0.26",
            uploadAccepted: false,
          },
        }}
      />,
    );

    expect(html).not.toContain("Update failed");
    expect(html).not.toContain("Disconnect VibeTV from power");
  });

  // A failed check is not conclusive: it proved nothing about the pending
  // update, so the failure details and recovery action must survive it.
  it("keeps a finished update failure when the fresh firmware check itself failed", () => {
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
          checkedAt: "2026-08-09T14:00:00Z",
          installedFirmware: "1.0.39",
          updateAvailable: false,
          status: "check_failed",
        }}
        updateStatus={{
          phase: "error",
          stage: "uploading",
          startedAt: "2026-08-09T13:55:00Z",
          finishedAt: "2026-08-09T13:57:00Z",
          error:
            "Disconnect VibeTV from power for 10 seconds, reconnect it, and wait until the picture returns before trying again.",
          logs: [],
          result: {
            firmware: "9999.0.33",
            uploadAccepted: false,
          },
        }}
      />,
    );

    expect(html).toContain("Disconnect VibeTV from power");
  });

  // The same failure must survive while the update really is still pending,
  // because there the power-cycle advice is the customer's next step.
  it("keeps a finished update failure while the firmware update is still pending", () => {
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
          checkedAt: "2026-08-07T09:20:00Z",
          installedFirmware: "1.0.39",
          latestFirmware: "9999.0.26",
          updateAvailable: true,
          status: "update_available",
        }}
        updateStatus={{
          phase: "error",
          stage: "uploading",
          startedAt: "2026-08-07T09:13:00Z",
          finishedAt: "2026-08-07T09:15:00Z",
          error:
            "Disconnect VibeTV from power for 10 seconds, reconnect it, and wait until the picture returns before trying again.",
          logs: [],
          result: {
            firmware: "9999.0.26",
            uploadAccepted: false,
          },
        }}
      />,
    );

    expect(html).toContain("Update failed");
  });

  it("shows Cable reconnect recovery with a manual retry button", () => {
    const html = renderToStaticMarkup(
      <UpdatesScreen
        companionStatus="online"
        device={{ connected: true, board: "esp8266-smalltv-st7789", firmware: "1.0.40" }}
        firmwareUpdate={{
          checkedAt: "2026-08-27T10:00:00Z",
          installedFirmware: "1.0.40",
          latestFirmware: "1.0.41",
          updateAvailable: true,
          status: "update_available",
        }}
        onCreateReport={() => undefined}
        onInstallUpdate={() => undefined}
        updateStatus={{
          phase: "error",
          stage: "uploading",
          startedAt: "2026-08-27T10:00:00Z",
          finishedAt: "2026-08-27T10:01:00Z",
          retryAllowed: true,
          error: "Reconnect VibeTV with a data-capable Cable, wait for it to start, then try the update once.",
          logs: [],
        }}
      />,
    );

    expect(html).toContain("Reconnect VibeTV with a data-capable Cable");
    expect(html).toContain("Try again");
    expect(html).toContain("Create report");
  });
});

// The mixed state (new firmware + old Mac App) renders slot-bound theme
// elements empty and the old app cannot preview the device, so it must never
// be enterable from this screen. The firmware update therefore stays locked
// not only while a Mac App update is known to be pending, but already while
// the Mac App release check is unresolved — the race window in which the
// 2026-08-09 rehearsal entered the mixed state on real hardware.
describe("UpdatesScreen Mac-App-first gate", () => {
  const firmwareUpdateAvailableProps = {
    companionStatus: "online" as const,
    device: {
      connected: true,
      board: "esp8266-smalltv-st7789",
      firmware: "1.0.39",
    },
    firmwareUpdate: {
      checkedAt: "2026-08-09T13:00:00Z",
      installedFirmware: "1.0.39",
      latestFirmware: "9999.0.32",
      updateAvailable: true,
      status: "update_available" as const,
    },
  };

  it("keeps the firmware update locked while the Mac App release check is unresolved", () => {
    // DO NOT weaken this test.
    const html = renderToStaticMarkup(
      <UpdatesScreen
        {...firmwareUpdateAvailableProps}
        companionRelease={null}
        onInstallUpdate={() => true}
      />,
    );
    expect(html).toContain("Checking Mac App");
    expect(html).toContain("unlocks when it finishes");
    expect(html).toContain("Checking updates");
    expect(html).toContain('disabled=""');
  });

  it("offers the firmware update once the resolved check reports the Mac App as current", () => {
    const html = renderToStaticMarkup(
      <UpdatesScreen
        {...firmwareUpdateAvailableProps}
        companionRelease={{
          checkedAt: "2026-08-09T13:00:00Z",
          status: "available",
          latestVersion: "1.0.52",
          installedVersion: "1.0.52",
          updateAvailable: false,
          message: "Mac App is up to date.",
        }}
        onInstallUpdate={() => true}
      />,
    );
    expect(html).not.toContain("Checking Mac App");
    expect(html).not.toContain("Update Mac App first");
    expect(html).toContain("Update");
    expect(html).not.toContain('disabled=""');
  });
});
