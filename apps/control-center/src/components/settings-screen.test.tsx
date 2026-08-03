import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DeviceInfo, StandbySettings } from "./control-center-types";
import { SettingsScreen, standbyTimeoutLabel } from "./settings-screen";

const standbyDevice: DeviceInfo = {
  active: true,
  connected: true,
  paired: true,
  ready: true,
  capabilities: { standby: { supported: true } },
};

const savedStandby: StandbySettings = {
  enabled: false,
  timeoutMinutes: 10,
  brightnessPercent: 20,
  screensaverPath: "/themes/s/night.json",
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
      onChooseScreensaver={vi.fn()}
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

  it("keeps every screensaver setting visible while the screensaver is off", () => {
    const html = render(standbyDevice);

    expect(html).toContain(">Screensaver</h3>");
    expect(html).toContain("Show screensaver");
    expect(html.indexOf('id="vibetv-standby"')).toBeLessThan(
      html.indexOf('for="vibetv-standby"'),
    );
    expect(html).toContain("Show after");
    expect(html).toContain("Brightness in screensaver");
    expect(html).toContain("Choose screensaver");
    expect(html).toMatch(/role="combobox"[^>]*disabled=""/);
    expect(html).toMatch(
      /aria-disabled="true"[^>]*id="vibetv-standby-brightness"/,
    );
    expect(html).not.toContain("Save screensaver brightness");
  });

  it("keeps the toggle and settings available before a screensaver is chosen", () => {
    const html = render(standbyDevice, {
      enabled: false,
      timeoutMinutes: 10,
      brightnessPercent: 20,
      screensaverPath: null,
    });

    expect(html).toContain("Choose screensaver");
    expect(html).toContain('aria-label="Show screensaver"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('id="vibetv-standby-timeout"');
    expect(html).toContain('id="vibetv-standby-brightness"');
    expect(html).not.toContain("Choose a screensaver before turning it on.");
    expect(html).not.toContain('data-variant="link"');
    expect(html).toContain('<a class="inline-block');
    expect(html).toContain('href="#screensavers"');
  });

  it("shows timeout and screensaver brightness once the screensaver is on", () => {
    const html = render(standbyDevice, {
      enabled: true,
      timeoutMinutes: 30,
      brightnessPercent: 35,
      screensaverPath: "/themes/s/night.json",
    });

    expect(html).toContain("Show screensaver");
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("Show after");
    expect(html).toMatch(
      /data-orientation="horizontal"[^>]*><label[^>]+for="vibetv-standby-timeout"/,
    );
    expect(html).toContain('id="vibetv-standby-timeout"');
    expect(html).toContain("Brightness in screensaver");
    expect(html).toContain('id="vibetv-standby-brightness"');
    expect(html).toContain(">35%</output>");
    expect(html).not.toContain("Save screensaver brightness");
  });

  it("shows the one-minute firmware minimum as a readable timeout", () => {
    expect(standbyTimeoutLabel(1)).toBe("1 minute");
    expect(standbyTimeoutLabel(5)).toBe("5 minutes");
  });

  it("uses flat sections with dividers instead of cards", () => {
    const html = render(standbyDevice);

    expect(html).not.toContain("Adjust the screen of the connected VibeTV.");
    expect(html).not.toContain(
      "Show your selected screensaver when VibeTV is idle.",
    );
    expect(html).not.toContain("minimum");
    expect(html).not.toContain("Save brightness");
    expect(html).toContain('data-slot="item-separator"');
    expect(html).not.toContain('data-slot="card"');
  });

  it("uses responsive intro and control columns for every section", () => {
    const html = render(standbyDevice);

    expect(html.match(/grid-cols-1/g)).toHaveLength(3);
    expect(
      html.match(/md:grid-cols-\[minmax\(0,1fr\)_minmax\(0,2fr\)\]/g),
    ).toHaveLength(3);
    expect(html).toMatch(
      /<h3>Setup<\/h3>.*Connect this Mac to another VibeTV\.<\/p><\/div><div data-slot="item-actions"/,
    );
  });
});
