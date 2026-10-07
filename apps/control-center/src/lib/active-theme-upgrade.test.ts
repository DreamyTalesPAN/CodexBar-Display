import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DeviceInfo } from "@/components/control-center-types";
import {
  buildThemePack,
  createBlankThemeSpec,
  importThemeSpec,
  validateThemeSpec,
} from "@/lib/theme-studio";
import type { ThemeProduct } from "@/lib/themes";
import {
  activeLiveThemeId,
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
        supportsProviderAssetsV1: supportsUsageSlotsV1,
        supportsColorStopsV1: supportsUsageSlotsV1,
        supportsTextValignV1: supportsUsageSlotsV1,
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
    // Two catalog revisions: in standby revision 1 is a Theme Studio theme.
    const current = {
      ...slotTheme,
      themeRev: 3,
      themeSpecPath: "/themes/u/synthwa-3-619665.json",
    };
    const inStandby: DeviceInfo = {
      ...device(true, "/themes/s/night-clock.json"),
      activeTheme: "night-clock",
      standby: {
        active: true,
        liveThemePath: slotTheme.themeSpecPath,
      },
    };

    expect(resolveActiveLiveTheme([screensaver, current], inStandby)).toBe(
      current,
    );
    expect(
      resolveActiveThemeUpgrade([screensaver, current], inStandby),
    ).toEqual({
      needed: true,
      needsFirmwareCapability: false,
      needsThemeSpec: true,
      theme: current,
      unresolved: false,
    });

    expect(
      resolveActiveLiveTheme([screensaver, current], {
        ...inStandby,
        standby: { active: true },
      }),
    ).toBeUndefined();
  });

  // Seen on a real VibeTV: in standby `activeTheme` named the screensaver, and
  // the theme library then showed no live theme as installed.
  it("names the live theme whether or not a screensaver is on screen", () => {
    const catalog = [screensaver, slotTheme];
    const awake = device(true, "/themes/u/synthwa-2-5f8ac7.json");
    const inStandby: DeviceInfo = {
      ...device(true, "/themes/s/night-clock.json"),
      activeTheme: "night-clock",
      standby: {
        active: true,
        liveThemePath: "/themes/u/synthwa-2-5f8ac7.json",
      },
    };

    expect(activeLiveThemeId(catalog, awake)).toBe("synthwave");
    expect(activeLiveThemeId(catalog, inStandby)).toBe("synthwave");
    // A theme the catalog does not list is named as VibeTV reports it.
    expect(activeLiveThemeId(catalog, { ...awake, activeTheme: "my-theme" })).toBe(
      "my-theme",
    );
    expect(activeLiveThemeId(catalog, null)).toBeUndefined();
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

  it.each([
    "supportsProviderAssetsV1",
    "supportsColorStopsV1",
    "supportsTextValignV1",
  ] as const)(
    "keeps missing %s unresolved without theme requirements",
    (capability) => {
      const current = device(true, slotTheme.themeSpecPath);
      current.capabilities!.theme![capability] = false;
      const unknownRequirements = { ...slotTheme, requiredCapabilities: undefined };
      const unrelated = { ...slotTheme, themeId: "other-theme" };

      for (const catalog of [[], [unrelated], [unknownRequirements]]) {
        expect(resolveActiveThemeUpgrade(catalog, current).unresolved).toBe(true);
      }
      expect(
        resolveActiveThemeUpgrade(
          [{ ...slotTheme, requiredCapabilities: [] }],
          current,
        ).unresolved,
      ).toBe(false);
    },
  );

  it("needs no catalog attention when all firmware capabilities are present", () => {
    expect(resolveActiveThemeUpgrade([], device(true)).unresolved).toBe(false);
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

// Found on 2026-10-08: a Theme Studio copy of Mini Classic lands on VibeTV as
// /themes/u/mini-cl-1-<hash>.json, the catalog theme as mini-cl-9-<hash>.json.
// During standby the live theme is known by its path alone, the copy was taken
// for revision 1 of the catalog theme, and the automatic update installed the
// catalog theme over it and swept the customer's files off the device.
describe("a Theme Studio theme in the live slot during standby", () => {
  const dist = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../dist/theme-packs",
  );
  const readJson = (file: string) =>
    JSON.parse(readFileSync(path.join(dist, file), "utf8"));
  // The catalog this build ships, not a fixture.
  const catalog: ThemeProduct[] = readJson("vibetv-theme-packs-v2.json").themes.map(
    (entry: ThemeProduct & { id: string }) => ({
      ...slotTheme,
      ...entry,
      themeId: entry.id,
    }),
  );
  const liveThemes = catalog.filter((theme) => theme.usage === "live");
  const inStandby = (liveThemePath: string): DeviceInfo => ({
    ...device(true, "/themes/s/nc-3-e18e4217.json"),
    activeTheme: "night-clock",
    standby: { active: true, liveThemePath },
  });
  // What "Edit" on a catalog theme in the Themes library opens: the published
  // spec under the id `<catalog id>-custom`.
  const customCopy = (themeId: string) => {
    const published = readJson(`render/${themeId}.json`);
    const spec = importThemeSpec(published.spec);
    spec.themeId = `${themeId}-custom`;
    return { assets: published.assets, name: `${published.name} Custom`, spec };
  };
  // The file name Theme Studio gives it on VibeTV.
  const customCopyPath = (themeId: string): string => {
    const copy = customCopy(themeId);
    return validateThemeSpec(copy.spec, copy.assets).themeSpecPath;
  };

  it("sends the copy to VibeTV under the catalog theme's file name prefix", () => {
    const copy = customCopy("mini-classic");
    const sent = buildThemePack(copy.spec, copy.name, copy.assets);

    expect(sent.manifest.themeSpec.path).toBe(customCopyPath("mini-classic"));
    expect(sent.manifest.themeSpec.path).toMatch(
      /^\/themes\/u\/mini-cl-1-[0-9a-f]{6}\.json$/,
    );
  });

  it.each(liveThemes.map((theme) => theme.themeId))(
    "leaves a customised copy of %s alone",
    (themeId) => {
      const standby = inStandby(customCopyPath(themeId));

      expect(resolveActiveLiveTheme(catalog, standby)).toBeUndefined();
      expect(resolveActiveThemeUpgrade(catalog, standby)).toEqual({
        needed: false,
        needsFirmwareCapability: false,
        needsThemeSpec: false,
        unresolved: false,
      });
      // Not named after the catalog theme, and not after the screensaver
      // that is on screen.
      expect(activeLiveThemeId(catalog, standby)).toBeUndefined();
    },
  );

  it("leaves a theme made from scratch alone", () => {
    const spec = createBlankThemeSpec();
    const standby = inStandby(
      buildThemePack(spec, "New Theme").manifest.themeSpec.path,
    );

    expect(resolveActiveThemeUpgrade(catalog, standby).needed).toBe(false);
  });

  it("still updates every later revision the catalog has shipped", () => {
    let checked = 0;
    for (const theme of liveThemes) {
      for (const file of readdirSync(path.join(dist, "render", theme.themeId))) {
        const shipped = `/themes/u/${file}`;
        if (shipped === theme.themeSpecPath || /-1-[0-9a-f]+\.json$/.test(file)) {
          continue;
        }
        expect(
          resolveActiveThemeUpgrade(catalog, inStandby(shipped)),
          shipped,
        ).toMatchObject({ needed: true, needsThemeSpec: true, theme });
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  // Revision 1 is where every Theme Studio theme lives, so the catalog's own
  // first revision (public release v1.0.52) waits for VibeTV to wake up: then
  // it reports the theme by id and is updated as before.
  it("updates the catalog's own first revision once VibeTV is awake", () => {
    const firstRevision = "/themes/u/mini-cl-1-e4fe6b.json";

    expect(
      resolveActiveThemeUpgrade(catalog, inStandby(firstRevision)).needed,
    ).toBe(false);
    expect(
      resolveActiveThemeUpgrade(catalog, {
        ...device(true, firstRevision),
        activeTheme: "mini-classic",
      }),
    ).toMatchObject({
      needed: true,
      theme: { themeId: "mini-classic" },
    });
  });
});
