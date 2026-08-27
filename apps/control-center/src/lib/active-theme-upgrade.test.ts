import { describe, expect, it } from "vitest";
import type { DeviceInfo } from "@/components/control-center-types";
import type { ThemeProduct } from "@/lib/themes";
import {
  resolveActiveLiveTheme,
  resolveActiveThemeUpgrade,
  resolveScreensaverUpgrade,
} from "./active-theme-upgrade";

const slotTheme = {
  id: "synthwave",
  isFree: true,
  priceLabel: "Free",
  requiredCapabilities: ["usage-slots-v1"],
  source: "github-catalog",
  themeId: "synthwave",
  themeRev: 2,
  themeSpecPath: "/themes/u/synthwa-2-5f8ac7.json",
  title: "Synthwave",
} satisfies ThemeProduct;

const screensaver = {
  ...slotTheme,
  id: "night-clock",
  themeId: "night-clock",
  themeSpecPath: "/themes/s/night-clock.json",
  title: "Night Clock",
  usage: "screensaver",
} satisfies ThemeProduct;

// Real shipped path from theme-packs/night-clock/manifest.json — screensaver
// hashes are eight hex characters, unlike the six of live packs.
const versionedScreensaver = {
  ...screensaver,
  themeRev: 3,
  themeSpecPath: "/themes/s/nc-3-e18e4217.json",
} satisfies ThemeProduct;

function device(
  supportsUsageSlotsV1: boolean,
  path = "/themes/u/synthwa-1-6b39a3.json",
): DeviceInfo {
  return {
    activeTheme: "synthwave",
    capabilities: {
      theme: {
        supportsUsageSlotsV1,
        supportsUsageWindowsV1: supportsUsageSlotsV1,
      },
    },
    connected: true,
    display: {
      themeSpec: {
        active: true,
        path,
      },
    },
  };
}

describe("resolveActiveThemeUpgrade", () => {
  it("resolves a cataloged slot theme before and after the firmware update", () => {
    expect(resolveActiveThemeUpgrade([slotTheme], device(false))).toEqual({
      needed: true,
      needsFirmwareCapability: true,
      needsThemeSpec: true,
      theme: slotTheme,
      unresolved: false,
    });
    expect(
      resolveActiveThemeUpgrade(
        [slotTheme],
        device(true, "/themes/u/synthwa-2-5f8ac7.json"),
      ),
    ).toEqual({
      needed: false,
      needsFirmwareCapability: false,
      needsThemeSpec: false,
      theme: slotTheme,
      unresolved: false,
    });
  });

  it("upgrades an old active ThemeSpec even when firmware is already capable", () => {
    expect(resolveActiveThemeUpgrade([slotTheme], device(true))).toEqual({
      needed: true,
      needsFirmwareCapability: false,
      needsThemeSpec: true,
      theme: slotTheme,
      unresolved: false,
    });
  });

  it("resolves the saved live theme while a screensaver is on screen", () => {
    const inStandby: DeviceInfo = {
      ...device(true, "/themes/s/night-clock.json"),
      activeTheme: "night-clock",
      standby: {
        active: true,
        liveThemePath: "/themes/u/synthwa-1-6b39a3.json",
      },
    };

    expect(resolveActiveLiveTheme([screensaver, slotTheme], inStandby)).toBe(
      slotTheme,
    );
    expect(
      resolveActiveThemeUpgrade([screensaver, slotTheme], inStandby),
    ).toEqual({
      needed: true,
      needsFirmwareCapability: false,
      needsThemeSpec: true,
      theme: slotTheme,
      unresolved: false,
    });

    expect(
      resolveActiveLiveTheme([screensaver, slotTheme], {
        ...inStandby,
        standby: { active: true },
      }),
    ).toBeUndefined();
  });

  it("reinstalls a cataloged ThemeSpec missing from the device status", () => {
    const themeWithoutCapabilities = {
      ...slotTheme,
      requiredCapabilities: undefined,
    };
    const missingActivePath: DeviceInfo = {
      ...device(true),
      display: { themeSpec: { active: true } },
    };
    expect(
      resolveActiveThemeUpgrade([themeWithoutCapabilities], missingActivePath),
    ).toEqual({
      needed: true,
      needsFirmwareCapability: false,
      needsThemeSpec: true,
      theme: themeWithoutCapabilities,
      unresolved: false,
    });
  });

  it("marks an incomplete non-empty catalog as unresolved on old firmware", () => {
    const otherTheme = {
      ...slotTheme,
      id: "clippy",
      themeId: "clippy",
      title: "Clippy",
    };
    expect(resolveActiveThemeUpgrade([otherTheme], device(false))).toEqual({
      needed: false,
      needsFirmwareCapability: false,
      needsThemeSpec: false,
      unresolved: true,
    });
  });
});

describe("resolveScreensaverUpgrade", () => {
  const catalog = [slotTheme, versionedScreensaver];

  it("upgrades a screensaver the catalog has moved to a new revision", () => {
    expect(
      resolveScreensaverUpgrade(catalog, "/themes/s/nc-2-cb6d64ba.json"),
    ).toEqual({
      needed: true,
      needsFirmwareCapability: false,
      needsThemeSpec: true,
      theme: versionedScreensaver,
      unresolved: false,
    });
  });

  it("leaves the current revision alone", () => {
    expect(
      resolveScreensaverUpgrade(catalog, "/themes/s/nc-3-e18e4217.json").needed,
    ).toBe(false);
  });

  it("stays idle without a selected screensaver", () => {
    expect(resolveScreensaverUpgrade(catalog, undefined).needed).toBe(false);
    expect(resolveScreensaverUpgrade(catalog, "  ").needed).toBe(false);
  });

  // A studio-built screensaver has no catalog entry to upgrade towards, so the
  // customer's own file must never be replaced by a lookalike.
  it("ignores a screensaver that is not in the catalog", () => {
    expect(
      resolveScreensaverUpgrade(catalog, "/themes/s/mine-1-abc123.json").needed,
    ).toBe(false);
  });

  // The live slot is resolved elsewhere; a live path must not match a
  // screensaver entry just because the revision suffix looks alike.
  it("never treats a live-slot path as a screensaver", () => {
    expect(
      resolveScreensaverUpgrade(catalog, "/themes/u/synthwa-1-6b39a3.json")
        .needed,
    ).toBe(false);
  });
});

// The six-vs-eight hex difference between live and screensaver paths slipped
// past a hand-written fixture once and let every screensaver upgrade go
// unnoticed on real hardware. Pin the shape against the shipped paths.
describe("versioned path matching against shipped paths", () => {
  const shipped = [
    "/themes/u/claude--5-ef8ada.json",
    "/themes/u/clippy-4-7eb2b0.json",
    "/themes/u/mini-cl-5-14d68f.json",
    "/themes/u/synthwa-4-d3ff8f.json",
    "/themes/s/nc-3-e18e4217.json",
    "/themes/s/rcf-6-03e818f0.json",
    "/themes/s/tf-5-9aeed240.json",
  ];

  it("recognises every shipped screensaver path as an upgrade target", () => {
    for (const path of shipped.filter((p) => p.startsWith("/themes/s/"))) {
      const theme = { ...screensaver, themeSpecPath: path };
      // Same pack, older revision: the hash length must not decide this.
      const older = path.replace(/-(\d+)-/, (_m, rev) => `-${Number(rev) - 1}-`);
      expect(resolveScreensaverUpgrade([theme], older).needed).toBe(true);
    }
  });

  it("recognises every shipped live path through the live resolver", () => {
    for (const path of shipped.filter((p) => p.startsWith("/themes/u/"))) {
      const theme = { ...slotTheme, themeSpecPath: path, usage: undefined };
      const older = path.replace(/-(\d+)-/, (_m, rev) => `-${Number(rev) - 1}-`);
      const found = resolveActiveLiveTheme([theme], {
        connected: true,
        standby: { active: true, liveThemePath: older },
      } as never);
      expect(found?.themeSpecPath).toBe(path);
    }
  });
});
