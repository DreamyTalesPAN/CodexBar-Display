import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DeviceInfo, StandbySettings } from "./control-center-types";
import { SettingsScreen } from "./settings-screen";

const standbyDevice: DeviceInfo = {
  connected: true,
  ready: true,
  capabilities: { standby: { supported: true } },
};

const savedStandby: StandbySettings = {
  enabled: false,
  timeoutMinutes: 10,
  brightnessPercent: 20,
};

function render(
  device: DeviceInfo,
  standby: StandbySettings | null = savedStandby,
) {
  return renderToStaticMarkup(
    <SettingsScreen
      brightness={70}
      busyAction={null}
      device={device}
      standby={standby}
      onBrightnessChange={vi.fn()}
      onResetSetup={vi.fn()}
      onSaveBrightness={vi.fn()}
      onSaveStandby={vi.fn()}
      onStandbyBrightnessChange={vi.fn()}
    />,
  );
}

describe("SettingsScreen standby controls", () => {
  it("hides the whole block on firmware without standby support", () => {
    const html = render({ connected: true, ready: true });

    expect(html).toContain("Brightness");
    expect(html).not.toContain("Show screensaver");
    expect(html).not.toContain("Show after");
    expect(html).not.toContain("Brightness in screensaver");
  });

  it("collapses the screensaver details while the screensaver is off", () => {
    const html = render(standbyDevice);

    expect(html).toContain("Show screensaver");
    expect(html).not.toContain("Show after");
    expect(html).not.toContain("Brightness in screensaver");
  });

  it("shows timeout and screensaver brightness once the screensaver is on", () => {
    const html = render(standbyDevice, {
      enabled: true,
      timeoutMinutes: 30,
      brightnessPercent: 35,
    });

    expect(html).toContain("Show screensaver");
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("Show after");
    expect(html).toContain('id="vibetv-standby-timeout"');
    expect(html).toContain("Brightness in screensaver");
    expect(html).toContain('id="vibetv-standby-brightness"');
  });

  it("describes the card as the whole screen, not only brightness", () => {
    expect(render(standbyDevice)).toContain(
      "Adjust the screen of the connected VibeTV.",
    );
  });
});
