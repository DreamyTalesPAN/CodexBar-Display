// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreferenceDescriptor } from "./control-center-types";
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
  // jsdom has neither; the open select list calls both.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const usageDisplay: PreferenceDescriptor = {
  allowsDefault: true,
  availability: { state: "available" },
  effectiveValue: "remaining",
  id: "vibetv.usage.displayMode",
  label: "Usage display",
  options: [
    { value: "used", label: "Used" },
    { value: "remaining", label: "Remaining" },
  ],
  owner: "vibetv",
  section: "display",
  type: "enum",
  value: "remaining",
  writable: true,
  writeStrategy: "vibetv_override",
};

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

/** Opens the select with this name and returns the text of its options. */
function openSelect(name: string): string[] {
  fireEvent.keyDown(screen.getByRole("combobox", { name }), { key: "Enter" });
  return screen.getAllByRole("option").map((option) => option.textContent ?? "");
}

function choose(option: string) {
  fireEvent.keyDown(screen.getByRole("option", { name: option }), { key: "Enter" });
}

describe("SettingsScreen display preferences", () => {
  it("offers exactly Default, Used and Remaining and saves the choice at once", () => {
    const onChange = vi.fn();
    render(
      <SettingsScreen
        {...props({
          displayPreferences: [usageDisplay],
          onDisplayPreferenceChange: onChange,
        })}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Usage display" }).textContent).toBe("Remaining");
    expect(openSelect("Usage display")).toEqual(["Default", "Used", "Remaining"]);
    choose("Used");
    expect(onChange).toHaveBeenLastCalledWith(usageDisplay, "used");

    openSelect("Usage display");
    choose("Default");
    expect(onChange).toHaveBeenLastCalledWith(usageDisplay, null);
  });

  it("shows Default without naming where the value comes from", () => {
    render(
      <SettingsScreen
        {...props({ displayPreferences: [{ ...usageDisplay, value: null }] })}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Usage display" }).textContent).toBe("Default");
    expect(document.body.textContent).not.toMatch(/following|codexbar/i);
  });
});
