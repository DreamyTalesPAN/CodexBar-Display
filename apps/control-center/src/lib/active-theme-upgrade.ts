import type { DeviceInfo } from "@/components/control-center-types";
import { sentOwnThemePaths } from "@/lib/sent-own-theme-paths";
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
  ownPaths: string[] = [],
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
  const activePath = standbyActive
    ? standbyLivePath
    : device.display?.themeSpec?.path?.trim();
  // Awake, VibeTV names its theme by id, and a later catalog can give one of
  // its themes the id of a theme the customer saved. Under a path one of their
  // saved themes is sent under, VibeTV draws that theme and not the catalog's;
  // taking it for an old revision installed the catalog theme over it.
  const theme =
    !standbyActive && activePath && ownPaths.includes(activePath)
      ? undefined
      : resolveActiveLiveTheme(themes, device);
  if (!theme) {
    return {
      needed: false,
      needsFirmwareCapability: false,
      needsThemeSpec: false,
      unresolved: hasCapabilityGap,
    };
  }
  const expectedPath = theme.themeSpecPath?.trim();
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

// The paths the customer's saved themes and screensavers are sent to VibeTV
// under. A file VibeTV reports under one of them is the customer's own.
export function ownThemePaths(userThemes: UserThemeRecord[]): string[] {
  return userThemes.map(
    ({ document }) =>
      validateThemeSpec(document.spec, document.assets, document.usage)
        .themeSpecPath,
  );
}

// The catalog screensaver in VibeTV's screensaver slot, in whichever revision.
// VibeTV reports that slot only as a path, and the file of a screensaver the
// customer made can start like a catalog one's. So a path one of their saved
// screensavers is sent under is never a catalog screensaver: taking it for an
// old revision would install the catalog pack over the customer's own. Every
// other path is told by its file name, revision 1 included, because catalog
// screensavers were shipped at revision 1 too (Token Fire as tf-1-874fd8e2)
// and VibeTVs that still hold one must get the update.
export function resolveInstalledScreensaver(
  themes: ThemeProduct[],
  screensaverPath: string | null | undefined,
  ownPaths: string[] = [],
): ThemeProduct | undefined {
  const installedPath = screensaverPath?.trim();
  if (installedPath && ownPaths.includes(installedPath)) {
    return undefined;
  }
  return themes.find(
    (candidate) =>
      candidate.usage === "screensaver" &&
      sameVersionedThemePath(candidate.themeSpecPath, installedPath),
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
  const own = userThemes.find(
    ({ document }) =>
      document.usage === "screensaver" &&
      validateThemeSpec(document.spec, document.assets, "screensaver")
        .themeSpecPath === installedPath,
  )?.document;
  // A file this app sent for a screensaver that was changed or deleted since
  // is still the customer's, not the catalog screensaver it is named like.
  return own
    ? { themeId: own.spec.themeId, title: own.packName }
    : resolveInstalledScreensaver(themes, installedPath, sentOwnThemePaths());
}

// The screensaver slot drifts exactly like the live slot when the catalog ships a
// new revision, but nothing else catches it: the device reports only the path it
// has, and `activeTheme` describes the live slot alone. Without this the customer
// keeps an outdated screensaver until they reinstall it by hand.
export function resolveScreensaverUpgrade(
  themes: ThemeProduct[],
  screensaverPath: string | null | undefined,
  ownPaths: string[] = [],
): ActiveThemeUpgrade {
  const installedPath = screensaverPath?.trim();
  const theme = resolveInstalledScreensaver(themes, installedPath, ownPaths);
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

// Whether a file VibeTV holds can be this catalog theme's, for a caller that
// knows the theme by id too. Awake, VibeTV reports the id of a theme the
// customer made as well, so the id alone does not make it the catalog theme. A
// file with a revision in its name is the catalog theme's only under that
// theme's file name. One without, as early packs had, cannot be told by its
// name and is left to the id, like a path that is not known.
export function pathMayNameCatalogTheme(
  themeSpecPath: string | undefined,
  heldPath: string | undefined,
): boolean {
  return (
    !themeSpecPath ||
    !heldPath ||
    !versionedThemePathBase(heldPath) ||
    sameVersionedThemePath(themeSpecPath, heldPath)
  );
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
