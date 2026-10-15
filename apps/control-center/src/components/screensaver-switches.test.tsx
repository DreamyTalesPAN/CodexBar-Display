// Issue #643: Show screensaver has a switch in Settings and one under
// Appearance › Screensavers, for the same setting. Each says where the other
// one is, and both open and close by the same rule. Before, Screensavers
// closed its switch on a VibeTV that waits for usage while Settings left its
// own open, and the other way round during a firmware update.
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
      automaticPreviews={[]}
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

function screensavers(device: DeviceInfo, busyAction: string | null) {
  return renderToStaticMarkup(
    <ThemeLibraryScreen
      busyAction={busyAction}
      companionStatus="online"
      device={device}
      onInstallCustomTheme={async () => false}
      onInstallTheme={vi.fn()}
      onSaveStandby={vi.fn()}
      onSelectTheme={vi.fn()}
      selectedThemeId=""
      standby={standby}
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
  return {
    disabled: button!.includes('disabled=""'),
    describedBy: button!.match(/aria-describedby="([^"]+)"/)?.[1],
  };
}

describe("Show screensaver in Settings and under Screensavers", () => {
  it("says under each switch where the other one is", () => {
    const inSettings = settings(vibetv, null, standby);
    const inScreensavers = screensavers(vibetv, null);

    const settingsSwitch = switchOf(inSettings, "vibetv-standby");
    expect(inSettings).toContain(
      `id="${settingsSwitch.describedBy}">The same switch is under Appearance › Screensavers.</p>`,
    );
    const screensaversSwitch = switchOf(inScreensavers, "vibetv-library-standby");
    expect(inScreensavers).toContain(
      `id="${screensaversSwitch.describedBy}">The same switch is in Settings, where you also choose when the screensaver starts and how bright it is.</p>`,
    );
  });

  it.each([
    ["ready", vibetv, null, false],
    ["waiting for usage", { ...vibetv, ready: false }, null, false],
    ["updating its firmware", vibetv, "firmware-update", true],
    ["changing its connection", vibetv, "connection-mode", true],
    ["saving the screensaver", vibetv, "standby", false],
    ["not connected", { ...vibetv, connected: false }, null, true],
  ] as const)("opens and closes both switches together while VibeTV is %s", (_, device, busy, closed) => {
    expect(switchOf(settings(device, busy, standby), "vibetv-standby").disabled).toBe(closed);
    expect(switchOf(screensavers(device, busy), "vibetv-library-standby").disabled).toBe(closed);
  });

  // Until VibeTV's own value is read, Settings shows placeholder values. A
  // save from there wrote the placeholder time and brightness over the
  // customer's; Screensavers shows no switch at all then.
  it("keeps the Settings switch closed until VibeTV's setting is read", () => {
    expect(switchOf(settings(vibetv, null, null), "vibetv-standby").disabled).toBe(true);
  });
});
