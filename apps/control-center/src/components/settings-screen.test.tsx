import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DeviceInfo, StandbySettings } from "./control-center-types";
import type { ProviderItem, ProviderPickerProps } from "./provider-picker";
import { SettingsScreen, standbyTimeoutLabel } from "./settings-screen";

const providerPicker: ProviderPickerProps = {
  display: null,
  items: [],
  pendingCheckIds: new Set(),
  pendingPreferenceIds: new Set(),
  onCheck: vi.fn(),
  onDisplayChange: vi.fn(),
  onPreferenceChange: vi.fn(),
};

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

function provider(
  providerId: string,
  label: string,
  value: boolean,
): ProviderItem {
  return {
    allowsDefault: false,
    availability: { state: "available" },
    effectiveValue: value,
    health: {
      message: value ? "Ready." : "Off.",
      service: "operational",
      state: value ? "healthy" : "disabled",
    },
    id: `codexbar.providers.${providerId}.enabled`,
    label,
    owner: "codexbar",
    providerId,
    section: "providers",
    type: "boolean",
    value,
    writable: true,
    writeStrategy: "codexbar_command",
  };
}

function render(
  device: DeviceInfo,
  standby: StandbySettings | null = savedStandby,
  picker: ProviderPickerProps = providerPicker,
  brightness: number | null = 70,
  connectionMode: "cable" | "wifi" = "cable",
) {
  return renderToStaticMarkup(
    <SettingsScreen
      automaticPreviews={[]}
      brightness={brightness}
      busyAction={null}
      connectionMode={connectionMode}
      device={device}
      standby={standby}
      onBrightnessChange={vi.fn()}
      onChooseScreensaver={vi.fn()}
      onConnectionModeChange={vi.fn()}
      onResetSetup={vi.fn()}
      onSaveBrightness={vi.fn()}
      onSaveStandby={vi.fn()}
      onStandbyBrightnessChange={vi.fn()}
      providerPicker={picker}
    />,
  );
}

describe("SettingsScreen standby controls", () => {
  it("labels unsupported brightness without a loading state", () => {
    const html = render(
      {
        connected: true,
        ready: true,
        capabilities: { display: { brightness: { supported: false } } },
      },
      savedStandby,
      providerPicker,
      null,
    );

    expect(html).toContain("Not supported");
    expect(html).not.toContain("Loading");
  });

  it("hides the whole block on firmware without standby support", () => {
    const html = render({ connected: true, ready: true });

    expect(html).toContain("Brightness");
    expect(html).not.toContain("Show screensaver");
    expect(html).not.toContain("Show after");
    expect(html).not.toContain("Brightness in screensaver");
  });

  it("keeps every screensaver setting visible while the screensaver is off", () => {
    const html = render(standbyDevice);

    expect(html).toContain(">Screensaver</h2>");
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

  it("keeps the toggle usable and greys out details before a screensaver is chosen", () => {
    const html = render(standbyDevice, {
      enabled: false,
      timeoutMinutes: 10,
      brightnessPercent: 20,
      screensaverPath: null,
    });

    expect(html).toContain("Choose screensaver");
    expect(html).toContain('aria-label="Show screensaver"');
    expect(html).toContain('aria-checked="false"');
    const standbySwitch = html.match(
      /<button[^>]*id="vibetv-standby"[^>]*>/,
    )?.[0];
    // The toggle is the entry point: it must stay usable even before any
    // screensaver is installed.
    expect(standbySwitch).not.toContain('disabled=""');
    expect(html).toContain('id="vibetv-standby-timeout"');
    expect(html).toContain('id="vibetv-standby-brightness"');
    // While the screensaver is off, every detail row reads as disabled:
    // labels grey out with their fields and the link is inert.
    expect(html.match(/data-disabled="true"/g)?.length).toBeGreaterThanOrEqual(
      2,
    );
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("pointer-events-none");
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
    // Nothing on this screen is a card any more: the provider list carries its
    // own rows, and the card that used to wrap them took the page's only
    // heading with it.
    expect(html).not.toContain('data-slot="card"');
    expect(html).toContain(">AI providers</h2>");
  });

  // Asserted as structure rather than as class strings: counting the class
  // string is what let three copies of it accumulate in the first place.
  it("gives every section a heading and a control column", () => {
    const html = render(standbyDevice);
    const headings = html.match(/<h2[^>]*>([^<]+)<\/h2>/g) || [];

    expect(headings).toHaveLength(6);
    expect(html).toContain(">Display</h2>");
    expect(html).toContain(">Display mode</h2>");
    expect(html).toContain(">AI providers</h2>");
    expect(html).toContain(">Screensaver</h2>");
    expect(html).toContain(">Connection</h2>");
    expect(html).toContain(">Setup</h2>");
    expect(html).toContain("Connect this Mac to another VibeTV.");
    expect(html.match(/<section /g)).toHaveLength(6);
  });

  // The provider list is the longest thing on the page, so it closes it rather
  // than pushing the short settings below it off the screen.
  it("puts AI providers last", () => {
    const html = render(standbyDevice);
    const order = (html.match(/<h2[^>]*>([^<]+)<\/h2>/g) || []).map((tag) =>
      tag.replace(/<[^>]+>/g, ""),
    );

    expect(order).toEqual([
      "Display",
      "Display mode",
      "Screensaver",
      "Connection",
      "Setup",
      "AI providers",
    ]);
  });

  it("keeps enabled providers first in Settings without reordering either group", () => {
    const html = render(standbyDevice, savedStandby, {
      ...providerPicker,
      items: [
        provider("openai", "OpenAI", false),
        provider("claude", "Claude Code", true),
        provider("cursor", "Cursor", false),
        provider("codex", "Codex", true),
      ],
    });
    const providerSection = html.slice(html.indexOf(">AI providers</h2>"));
    const positions = ["Claude Code", "Codex", "OpenAI", "Cursor"].map(
      (label) => providerSection.indexOf(`>${label}</`),
    );

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual(
      [...positions].sort((left, right) => left - right),
    );
  });

  it("leaves the display mode cards usable when no write is in flight", () => {
    const html = render(standbyDevice);
    const cards = html.match(/<button aria-pressed="(?:true|false)"[^>]*>/g) || [];

    expect(cards.length).toBeGreaterThanOrEqual(2);
    expect(cards.some((card) => card.includes('disabled=""'))).toBe(false);
  });

  // The design puts the reading beside its label. It stays an <output>, so a
  // screen reader still announces it as it changes.
  it("shows the brightness reading next to its label", () => {
    const html = render(standbyDevice);

    expect(html).toMatch(/for="vibetv-brightness"[^>]*>Brightness<\/label>/);
    expect(html).toContain(">70%</output>");
    // It no longer rides the thumb: no absolute placement, no computed offset.
    expect(html).not.toMatch(/<output[^>]*class="[^"]*absolute/);
    expect(html).not.toMatch(/<output[^>]*style="left:/);
  });

  it("uses the existing Settings select pattern for connection mode", () => {
    const html = render(standbyDevice);

    expect(html).toContain(">Connection</h2>");
    expect(html).toContain("Choose how this Mac connects to VibeTV.");
    expect(html).toContain('for="vibetv-connection-mode"');
    expect(html).toContain('aria-label="Connection mode"');
    expect(html).toContain('data-slot="select-trigger"');
    expect(html).not.toContain("Change connection");
  });

  it("keeps Cable recovery available for an active offline WiFi binding", () => {
    const html = render(
      {
        active: true,
        connected: false,
        paired: true,
        capabilities: {
          transport: {
            active: "wifi",
            mode: "wifi",
            supported: ["usb", "wifi"],
          },
        },
      },
      null,
      providerPicker,
      null,
      "wifi",
    );
    const connectionModeTrigger = html.match(
      /<button[^>]*aria-label="Connection mode"[^>]*>/,
    )?.[0];

    expect(connectionModeTrigger).toBeDefined();
    expect(connectionModeTrigger).not.toContain('disabled=""');
  });

  it("keeps VibeTV mutations disabled during a firmware update", () => {
    const html = renderToStaticMarkup(
      <SettingsScreen
        automaticPreviews={[]}
        brightness={50}
        busyAction="firmware-update"
        connectionMode="cable"
        device={standbyDevice}
        standby={savedStandby}
        onBrightnessChange={vi.fn()}
        onChooseScreensaver={vi.fn()}
        onConnectionModeChange={vi.fn()}
        onResetSetup={vi.fn()}
        onSaveBrightness={vi.fn()}
        onSaveStandby={vi.fn()}
        onStandbyBrightnessChange={vi.fn()}
        providerPicker={providerPicker}
      />,
    );

    expect(html.match(/<button[^>]*disabled=""/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
