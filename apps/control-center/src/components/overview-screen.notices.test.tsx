// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeviceInfo } from "./control-center-types";
import { OverviewScreen, useOverviewNotice } from "./overview-screen";

// The flat preview is the Overview here; the 3D case is not under test.
vi.mock("./vibetv-3d-support", () => ({
  hardwareWebGLAvailable: () => false,
}));

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
const weakWiFi = { ...connectedDevice, health: { wifi: { rssi: -85, weak: true } } };
const themeNotShown = {
  ...connectedDevice,
  connectionState: "display_render_failed" as const,
};
const bothNotices = { ...weakWiFi, connectionState: "display_render_failed" as const };

describe("useOverviewNotice", () => {
  it("stays closed after the customer closes it, until the notice goes away and comes back", () => {
    const { result, rerender } = renderHook(
      ({ device }) => useOverviewNotice(device, false),
      { initialProps: { device: themeNotShown as DeviceInfo | null } },
    );
    expect(result.current.notice).toBe("theme-not-shown");

    act(() => result.current.close("theme-not-shown"));
    expect(result.current.notice).toBeNull();

    rerender({ device: connectedDevice });
    expect(result.current.notice).toBeNull();

    rerender({ device: themeNotShown });
    expect(result.current.notice).toBe("theme-not-shown");
  });

  it("leaves weak WiFi to the app-wide notice and keeps the theme notice", () => {
    const { result, rerender } = renderHook(
      ({ device }) => useOverviewNotice(device, false),
      { initialProps: { device: weakWiFi as DeviceInfo } },
    );
    expect(result.current.notice).toBeNull();
    rerender({ device: bothNotices });
    expect(result.current.notice).toBe("theme-not-shown");
  });

  it("holds every notice while the busy notice is due", () => {
    const { result, rerender } = renderHook(
      ({ held }) => useOverviewNotice(themeNotShown, held),
      { initialProps: { held: true } },
    );
    expect(result.current.notice).toBeNull();

    rerender({ held: false });
    expect(result.current.notice).toBe("theme-not-shown");
  });

  it("has no notice in the normal state", () => {
    const { result } = renderHook(() => useOverviewNotice(connectedDevice, false));
    expect(result.current.notice).toBeNull();
  });
});

describe("OverviewScreen notice dialog", () => {
  it("reports a theme notice close through Not now", () => {
    const onCloseNotice = vi.fn();
    render(
      <OverviewScreen
        companionStatus="online"
        device={themeNotShown}
        notice="theme-not-shown"
        onCloseNotice={onCloseNotice}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Theme not shown" });
    expect(dialog.textContent).toContain("VibeTV can't show this theme. Choose another theme.");
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onCloseNotice).toHaveBeenCalledWith("theme-not-shown");
  });

  it("tells that a theme cannot be shown, in a dialog", () => {
    render(
      <OverviewScreen
        companionStatus="online"
        device={themeNotShown}
        notice="theme-not-shown"
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Theme not shown" });
    expect(dialog.textContent).toContain("VibeTV can't show this theme. Choose another theme.");
  });

  it("shows no dialog without a notice", () => {
    render(<OverviewScreen companionStatus="online" device={connectedDevice} />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("waits while another dialog is open and shows once that dialog has closed", async () => {
    const otherDialog = document.createElement("div");
    otherDialog.setAttribute("role", "dialog");
    document.body.append(otherDialog);

    render(
      <OverviewScreen companionStatus="online" device={themeNotShown} notice="theme-not-shown" />,
    );
    expect(screen.queryByRole("dialog", { name: "Theme not shown" })).toBeNull();

    act(() => otherDialog.remove());

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Theme not shown" })).toBeTruthy();
    });
  });
});
