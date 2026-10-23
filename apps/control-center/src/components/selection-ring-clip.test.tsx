import type { Browser } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { launchRingBrowser, ringClips } from "@/test/ring-clip";
import type { DeviceCandidate } from "./control-center-types";
import type { ProviderItem } from "./provider-picker";
import { candidateKey } from "./setup/setup-connection";
import { SetupDeviceScreen } from "./setup/setup-device-screen";
import { SetupDisplayModeScreen } from "./setup/setup-display-mode-screen";
import { SetupProvidersScreen } from "./setup/setup-providers-screen";
import { SettingsScreen } from "./settings-screen";
import { SetupThemeScreen, type SetupThemeOption } from "./setup/setup-theme-screen";
import { ThemeLibraryScreen } from "./theme-library-screen";
import type { ThemeProduct } from "@/lib/themes";

vi.mock("@/lib/theme-studio-storage", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadUserThemes: () => ({ ok: true, value: { themes: [] } }),
  loadThemeStudioRecovery: () => ({ ok: true, value: null }),
}));

// Paul, 23.10.2026 (7216): the selected card of "Choose your theme" lost its
// top border. A selection or focus ring is a shadow outside the card, so a
// scroll box that holds cards without room around them cuts it. Every grid
// and list of the setup that selects or focuses is rendered here with a
// selected and a keyboard-focused card in every edge position, in the real
// stylesheet, and fails when any ancestor that clips cuts a side of the ring.

// 1440x900 and 1280x800 are the windows the setup is checked in; 1240 is the
// width at which five 200 px cards and four 32 px gaps fill the step exactly.
const WINDOWS = [
  { height: 900, width: 1440 },
  { height: 800, width: 1280 },
  { height: 800, width: 1240 },
];

let browser: Browser;
beforeAll(async () => {
  browser = await launchRingBrowser();
}, 60_000);
afterAll(async () => {
  await browser.close();
});

const noop = vi.fn();

const THEMES: SetupThemeOption[] = [
  "Claude Creature",
  "Clippy",
  "Gauge",
  "Mini Classic",
  "Night Clock",
  "Pace Meter",
  "Pixel Battery",
  "Reset Countdown",
  "Synthwave",
  "Tiny Office",
  "Token Counter",
  "Token Fire",
].map((name) => ({ id: name.toLowerCase().replace(/ /g, "-"), name }));

function provider(label: string): ProviderItem {
  const providerId = label.toLowerCase();
  return {
    allowsDefault: false,
    availability: { state: "available" },
    effectiveValue: true,
    health: { message: "", service: "operational", state: "healthy" },
    id: `codexbar.providers.${providerId}.enabled`,
    label,
    owner: "codexbar",
    providerId,
    section: "providers",
    type: "boolean",
    value: true,
    writable: true,
    writeStrategy: "codexbar_command",
  };
}

const PROVIDERS = ["Codex", "Claude", "Cursor", "Copilot", "Gemini", "Amp", "Kiro", "Zed", "Warp", "Droid", "Kimi", "Qwen"].map(provider);

const DEVICES: DeviceCandidate[] = ["5804508", "5863327", "14799300"].map((deviceId, index) => ({
  deviceId,
  firmware: "1.0.55",
  target: `http://192.168.178.${150 + index}`,
}));

const CATALOG = THEMES.map(
  ({ id, name }, index) =>
    ({
      id,
      isFree: true,
      packSha256: "a".repeat(64),
      packSizeBytes: 100,
      packUrl: `https://example.com/${id}.zip`,
      priceLabel: "Free",
      source: "github-catalog",
      themeId: id,
      title: name,
      usage: index % 4 === 3 ? "screensaver" : "live",
    }) as ThemeProduct,
);

describe("selection and focus rings stay whole", { timeout: 60_000 }, () => {
  describe.each(WINDOWS)("at $width x $height", (window) => {
    it("keeps the ring of the selected theme whole in every row and column", async () => {
      for (const { id } of THEMES) {
        const html = renderToStaticMarkup(
          <SetupThemeScreen onInstall={noop} onSelect={noop} selectedThemeId={id} themes={THEMES} />,
        );
        expect(await ringClips(browser, html, { ...window, selector: '[role="radio"][aria-checked="true"]' }), id).toEqual([]);
      }
    });

    it("keeps the frame and focus ring of every theme card whole", async () => {
      const html = renderToStaticMarkup(
        <SetupThemeScreen onInstall={noop} onSelect={noop} selectedThemeId="gauge" themes={THEMES} />,
      );
      expect(await ringClips(browser, html, { ...window, selector: '[role="radio"]' })).toEqual([]);
    });

    it("keeps the frame of every provider row and the focus ring of its switch whole", async () => {
      const html = renderToStaticMarkup(
        <SetupProvidersScreen
          onContinue={noop}
          onToggle={noop}
          pendingCheckIds={new Set()}
          pendingPreferenceIds={new Set()}
          providers={PROVIDERS}
          usage={null}
        />,
      );
      expect(await ringClips(browser, html, { ...window, selector: '[data-slot="item"]' })).toEqual([]);
    });

    it("keeps the ring of the chosen VibeTV and the chosen connection whole", async () => {
      const screen = (props: object) =>
        renderToStaticMarkup(
          <SetupDeviceScreen
            candidates={DEVICES}
            logLines={[]}
            onChooseTransport={noop}
            onConfigureWiFi={async () => {}}
            onConnect={noop}
            onEnterAddressManually={noop}
            onScanWiFiNetworks={noop}
            onSearchAgain={noop}
            onSelect={noop}
            onWiFiError={noop}
            selectedTarget={null}
            transport="wifi"
            {...props}
          />,
        );
      for (const device of DEVICES) {
        const html = screen({ selectedTarget: candidateKey(device) });
        expect(await ringClips(browser, html, { ...window, selector: '[role="radio"]' }), device.deviceId).toEqual([]);
      }
      const modes = screen({ showCandidates: false, showModeChoice: true });
      expect(await ringClips(browser, modes, { ...window, selector: '[aria-label="Cable"], [aria-label="WiFi"]' })).toEqual([]);
    });

    it("keeps the focus ring of every Appearance card control whole", async () => {
      for (const usage of ["all", "live", "screensaver"] as const) {
        const html = renderToStaticMarkup(
          <ThemeLibraryScreen
            busyAction={null}
            companionStatus="online"
            device={null}
            onInstallCustomTheme={async () => false}
            onInstallTheme={noop}
            onSelectTheme={noop}
            onUsageChange={noop}
            selectedThemeId="gauge"
            storefrontConfigured={false}
            themeInstallEnabled={false}
            themes={CATALOG}
            usage={usage}
          />,
        );
        expect(await ringClips(browser, html, { ...window, selector: '[role="listitem"] :is(button, a[href])' }), usage).toEqual([]);
      }
    });

    it("keeps the focus ring of every Settings choice and switch whole", async () => {
      for (const connectionMode of ["cable", "wifi"] as const) {
        const html = renderToStaticMarkup(
          <SettingsScreen
            brightness={70}
            busyAction={null}
            connectionMode={connectionMode}
            device={{
              active: true,
              capabilities: { standby: { supported: true }, theme: { maxUsageWindows: 2, supportsUsageWindowsV1: true } },
              connected: true,
              paired: true,
              ready: true,
            }}
            displayPreferences={[]}
            onBrightnessChange={noop}
            onChooseScreensaver={noop}
            onConnectionModeChange={noop}
            onDismissError={noop}
            onResetSetup={noop}
            onSaveBrightness={noop}
            onSaveStandby={noop}
            onStandbyBrightnessChange={noop}
            providerPicker={{
              display: null,
              items: PROVIDERS.slice(0, 3),
              onDisplayChange: noop,
              onPreferenceChange: noop,
              pendingCheckIds: new Set(),
              pendingPreferenceIds: new Set(),
              usage: { providers: ["codex", "claude", "cursor"].map((id) => ({ id, label: id, resetSecs: 0, session: 0, usageMode: "used", weekly: 0 })) },
            }}
            providerShortcut={null}
            standby={{ brightnessPercent: 20, enabled: true, screensaverPath: "/themes/s/night.json", timeoutMinutes: 10 }}
            windowsHost={false}
          />,
        );
        expect(await ringClips(browser, html, { ...window, selector: '[aria-pressed], [role="switch"]' }), connectionMode).toEqual([]);
      }
    });

    it("keeps the ring of the chosen display mode and provider whole", async () => {
      const providers = PROVIDERS.slice(0, 4).map(({ label, providerId }) => ({ id: providerId, label }));
      const preview = { providerLabel: "Codex", resetLabel: null, windows: [] };
      for (const mode of ["automatic", "fixed", "pair"] as const) {
        for (const selected of providers) {
          const html = renderToStaticMarkup(
            <SetupDisplayModeScreen
              automaticPreview={preview}
              automaticPreviews={[preview]}
              manualPreview={preview}
              mode={mode}
              onContinue={noop}
              onSelectMode={noop}
              onSelectPair={noop}
              onSelectProvider={noop}
              pairPreview={preview}
              pairProviderIds={[providers[0].id, providers[1].id]}
              providers={providers}
              selectedProviderId={selected.id}
            />,
          );
          expect(await ringClips(browser, html, { ...window, selector: "[aria-pressed]" }), `${mode} ${selected.label}`).toEqual([]);
        }
      }
    });
  });
});
