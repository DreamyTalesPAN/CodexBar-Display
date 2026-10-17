// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { OverviewScreen } from "./overview-screen";

// jsdom has no WebGL: the 3D case must fall back to the flat live preview.
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class NoWebGLRenderer {
    constructor() {
      throw new Error("WebGL is not available");
    }
  }
  return { ...actual, WebGLRenderer: NoWebGLRenderer };
});

afterEach(() => {
  cleanup();
});

const connectedDevice = {
  active: true,
  connected: true,
  deviceId: "14799300",
  paired: true,
  ready: true,
};

describe("OverviewScreen", () => {
  it("shows only the VibeTV in 3D, with the status line as the only text", () => {
    const html = renderToStaticMarkup(
      <OverviewScreen companionStatus="online" device={connectedDevice} />,
    );

    expect(html).toContain("VibeTV is connected");
    expect(html).toContain('aria-label="Interactive VibeTV preview. Drag to rotate."');
    // The former tiles and the badge are gone.
    for (const removed of [
      "Mac App",
      "Online",
      "Firmware",
      "Connected</",
      "Live</",
      "Connected by Cable",
    ]) {
      expect(html).not.toContain(removed);
    }
  });

  it("uses the status line for each VibeTV state", () => {
    const disconnected = renderToStaticMarkup(
      <OverviewScreen
        companionStatus="online"
        device={{ active: true, connected: false, deviceId: "14799300", paired: true, ready: false }}
      />,
    );
    expect(disconnected).toContain("VibeTV status");
    expect(disconnected).not.toContain("VibeTV is connected");

    const restarting = renderToStaticMarkup(
      <OverviewScreen
        companionStatus="online"
        device={{ active: true, connected: false, paired: true, ready: false }}
        firmwareUpdateStatus={{ phase: "installing", stage: "rebooting" }}
      />,
    );
    expect(restarting).toContain("VibeTV is restarting");
    expect(restarting).not.toContain("VibeTV is connected");
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

  it("does not add a connection-mode banner to the overview", () => {
    const html = renderToStaticMarkup(
      <OverviewScreen companionStatus="online" device={connectedDevice} />,
    );

    expect(html).not.toContain("Change connection");
  });

  it("shows the not-found dialog with a lime primary, Not now and no close button", () => {
    const onRunSetupAgain = vi.fn();
    render(
      <OverviewScreen
        companionStatus="online"
        device={{
          active: true,
          connected: false,
          deviceId: "14799300",
          paired: true,
          ready: false,
          stream: { errorCode: "device_not_found", healthy: false, running: true },
        }}
        onRunSetupAgain={onRunSetupAgain}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "We couldn't find your VibeTV" });
    expect(dialog.textContent).toContain(
      "Check that VibeTV is plugged in and on the same WiFi as this Mac.",
    );
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(screen.getByRole("button", { name: "Run setup again" }).className).toContain("bg-primary");
    expect(screen.getByRole("button", { name: "Not now" }).className).not.toContain("bg-primary");

    fireEvent.click(screen.getByRole("button", { name: "Run setup again" }));
    expect(onRunSetupAgain).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "We couldn't find your VibeTV" })).toBeNull();
  });

  it("closes the not-found dialog with Not now", () => {
    render(
      <OverviewScreen
        companionStatus="online"
        device={{
          active: true,
          connected: false,
          paired: true,
          ready: false,
          stream: { errorCode: "device_not_found", healthy: false, running: true },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("dialog", { name: "We couldn't find your VibeTV" })).toBeNull();
  });

  it("falls back to the flat live preview when WebGL is unavailable", async () => {
    render(
      <OverviewScreen
        companionStatus="online"
        device={{ active: true, connected: false, paired: true, ready: false }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("VibeTV live preview is offline")).toBeTruthy();
    });
    expect(screen.queryByRole("group", { name: /Interactive VibeTV preview/ })).toBeNull();
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
