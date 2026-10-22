// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

const usageMode: PreferenceDescriptor = {
  ...rotation,
  id: "codexbar.usageBarsShowUsed",
  label: "Show",
  owner: "codexbar",
  writeStrategy: "codexbar_command",
  value: "true",
  effectiveValue: "true",
  options: [
    { value: "true", label: "Used" },
    { value: "false", label: "Remaining" },
  ],
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
  it.each(["automatic", "fixed"] as const)("offers CodexBar's mode under Display mode in %s", (mode) => {
    const onChange = vi.fn();
    const settings = props({ displayPreferences: [rotation, usageMode], onDisplayPreferenceChange: onChange });
    settings.providerPicker.display = { mode, providerIds: [], configured: true, valid: true };
    render(<SettingsScreen {...settings} />);
    const control = screen.getByRole("combobox", { name: "Show" });
    expect(control.closest("#settings-usage-mode")).not.toBeNull();
    expect(control.textContent).toBe("Used");
    expect(openSelect("Show")).toEqual(["Used", "Remaining"]);
    choose("Remaining");
    expect(onChange).toHaveBeenCalledExactlyOnceWith(usageMode, "false");
  });

  // Paul, 22.10.: Used / Remaining is its own section, Usage mode, right after
  // Display mode; AI providers stays the last section.
  it("gives Used / Remaining its own Usage mode section after Display mode", () => {
    const { container } = render(<SettingsScreen {...props({ displayPreferences: [rotation, usageMode] })} />);
    const titles = Array.from(container.querySelectorAll("section h2")).map((heading) => heading.textContent);
    expect(titles.slice(titles.indexOf("Display mode"), titles.indexOf("Display mode") + 2)).toEqual(["Display mode", "Usage mode"]);
    expect(titles.at(-1)).toBe("AI providers");
    const section = document.getElementById("settings-usage-mode");
    expect(section?.querySelector("h2")?.textContent).toBe("Usage mode");
    expect(within(section as HTMLElement).getByRole("combobox", { name: "Show" })).toBeTruthy();
    expect(within(document.getElementById("settings-display-mode") as HTMLElement).queryByRole("combobox", { name: "Show" })).toBeNull();
  });

  it("reads Remaining from the descriptor and offers Used", () => {
    const descriptor = { ...usageMode, value: "false", effectiveValue: "false" };
    const onChange = vi.fn();
    render(<SettingsScreen {...props({ displayPreferences: [descriptor], onDisplayPreferenceChange: onChange })} />);
    expect(screen.getByRole("combobox", { name: "Show" }).textContent).toBe("Remaining");
    openSelect("Show");
    choose("Used");
    expect(onChange).toHaveBeenCalledExactlyOnceWith(descriptor, "true");
  });

  it("disables the choice when CodexBar's mode is overridden", () => {
    render(<SettingsScreen {...props({ displayPreferences: [{ ...usageMode, writable: false }] })} />);
    expect((screen.getByRole("combobox", { name: "Show" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([false, true])("omits the choice when the companion does not list it (Windows: %s)", (windowsHost) => {
    render(<SettingsScreen {...props({ windowsHost, displayPreferences: [rotation] })} />);
    expect(screen.queryByRole("combobox", { name: "Show" })).toBeNull();
  });

  // Issue #322: Automatic switches when activity changes unless the customer
  // picks one of three intervals.
  it("offers the three rotation intervals beside the activity rule", () => {
    const onChange = vi.fn();
    render(
      <SettingsScreen
        {...props({
          displayPreferences: [rotation],
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
});

// Issue #558: "Show after 10 minutes" did not say minutes of what.
describe("SettingsScreen screensaver timeout", () => {
  it("says what the minutes of Show after count", () => {
    const onSaveStandby = vi.fn();
    const standby = { enabled: true, timeoutMinutes: 10, brightnessPercent: 20 };
    render(
      <SettingsScreen
        {...props({
          device: {
            active: true, connected: true, ready: true, paired: true,
            capabilities: { standby: { supported: true } },
          },
          onSaveStandby,
          standby,
        })}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Show after" }).textContent).toBe(
      "10 minutes without AI usage",
    );
    expect(openSelect("Show after")).toEqual(
      ["1 minute", "5 minutes", "10 minutes", "15 minutes", "30 minutes", "60 minutes"].map(
        (minutes) => `${minutes} without AI usage`,
      ),
    );
    choose("30 minutes without AI usage");
    expect(onSaveStandby).toHaveBeenLastCalledWith({ ...standby, timeoutMinutes: 30 });
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
