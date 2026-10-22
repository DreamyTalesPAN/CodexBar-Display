import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import type { ThemeProduct } from "@/lib/themes";
import type {
  DeviceInfo,
  PreferenceDescriptor,
  StandbySettings,
} from "./control-center-types";

type ThemeCapabilities = NonNullable<NonNullable<DeviceInfo["capabilities"]>["theme"]>;
import type { ProviderItem, ProviderPickerProps } from "./provider-picker";
import {
  SettingsScreen,
  standbyTimeoutLabel,
  type SettingsScreenProps,
} from "./settings-screen";

const providerPicker: ProviderPickerProps = {
  usage: { providers: ["codex", "claude", "cursor"].map((id) => ({
    id, label: id, session: 0, weekly: 0, resetSecs: 0, usageMode: "used",
  })) },
  display: null,
  items: [],
  pendingCheckIds: new Set(),
  pendingPreferenceIds: new Set(),
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

function render(
  device: DeviceInfo,
  standby: StandbySettings | null = savedStandby,
  picker: ProviderPickerProps = providerPicker,
  brightness: number | null = 70,
  connectionMode: "cable" | "wifi" = "cable",
  windowsHost = false,
  displayPreferences: PreferenceDescriptor[] = [],
  providerShortcut: SettingsScreenProps["providerShortcut"] = null,
) {
  return renderToStaticMarkup(
    <SettingsScreen
      brightness={brightness}
      busyAction={null}
      connectionMode={connectionMode}
      device={device}
      displayPreferences={displayPreferences}
      standby={standby}
      onBrightnessChange={vi.fn()}
      onChooseScreensaver={vi.fn()}
      onConnectionModeChange={vi.fn()}
      onDismissError={vi.fn()}
      onResetSetup={vi.fn()}
      onSaveBrightness={vi.fn()}
      onSaveStandby={vi.fn()}
      onStandbyBrightnessChange={vi.fn()}
      providerPicker={picker}
      providerShortcut={providerShortcut}
      windowsHost={windowsHost}
    />,
  );
}

describe("Provider settings", () => {
  // Paul, 16.10.2026: the setup intro does not belong above Settings › AI providers.
  it("shows the provider list without the setup intro", () => {
    const html = render(standbyDevice);
    expect(html).toContain("Search providers");
    expect(html).not.toContain("VibeTV reads your AI usage with CodexBar");
    expect(html).not.toContain("Turn on the providers you use below.");
  });
});

// Issues #438/#460: the Windows app must not speak of "this Mac". The Mac
// wording is pinned by the tests below and must not change at all.
describe("SettingsScreen on Windows", () => {
  it("says this computer where the Mac app says this Mac", () => {
    const html = render(standbyDevice, savedStandby, providerPicker, 70, "cable", true);

    expect(html).toContain("Requires a data cable connected to this computer.");
    expect(html).toContain("Connect this computer to another VibeTV.");
    expect(html).not.toContain("Mac");
  });
});

describe("SettingsScreen standby controls", () => {
  it("offers the factory reset only over the USB cable", () => {
    const props = {
      brightness: 70,
      busyAction: null,
      device: standbyDevice,
      standby: savedStandby,
      onBrightnessChange: vi.fn(),
      onChooseScreensaver: vi.fn(),
      onConnectionModeChange: vi.fn(),
      onDismissError: vi.fn(),
      onEraseDevice: vi.fn(),
      onResetSetup: vi.fn(),
      onSaveBrightness: vi.fn(),
      onSaveStandby: vi.fn(),
      onStandbyBrightnessChange: vi.fn(),
      providerPicker,
    };
    const cable = renderToStaticMarkup(
      <SettingsScreen {...props} connectionMode="cable" />,
    );
    const wifi = renderToStaticMarkup(
      <SettingsScreen {...props} connectionMode="wifi" />,
    );

    expect(cable).toContain("Factory reset");
    expect(wifi).not.toContain("Factory reset");
    // Calm master: each action is a row with its title, its own line and an
    // outline button on the right ("Run setup", red "Reset…"). Run diagnostics
    // is on Support only.
    expect(cable).toMatch(
      /Run setup again<\/p><p[^>]*>Connect this Mac to another VibeTV\.<\/p><\/div><button[^>]*><span>Run setup<\/span><\/button><\/div><div[^>]*><div[^>]*><p[^>]*>Factory reset<\/p><p[^>]*>VibeTV forgets its WiFi details, pairing, settings and themes\.<\/p><\/div><button[^>]*><span>Reset…<\/span><\/button>/,
    );
    // The template's outline buttons have 14 px of side space (border included in the 36 px box).
    expect(cable).toMatch(/<button[^>]*class="[^"]*\bpx-3\.5\b[^"]*"[^>]*><span>Run setup<\/span>/);
    expect(cable).toMatch(/<button[^>]*class="[^"]*\bpx-3\.5\b[^"]*"[^>]*><span>Reset…<\/span>/);
    expect(cable.match(/Connect this Mac to another VibeTV\./g)).toHaveLength(1);
    expect(wifi).toContain("Connect this Mac to another VibeTV.");
    expect(wifi).not.toContain("VibeTV forgets");
    expect(cable).not.toContain("Run diagnostics");
  });

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
    // The name sits in its fixed column to the left, the switch beside it.
    expect(html.indexOf('for="vibetv-standby"')).toBeLessThan(
      html.indexOf('id="vibetv-standby"'),
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
    expect(html).toMatch(/<label[^>]+for="vibetv-standby-timeout"/);
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

    expect(headings).toHaveLength(8);
    expect(html).toContain(">Brightness</h2>");
    expect(html).toContain(">Display mode</h2>");
    expect(html).toContain(">Limits on VibeTV</h2>");
    expect(html).toContain(">AI providers</h2>");
    expect(html).toContain(">Screensaver</h2>");
    expect(html).toContain(">Connection</h2>");
    expect(html).toContain(">Setup</h2>");
    expect(html).toContain(">Theme Studio AI</h2>");
    expect(html).toContain("Connect this Mac to another VibeTV.");
    expect(html.match(/<section /g)).toHaveLength(8);
  });

  // The provider list is the longest thing on the page, so it closes it rather
  // than pushing the short settings below it off the screen.
  it("puts AI providers last", () => {
    const html = render(standbyDevice);
    const order = (html.match(/<h2[^>]*>([^<]+)<\/h2>/g) || []).map((tag) =>
      tag.replace(/<[^>]+>/g, ""),
    );

    expect(order).toEqual([
      "Display mode",
      "Limits on VibeTV",
      "Brightness",
      "Screensaver",
      "Connection",
      "Setup",
      "Theme Studio AI",
      "AI providers",
    ]);
  });

  // The Theme Studio key row sits under its own name, not inside the provider
  // list: a row without a left-hand label broke the section rule.
  it("gives the Theme Studio AI row its own section above AI providers", () => {
    const html = render(standbyDevice);
    const themeSection = html.slice(html.indexOf(">Theme Studio AI</h2>"), html.indexOf(">AI providers</h2>"));

    expect(themeSection).toContain("Add key");
    // The section label already names the row; the row shows no second title.
    expect(themeSection).not.toContain(">Theme Studio AI</p>");
    expect(themeSection).not.toContain("Search providers");
  });

  it("puts the common subscription tools first in Settings, then switched-on providers", () => {
    const html = render(standbyDevice, savedStandby, {
      ...providerPicker,
      onOpenSignIn: vi.fn(),
      items: [
        provider("antigravity", "Antigravity", false),
        provider("claude", "Claude Code", true),
        provider("cursor", "Cursor", false),
        provider("codex", "Codex", true),
        // Switched on without a sign-in the Companion can start: it is listed
        // and sorts with the enabled group.
        provider("openai", "OpenAI", true),
        // Off: listed with the other switched-off providers.
        provider("gemini", "Gemini", false),
      ],
    });
    const providerSection = html.slice(html.indexOf(">AI providers</h2>"));
    const positions = [
      "Codex",
      "Claude Code",
      "Cursor",
      "Antigravity",
      "OpenAI",
      "Gemini",
    ].map((label) => providerSection.indexOf(`>${label}</`));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual(
      [...positions].sort((left, right) => left - right),
    );
  });

  // Without the companion's sign-in action (an older Companion) every
  // provider CodexBar reports stays on the page.
  it("keeps every provider in Settings on a companion without the sign-in action", () => {
    const html = render(standbyDevice, savedStandby, {
      ...providerPicker,
      items: [
        provider("claude", "Claude Code", true),
        provider("openai", "OpenAI", true),
        provider("gemini", "Gemini", false),
      ],
    });
    const providerSection = html.slice(html.indexOf(">AI providers</h2>"));

    expect(providerSection).toContain(">OpenAI</");
    expect(providerSection).toContain(">Gemini</");
  });

  it("leaves eligible display mode radios usable when no write is in flight", () => {
    const html = render(standbyDevice, savedStandby, {
      ...providerPicker,
      items: [provider("claude", "Claude", true), provider("codex", "Codex", true)],
    });
    const cards =
      html.match(/<button aria-label="(?:Automatic|One provider|Two at once)" aria-pressed="(?:true|false)"[^>]*>/g) || [];

    expect(cards.length).toBeGreaterThanOrEqual(2);
    expect(cards.some((card) => card.includes('disabled=""'))).toBe(false);
  });

  it.each(["one enabled", "missing reading", "stale reading", "unavailable reading"])(
    "disables Two at once with fewer than two eligible providers (%s)", (gap) => {
      const html = render(standbyDevice, savedStandby, {
        ...providerPicker,
        display: { mode: "automatic", providerIds: ["claude", "codex"], configured: true, valid: true },
        items: [provider("claude", "Claude", true), provider("codex", "Codex", gap !== "one enabled")],
        usage: { providers: providerPicker.usage!.providers
          .filter((reading) => gap !== "missing reading" || reading.id !== "codex")
          .map((reading) => reading.id === "codex" ? {
            ...reading, stale: gap === "stale reading", usageUnavailable: gap === "unavailable reading",
          } : reading) },
      });
      expect(html.match(/<button aria-label="Two at once"[^>]*>/)?.[0]).toContain('disabled=""');
    },
  );

  it("keeps an already saved pair selectable and visible during a provider gap", () => {
    const html = render(standbyDevice, savedStandby, {
      ...providerPicker,
      display: { mode: "pair", providerIds: ["claude", "codex"], configured: true, valid: true },
      items: [provider("claude", "Claude", true)],
      usage: null,
    });
    const pair = html.match(/<button aria-label="Two at once"[^>]*>/)?.[0];
    expect(pair).toContain('aria-pressed="true"');
    expect(pair).not.toContain('disabled=""');
    expect(html).toContain('>Provider 1</label>');
    expect(html).toContain('>Provider 2</label>');
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

  it("puts Connection after Screensaver and marks the active mode", () => {
    const html = render(standbyDevice);
    expect(html.indexOf(">Screensaver</h2>")).toBeLessThan(html.indexOf(">Connection</h2>"));
    expect(html).toContain('aria-label="USB-C" aria-pressed="true"');
    expect(html).toContain('aria-label="WiFi" aria-pressed="false"');
    expect(html).toContain("Requires a data cable connected to this Mac.");
    expect(html).toContain("VibeTV can sit anywhere on your desk.");
  });

  // Calm rule: small descriptions are 13 px, not the 16 px of the page body.
  it("sets the Connection descriptions at 13 px", () => {
    const html = render(standbyDevice, savedStandby, providerPicker, 70, "cable", false);

    expect(html).toMatch(
      /<span class="[^"]*text-\[13px\][^"]*">Requires a data cable connected to this Mac\.<\/span>/,
    );
    expect(html).toMatch(
      /<span class="[^"]*text-\[13px\][^"]*">No cable needed — VibeTV can sit anywhere on your desk\.<\/span>/,
    );
  });

  // Calm rule: the rest of the small text on Settings is 13 px too: section
  // names (semibold), the notice above Display mode, the brightness reading
  // and both help texts under Setup.
  it("sets the remaining small Settings text at 13 px", () => {
    const html = renderToStaticMarkup(
      <SettingsScreen
        brightness={70}
        busyAction={null}
        connectionMode="cable"
        device={standbyDevice}
        standby={savedStandby}
        onBrightnessChange={vi.fn()}
        onChooseScreensaver={vi.fn()}
        onConnectionModeChange={vi.fn()}
        onDismissError={vi.fn()}
        onEraseDevice={vi.fn()}
        onResetSetup={vi.fn()}
        onSaveBrightness={vi.fn()}
        onSaveStandby={vi.fn()}
        onStandbyBrightnessChange={vi.fn()}
        providerPicker={{
          ...providerPicker,
          displayNotice: "Codex is off, so VibeTV now switches automatically.",
        }}
      />,
    );

    expect(html).toMatch(/<h2 class="[^"]*text-\[13px\][^"]*">Display mode<\/h2>/);
    expect(html).toMatch(/<h2 class="[^"]*text-\[13px\][^"]*">Connection<\/h2>/);
    expect(html).toMatch(/<p [^>]*text-\[13px\][^>]*role="status">/);
    expect(html).toMatch(/<output [^>]*text-\[13px\][^>]*>70%<\/output>/);
    expect(html).toMatch(/<p [^>]*text-\[13px\][^>]*id="vibetv-run-setup-help">/);
    expect(html).toMatch(/<p [^>]*text-\[13px\][^>]*id="vibetv-factory-reset-help">/);
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
      /<button[^>]*aria-label="USB-C"[^>]*>/,
    )?.[0];

    expect(connectionModeTrigger).toBeDefined();
    expect(connectionModeTrigger).not.toContain('disabled=""');
  });

  // Issue #489: a VibeTV on WiFi offers USB-C only on cable-only firmware.
  it("greys out USB-C for older and legacy WiFi firmware", () => {
    const usbCard = (cableOnlyUpdates?: boolean, supported = ["usb", "wifi"]) =>
      render(
        {
          active: true,
          connected: true,
          paired: true,
          capabilities: {
            transport: { active: "wifi", mode: "wifi", supported, cableOnlyUpdates },
          },
        },
        null,
        providerPicker,
        null,
        "wifi",
      ).match(/<button[^>]*aria-label="USB-C"[^>]*>/)?.[0];

    expect(usbCard(true)).toBeDefined();
    expect(usbCard(true)).not.toContain('disabled=""');
    expect(usbCard(undefined)).toContain('disabled=""');
    expect(usbCard(false, ["wifi"])).toContain('disabled=""');
  });

  it("keeps VibeTV mutations disabled during a firmware update", () => {
    const html = renderToStaticMarkup(
      <SettingsScreen
        brightness={50}
        busyAction="firmware-update"
        connectionMode="cable"
        device={standbyDevice}
        standby={savedStandby}
        onBrightnessChange={vi.fn()}
        onChooseScreensaver={vi.fn()}
        onConnectionModeChange={vi.fn()}
        onDismissError={vi.fn()}
        onResetSetup={vi.fn()}
        onSaveBrightness={vi.fn()}
        onSaveStandby={vi.fn()}
        onStandbyBrightnessChange={vi.fn()}
        providerPicker={providerPicker}
      />,
    );

    expect(html.match(/<button[^>]*disabled=""/g)?.length).toBeGreaterThanOrEqual(2);
  });

  // Issue #322: the timed rotation is one select under the Automatic radio.
  // Issue #864 review: Two at once needs two windows per frame, which only
  // firmware with usage-windows-v1 and room for two draws.
  it("disables Two at once with Update needed on firmware without two windows", () => {
    const pairCard = (theme: ThemeCapabilities, ready = true) => {
      const html = render(
        { ...standbyDevice, ready, capabilities: { theme } },
        savedStandby,
        {
          ...providerPicker,
          display: { mode: "pair", providerIds: ["claude", "codex"], configured: true, valid: true },
          items: [provider("claude", "Claude", true), provider("codex", "Codex", true)],
        },
      );
      const title = html.indexOf(">Two at once<");
      return {
        card: html.slice(html.lastIndexOf("<button", title), title),
        text: html.slice(title, html.indexOf("</button>", title)),
      };
    };
    const updateNeeded = "Update needed. Update VibeTV to use this.";
    const shown = "VibeTV shows two sources, one above the other.";

    const old = pairCard({ supportsUsageWindowsV1: false, maxUsageWindows: 1 });
    expect(old.card).toContain('disabled=""');
    expect(old.text).toContain(updateNeeded);
    expect(old.text).not.toContain(shown);

    // Room for one window is not enough for a pair either.
    expect(pairCard({ supportsUsageWindowsV1: true, maxUsageWindows: 1 }).card).toContain('disabled=""');

    const capable = pairCard({ supportsUsageWindowsV1: true, maxUsageWindows: 2 });
    expect(capable.card).not.toContain('disabled=""');
    expect(capable.text).toContain(shown);
    expect(capable.text).not.toContain(updateNeeded);

    // Offline or unknown: no claim about the firmware.
    const offline = pairCard({ supportsUsageWindowsV1: false }, false);
    expect(offline.text).not.toContain(updateNeeded);
  });

  it("offers the rotation under Display mode only while Automatic is chosen", () => {
    const displayMode = (
      mode: "automatic" | "fixed",
      preferences: PreferenceDescriptor[],
    ) => {
      const html = render(
        standbyDevice,
        savedStandby,
        {
          ...providerPicker,
          display: { mode, providerIds: ["claude"], configured: true, valid: true },
          items: [provider("claude", "Claude", true), provider("codex", "Codex", true)],
        },
        70, "cable", false, preferences,
      );
      return html.slice(
        html.indexOf(">Display mode</h2>"),
        html.indexOf(">Screensaver</h2>"),
      );
    };
    const byActivity =
      "VibeTV switches between your sources based on recent activity and usage.";
    const onATimer = "VibeTV switches between your sources on a timer.";

    const automatic = displayMode("automatic", [rotation]);
    expect(automatic).toMatch(
      /for="vibetv\.display\.rotateSeconds"[^>]*>Switch providers<\/label>/,
    );
    expect(automatic).toContain(byActivity);
    expect(automatic).not.toContain(onATimer);

    // The Automatic line says what the chosen timer makes it do.
    const timed = displayMode("automatic", [{ ...rotation, value: "30" }]);
    expect(timed).toContain(onATimer);
    expect(timed).not.toContain(byActivity);

    expect(displayMode("fixed", [rotation])).not.toContain("Switch providers");
    expect(displayMode("automatic", [])).not.toContain("Switch providers");
  });

  // Variante A (#592): under Automatic, the provider VibeTV last received, and
  // only while the stream is healthy.
  it("names the provider VibeTV last received under Automatic", () => {
    const section = (mode: "automatic" | "fixed", device: DeviceInfo) => {
      const html = render(device, savedStandby, {
        ...providerPicker,
        display: { mode, providerIds: ["claude"], configured: true, valid: true },
        items: [provider("claude", "Claude", true), provider("codex", "Codex", true)],
      });
      return html.slice(
        html.indexOf(">Display mode</h2>"),
        html.indexOf("</section>", html.indexOf(">Display mode</h2>")),
      );
    };
    const streaming = (lastProviderId?: string): DeviceInfo => ({
      ...standbyDevice,
      stream: { healthy: true, running: true, lastProviderId },
    });

    expect(section("automatic", streaming("claude"))).toContain("Showing now: Claude");
    expect(section("automatic", streaming("gemini"))).not.toContain("Showing now:");
    expect(section("automatic", streaming())).not.toContain("Showing now:");
    expect(section("automatic", standbyDevice)).not.toContain("Showing now:");
    expect(section("automatic", { ...streaming("claude"), ready: false })).not.toContain("Showing now:");
    expect(section("fixed", streaming("claude"))).not.toContain("Showing now:");
  });

  // Variante A (#592): three radios; the chosen one carries its source rows.
  it("shows Display mode as three radios with the source rows under the chosen one", () => {
    const section = (mode: "automatic" | "fixed" | "pair", providerIds = ["claude"]) => {
      const html = render(standbyDevice, savedStandby, {
        ...providerPicker,
        display: { mode, providerIds, configured: true, valid: true },
        items: [provider("claude", "Claude", true), provider("codex", "Codex", true)],
      });
      return html.slice(
        html.indexOf(">Display mode</h2>"),
        html.indexOf("</section>", html.indexOf(">Display mode</h2>")),
      );
    };
    const pressed = (html: string) =>
      Array.from(
        html.matchAll(/<button\b[^>]*aria-label="([^"]*)"[^>]*aria-pressed="true"/g),
        (match) => match[1],
      );

    const automatic = section("automatic");
    expect(pressed(automatic)).toEqual(["Automatic"]);
    expect(automatic).toContain("VibeTV always shows the one source you pick.");
    expect(automatic).toContain("VibeTV shows two sources, one above the other.");
    for (const label of ["Source", "Provider 1", "Provider 2"]) {
      expect(automatic).not.toContain(`>${label}</label>`);
    }

    const one = section("fixed");
    expect(pressed(one)).toEqual(["One provider"]);
    expect(one).toContain(">Source</label>");
    expect(one).not.toContain(">Provider 1</label>");
    // No preview cards in Settings.
    expect(one).not.toContain('data-slot="display-mode-preview"');

    const two = section("pair", ["claude", "codex"]);
    expect(pressed(two)).toEqual(["Two at once"]);
    expect(two).toContain(">Provider 1</label>");
    expect(two).toContain(">Provider 2</label>");
    expect(two).not.toContain(">Source</label>");
    expect(two).not.toContain(">Top</label>");
    expect(two).not.toContain(">Bottom</label>");
    expect(two).not.toContain("First");
    expect(two).not.toContain("Second");
  });

  it("puts Limits on VibeTV right below Display mode, without a description", () => {
    const html = render(standbyDevice);
    const limits = html.slice(
      html.indexOf(">Limits on VibeTV</h2>"),
      html.indexOf(">Brightness</h2>"),
    );

    expect(html.indexOf(">Display mode</h2>")).toBeLessThan(html.indexOf(">Limits on VibeTV</h2>"));
    expect(limits).not.toContain("VibeTV shows the ticked limits");
  });

  // Issue #424: the app's global shortcut for the next provider is named
  // under Display mode, and so is the case that the system refused its keys.
  it("names the provider shortcut under Display mode", () => {
    const signedOut: ProviderItem = {
      ...provider("codex", "Codex", true),
      health: { message: "Authentication required.", service: "operational", state: "auth_required" },
    };
    const twoWithUsage = [provider("claude", "Claude", true), provider("cursor", "Cursor", true)];
    const displayMode = (
      providerShortcut: SettingsScreenProps["providerShortcut"],
      windowsHost = false,
      mode: "automatic" | "fixed" = "automatic",
      items: ProviderItem[] = twoWithUsage,
    ) => {
      const html = render(
        standbyDevice, savedStandby,
        { ...providerPicker, items,
          display: { mode, providerIds: ["claude"], configured: true, valid: true } },
        70, "cable", windowsHost, [], providerShortcut,
      );
      return html.slice(
        html.indexOf(">Display mode</h2>"),
        html.indexOf(">Screensaver</h2>"),
      );
    };

    expect(displayMode("available")).toContain(
      "Press ⌃⌥⌘P in any app to show the next provider. This switches to One provider.",
    );
    expect(displayMode("unavailable")).toContain(
      "The shortcut ⌃⌥⌘P for the next provider is not available: another app may already be using these keys.",
    );
    expect(displayMode("unavailable")).not.toContain("Press ");

    const windows = displayMode("available", true);
    expect(windows).toContain(
      "Press Ctrl+Alt+Shift+P in any app to show the next provider. This switches to One provider.",
    );
    expect(windows).not.toContain("⌘");
    expect(displayMode("unavailable", true)).toContain(
      "The shortcut Ctrl+Alt+Shift+P for the next provider is not available: another app may already be using these keys.",
    );

    // Issue #558: the line follows what a press would do. With Manual chosen
    // nothing switches to One provider, and with one provider that has usage a
    // press changes nothing, also when a second one is on without usage.
    const manual = displayMode("available", false, "fixed");
    expect(manual).toContain("Press ⌃⌥⌘P in any app to show the next provider.");
    expect(manual).not.toContain("This switches to One provider.");
    for (const mode of ["automatic", "fixed"] as const) {
      const one = displayMode("available", true, mode, [provider("claude", "Claude", true), signedOut]);
      expect(one).toContain(
        "Press Ctrl+Alt+Shift+P in any app to show the next provider. This needs two providers with usage.",
      );
      expect(one).not.toContain("This switches to One provider.");
    }

    // Until usage has been read, nobody knows how many providers have usage,
    // and a press may well work: the line claims neither.
    const unread = render(
      standbyDevice, savedStandby,
      { ...providerPicker, usage: null, items: twoWithUsage,
        display: { mode: "automatic", providerIds: ["claude"], configured: true, valid: true } },
      70, "cable", false, [], "available",
    );
    expect(unread).toContain("Press ⌃⌥⌘P in any app to show the next provider.</p>");
    expect(unread).not.toContain("This needs two providers with usage.");

    // Calm rule: the shortcut line is 13 px like the other small text.
    expect(displayMode("available")).toMatch(
      /<p class="[^"]*text-\[13px\][^"]*">Press ⌃⌥⌘P in any app to show the next provider\. This switches to One provider\.<\/p>/,
    );

    // A browser has no global shortcut, so Settings names none.
    expect(displayMode(null)).not.toContain("shortcut");
    expect(displayMode(null)).not.toContain("Press ");
  });

  // The line wraps to one or two lines by state, and a change of lines moved
  // everything below it (#579, found in #698). Every state keeps the same
  // paragraph, with room for two lines.
  it("keeps the provider shortcut line two lines high in every state", () => {
    const reserved = '<p class="-mt-1 min-h-[2lh] text-[13px] text-muted-foreground">';
    const page = (
      providerShortcut: SettingsScreenProps["providerShortcut"],
      mode: "automatic" | "fixed" = "automatic",
      usage: ProviderPickerProps["usage"] = providerPicker.usage,
      items: ProviderItem[] = [provider("claude", "Claude", true), provider("cursor", "Cursor", true)],
    ) =>
      render(
        standbyDevice, savedStandby,
        { ...providerPicker, usage, items,
          display: { mode, providerIds: ["claude"], configured: true, valid: true } },
        70, "cable", false, [], providerShortcut,
      );

    // Automatic with two providers and usage wraps to two lines; Manual, an
    // unread usage and one provider with usage wrap to one, and a press that
    // is unavailable has its own sentence.
    expect(page("available")).toContain(reserved);
    expect(page("available", "fixed")).toContain(reserved);
    expect(page("available", "automatic", null)).toContain(reserved);
    expect(page("available", "automatic", providerPicker.usage, [provider("claude", "Claude", true)])).toContain(reserved);
    expect(page("unavailable")).toContain(reserved);

    // A browser has no global shortcut, so there is no line to keep.
    expect(page(null)).not.toContain("min-h-[2lh]");
  });

  it("says why Display mode switched to Automatic", () => {
    const notice = "Codex is off, so VibeTV now switches automatically.";
    const html = render(standbyDevice, savedStandby, {
      ...providerPicker,
      display: { mode: "automatic", providerIds: ["claude"], configured: true, valid: true },
      displayNotice: notice,
      items: [provider("claude", "Claude", true), provider("codex", "Codex", false)],
    });
    const displaySection = html.slice(
      html.indexOf(">Display mode</h2>"),
      html.indexOf(">Screensaver</h2>"),
    );

    expect(displaySection).toContain(`role="status">${notice}</p>`);
    expect(render(standbyDevice)).not.toContain("now switches automatically");
  });

  // Issue #558, seen in the Windows app: "Show screensaver" could be switched
  // on with no screensaver installed, and Settings never said which one it
  // shows.
  describe("the installed screensaver", () => {
    const nightClock: ThemeProduct = {
      id: "night-clock",
      isFree: true,
      priceLabel: "Free",
      source: "github-catalog",
      themeId: "night-clock",
      themeSpecPath: "/themes/s/nc-3-e18e4217.json",
      title: "Night Clock",
      usage: "screensaver",
    };
    const block = (
      enabled: boolean,
      slot?: NonNullable<DeviceInfo["standby"]>,
    ) => {
      const html = renderToStaticMarkup(
        <SettingsScreen
          brightness={70}
          busyAction={null}
          connectionMode="cable"
          device={{ ...standbyDevice, standby: slot }}
          standby={{ ...savedStandby, enabled }}
          onBrightnessChange={vi.fn()}
          onChooseScreensaver={vi.fn()}
          onConnectionModeChange={vi.fn()}
          onDismissError={vi.fn()}
          onResetSetup={vi.fn()}
          onSaveBrightness={vi.fn()}
          onSaveStandby={vi.fn()}
          onStandbyBrightnessChange={vi.fn()}
          providerPicker={providerPicker}
          themes={[nightClock]}
        />,
      );
      return html.slice(
        html.indexOf(">Screensaver</h2>"),
        html.indexOf(">Connection</h2>"),
      );
    };
    const link = /<a aria-disabled="false"[^>]*>Choose screensaver<\/a>/;

    it("is named beside Choose screensaver while the screensaver is on", () => {
      // An older revision in the slot is still this screensaver.
      const named = block(true, { screensaverPath: "/themes/s/nc-2-cb6d64ba.json" });
      expect(named).toMatch(/<span class="[^"]*text-\[13px\][^"]*">Night Clock is installed\.<\/span>/);
      expect(named).toMatch(link);

      // A screensaver neither the catalog nor this computer knows.
      const unknown = block(true, { screensaverPath: "/themes/s/other-1-abc123.json" });
      expect(unknown).toContain(">A custom screensaver is installed.</span>");
    });

    it("turns the Choose screensaver link olive on hover, never lime", () => {
      const none = block(true, { active: false });

      expect(none).toMatch(
        /<a [^>]*hover:text-\[var\(--vibetv-support\)\][^>]*>Choose screensaver<\/a>/,
      );
      expect(none).not.toContain("hover:text-primary");
    });

    it("says that none is installed, with Choose screensaver as the way out", () => {
      const none = block(true, { active: false });

      expect(none).toMatch(/>No screensaver is installed yet\.<\/span>/);
      expect(none).toMatch(link);
    });

    it("leaves the block as it is while the screensaver is off", () => {
      const off = block(false, { screensaverPath: "/themes/s/nc-3-e18e4217.json" });

      expect(off).not.toContain("installed");
      expect(off).toBe(block(false));
      expect(block(false, { active: false })).toBe(off);
    });

    // Without the slot in the device status nothing is known about it.
    it("says nothing while VibeTV does not report its screensaver", () => {
      expect(block(true)).not.toContain("installed");
    });
  });

  it("has no accessibility violations with every section shown", async () => {
    await expectNoAxeViolations(
      render(
        // With the line that names the installed screensaver.
        { ...standbyDevice, standby: { screensaverPath: "/themes/s/nc-3-e18e4217.json" } },
        { ...savedStandby, enabled: true },
        {
          ...providerPicker,
          display: { mode: "fixed", providerIds: ["claude"], configured: true, valid: true },
          items: [provider("claude", "Claude", true), provider("codex", "Codex", false)],
        },
        70, "cable", false, [rotation],
      ),
    );
  });
});

it("shows Reset in footer in Limits and disables it on old firmware", () => {
 const preference: PreferenceDescriptor = {...rotation,id:"vibetv.display.footerReset",label:"Reset in footer",value:"primary",effectiveValue:"primary",options:[{value:"primary",label:"Session reset"},{value:"secondary",label:"Weekly reset"}]};
 for (const supported of [false,true]) {
  const markup=render({...standbyDevice,firmware:"1.0.1",capabilities:{theme:{supportsResetFooterV1:supported}}},savedStandby,providerPicker,70,"cable",false,[preference]);
  const section=markup.slice(markup.indexOf("Limits on VibeTV"),markup.indexOf("</section>",markup.indexOf("Limits on VibeTV")));
  expect(section).toContain("Reset in footer");
  expect(section).toContain('role="combobox"');
  expect(/<button[^>]*\sdisabled(?:=|[ >])/.test(section)).toBe(!supported);
  expect(section.includes("Update VibeTV to use this.")).toBe(!supported);
 }
});
