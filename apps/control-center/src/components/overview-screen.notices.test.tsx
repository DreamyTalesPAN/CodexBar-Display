// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OverviewScreen } from "./overview-screen";

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
const themeNotShown = { ...connectedDevice, connectionState: "display_render_failed" as const };

describe("OverviewScreen notices", () => {
  it("asks about a weak WiFi signal in a dialog, with the old words", () => {
    render(<OverviewScreen companionStatus="online" device={weakWiFi} />);

    const dialog = screen.getByRole("dialog", { name: "Weak WiFi signal" });
    expect(dialog.textContent).toContain("Move VibeTV closer to your router.");
    expect(screen.getByRole("button", { name: "Not now" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("tells that a theme cannot be shown, in a dialog", () => {
    render(<OverviewScreen companionStatus="online" device={themeNotShown} />);

    const dialog = screen.getByRole("dialog", { name: "Theme not shown" });
    expect(dialog.textContent).toContain("VibeTV can't show this theme. Choose another theme.");
  });

  it("shows no dialog in the normal state", () => {
    render(<OverviewScreen companionStatus="online" device={connectedDevice} />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays closed after Not now, and opens again only when the notice comes back", () => {
    const { rerender } = render(<OverviewScreen companionStatus="online" device={weakWiFi} />);

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(<OverviewScreen companionStatus="online" device={weakWiFi} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(<OverviewScreen companionStatus="online" device={connectedDevice} />);
    rerender(<OverviewScreen companionStatus="online" device={weakWiFi} />);
    expect(screen.getByRole("dialog", { name: "Weak WiFi signal" })).toBeTruthy();
  });

  it("waits while another dialog is open and shows once that dialog has closed", async () => {
    const otherDialog = document.createElement("div");
    otherDialog.setAttribute("role", "dialog");
    document.body.append(otherDialog);

    render(<OverviewScreen companionStatus="online" device={weakWiFi} />);
    expect(screen.queryByRole("dialog", { name: "Weak WiFi signal" })).toBeNull();

    act(() => otherDialog.remove());

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Weak WiFi signal" })).toBeTruthy();
    });
  });
});
