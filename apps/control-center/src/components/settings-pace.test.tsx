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

  // A ready device with the pace flag unless the test says otherwise.
  const capable: Partial<DeviceInfo> = {
    capabilities: { theme: { supportsUsagePaceV1: true, supportsUsageWindowsV1: true, maxUsageWindows: 2 } },
  };
  const render = (displayPreferences: PreferenceDescriptor[], snapshot: UsageSnapshot, active: string, extra: Partial<DeviceInfo> = capable) => {
    const picker: ProviderPickerProps = {
      usage: snapshot, display: null, items: [], pendingCheckIds: new Set(),
      pendingPreferenceIds: new Set(), onDisplayChange: vi.fn(), onPreferenceChange: vi.fn(),
    };
    const device: DeviceInfo = { active: true, connected: true, paired: true, ready: true, activeTheme: active, ...extra };
    return renderToStaticMarkup(
      <SettingsScreen
        automaticPreviews={[]} brightness={70} busyAction={null} connectionMode="cable"
        device={device} displayPreferences={displayPreferences} standby={null}
        onBrightnessChange={vi.fn()} onChooseScreensaver={vi.fn()} onConnectionModeChange={vi.fn()}
        onDismissError={vi.fn()} onResetSetup={vi.fn()} onSaveBrightness={vi.fn()}
        onSaveStandby={vi.fn()} onStandbyBrightnessChange={vi.fn()} providerPicker={picker}
        themes={themes}
      />,
    );
  };

  it("stands directly under Display mode with the switch on and the muted line", () => {
    const html = render([showPace(true)], usage("farAhead"), "token-counter");
    const sections = [...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map(([, title]) => title);
    expect(sections.slice(sections.indexOf("Display mode"), sections.indexOf("Display mode") + 2)).toEqual(["Display mode", "Pace"]);
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

  // Issue #864 review: a device without the pace flag cannot show pace.
  const updateNeeded = "Update needed. Update VibeTV to use this.";
  const paceSwitch = (html: string) => html.match(/<button[^>]*role="switch"[^>]*>|<button[^>]*aria-checked[^>]*>/)?.[0] ?? "";

  it("disables the switch and says Update needed on firmware without pace", () => {
    const old = { capabilities: { theme: { supportsUsagePaceV1: false } } };
    const html = render([showPace(true)], usage("farAhead"), "token-counter", old);
    expect(html).toContain(updateNeeded);
    expect(html).not.toContain("has no place for it");
    expect(paceSwitch(html)).toContain('disabled=""');
    // The device does not draw pace, so the switch does not claim it is on.
    expect(html).toMatch(/aria-checked="false"/);
  });

  it("keeps the normal pace line on capable firmware and while the device is unknown", () => {
    const capableHtml = render([showPace(true)], usage("farAhead"), "token-counter");
    expect(capableHtml).not.toContain(updateNeeded);
    expect(capableHtml).toContain("Token Counter has no place for it. Pace Meter shows it.");
    expect(paceSwitch(capableHtml)).not.toContain('disabled=""');

    // Offline: no claim about the firmware.
    const offline = render([showPace(true)], usage("farAhead"), "token-counter", { ready: false, connected: false, capabilities: undefined });
    expect(offline).not.toContain(updateNeeded);
    expect(offline).toMatch(/aria-checked="true"/);
  });

  it("has no accessibility violations", async () => {
    await expectNoAxeViolations(render([showPace(true)], usage("farAhead"), "token-counter"));
  });
});
