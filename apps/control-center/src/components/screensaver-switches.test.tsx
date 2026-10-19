// Issue #643: Show screensaver has its switch in Settings only, beside when
// the screensaver starts and how bright it is. Appearance › Screensavers says
// in one line when it is off and links to it (variant 645-A). The Settings
// switch opens only once VibeTV's own value is read.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { DeviceInfo, StandbySettings } from "./control-center-types";
import { SettingsScreen } from "./settings-screen";
import { ThemeLibraryScreen } from "./theme-library-screen";

const standby: StandbySettings = {
  enabled: true,
  timeoutMinutes: 10,
  brightnessPercent: 20,
  screensaverPath: null,
};

const vibetv: DeviceInfo = {
  active: true,
  connected: true,
  paired: true,
  ready: true,
  capabilities: { standby: { supported: true } },
};

function settings(device: DeviceInfo, busyAction: string | null, saved: StandbySettings | null) {
  return renderToStaticMarkup(
    <SettingsScreen
      brightness={70}
      busyAction={busyAction}
      connectionMode="cable"
      device={device}
      displayPreferences={[]}
      standby={saved}
      onBrightnessChange={vi.fn()}
      onChooseScreensaver={vi.fn()}
      onConnectionModeChange={vi.fn()}
      onDismissError={vi.fn()}
      onResetSetup={vi.fn()}
      onSaveBrightness={vi.fn()}
      onSaveStandby={vi.fn()}
      onStandbyBrightnessChange={vi.fn()}
      providerPicker={{
        usage: { providers: [] },
        display: null,
        items: [],
        pendingCheckIds: new Set(),
        pendingPreferenceIds: new Set(),
        onCheck: vi.fn(),
        onDisplayChange: vi.fn(),
        onPreferenceChange: vi.fn(),
      }}
    />,
  );
}

function screensavers(saved: StandbySettings | null) {
  return renderToStaticMarkup(
    <ThemeLibraryScreen
      busyAction={null}
      companionStatus="online"
      device={vibetv}
      onInstallCustomTheme={async () => false}
      onInstallTheme={vi.fn()}
      onOpenScreensaverSettings={vi.fn()}
      onSelectTheme={vi.fn()}
      selectedThemeId=""
      standby={saved}
      storefrontConfigured={false}
      themeInstallEnabled
      themes={[]}
      usage="screensaver"
    />,
  );
}

function switchOf(html: string, id: string) {
  const button = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))?.[0];
  expect(button).toBeTruthy();
  return { disabled: button!.includes('disabled=""') };
}

describe("Show screensaver in Settings, a line under Screensavers", () => {
  it.each([
    ["ready", vibetv, null, false],
    ["waiting for usage", { ...vibetv, ready: false }, null, false],
    ["updating its firmware", vibetv, "firmware-update", true],
    ["changing its connection", vibetv, "connection-mode", true],
    ["saving the screensaver", vibetv, "standby", false],
    ["not connected", { ...vibetv, connected: false }, null, true],
  ] as const)("opens the Settings switch by one rule while VibeTV is %s", (_, device, busy, closed) => {
    expect(switchOf(settings(device, busy, standby), "vibetv-standby").disabled).toBe(closed);
  });

  // Until VibeTV's own value is read, Settings shows placeholder values. A
  // save from there wrote the placeholder time and brightness over the
  // customer's.
  it("keeps the Settings switch closed until VibeTV's setting is read", () => {
    expect(switchOf(settings(vibetv, null, null), "vibetv-standby").disabled).toBe(true);
  });

  it("has no switch and no explanation under Screensavers", () => {
    for (const saved of [standby, { ...standby, enabled: false }, null]) {
      const html = screensavers(saved);
      expect(html).not.toContain('role="switch"');
      expect(html).not.toContain("The same switch");
      expect(html).not.toContain("Screensaver is turned off");
    }
    expect(settings(vibetv, null, standby)).not.toContain("The same switch");
  });

  it("says in one line under Screensavers that the screensaver is off and links to Settings", () => {
    const off = screensavers({ ...standby, enabled: false });
    expect(off).toContain("Screensaver is off. Turn it on in");
    expect(off).toMatch(/<a [^>]*href="#settings-screensaver"[^>]*>Settings<\/a>/);
    expect(settings(vibetv, null, standby)).toContain('id="settings-screensaver"');

    expect(screensavers(standby)).not.toContain("Screensaver is off.");
    expect(screensavers(null)).not.toContain("Screensaver is off.");
  });
});
