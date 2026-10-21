// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildThemePack, createBlankThemeSpec } from "@/lib/theme-studio";
import { writeUserThemes } from "@/lib/theme-studio-storage";
import type { PreferenceDescriptor } from "./control-center-types";
import type { ProviderItem } from "./provider-picker";
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
      items: [], pendingCheckIds: new Set(), pendingPreferenceIds: new Set(), onDisplayChange: vi.fn(), onPreferenceChange: vi.fn(),
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
  it.each(["automatic", "fixed", "pair"] as const)("offers CodexBar's mode under Display mode in %s", (mode) => {
    const onChange = vi.fn();
    const settings = props({ displayPreferences: [rotation, usageMode], onDisplayPreferenceChange: onChange });
    settings.providerPicker.display = { mode, providerIds: [], configured: true, valid: true };
    render(<SettingsScreen {...settings} />);
    const control = screen.getByRole("combobox", { name: "Show" });
    expect(control.closest("#settings-display-mode")).not.toBeNull();
    expect(screen.getAllByRole("combobox", { name: "Show" })).toHaveLength(1);
    expect(screen.getByRole("group", { name: "Display mode" }).compareDocumentPosition(control)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(control.compareDocumentPosition(screen.getByText("Limits on VibeTV"))
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(control.textContent).toBe("Used");
    expect(openSelect("Show")).toEqual(["Used", "Remaining"]);
    choose("Remaining");
    expect(onChange).toHaveBeenCalledExactlyOnceWith(usageMode, "false");
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

describe("SettingsScreen display sources", () => {
  const item = (providerId: string, label: string): ProviderItem => ({
    allowsDefault: false,
    availability: { state: "available" },
    effectiveValue: true,
    health: { message: "Ready.", service: "operational", state: "healthy" },
    id: `codexbar.providers.${providerId}.enabled`,
    label,
    owner: "codexbar",
    providerId,
    section: "providers",
    type: "boolean",
    value: true,
    writable: true,
    writeStrategy: "codexbar_command",
  });
  const sources = (mode: "fixed" | "pair", providerIds: string[]) => {
    const onDisplayChange = vi.fn();
    const base = props();
    render(
      <SettingsScreen
        {...base}
        providerPicker={{
          ...base.providerPicker,
          usage: { providers: ["claude", "codex", "cursor"].map((id) => ({
            id, label: id, session: 0, weekly: 0, resetSecs: 0, usageMode: "used",
          })) },
          display: { mode, providerIds, configured: true, valid: true },
          items: [item("claude", "Claude"), item("codex", "Codex"), item("cursor", "Cursor")],
          onDisplayChange,
        }}
      />,
    );
    return onDisplayChange;
  };

  it.each(["stale", "usageUnavailable", "missing"])(
    "keeps the saved pair when one member is %s",
    (unavailable) => {
      const base = props();
      render(<SettingsScreen {...base}
        automaticPreviews={[
          { providerLabel: "Codex", resetLabel: null, windows: [{ label: "Session", percent: 37 }] },
          { providerLabel: "Claude", resetLabel: null, windows: [{ label: "Session", percent: null }] },
        ]}
        providerPicker={{
          ...base.providerPicker,
          items: [item("codex", "Codex"), item("claude", "Claude")],
          display: { mode: "pair", providerIds: ["claude", "codex"], configured: true, valid: true },
          usage: { providers: [
            { id: "codex", label: "Codex", session: 37, weekly: 0, resetSecs: 0, usageMode: "used" },
            ...(unavailable === "missing" ? [] : [{
              id: "claude", label: "Claude", session: 82, weekly: 0, resetSecs: 0,
              usageMode: "used", [unavailable]: true,
            }]),
          ] },
        }}
      />);

      const pair = screen.getByRole("button", { name: /Two at once/ });
      expect(pair.getAttribute("aria-pressed")).toBe("true");
      expect(document.querySelector('[data-slot="display-mode-preview"]')).toBeNull();
      expect(screen.getByRole("combobox", { name: "Provider 1" }).textContent).toBe("Claude");
      expect(screen.getByRole("combobox", { name: "Provider 2" }).textContent).toBe("Codex");
      expect(base.providerPicker.onDisplayChange).not.toHaveBeenCalled();
    },
  );

  it("saves the pair from Provider 1 and Provider 2", () => {
    const onDisplayChange = sources("pair", ["claude", "codex"]);

    expect(screen.getByRole("combobox", { name: "Provider 1" }).textContent).toBe("Claude");
    expect(screen.getByRole("combobox", { name: "Provider 2" }).textContent).toBe("Codex");
    openSelect("Provider 1");
    choose("Cursor");
    expect(onDisplayChange).toHaveBeenLastCalledWith(
      { mode: "pair", providerIds: ["cursor", "codex"] },
      "cursor",
    );
    cleanup();
    const second = sources("pair", ["claude", "codex"]);
    openSelect("Provider 2");
    choose("Cursor");
    expect(second).toHaveBeenLastCalledWith(
      { mode: "pair", providerIds: ["claude", "cursor"] },
      "claude",
    );
  });

  it.each([
    ["Provider 1", "Codex"],
    ["Provider 2", "Claude"],
  ])("swaps and saves the full pair when %s picks the other source", (picker, source) => {
    const onDisplayChange = sources("pair", ["claude", "codex"]);

    expect(screen.queryAllByRole("combobox", { name: /^(Top|Bottom)$/ })).toHaveLength(0);
    openSelect(picker);
    choose(source);

    expect(onDisplayChange).toHaveBeenCalledExactlyOnceWith(
      { mode: "pair", providerIds: ["codex", "claude"] },
      "codex",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

});
