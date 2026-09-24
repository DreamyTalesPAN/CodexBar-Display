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
    onDismissError: vi.fn(),
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

describe("SettingsScreen diagnostics entry", () => {
  it("runs diagnostics from the AI provider settings", () => {
    const run = vi.fn();
    render(<SettingsScreen {...props({ onRunDiagnostics: run })} />);
    fireEvent.click(screen.getByRole("button", { name: "Run diagnostics" }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("hides the entry when the app cannot run diagnostics", () => {
    render(<SettingsScreen {...props()} />);
    expect(screen.queryByRole("button", { name: "Run diagnostics" })).toBeNull();
  });
});
