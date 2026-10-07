import type { DeviceInfo } from "@/components/control-center-types";
import { validateThemeSpec } from "@/lib/theme-studio";
import type { UserThemeRecord } from "@/lib/theme-studio-storage";
import type { ThemeProduct } from "@/lib/themes";

export type ActiveThemeUpgrade = {
  needed: boolean;
  needsFirmwareCapability: boolean;
  needsThemeSpec: boolean;
  theme?: ThemeProduct;
  unresolved: boolean;
};

// Nothing to install. Shared so a caller that has to hold an upgrade back can
// say so with the same value the resolvers return when they find nothing.
export const NO_THEME_UPGRADE: ActiveThemeUpgrade = Object.freeze({
  needed: false,
  needsFirmwareCapability: false,
  needsThemeSpec: false,
  unresolved: false,
});

type LiveSlotDevice = Pick<DeviceInfo, "activeTheme" | "standby">;

// Theme Studio saves every theme as revision 1 under the first seven
// characters of its id, so a customer's copy of Mini Classic lands on VibeTV as
// mini-cl-1-<hash> beside the catalog's mini-cl-9-<hash>. In standby the path
// is all VibeTV reports of the live slot, so a revision-1 path only names a
// catalog theme when it is that theme's exact path; taking it for an old
// revision installed the catalog theme over the customer's own. The catalog's
// own first revision is updated once VibeTV is awake and reports its id.
const FIRST_REVISION_PATH = /-1-[0-9a-f]{6,}\.json$/i;

export function resolveActiveLiveTheme(
  themes: ThemeProduct[],
  device: LiveSlotDevice | null | undefined,
): ThemeProduct | undefined {
  if (device?.standby?.active === true) {
    const livePath = device.standby.liveThemePath?.trim();
    const mayBeCustomerTheme = FIRST_REVISION_PATH.test(livePath ?? "");
    return themes.find(
      (candidate) =>
        candidate.usage !== "screensaver" &&
        (mayBeCustomerTheme
          ? candidate.themeSpecPath?.trim() === livePath
          : sameVersionedThemePath(candidate.themeSpecPath, livePath)),
    );
  }
  return themes.find(
    (candidate) =>
      candidate.usage !== "screensaver" &&
      candidate.themeId === device?.activeTheme,
  );
}

// The theme the customer chose for the live slot, for every place that names
// the active theme. `activeTheme` is what VibeTV draws, which during standby is
// the screensaver, so it does not name the live theme then. A live theme the
// catalog does not list (a Theme Studio theme) cannot be named from its path
// either: during standby it has no id here.
export function activeLiveThemeId(
  themes: ThemeProduct[],
  device: LiveSlotDevice | null | undefined,
): string | undefined {
  const listed = resolveActiveLiveTheme(themes, device)?.themeId;
  if (listed || device?.standby?.active === true) {
    return listed;
  }
  return device?.activeTheme;
}

export function resolveActiveThemeUpgrade(
  themes: ThemeProduct[],
  device: DeviceInfo | null,
): ActiveThemeUpgrade {
  const standbyActive = device?.standby?.active === true;
  const standbyLivePath = standbyActive
    ? device?.standby?.liveThemePath?.trim()
    : undefined;
  if (!device || (!device.activeTheme && !standbyLivePath)) {
    return {
      needed: false,
      needsFirmwareCapability: false,
      needsThemeSpec: false,
      unresolved: false,
    };
  }
  const needsUsageSlots =
    device.capabilities?.theme?.supportsUsageSlotsV1 !== true;
  const needsUsageWindows =
    device.capabilities?.theme?.supportsUsageWindowsV1 !== true;
  const needsProviderAssets =
    device.capabilities?.theme?.supportsProviderAssetsV1 !== true;
  const needsColorStops =
    device.capabilities?.theme?.supportsColorStopsV1 !== true;
  const needsTextValign =
    device.capabilities?.theme?.supportsTextValignV1 !== true;
  const hasCapabilityGap =
    needsUsageSlots ||
    needsUsageWindows ||
    needsProviderAssets ||
    needsColorStops ||
    needsTextValign;
  const theme = resolveActiveLiveTheme(themes, device);
  if (!theme) {
    return {
      needed: false,
      needsFirmwareCapability: false,
      needsThemeSpec: false,
      unresolved: hasCapabilityGap,
    };
  }
  const expectedPath = theme.themeSpecPath?.trim();
  const activePath = standbyActive
    ? standbyLivePath
    : device.display?.themeSpec?.path?.trim();
  const pathIsOutdated = Boolean(expectedPath && expectedPath !== activePath);
  if (!theme.requiredCapabilities) {
    return {
      needed: pathIsOutdated,
      needsFirmwareCapability: false,
      needsThemeSpec: pathIsOutdated,
      theme,
      unresolved: hasCapabilityGap,
    };
  }
  const needsRequiredCapability =
    (theme.requiredCapabilities.includes("usage-slots-v1") && needsUsageSlots) ||
    (theme.requiredCapabilities.includes("usage-windows-v1") &&
      needsUsageWindows) ||
    (theme.requiredCapabilities.includes("provider-assets-v1") &&
      needsProviderAssets) ||
    (theme.requiredCapabilities.includes("color-stops-v1") && needsColorStops) ||
    (theme.requiredCapabilities.includes("text-valign-v1") && needsTextValign);
  return {
    needed: needsRequiredCapability || pathIsOutdated,
    needsFirmwareCapability: needsRequiredCapability,
    needsThemeSpec: pathIsOutdated,
    theme,
    unresolved: false,
  };
}

// The catalog screensaver in VibeTV's screensaver slot, in whichever revision.
// VibeTV reports that slot only as a path, so the same rule as for the live
// slot in standby applies: a revision-1 path may be the customer's own
// screensaver from Screensaver Studio and names a catalog screensaver only when
// it is that screensaver's exact path. Taking it for an old revision would
// install the catalog pack over the customer's own. The price: a catalog
// screensaver that is still on revision 1 on VibeTV is not updated by itself.
export function resolveInstalledScreensaver(
  themes: ThemeProduct[],
  screensaverPath: string | null | undefined,
): ThemeProduct | undefined {
  const installedPath = screensaverPath?.trim();
  const mayBeCustomerScreensaver = FIRST_REVISION_PATH.test(installedPath ?? "");
  return themes.find(
    (candidate) =>
      candidate.usage === "screensaver" &&
      (mayBeCustomerScreensaver
        ? candidate.themeSpecPath?.trim() === installedPath
        : sameVersionedThemePath(candidate.themeSpecPath, installedPath)),
  );
}

// What VibeTV has in its screensaver slot, for every place that names it: a
// catalog screensaver in whichever revision, or the customer's own in exactly
// the saved version, whose path is the one its theme file is sent under.
export function installedScreensaver(
  themes: ThemeProduct[],
  userThemes: UserThemeRecord[],
  screensaverPath: string | null | undefined,
): Pick<ThemeProduct, "themeId" | "title"> | undefined {
  const installedPath = screensaverPath?.trim();
  if (!installedPath) {
    return undefined;
  }
  const listed = resolveInstalledScreensaver(themes, installedPath);
  if (listed) {
    return listed;
  }
  const own = userThemes.find(
    ({ document }) =>
      document.usage === "screensaver" &&
      validateThemeSpec(document.spec, document.assets, "screensaver")
        .themeSpecPath === installedPath,
  )?.document;
  return own && { themeId: own.spec.themeId, title: own.packName };
}

// The screensaver slot drifts exactly like the live slot when the catalog ships a
// new revision, but nothing else catches it: the device reports only the path it
// has, and `activeTheme` describes the live slot alone. Without this the customer
// keeps an outdated screensaver until they reinstall it by hand.
export function resolveScreensaverUpgrade(
  themes: ThemeProduct[],
  screensaverPath: string | null | undefined,
): ActiveThemeUpgrade {
  const installedPath = screensaverPath?.trim();
  const theme = resolveInstalledScreensaver(themes, installedPath);
  const expectedPath = theme?.themeSpecPath?.trim();
  if (!theme || !expectedPath || expectedPath === installedPath) {
    return NO_THEME_UPGRADE;
  }
  return {
    needed: true,
    needsFirmwareCapability: false,
    needsThemeSpec: true,
    theme,
    unresolved: false,
  };
}

function sameVersionedThemePath(
  candidatePath: string | undefined,
  activePath: string | undefined,
): boolean {
  const candidate = candidatePath?.trim();
  if (!candidate || !activePath) {
    return false;
  }
  if (candidate === activePath) {
    return true;
  }
  const candidateBase = versionedThemePathBase(candidate);
  return Boolean(
    candidateBase && candidateBase === versionedThemePathBase(activePath),
  );
}

// Shipped paths are `<prefix>-<rev>-<hash>.json`, and the hash length differs
// per slot: live packs carry six hex characters (claude--5-ef8ada), screensavers
// eight (nc-3-e18e4217). Pinning six silently skipped every screensaver.
function versionedThemePathBase(path: string): string | undefined {
  return path.match(/^(\/themes\/[us]\/.+)-\d+-[0-9a-f]{6,}\.json$/i)?.[1];
}
