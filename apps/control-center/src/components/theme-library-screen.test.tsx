import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import type { ThemeStudioUsage } from "@/lib/theme-studio";
import type { ThemeProduct } from "@/lib/themes";
import {
  ThemeLibraryScreen,
  themeNeedsUpgradeableFirmware,
  type ThemeInstallStatus,
  type ThemeLibraryDeviceInfo,
} from "./theme-library-screen";

const theme: ThemeProduct = {
  id: "synthwave",
  title: "Synthwave",
  priceLabel: "Free",
  isFree: true,
  themeId: "synthwave",
  packUrl: "https://cdn.example.test/synthwave.vibetv-theme",
  packSha256: "a".repeat(64),
  packSizeBytes: 1234,
  compatibleBoards: ["esp8266_smalltv_st7789"],
  requiresFirmware: "1.0.0",
  requiredCapabilities: ["usage-slots-v1"],
  source: "github-catalog",
};

const themes: ThemeProduct[] = [
  {
    id: "live-theme",
    isFree: true,
    packSha256: "a".repeat(64),
    packSizeBytes: 100,
    packUrl: "https://example.com/live.zip",
    priceLabel: "Kostenlos",
    source: "github-catalog",
    themeId: "live-theme",
    title: "Live Theme",
    usage: "live",
  },
  {
    id: "night-clock",
    isFree: true,
    packSha256: "b".repeat(64),
    packSizeBytes: 100,
    packUrl: "https://example.com/screensaver.zip",
    priceLabel: "Kostenlos",
    source: "github-catalog",
    themeId: "night-clock",
    title: "Night Clock",
    usage: "screensaver",
  },
];

const device: ThemeLibraryDeviceInfo = {
  connected: true,
  paired: true,
  ready: false,
  board: "esp8266-smalltv-st7789",
  firmware: "1.0.39",
  activeTheme: "theme-missing",
  capabilities: {
    theme: {
      supportsThemeSpecV1: true,
      supportsUsageSlotsV1: false,
    },
  },
};

function renderLibrary(
  usage: ThemeStudioUsage,
  catalog = themes,
  standby = {
    enabled: false,
    timeoutMinutes: 10,
    brightnessPercent: 20,
    screensaverPath: "/themes/s/night.json",
  },
) {
  return renderToStaticMarkup(
    <ThemeLibraryScreen
      busyAction={null}
      companionStatus="online"
      device={null}
      onInstallCustomTheme={async () => false}
      onInstallTheme={vi.fn()}
      onSaveStandby={vi.fn()}
      onSelectTheme={vi.fn()}
      selectedThemeId=""
      storefrontConfigured={false}
      standby={standby}
      themeInstallEnabled={false}
      themes={catalog}
      usage={usage}
    />,
  );
}

describe("themeNeedsUpgradeableFirmware", () => {
  it("recognizes a known missing theme capability as firmware-upgradeable", () => {
    expect(themeNeedsUpgradeableFirmware(theme, device, true)).toBe(true);
  });

  it("recognizes an old firmware version as upgradeable", () => {
    expect(
      themeNeedsUpgradeableFirmware(
        {
          ...theme,
          requiredCapabilities: [],
          requiresFirmware: "1.0.40",
        },
        device,
        true,
      ),
    ).toBe(true);
  });

  it("does not offer firmware as a fix for an incompatible board", () => {
    expect(
      themeNeedsUpgradeableFirmware(
        {
          ...theme,
          compatibleBoards: ["esp32_lilygo_t_display_s3"],
        },
        device,
        true,
      ),
    ).toBe(false);
  });

  it("does not claim an unknown capability can be fixed by firmware", () => {
    expect(
      themeNeedsUpgradeableFirmware(
        {
          ...theme,
          requiredCapabilities: ["future-theme-protocol"],
        },
        device,
        true,
      ),
    ).toBe(false);
  });

  it("keeps the update path unavailable when theme installs are disabled", () => {
    expect(themeNeedsUpgradeableFirmware(theme, device, false)).toBe(false);
  });

});

describe("ThemeLibraryScreen Appearance sections", () => {
  // The setup arm used to wrap or hide each of these; nothing asserted the
  // Appearance arm, so unwrapping it could have changed the tab in silence.
  it("makes the preview reachable and offers Edit on every theme", () => {
    const html = renderLibrary("live");

    expect(html).toContain('aria-label="Preview Live Theme"');
    expect(html).toContain("<span>Edit</span>");
  });

  it("says Wait rather than a blocked label while another action runs", () => {
    const html = renderToStaticMarkup(
      <ThemeLibraryScreen
        busyAction="install"
        companionStatus="online"
        device={null}
        onInstallCustomTheme={async () => false}
        onInstallTheme={vi.fn()}
        onSaveStandby={vi.fn()}
        onSelectTheme={vi.fn()}
        selectedThemeId=""
        storefrontConfigured={false}
        themeInstallEnabled={false}
        themes={themes}
        usage="live"
      />,
    );

    expect(html).toContain("Wait");
  });

  // Seen on a real VibeTV in standby: every theme offered Install, the live
  // one included, because the screensaver was reported as the active theme.
  it("keeps the live theme installed while the screensaver is on screen", () => {
    const livePath = "/themes/u/live-th-3-1a2b3c.json";
    const render = (standby?: ThemeLibraryDeviceInfo["standby"]) =>
      renderToStaticMarkup(
        <ThemeLibraryScreen
          busyAction={null}
          companionStatus="online"
          device={{
            ...device,
            ready: true,
            activeTheme: standby ? "night-clock" : "live-theme",
            standby,
          }}
          onInstallCustomTheme={async () => false}
          onInstallTheme={vi.fn()}
          onSaveStandby={vi.fn()}
          onSelectTheme={vi.fn()}
          selectedThemeId=""
          storefrontConfigured={false}
          themeInstallEnabled
          themes={[{ ...themes[0], themeSpecPath: livePath }, themes[1]]}
          usage="live"
        />,
      );

    expect(render()).toContain("Theme is already installed.");
    expect(render({ active: true, liveThemePath: livePath })).toContain(
      "Theme is already installed.",
    );
  });

  // An own theme and a later catalog theme shared the id `my-theme`. The
  // customer changed the own theme and saved it, which gave the saved copy
  // another id. The awake VibeTV still reports the id and holds the old file,
  // and the catalog row read Installed with its Install closed.
  it("offers Install for a catalog theme while VibeTV holds another theme's file under its id", () => {
    const render = (path?: string, earlierThemeSpecPaths?: string[]) =>
      renderToStaticMarkup(
        <ThemeLibraryScreen
          busyAction={null}
          companionStatus="online"
          device={{
            ...device,
            ready: true,
            activeTheme: "my-theme",
            display: { themeSpec: { path } },
          }}
          onInstallCustomTheme={async () => false}
          onInstallTheme={vi.fn()}
          onSaveStandby={vi.fn()}
          onSelectTheme={vi.fn()}
          selectedThemeId=""
          storefrontConfigured={false}
          themeInstallEnabled
          themes={[
            {
              ...themes[0],
              id: "my-theme",
              themeId: "my-theme",
              themeSpecPath: "/themes/u/mt-4-abcdef.json",
              earlierThemeSpecPaths,
              title: "Catalog Namesake",
            },
          ]}
          usage="live"
        />,
      );

    const oldOwnFile = render("/themes/u/my-them-1-0a1b2c.json");
    expect(oldOwnFile).toContain('title="Install Catalog Namesake"');
    expect(oldOwnFile).not.toContain("Theme is already installed.");
    // The catalog theme's file in an older revision is still that theme, and
    // without a reported file the id decides as before.
    expect(render("/themes/u/mt-3-123456.json")).toContain(
      "Theme is already installed.",
    );
    expect(render()).toContain("Theme is already installed.");
    // #559: a catalog that names its earlier files tells an own file that
    // starts like its own from a revision it shipped.
    const earlier = ["/themes/u/mt-3-123456.json"];
    expect(render("/themes/u/mt-3-0a1b2c.json", earlier)).toContain(
      'title="Install Catalog Namesake"',
    );
    for (const held of [earlier[0], "/themes/u/mt-4-abcdef.json", undefined]) {
      expect(render(held, earlier)).toContain("Theme is already installed.");
    }
  });

  // Seen on the Windows app on 2026-10-07: Retro 3D said "Install" again after
  // a theme was installed, although it was still VibeTV's screensaver. The row
  // only knew the last install made from the app.
  it("keeps the screensaver installed after a theme was installed", () => {
    const render = (screensaverPath?: string) =>
      renderToStaticMarkup(
        <ThemeLibraryScreen
          busyAction={null}
          companionStatus="online"
          device={{ ...device, ready: true, standby: { screensaverPath } }}
          lastInstall={{
            activePath: "/themes/u/live-th-3-1a2b3c.json",
            name: "Live Theme",
            packId: "live-theme-3",
            themeId: "live-theme",
            themeRev: 3,
          }}
          onInstallCustomTheme={async () => false}
          onInstallTheme={vi.fn()}
          onSaveStandby={vi.fn()}
          onSelectTheme={vi.fn()}
          selectedThemeId=""
          standby={{ enabled: true, timeoutMinutes: 10, brightnessPercent: 20 }}
          storefrontConfigured={false}
          themeInstallEnabled
          themes={[
            themes[0],
            { ...themes[1], themeSpecPath: "/themes/s/nc-3-e18e4217.json" },
          ]}
          usage="screensaver"
        />,
      );

    expect(render()).not.toContain("Theme is already installed.");
    expect(render("/themes/s/nc-3-e18e4217.json")).toContain(
      "Theme is already installed.",
    );
    // An older revision in the slot is still this screensaver.
    expect(render("/themes/s/nc-2-cb6d64ba.json")).toContain(
      "Theme is already installed.",
    );
  });

  it("lets a VibeTV that cannot show its theme install another one", () => {
    const render = (connectionState: string) =>
      renderToStaticMarkup(
        <ThemeLibraryScreen
          busyAction={null}
          companionStatus="online"
          device={{ ...device, firmware: "9.9.9", connectionState }}
          onInstallCustomTheme={async () => false}
          onInstallTheme={vi.fn()}
          onSaveStandby={vi.fn()}
          onSelectTheme={vi.fn()}
          selectedThemeId=""
          storefrontConfigured={false}
          themeInstallEnabled
          themes={themes}
          usage="live"
        />,
      );
    expect(render("provider_setup_required")).toContain("Connect VibeTV first.");
    expect(render("display_render_failed")).not.toContain("Connect VibeTV first.");
  });

  it("keeps the existing Themes list restricted to live packs", () => {
    const html = renderLibrary("live");

    expect(html).toContain(">Themes<");
    expect(html).toContain(
      "Customize how your live usage screen looks while VibeTV is active.",
    );
    expect(html).toContain("Create Theme");
    expect(html).toContain("Live Theme");
    expect(html).not.toContain("Night Clock");
  });

  it("shows only screensaver packs and the screensaver create action", () => {
    const html = renderLibrary("screensaver");

    expect(html).toContain(">Screensavers<");
    expect(html).toContain(
      "Choose what appears when VibeTV enters standby after being idle.",
    );
    expect(html).toContain("Create Screensaver");
    expect(html).toContain('aria-label="Show screensaver"');
    expect(html).toContain("Screensaver is turned off");
    expect(html).toContain("Night Clock");
    expect(html).not.toContain("Live Theme");
    // Switched off is a normal state, not an error (#548).
    const notice = html
      .split('data-slot="alert"')
      .find((part) => part.includes("Screensaver is turned off"));
    expect(notice?.slice(0, notice.indexOf(">"))).toContain("text-card-foreground");
    expect(notice?.slice(0, notice.indexOf(">"))).not.toContain("text-destructive");
  });

  it("locks installs while the screensaver is off but keeps the toggle usable", () => {
    const html = renderToStaticMarkup(
      <ThemeLibraryScreen
        busyAction={null}
        companionStatus="online"
        device={{
          connected: true,
          paired: true,
          ready: true,
          activeTheme: "live-theme",
        }}
        onInstallCustomTheme={async () => false}
        onInstallTheme={vi.fn()}
        onSaveStandby={vi.fn()}
        onSelectTheme={vi.fn()}
        selectedThemeId=""
        storefrontConfigured={false}
        standby={{
          enabled: false,
          timeoutMinutes: 10,
          brightnessPercent: 20,
          screensaverPath: null,
        }}
        themeInstallEnabled
        themes={themes}
        usage="screensaver"
      />,
    );

    const standbySwitch = html.match(
      /<button[^>]*id="vibetv-library-standby"[^>]*>/,
    )?.[0];
    expect(standbySwitch).not.toContain('disabled=""');
    expect(html).toContain("Turn On First");
    expect(html).toContain("Turn on Show screensaver to install");
  });

  it("removes the warning without hiding the library when enabled", () => {
    const html = renderLibrary("screensaver", themes, {
      enabled: true,
      timeoutMinutes: 10,
      brightnessPercent: 20,
      screensaverPath: "/themes/s/night.json",
    });

    expect(html).toContain('aria-checked="true"');
    expect(html).not.toContain("Screensaver is turned off");
    expect(html).toContain("Night Clock");
  });

  // Issue #558: the Screensavers list said "theme" in these lines of its own.
  it.each([
    ["screensaver", "night-clock", "Screensaver"],
    ["live", "live-theme", "Theme"],
  ] as const)("words its own install lines on the %s list for what it installs", (usage, themeId, noun) => {
    const list = (installStatus?: ThemeInstallStatus) =>
      renderToStaticMarkup(
        <ThemeLibraryScreen
          busyAction={null}
          companionStatus="online"
          device={{ connected: true, paired: true, ready: true }}
          installStatus={installStatus}
          onInstallCustomTheme={async () => false}
          onInstallTheme={vi.fn()}
          onSelectTheme={vi.fn()}
          selectedThemeId=""
          storefrontConfigured={false}
          themeInstallEnabled={false}
          themes={themes}
          usage={usage}
        />,
      );

    expect(list()).toContain(`title="${noun} installs are not available right now."`);
    // An install the page knows no line of yet.
    expect(
      list({ phase: "installing", themeId, title: "", startedAt: "", logs: [] }),
    ).toContain(`Preparing ${noun.toLowerCase()} install.`);
  });

  it("shows a clear empty state when the catalog has no screensavers", () => {
    const html = renderLibrary("screensaver", [themes[0]]);

    expect(html).toContain("No screensavers yet");
    expect(html).toContain("Create a screensaver to add it to this list.");
    expect(html).toContain("Create Screensaver");
    expect(html).not.toContain("Reload catalog");
  });

  it("has no accessibility violations as Themes, Screensavers, empty list and during an install", async () => {
    await expectNoAxeViolations(renderLibrary("live"));
    await expectNoAxeViolations(renderLibrary("screensaver"));
    await expectNoAxeViolations(renderLibrary("screensaver", [themes[0]]));
    await expectNoAxeViolations(
      renderToStaticMarkup(
        <ThemeLibraryScreen
          busyAction="install"
          companionStatus="online"
          device={{ ...device, ready: true, firmware: "9.9.9" }}
          installStatus={{
            phase: "installing",
            themeId: "live-theme",
            title: "Live Theme",
            startedAt: "2026-10-07T10:00:00Z",
            progress: 40,
            logs: ["Checking VibeTV.", "Sending theme."],
          }}
          onInstallCustomTheme={async () => false}
          onInstallTheme={vi.fn()}
          onSelectTheme={vi.fn()}
          selectedThemeId="live-theme"
          storefrontConfigured={false}
          themeInstallEnabled
          themes={themes}
          usage="live"
        />,
      ),
    );
  });
});
