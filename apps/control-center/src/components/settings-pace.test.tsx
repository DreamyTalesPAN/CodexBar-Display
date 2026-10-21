import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import type { ThemeProduct } from "@/lib/themes";
import type {
  DeviceInfo,
  PreferenceDescriptor,
  UsageSnapshot,
} from "./control-center-types";
import type { ProviderPickerProps } from "./provider-picker";
import { activeLiveThemeId } from "@/lib/active-theme-upgrade";
import { paceSetting, SHOW_PACE_PREFERENCE_ID } from "./settings-pace";
import { SettingsScreen } from "./settings-screen";

const showPace = (value: boolean): PreferenceDescriptor => ({
  allowsDefault: false,
  availability: { state: "available" },
  effectiveValue: value,
  id: SHOW_PACE_PREFERENCE_ID,
  label: "Show reserve or deficit",
  owner: "vibetv",
  section: "display",
  type: "boolean",
  value,
  writable: true,
  writeStrategy: "vibetv_override",
});

const lane = (stage?: string) => ({
  id: "session", label: "Session", usedPercent: 40, ...(stage ? { stage } : {}),
});
const usage = (stage?: string): UsageSnapshot => ({
  providers: [{
    id: "claude", label: "Claude", session: 40, weekly: 10, resetSecs: 100, usageMode: "used",
    windows: [lane(stage)],
    pace: stage ? [{ window: "primary", stage }] : [],
  }],
});
const theme = (id: string, title: string, capabilities: string[]): ThemeProduct => ({
  id, themeId: id, title, priceLabel: "Free", isFree: true, packUrl: "", packSha256: "",
  packSizeBytes: 1, source: "github-catalog", requiredCapabilities: capabilities,
});
const themes = [
  theme("mini-classic", "Mini Classic", ["usage-slots-v1", "usage-pace-v1"]),
  theme("token-counter", "Token Counter", ["usage-slots-v1"]),
  theme("pace-meter", "Pace Meter", ["usage-slots-v1", "usage-pace-v1"]),
];

describe("the Settings section Pace", () => {
  it("is there only when the engine sends pace", () => {
    expect(paceSetting([showPace(true)], usage("farAhead"), undefined, themes)).not.toBeNull();
    // Today's Windows engine sends no pace: no section.
    expect(paceSetting([showPace(true)], usage(), undefined, themes)).toBeNull();
    expect(paceSetting([showPace(true)], null, undefined, themes)).toBeNull();
    // An older Mac App without the preference has none either.
    expect(paceSetting([], usage("farAhead"), undefined, themes)).toBeNull();
  });

  it("names a theme without a place for pace only while the switch is on", () => {
    const note = (value: boolean, active?: string) =>
      paceSetting([showPace(value)], usage("ahead"), active, themes)?.note;
    expect(note(true, "token-counter")).toBe("Token Counter has no place for it. Pace Meter shows it.");
    expect(note(false, "token-counter")).toBeNull();
    // A theme with pace, or one the catalog does not know, gets no line.
    expect(note(true, "mini-classic")).toBeNull();
    expect(note(true, "my-own-theme")).toBeNull();
    expect(note(true, undefined)).toBeNull();
  });

  const render = (displayPreferences: PreferenceDescriptor[], snapshot: UsageSnapshot, active: string, standby?: DeviceInfo["standby"]) => {
    const picker: ProviderPickerProps = {
      usage: snapshot, display: null, items: [], pendingCheckIds: new Set(),
      pendingPreferenceIds: new Set(), onDisplayChange: vi.fn(), onPreferenceChange: vi.fn(),
    };
    const device: DeviceInfo = { active: true, connected: true, paired: true, ready: true, activeTheme: active, ...(standby ? { standby } : {}) };
    return renderToStaticMarkup(
      <SettingsScreen
        brightness={70} busyAction={null} connectionMode="cable"
        device={device} displayPreferences={displayPreferences} standby={null}
        onBrightnessChange={vi.fn()} onChooseScreensaver={vi.fn()} onConnectionModeChange={vi.fn()}
        onDismissError={vi.fn()} onResetSetup={vi.fn()} onSaveBrightness={vi.fn()}
        onSaveStandby={vi.fn()} onStandbyBrightnessChange={vi.fn()} providerPicker={picker}
        themes={themes}
      />,
    );
  };

  it("stands under Display mode and Limits on VibeTV with the switch on and the muted line", () => {
    const html = render([showPace(true)], usage("farAhead"), "token-counter");
    const sections = [...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map(([, title]) => title);
    expect(sections.slice(sections.indexOf("Display mode"), sections.indexOf("Display mode") + 3)).toEqual(["Display mode", "Limits on VibeTV", "Pace"]);
    expect(html).toContain(">Show reserve or deficit</label>");
    expect(html).toMatch(/role="switch"[^>]*aria-checked="true"|aria-checked="true"[^>]*role="switch"/);
    expect(html).toContain("Token Counter has no place for it. Pace Meter shows it.");
    // Off: no line, the switch is off.
    const off = render([showPace(false)], usage("farAhead"), "token-counter");
    expect(off).not.toContain("has no place for it");
    expect(off).toMatch(/aria-checked="false"/);
  });

  // During standby the device draws the screensaver; the note names the live theme.
  it("names the live theme, not the screensaver, while VibeTV is in standby", () => {
    const withPath = (id: string, themeSpecPath: string) => ({
      ...themes.find((item) => item.id === id)!, themeSpecPath,
    });
    const catalog = [
      withPath("mini-classic", "/themes/u/mini-5-aaaaaa.json"),
      withPath("token-counter", "/themes/u/tc-3-bbbbbb.json"),
    ];
    const screensaver = { ...theme("night-clock", "Night Clock", []), usage: "screensaver" as const };
    const note = (livePath: string) =>
      paceSetting(
        [showPace(true)], usage("ahead"),
        activeLiveThemeId([...catalog, screensaver], {
          activeTheme: "night-clock",
          standby: { active: true, liveThemePath: livePath },
        } as DeviceInfo),
        [...catalog, screensaver],
      )?.note;
    expect(note("/themes/u/mini-5-aaaaaa.json")).toBeNull();
    expect(note("/themes/u/tc-3-bbbbbb.json")).toBe("Token Counter has no place for it. Pace Meter shows it.");
  });

  it("is not drawn on an engine without pace", () => {
    const html = render([showPace(true)], usage(), "token-counter");
    expect(html).not.toContain("Show reserve or deficit");
    expect(html).not.toContain(">Pace<");
  });

  it.each([false, true])("keeps the setting when lane pace is cleared (stale=%s)", (stale) => {
    const snapshot = usage("farAhead");
    snapshot.providers[0] = {
      ...snapshot.providers[0], stale, windowsRetained: stale,
      // The API clears lane pace when stale or after the reset has passed.
      windows: [lane()],
    };
    const html = render([showPace(true)], snapshot, "token-counter");
    expect(html).toContain(">Pace<");
    expect(html).toContain(">Show reserve or deficit</label>");
    expect(html).toContain("Token Counter has no place for it. Pace Meter shows it.");
  });

  it("has no accessibility violations", async () => {
    await expectNoAxeViolations(render([showPace(true)], usage("farAhead"), "token-counter"));
  });
});
