// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildThemePack, createBlankThemeSpec } from "@/lib/theme-studio";
import { writeUserThemes } from "@/lib/theme-studio-storage";
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

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

const rotation: PreferenceDescriptor = {
  allowsDefault: false,
  availability: { state: "available" },
  effectiveValue: "0",
  id: "vibetv.display.rotateSeconds",
  label: "Switch providers",
  options: [
    { value: "0", label: "When activity changes" },
    { value: "30", label: "Every 30 seconds" },
    { value: "60", label: "Every minute" },
    { value: "300", label: "Every 5 minutes" },
  ],
  owner: "vibetv",
  section: "display",
  type: "enum",
  value: "0",
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

  // Issue #322: Automatic switches when activity changes unless the customer
  // picks one of three intervals.
  it("offers the three rotation intervals beside the activity rule", () => {
    const onChange = vi.fn();
    render(
      <SettingsScreen
        {...props({
          displayPreferences: [usageDisplay, rotation],
          onDisplayPreferenceChange: onChange,
        })}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Switch providers" }).textContent).toBe(
      "When activity changes",
    );
    expect(openSelect("Switch providers")).toEqual([
      "When activity changes",
      "Every 30 seconds",
      "Every minute",
      "Every 5 minutes",
    ]);
    choose("Every 30 seconds");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(rotation, "30");
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

// Issue #558: the customer's own screensaver is named as it was saved. VibeTV
// reports it only by the path its theme file was sent under.
describe("SettingsScreen installed screensaver", () => {
  it("names the customer's own screensaver by its saved name", () => {
    const own = {
      assets: {},
      packName: "My Screensaver",
      spec: { ...createBlankThemeSpec(), themeId: "my-screensaver" },
      usage: "screensaver" as const,
    };
    expect(
      writeUserThemes([{ id: "u-1", updatedAt: "2026-10-08T00:00:00Z", document: own }]).ok,
    ).toBe(true);
    const screensaverPath = buildThemePack(own.spec, own.packName, own.assets, "screensaver")
      .manifest.themeSpec.path;

    render(
      <SettingsScreen
        {...props({
          device: {
            active: true, connected: true, ready: true, paired: true,
            capabilities: { standby: { supported: true } },
            standby: { screensaverPath },
          },
          standby: { enabled: true, timeoutMinutes: 10, brightnessPercent: 20 },
        })}
      />,
    );

    expect(document.body.textContent).toContain("My Screensaver is installed.");
    expect(screen.getByRole("link", { name: "Choose screensaver" })).toBeTruthy();
  });
});
