// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsScreen, type SettingsScreenProps } from "./settings-screen";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal("matchMedia", () => ({
    matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function props(overrides: Partial<SettingsScreenProps> = {}): SettingsScreenProps {
  return {
    automaticPreviews: [],
    brightness: 20,
    busyAction: null,
    connectionMode: "cable",
    device: { active: true, connected: true, ready: true, paired: true },
    standby: null,
    onBrightnessChange: vi.fn(),
    onChooseScreensaver: vi.fn(),
    onConnectionModeChange: vi.fn(),
    onResetSetup: vi.fn(),
    onSaveBrightness: vi.fn(),
    onSaveStandby: vi.fn(),
    onStandbyBrightnessChange: vi.fn(),
    providerPicker: {
      usage: null,
      display: null,
      items: [], pendingCheckIds: new Set(), pendingPreferenceIds: new Set(),
      onCheck: vi.fn(), onDisplayChange: vi.fn(), onPreferenceChange: vi.fn(),
    },
    ...overrides,
  };
}

describe("Settings connection cards", () => {
  it.each([
    ["cable", "USB-C", "WiFi", "Switch to WiFi", "wifi"],
    ["wifi", "WiFi", "USB-C", "Switch to USB-C", "cable"],
  ] as const)("confirms a change from %s and waits for the saved mode", (mode, current, next, action, target) => {
    const settings = props({ connectionMode: mode });
    const view = render(<SettingsScreen {...settings} />);
    fireEvent.click(screen.getByRole("button", { name: current }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: next }));
    expect(screen.getByRole("dialog", { name: `Switch to ${next}?` })).toBeTruthy();
    expect(settings.onConnectionModeChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: `Keep ${current}` }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(settings.onConnectionModeChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: next }));
    fireEvent.click(screen.getByRole("button", { name: action }));
    expect(settings.onConnectionModeChange).toHaveBeenCalledExactlyOnceWith(target);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: current }).getAttribute("aria-pressed")).toBe("true");

    view.rerender(<SettingsScreen {...settings} busyAction="connection-mode" />);
    expect((screen.getByRole("button", { name: next }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<SettingsScreen {...settings} connectionMode={target} />);
    expect(screen.getByRole("button", { name: next }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows a failed connection action while keeping the saved mode and retry available", () => {
    const view = render(<SettingsScreen {...props({ connectionMode: "wifi", actionError: {
      code: "cable_identity_unavailable", message: "Cable VibeTV did not answer.", nextAction: "Reconnect the data cable and try again.",
    } })} />);
    expect(screen.getByRole("alert").textContent).toContain("Reconnect the data cable and try again.");
    expect(screen.getByRole("button", { name: "WiFi" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("button", { name: "USB-C" }) as HTMLButtonElement).disabled).toBe(false);
    view.rerender(<SettingsScreen {...props({ connectionMode: "wifi" })} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("blocks unsupported transports and confirmation during a firmware update", () => {
    const settings = props({ device: {
      active: true, connected: true, ready: true, paired: true,
      capabilities: { transport: { supported: ["usb"] } },
    } });
    const view = render(<SettingsScreen {...settings} />);
    expect((screen.getByRole("button", { name: "WiFi" }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<SettingsScreen {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "WiFi" }));
    view.rerender(<SettingsScreen {...settings} busyAction="firmware-update" />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to WiFi" }));
    expect(settings.onConnectionModeChange).not.toHaveBeenCalled();
  });
});
