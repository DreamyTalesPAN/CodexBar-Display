"use client";

import {
  Library,
  Lock,
  Monitor,
  Plus,
  RefreshCw,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import type { ComponentProps, ReactNode, RefObject } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { SetupDialog } from "@/components/setup/setup-dialog";
import { systemBusyCopy } from "./system-busy-dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  activeLiveThemeId,
  installedScreensaver,
  fileMayBeCatalogThemes,
} from "@/lib/active-theme-upgrade";
import {
  matchesFilters,
  matchesQuery,
  optionCount,
  productTags,
  visibleFilterGroups,
  type FilterableRow,
} from "@/lib/appearance-filters";
import { compareSemVer, parseSemVer } from "@/lib/semver";
import { sentOwnThemePaths } from "@/lib/sent-own-theme-paths";
import { cn } from "@/lib/utils";
import { copyForHost, statusForHost } from "@/lib/customer-platform";
import { isRemoteThemePackUrl } from "@/lib/theme-pack-url";
import { catalogThemeRowId } from "@/lib/whats-new";
import {
  createBlankThemeSpec,
  importThemeSpec,
  normalizeThemeSpec,
  validateThemeSpec,
  wordsForUsage,
  type ThemeStudioAsset,
  type ThemeStudioUsage,
} from "@/lib/theme-studio";
import {
  clearThemeStudioRecovery,
  loadThemeStudioRecovery,
  loadUserThemes,
  writeUserThemes,
  type ThemeStudioRecovery,
  type UserThemeRecord,
} from "@/lib/theme-studio-storage";
import type { ThemeStudioDeviceCapabilities } from "@/lib/theme-studio-capabilities";
import type { ThemeProduct } from "@/lib/themes";
import { themeRenderPackUrl } from "./control-center-runtime";
import {
  themeShowsTokenTotals,
  type ThemeRenderPack,
} from "./live-vibetv-preview";
import {
  AppearanceToolbar,
  type ThemeLibraryUsage,
} from "./appearance-toolbar";
import { ThemeRenderPreview } from "./theme-render-preview";
import { ReplaceDraftDialog } from "./theme-studio/replace-draft-dialog";
import { SetupStepFailedDialog } from "./setup/setup-provider-dialogs";
import type { ApiError, StandbySettings } from "./control-center-types";
import {
  ThemeStudioScreen,
  type ThemeStudioEditorTheme,
  type ThemeStudioInstallPayload,
  type ThemeStudioSavePayload,
} from "./theme-studio-screen";

export type { ThemeLibraryUsage } from "./appearance-toolbar";

export type ThemeLibraryCompanionStatus = "unknown" | "online" | "missing";

export type ThemeLibraryDeviceInfo = {
  connected: boolean;
  paired?: boolean;
  ready?: boolean;
  connectionState?: string;
  board?: string;
  firmware?: string;
  activeTheme?: string;
  display?: { themeSpec?: { path?: string } };
  standby?: {
    active?: boolean;
    liveThemePath?: string;
    screensaverPath?: string;
  };
  capabilities?: {
    display?: {
      heightPx?: number;
      widthPx?: number;
    };
    theme?: Omit<
      ThemeStudioDeviceCapabilities,
      "displayHeightPx" | "displayWidthPx"
    >;
  };
};

type ThemeInstallBlocker = {
  firmwareUpgradeable?: boolean;
  reason: string;
  readinessTitle?: string;
  readinessDetail?: string;
  readinessIcon?: ReactNode;
};

type ThemeLibraryItem =
  | {
      kind: "custom";
      custom: UserThemeRecord;
      id: string;
      themeId: string;
      title: string;
      usage: ThemeStudioUsage;
    }
  | {
      kind: "published";
      id: string;
      product: ThemeProduct;
      themeId: string;
      title: string;
      usage: ThemeStudioUsage;
    };

export type ThemeInstallResult = {
  themeId: string;
  packId: string;
  name: string;
  activePath: string;
  themeRev: number;
};

export type ThemeInstallStatus = {
  phase: "installing" | "complete" | "error";
  themeId: string;
  title: string;
  startedAt: string;
  finishedAt?: string;
  message?: string;
  progress?: number;
  logs: string[];
  result?: ThemeInstallResult;
  error?: string;
  failure?: ApiError;
};

const SCREENSAVER_OFF_REASON = "Turn on Show screensaver first.";

export type ThemeLibraryScreenProps = {
  themes: ThemeProduct[];
  /** Which rows are listed: all, themes (live) or screensavers. */
  usage?: ThemeLibraryUsage;
  onUsageChange?: (usage: ThemeLibraryUsage) => void;
  selectedTheme?: ThemeProduct;
  selectedThemeId: string;
  selectedScreensaver?: ThemeProduct;
  selectedScreensaverId?: string;
  catalogIssue?: string;
  companionStatus: ThemeLibraryCompanionStatus;
  device: ThemeLibraryDeviceInfo | null;
  themeInstallEnabled: boolean;
  /** The provider on VibeTV has no token history (usageTokenHistoryUnavailableOnVibeTV). */
  tokenHistoryUnavailable?: boolean;
  busyAction: string | null;
  installStatus?: ThemeInstallStatus | null;
  lastInstall?: ThemeInstallResult;
  requestedThemeId?: string;
  storefrontConfigured: boolean;
  standby?: StandbySettings | null;
  onSelectTheme: (themeId: string, usage: ThemeStudioUsage) => void;
  onInstallCustomTheme: (payload: ThemeStudioInstallPayload) => Promise<boolean>;
  onInstallTheme: (theme: ThemeProduct) => Promise<unknown> | void;
  /** Tells the shell whether the Theme Studio is open (it draws its own header row). */
  onStudioOpenChange?: (open: boolean) => void;
  /** The "Settings" link of the screensaver-off notice. */
  onOpenScreensaverSettings?: () => void;
  /** The app runs on Windows, where "Mac App" reads "app". */
  windowsHost?: boolean;
};

// One rule for the page's notices: a notice waits while any other dialog is
// open in the document. Not counted: this page's own notices, and the busy
// announcement, which already waits for every other dialog (so the two never
// wait on each other and loop).
const OPEN_DIALOGS = '[role="dialog"], [role="alertdialog"]';
let pageNoticesShown = 0;

function otherDialogOpen(): boolean {
  if (typeof document === "undefined") return false;
  const others = Array.from(document.querySelectorAll(OPEN_DIALOGS)).filter(
    (dialog) => !dialog.textContent?.includes(systemBusyCopy.title),
  );
  return others.length > pageNoticesShown;
}

/** Whether another dialog is open right now, kept current while mounted. */
function useOtherDialogOpen(): boolean {
  const [open, setOpen] = useState(otherDialogOpen);
  useLayoutEffect(() => {
    const check = () => setOpen(otherDialogOpen());
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return open;
}

/** A page notice: an overlay over the page, counted by useOtherDialogOpen. */
function PageNotice(props: ComponentProps<typeof SetupDialog>) {
  useLayoutEffect(() => {
    pageNoticesShown += 1;
    return () => {
      pageNoticesShown -= 1;
    };
  }, []);
  return <SetupDialog {...props} />;
}

export function ThemeLibraryScreen({
  themes,
  usage = "live",
  onUsageChange,
  selectedTheme,
  selectedThemeId,
  selectedScreensaver,
  selectedScreensaverId = "",
  busyAction,
  catalogIssue,
  device,
  installStatus,
  lastInstall,
  requestedThemeId,
  companionStatus,
  storefrontConfigured,
  standby,
  themeInstallEnabled,
  tokenHistoryUnavailable = false,
  onInstallCustomTheme,
  onSelectTheme,
  onInstallTheme,
  onOpenScreensaverSettings,
  onStudioOpenChange,
  windowsHost = false,
}: ThemeLibraryScreenProps) {
  const screensavers = usage === "screensaver";
  const publishedOf = (rowUsage: ThemeStudioUsage) =>
    themes.filter((theme) => (theme.usage || "live") === rowUsage);
  // A screensaver is installed only while the screensaver is turned on, from
  // the list and from Screensaver Studio alike.
  const screensaverInstallBlockedReason = standby
    ? standby.enabled
      ? ""
      : SCREENSAVER_OFF_REASON
    : // The switch comes with the settings. A VibeTV that has it reports a
      // standby state; while the settings are not there (still loading, or
      // reading them failed) the app does not know whether it is on. A
      // VibeTV without the switch reports neither and is not held back.
      device?.standby
      ? "Screensaver installs are not available right now."
      : "";
  // The sentences this page writes itself name what its list holds (issue
  // #558); on the page with both types they are about themes. Only those: a
  // message from storage, the app or the Mac App can carry the customer's own
  // name for a theme and is shown as it came.
  const say = (text: string) =>
    wordsForUsage(text, screensavers ? "screensaver" : "live");
  const [userThemes, setUserThemes] = useState<UserThemeRecord[]>([]);
  const [query, setQuery] = useState("");
  const [pickedFilters, setPickedFilters] = useState<string[]>([]);
  // What VibeTV itself reports in each slot, not what was installed last from
  // here: an install into the other slot changes nothing.
  const screensaverPath = device?.standby?.screensaverPath?.trim();
  const screensaverThemeId = useMemo(
    () => installedScreensaver(themes, userThemes, screensaverPath)?.themeId,
    [screensaverPath, themes, userThemes],
  );
  const liveThemeId = activeLiveThemeId(themes, device);
  const liveHeldPath = (
    device?.standby?.active === true
      ? device.standby.liveThemePath
      : device?.display?.themeSpec?.path
  )?.trim();
  const [recovery, setRecovery] = useState<ThemeStudioRecovery | null>(null);
  // There is one recovery copy, and the editor writes a new draft over it. What
  // would be opened while an older draft waits there, until the customer agrees.
  const [replacingRecovery, setReplacingRecovery] = useState<(() => void) | null>(null);
  const [editingTheme, setEditingTheme] =
    useState<ThemeStudioEditorTheme | null>(null);
  // Reset when this screen goes away (the shell then shows its header again).
  useEffect(() => {
    onStudioOpenChange?.(editingTheme !== null);
    return () => onStudioOpenChange?.(false);
  }, [editingTheme, onStudioOpenChange]);
  const [libraryError, setLibraryError] = useState("");
  const [storageWarning, setStorageWarning] = useState("");
  // The storage notice is shown until its OK or X; the storage itself stays
  // locked, so the notice is kept here only as "closed for this message".
  const [closedStorageWarning, setClosedStorageWarning] = useState("");
  // The install-failure dialog of a row is a page dialog too; its row reports it.
  const [storageLocked, setStorageLocked] = useState(false);
  const [deleteTheme, setDeleteTheme] = useState<UserThemeRecord | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteReturnFocusRef = useRef<HTMLElement | null>(null);
  // Focus goes here after a delete; the page has no heading of its own.
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const filtersRef = useRef<HTMLButtonElement>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [loadingEditorRow, setLoadingEditorRow] = useState("");
  // Counts what was opened in the editor, to tell a theme that arrives late.
  const editorOpensRef = useRef(0);
  const [preparingInstallRow, setPreparingInstallRow] = useState("");
  const [installRow, setInstallRow] = useState("");
  const [previewTheme, setPreviewTheme] = useState<ThemeLibraryItem | null>(null);
  const recoveryUsage = recovery ? themeDocumentUsage(recovery.document) : "live";
  const recoveryMatchesUsage = usage === "all" || recoveryUsage === usage;
  // A page notice waits while another dialog of this page is open.
  // Page notices wait for any other open dialog (one generic rule, see
  // useOtherDialogOpen) and never show together: an error wins over the
  // storage notice.
  const otherDialogOpen = useOtherDialogOpen();
  const itemsOf = (rowUsage: ThemeStudioUsage): ThemeLibraryItem[] => [
    ...userThemes
      .filter((custom) => themeDocumentUsage(custom.document) === rowUsage)
      .map((custom) => ({
        kind: "custom" as const,
        custom,
        id: custom.id,
        themeId: custom.document.spec.themeId,
        title: custom.document.packName,
        usage: rowUsage,
      })),
    ...publishedOf(rowUsage).map((product) => ({
      kind: "published" as const,
      id: product.id,
      product,
      themeId: product.themeId,
      title: product.title,
      usage: rowUsage,
    })),
  ];
  const liveItems = itemsOf("live");
  const screensaverItems = itemsOf("screensaver");
  const allItems = [...liveItems, ...screensaverItems];
  const segmentItems =
    usage === "all"
      ? allItems
      : screensavers
        ? screensaverItems
        : liveItems;
  // A later catalog can give one of its themes the id of a theme the customer
  // made. That id then names two rows, so for those the theme file decides which
  // one VibeTV holds: an own theme is sent under a path only it has.
  const ownPathBySharedId = new Map(
    allItems.flatMap((item) =>
      item.kind === "custom" &&
      publishedOf(item.usage).some((theme) => theme.themeId === item.themeId)
        ? [
            [
              sharedIdKey(item),
              validateThemeSpec(
                item.custom.document.spec,
                item.custom.document.assets,
                item.usage,
              ).themeSpecPath,
            ] as const,
          ]
        : [],
    ),
  );
  const sentOwnPaths = sentOwnThemePaths();
  const rowStates = new Map(
    allItems.map((item) => [
      rowKey(item),
      rowInstallState(item, {
        heldPath: item.usage === "screensaver" ? screensaverPath : liveHeldPath,
        installedThemeId:
          item.usage === "screensaver" ? screensaverThemeId : liveThemeId,
        lastInstall,
        ownPathOfSharedId: ownPathBySharedId.get(sharedIdKey(item)),
        sentOwnPaths,
      }),
    ]),
  );
  const rowFor = (item: ThemeLibraryItem): FilterableRow => ({
    name: item.title,
    installed: rowStates.get(rowKey(item))?.installed ?? false,
    updateAvailable: rowStates.get(rowKey(item))?.updateAvailable ?? false,
    tags: item.kind === "published" ? productTags(item.product) : [],
  });
  const filterGroups = visibleFilterGroups(allItems.map(rowFor));
  // A picked option of a group that is gone (a catalog without tags) is not applied.
  const pickedShown = pickedFilters.filter((id) =>
    filterGroups.some((group) => group.options.some((option) => option.id === id)),
  );
  const segmentRows = segmentItems.map(rowFor);
  const listedItems = segmentItems.filter(
    (item) =>
      matchesQuery(item.title, query) &&
      matchesFilters(rowFor(item), filterGroups, pickedShown),
  );
  const liveDisplayTheme =
    selectedTheme ||
    publishedOf("live").find((theme) => theme.themeId === selectedThemeId);
  const screensaverDisplayTheme =
    selectedScreensaver ||
    publishedOf("screensaver").find(
      (theme) => theme.themeId === selectedScreensaverId,
    );
  const displayTheme = screensavers
    ? screensaverDisplayTheme
    : liveDisplayTheme;
  const catalogEmpty = segmentItems.length === 0;
  const requestedThemeMissing = Boolean(
    !screensavers &&
      requestedThemeId &&
      selectedThemeId === requestedThemeId &&
      !liveDisplayTheme,
  );
  const readiness = requestedThemeMissing
    ? {
        title: "Choose an available theme",
        detail:
          "The requested theme is not available in this app catalog. Select another listed theme before starting install.",
        buttonReason: "Choose an available theme first.",
        icon: <Library size={22} aria-hidden />,
      }
    : buildInstallReadiness({
        companionStatus,
        device,
        selectedTheme: displayTheme,
        themeInstallEnabled,
        windowsHost,
      });
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const themesResult = loadUserThemes();
      if (themesResult.ok) {
        setUserThemes(themesResult.value.themes);
      } else {
        setUserThemes(themesResult.data?.themes || []);
        setStorageLocked(true);
        setStorageWarning(themesResult.error.message);
      }

      const recoveryResult = loadThemeStudioRecovery();
      if (recoveryResult.ok) {
        setRecovery(recoveryResult.value);
      } else {
        setRecovery(recoveryResult.data || null);
        setStorageLocked(true);
        setStorageWarning((current) =>
          current
            ? `${current} ${recoveryResult.error.message}`
            : recoveryResult.error.message,
        );
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function persistUserThemes(next: UserThemeRecord[]) {
    if (storageLocked) {
      throw new Error(
        storageWarning || say("Browser storage must be repaired before saving themes."),
      );
    }
    const result = writeUserThemes(next);
    if (!result.ok) {
      setLibraryError(result.error.message);
      throw new Error(result.error.message);
    }
    setUserThemes(result.value.themes);
  }

  // Opens something other than the waiting draft, which the customer agreed
  // to give up for it. The draft goes only now: what was chosen may have had
  // to be fetched first, and when that fails nothing takes its place.
  function openReplacingRecovery(theme: ThemeStudioEditorTheme) {
    if (!recovery || discardRecovery()) {
      editorOpensRef.current += 1;
      setEditingTheme(theme);
    }
  }

  function openBlankTheme(blankUsage: ThemeStudioUsage) {
    const blankScreensaver = blankUsage === "screensaver";
    const existingIds = allThemeIds(themes, userThemes);
    const spec = createBlankThemeSpec();
    spec.themeId = uniqueThemeId(
      blankScreensaver ? "my-screensaver" : "my-theme",
      existingIds,
    );
    setLibraryError("");
    openReplacingRecovery({
      assets: {},
      packName: blankScreensaver ? "New Screensaver" : "New Theme",
      source: "blank",
      spec,
      ...(blankScreensaver ? { usage: blankUsage } : {}),
    });
  }

  async function openThemeEditor(item: ThemeLibraryItem) {
    setLibraryError("");
    if (item.kind === "custom") {
      openReplacingRecovery({
        assets: item.custom.document.assets,
        libraryId: item.custom.id,
        packName: item.custom.document.packName,
        source: "custom",
        spec: item.custom.document.spec,
        usage: themeDocumentUsage(item.custom.document),
      });
      return;
    }

    setLoadingEditorRow(rowKey(item));
    const opensBefore = editorOpensRef.current;
    try {
      const payload = await fetchThemePackForEditing(
        item.product.themeId,
        item.product.themeSpecPath,
      );
      // The customer opened something else while this was loading: that stays
      // in the editor, and this theme is not what replaces the draft.
      if (opensBefore !== editorOpensRef.current) {
        return;
      }
      const spec = importThemeSpec(payload.spec);
      const existingIds = allThemeIds(themes, userThemes);
      spec.themeId = uniqueThemeId(`${item.product.themeId}-custom`, existingIds);
      openReplacingRecovery({
        assets: payload.assets || {},
        libraryId: item.product.themeId,
        packName: `${payload.name || item.product.title} Custom`,
        source: "published",
        spec,
        usage: item.product.usage || "live",
      });
    } catch (error) {
      setLibraryError(
        error instanceof Error
          ? error.message
          : wordsForUsage("Theme could not be opened.", item.usage),
      );
    } finally {
      setLoadingEditorRow("");
    }
  }

  async function saveThemeFromEditor(payload: ThemeStudioSavePayload) {
    const now = new Date().toISOString();
    // Only a theme opened from the customer's own row names one of their
    // records. For a catalog theme opened to edit, libraryId is the catalog
    // theme's id; a later catalog can give a theme the id of one of the
    // customer's own, and saving the copy then replaced that one.
    const currentId =
      payload.source === "custom" && payload.libraryId
        ? userThemes.find((theme) => theme.id === payload.libraryId)?.id
        : undefined;
    const existingIds = allThemeIds(themes, userThemes, currentId);
    const spec = normalizeThemeSpec(payload.spec);
    const savedUsage = payload.usage || editingTheme?.usage || "live";
    spec.themeId = uniqueThemeId(spec.themeId, existingIds);
    const id = currentId || spec.themeId;
    const nextRecord: UserThemeRecord = {
      document: {
        assets: payload.assets,
        packName: payload.packName.trim() || titleFromThemeId(spec.themeId),
        spec,
        ...(savedUsage === "screensaver" ? { usage: savedUsage } : {}),
      },
      id,
      originThemeId:
        payload.source === "published"
          ? payload.libraryId || undefined
          : userThemes.find((theme) => theme.id === currentId)?.originThemeId,
      updatedAt: now,
    };
    const next = [
      nextRecord,
      ...userThemes.filter((theme) => theme.id !== id),
    ];
    persistUserThemes(next);
    const cleared = clearThemeStudioRecovery();
    if (cleared.ok) {
      setRecovery(null);
    }
    return {
      document: nextRecord.document,
      libraryId: id,
      savedAt: now,
    };
  }

  function resumeRecovery() {
    if (!recovery) {
      return;
    }
    const matchingCustom =
      recovery.source === "custom" && recovery.libraryId
        ? userThemes.find((theme) => theme.id === recovery.libraryId)
        : undefined;
    setLibraryError("");
    setEditingTheme({
      assets: recovery.document.assets,
      libraryId:
        matchingCustom?.id ||
        (recovery.source === "published" ? recovery.libraryId : undefined),
      packName: recovery.document.packName,
      source:
        recovery.source === "custom" && !matchingCustom
          ? "blank"
          : recovery.source,
      recovered: true,
      spec: recovery.document.spec,
      usage: themeDocumentUsage(recovery.document),
    });
  }

  function discardRecovery(): boolean {
    const result = clearThemeStudioRecovery();
    if (!result.ok) {
      setLibraryError(result.error.message);
      return false;
    }
    setRecovery(null);
    return true;
  }

  function openInEditor(open: () => void) {
    if (recovery) {
      setReplacingRecovery(() => open);
    } else {
      open();
    }
  }

  function confirmDeleteTheme(): boolean {
    if (!deleteTheme) {
      return false;
    }
    // The delete dialog reports its own failure. It does not go through
    // persistUserThemes, which would publish a page-level error and could
    // clear or duplicate one that belongs to another action.
    if (storageLocked) {
      setDeleteError(
        storageWarning ||
          wordsForUsage(
            "Browser storage must be repaired before saving themes.",
            themeDocumentUsage(deleteTheme.document),
          ),
      );
      return false;
    }
    const result = writeUserThemes(
      userThemes.filter((theme) => theme.id !== deleteTheme.id),
    );
    if (!result.ok) {
      setDeleteError(result.error.message);
      return false;
    }
    setUserThemes(result.value.themes);
    setDeleteTheme(null);
    setDeleteError("");
    window.setTimeout(() => createButtonRef.current?.focus(), 0);
    return true;
  }

  function requestDeleteTheme(theme: UserThemeRecord) {
    deleteReturnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setDeleteError("");
    setDeleteTheme(theme);
  }

  function cancelDeleteTheme() {
    setDeleteTheme(null);
    setDeleteError("");
    window.setTimeout(() => deleteReturnFocusRef.current?.focus(), 0);
  }

  async function installLibraryTheme(item: ThemeLibraryItem) {
    setLibraryError("");
    setInstallRow(rowKey(item));
    onSelectTheme(item.themeId, item.usage);
    // Once its install is through, the row is no longer the one an install
    // belongs to: the next one may be the automatic update, which no row
    // started. A failed install stays with its row, which offers Try again.
    if (item.kind === "published") {
      if (await onInstallTheme(item.product)) {
        setInstallRow("");
      }
      return;
    }

    setPreparingInstallRow(rowKey(item));
    try {
      const sent = await onInstallCustomTheme({
        assets: item.custom.document.assets,
        packName: item.custom.document.packName,
        spec: item.custom.document.spec,
        ...(themeDocumentUsage(item.custom.document) === "screensaver"
          ? { usage: "screensaver" as const }
          : {}),
      });
      if (sent) {
        setInstallRow("");
      }
    } catch (error) {
      setLibraryError(
        error instanceof Error
          ? error.message
          : wordsForUsage("Theme could not be prepared.", item.usage),
      );
    } finally {
      setPreparingInstallRow("");
    }
  }

  // A failed install is one dialog of the page, not of its card: a search or a
  // filter can take the card off the list while the install runs, and the
  // failure must still be shown. Its row is the one that started the install.
  const hostInstallStatus = statusForHost(installStatus, windowsHost);
  const failedInstallItem =
    hostInstallStatus?.phase === "error"
      ? installRow
        ? allItems.find(
            (item) =>
              rowKey(item) === installRow &&
              item.themeId === hostInstallStatus.themeId,
          )
        : allItems.find((item) => item.themeId === hostInstallStatus.themeId)
      : undefined;
  const failedInstallBlocker = failedInstallItem
    ? installBlockerFor({
        // The row of a failed install offers Try again, as before.
        allowUnreadyInstall: true,
        device,
        item: failedInstallItem,
        screensaverInstallBlockedReason:
          failedInstallItem.usage === "screensaver"
            ? screensaverInstallBlockedReason
            : "",
        themeInstallBlockedReason: readiness.buttonReason,
        themeInstallEnabled,
      })
    : null;

  if (editingTheme) {
    return (
      <ThemeStudioScreen
        deviceCapabilities={themeStudioCapabilitiesFromDevice(device)}
        initialTheme={editingTheme}
        onBackToLibrary={() => {
          const draft = loadThemeStudioRecovery();
          if (draft.ok) setRecovery(draft.value);
          setEditingTheme(null);
        }}
        onInstallTheme={async (payload) => {
          // The studio's Send obeys the same screensaver switch as the list's
          // Install; the studio shows the reason as its error.
          if (payload.usage === "screensaver" && screensaverInstallBlockedReason) {
            throw new Error(screensaverInstallBlockedReason);
          }
          return onInstallCustomTheme(payload);
        }}
        installStatus={installStatus}
        onSaveToLibrary={saveThemeFromEditor}
        saveBlockedReason={storageLocked ? storageWarning : undefined}
        windowsHost={windowsHost}
      />
    );
  }

  const createLabel = screensavers ? "Create screensaver" : "Create theme";
  return (
    <div
      className={cn(
        // flow-root keeps the negative margin of the Create row inside, so the
        // page does not cover the sidebar toggle in the title row.
        "mx-auto flow-root w-full max-w-[1180px]",
      )}
    >
      {/* The page title (Appearance) is the shell's header; the button sits in
          that row, at its right end, as in the calm picture. In Themes and
          Screensavers it creates that type; on All it asks which. */}
      <section className="pointer-events-none -mt-10 flex h-10 items-center justify-end">
        {usage === "all" ? (
          <Popover onOpenChange={setCreateMenuOpen} open={createMenuOpen}>
            <PopoverTrigger asChild>
              <Button
                className="pointer-events-auto h-9 gap-2 px-[17px]"
                ref={createButtonRef}
                type="button"
              >
                <Plus data-icon="inline-start" aria-hidden />
                <span>Create</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-44 gap-0 rounded-xl p-1"
              sideOffset={8}
            >
              {(["live", "screensaver"] as const).map((type) => (
                <Button
                  className="justify-start font-normal"
                  key={type}
                  onClick={() => {
                    setCreateMenuOpen(false);
                    openInEditor(() => openBlankTheme(type));
                  }}
                  type="button"
                  variant="ghost"
                >
                  {type === "live" ? "Theme" : "Screensaver"}
                </Button>
              ))}
            </PopoverContent>
          </Popover>
        ) : (
          <Button
            aria-label={createLabel}
            className="pointer-events-auto h-9 gap-2 px-[17px]"
            onClick={() => openInEditor(() => openBlankTheme(usage))}
            ref={createButtonRef}
            type="button"
          >
            <Plus data-icon="inline-start" aria-hidden />
            <span>Create</span>
          </Button>
        )}
      </section>

      <div className="mt-8">
        <AppearanceToolbar
          filtersRef={filtersRef}
          counts={{
            all: allItems.length,
            live: liveItems.length,
            screensaver: screensaverItems.length,
          }}
          groups={filterGroups.map((group) => ({
            ...group,
            counts: Object.fromEntries(
              group.options.map((option) => [
                option.id,
                optionCount(segmentRows, option.id),
              ]),
            ),
          }))}
          onClearFilters={() => setPickedFilters([])}
          onQueryChange={setQuery}
          onToggleFilter={(id) =>
            setPickedFilters((current) =>
              current.includes(id)
                ? current.filter((picked) => picked !== id)
                : [...current, id],
            )
          }
          onUsageChange={onUsageChange}
          query={query}
          resultCount={listedItems.length}
          selected={pickedShown}
          usage={usage}
        />
      </div>

      {/* Installing a screensaver only makes sense while the screensaver is
          turned on; management (create, edit, preview) stays available. The
          switch itself is in Settings. */}
      {screensavers && screensaverInstallBlockedReason === SCREENSAVER_OFF_REASON ? (
        <p className="mt-6 text-body text-muted-foreground">
          Screensaver is off. Turn it on in{" "}
          <a
            className="text-foreground underline underline-offset-4 hover:text-[var(--vibetv-support)] dark:hover:text-[#A9C76A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href="#settings-screensaver"
            onClick={(event) => {
              event.preventDefault();
              onOpenScreensaverSettings?.();
            }}
          >
            Settings
          </a>
          .
        </p>
      ) : null}

      <section className="pt-6 pb-10">
        {recovery && recoveryMatchesUsage ? (
          <RecoveryCard
            // The theme that takes the draft's place is on its way.
            busy={Boolean(loadingEditorRow)}
            onDiscard={discardRecovery}
            onResume={resumeRecovery}
            recovery={recovery}
            title={wordsForUsage("Continue your unsaved theme", recoveryUsage)}
          />
        ) : null}
        {catalogEmpty ? (
          <CatalogEmptyState
            catalogIssue={catalogIssue}
            requestedThemeId={requestedThemeId}
            screensavers={screensavers}
            storefrontConfigured={storefrontConfigured}
          />
        ) : (
          <>
            {requestedThemeMissing ? (
              <MissingRequestedThemeNotice
                requestedThemeId={requestedThemeId}
              />
            ) : null}

            {listedItems.length === 0 ? (
              <p className="py-10 text-center text-body text-muted-foreground">
                Nothing matches your search or filters.
              </p>
            ) : null}
            {/* Cards are 200 px wide with 32 px between them, three in a row at most, as a group in the middle of the page (7197 review, point 8). gap-8!: ItemGroup's own gap for small items (gap-2.5) would win. */}
            <ItemGroup
              className="mx-auto grid max-w-[664px] justify-center gap-8!"
              style={{ gridTemplateColumns: "repeat(auto-fill, 200px)" }}
            >
              {listedItems.map((theme) => (
                <ThemeListItem
                  busyAction={busyAction}
                  screensaverInstallBlockedReason={
                    theme.usage === "screensaver"
                      ? screensaverInstallBlockedReason
                      : ""
                  }
                  device={device}
                  // The theme VibeTV shows, as its slot reports it; the
                  // selection stands in only while the slot is not known yet.
                  displayThemeId={
                    (theme.usage === "screensaver"
                      ? screensaverThemeId
                      : liveThemeId) ??
                    (theme.usage === "screensaver"
                      ? screensaverDisplayTheme
                      : liveDisplayTheme
                    )?.themeId
                  }
                  item={theme}
                  installStatus={hostInstallStatus}
                  key={rowKey(theme)}
                  installRow={installRow}
                  loadingEditorRow={loadingEditorRow}
                  onEditTheme={(item) =>
                    openInEditor(() => void openThemeEditor(item))
                  }
                  onDeleteTheme={requestDeleteTheme}
                  onInstallTheme={installLibraryTheme}
                  onPreviewTheme={setPreviewTheme}
                  filtersRef={filtersRef}
                  preparingInstallRow={preparingInstallRow}
                  selectedThemeId={
                    theme.usage === "screensaver"
                      ? selectedScreensaverId
                      : selectedThemeId
                  }
                  state={rowStates.get(rowKey(theme))!}
                  themeInstallBlockedReason={readiness.buttonReason}
                  themeInstallEnabled={themeInstallEnabled}
                  themeStorageLocked={storageLocked}
                  tokenHistoryUnavailable={tokenHistoryUnavailable}
                />
              ))}
            </ItemGroup>
          </>
        )}
      </section>

      {failedInstallItem && hostInstallStatus?.phase === "error" ? (
        <InstallErrorDialog
          canRetry={
            !busyAction && !preparingInstallRow && !failedInstallBlocker
          }
          onRetry={() => void installLibraryTheme(failedInstallItem)}
          status={hostInstallStatus}
          usage={failedInstallItem.usage}
        />
      ) : null}

      {previewTheme ? (
        <Dialog open onOpenChange={(open) => !open && setPreviewTheme(null)}>
          <DialogContent
            aria-describedby="theme-library-example-data"
            className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[520px]"
          >
            <DialogHeader>
              <DialogTitle className="truncate">{previewTheme.title}</DialogTitle>
            </DialogHeader>
            <p
              className="-mt-3 text-[13px] text-muted-foreground"
              id="theme-library-example-data"
            >
              Example data · This is a catalog preview, not live VibeTV data.
            </p>
            <div className="mx-auto w-60 max-w-full">
              <ThemePreview large theme={previewTheme} />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Close</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
      {/* Errors are overlays over the page. OK or the X clears the error; an
          error that arrives while another dialog is open waits for it. */}
      {libraryError && !otherDialogOpen ? (
        <PageNotice
          description={copyForHost(libraryError, windowsHost)}
          onOpenChange={(open) => {
            if (!open) setLibraryError("");
          }}
          open
          primaryAction={{ label: "OK", onSelect: () => setLibraryError("") }}
          title={say("Theme action failed")}
        />
      ) : null}
      {/* The storage notice shows after the error is closed, never with it. */}
      {storageWarning &&
      storageWarning !== closedStorageWarning &&
      !libraryError &&
      !otherDialogOpen ? (
        <PageNotice
          description={storageWarning}
          onOpenChange={(open) => {
            if (!open) setClosedStorageWarning(storageWarning);
          }}
          open
          primaryAction={{
            label: "OK",
            onSelect: () => setClosedStorageWarning(storageWarning),
          }}
          title={say("Theme storage needs attention")}
        />
      ) : null}
      {replacingRecovery && recovery ? (
        <ReplaceDraftDialog
          keepLabel="Keep draft"
          onKeep={() => setReplacingRecovery(null)}
          onReplace={() => {
            setReplacingRecovery(null);
            replacingRecovery();
          }}
        >
          {recovery.document.packName} has changes that are not saved. What you
          open takes its place.
        </ReplaceDraftDialog>
      ) : null}
      {deleteTheme ? (
        <DeleteThemeDialog
          error={deleteError}
          onCancel={cancelDeleteTheme}
          onConfirm={confirmDeleteTheme}
          theme={deleteTheme}
        />
      ) : null}
    </div>
  );
}

function themeDocumentUsage(
  document: UserThemeRecord["document"],
): ThemeStudioUsage {
  return document.usage || "live";
}

function themeStudioCapabilitiesFromDevice(
  device: ThemeLibraryDeviceInfo | null,
): ThemeStudioDeviceCapabilities | undefined {
  if (!device?.capabilities) {
    return undefined;
  }
  return {
    ...device.capabilities.theme,
    displayHeightPx: device.capabilities.display?.heightPx,
    displayWidthPx: device.capabilities.display?.widthPx,
  };
}

function RecoveryCard({
  busy,
  onDiscard,
  onResume,
  recovery,
  title,
}: {
  busy: boolean;
  onDiscard: () => void;
  onResume: () => void;
  recovery: ThemeStudioRecovery;
  title: string;
}) {
  return (
    <div className="mb-6 grid gap-4 rounded-[var(--radius-card)] border border-border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-foreground">
          {title}
        </div>
        <p className="mt-1 text-[13px] leading-6 text-muted-foreground">
          {recovery.document.packName} was last changed {formatRecoveryTime(recovery.updatedAt)}.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Button disabled={busy} onClick={onDiscard} type="button" variant="outline">
          Discard
        </Button>
        <Button disabled={busy} onClick={onResume} type="button">
          Resume
        </Button>
      </div>
    </div>
  );
}

function DeleteThemeDialog({
  error,
  onCancel,
  onConfirm,
  theme,
}: {
  error: string;
  onCancel: () => void;
  onConfirm: () => boolean;
  theme: UserThemeRecord;
}) {
  const say = (text: string) => wordsForUsage(text, themeDocumentUsage(theme.document));
  return (
    <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {theme.document.packName}?</AlertDialogTitle>
          <AlertDialogDescription>
          {say(
            "This deletes the local library copy only. It does not remove or change the theme currently active on VibeTV.",
          )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <Alert variant="destructive"><Lock /><AlertTitle>{say("Theme could not be deleted")}</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              if (!onConfirm()) {
                event.preventDefault();
              }
            }}
          >
            Delete local copy
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CatalogEmptyState({
  catalogIssue,
  requestedThemeId,
  screensavers,
  storefrontConfigured,
}: {
  catalogIssue?: string;
  requestedThemeId?: string;
  screensavers: boolean;
  storefrontConfigured: boolean;
}) {
  // A page state is text in the list area, not a framed card: frames are only
  // around objects (calm rules 5 and 7).
  if (screensavers && !catalogIssue) {
    return (
      <div className="py-10 text-center text-[13px] text-muted-foreground">
        <p className="font-semibold text-foreground">No screensavers yet</p>
        <p className="mt-1">Create a screensaver to add it to this list.</p>
      </div>
    );
  }

  const detail = requestedThemeId
    ? "This theme is not available right now. Reload the catalog or try again later."
    : storefrontConfigured || catalogIssue
      ? "Themes could not be loaded right now. Reload the catalog or try again later."
      : "Themes are not available from this page right now. Try again later.";

  return (
    <div className="grid justify-items-center gap-4 py-10 text-center text-[13px] text-muted-foreground">
      <div>
        <p className="font-semibold text-foreground">Themes unavailable</p>
        <p className="mt-1">{detail}</p>
      </div>
      <Button onClick={() => window.location.reload()} type="button">
        <RefreshCw data-icon="inline-start" aria-hidden />
        Reload catalog
      </Button>
    </div>
  );
}

function MissingRequestedThemeNotice({
  requestedThemeId,
}: {
  requestedThemeId?: string;
}) {
  if (!requestedThemeId) {
    return null;
  }

  return (
    <div className="mb-6 flex gap-3 rounded-[var(--radius-card)] border border-border bg-card p-4 text-sm text-muted-foreground">
      <Library
        className="mt-0.5 shrink-0 text-muted-foreground"
        size={18}
        aria-hidden
      />
      <div className="min-w-0">
        <div className="font-semibold text-foreground">
          Theme is not available
        </div>
        <div className="mt-1 break-words">
          Choose another theme below.
        </div>
      </div>
    </div>
  );
}

// Not the theme id: an own theme can carry the id a later catalog gave one of
// its themes.
function rowKey(item: ThemeLibraryItem): string {
  return `${item.kind}:${item.id}`;
}

// The id a row's file path is compared under when an own theme and a catalog
// theme of one type share it.
function sharedIdKey(item: ThemeLibraryItem): string {
  return `${item.usage}:${item.themeId}`;
}

type RowInstallState = {
  installed: boolean;
  sharesId: boolean;
  updateAvailable: boolean;
};

// Whether VibeTV holds this row's theme, and whether the row offers an update
// to it. One answer for the row itself and for the Installed / Update
// available filters.
function rowInstallState(
  item: ThemeLibraryItem,
  {
    heldPath,
    installedThemeId,
    lastInstall,
    ownPathOfSharedId,
    sentOwnPaths,
  }: {
    heldPath?: string;
    installedThemeId?: string;
    lastInstall?: ThemeInstallResult;
    ownPathOfSharedId?: string;
    sentOwnPaths: string[];
  },
): RowInstallState {
  const theme = item.kind === "published" ? item.product : null;
  const isCustom = item.kind === "custom";
  const sharesId = ownPathOfSharedId !== undefined;
  const installedPath =
    lastInstall?.themeId === item.themeId ? lastInstall.activePath : heldPath;
  const held =
    (lastInstall?.themeId === item.themeId ||
      installedThemeId === item.themeId) &&
    (!sharesId ||
      (isCustom
        ? installedPath === ownPathOfSharedId
        : Boolean(installedPath) && installedPath !== ownPathOfSharedId)) &&
    (isCustom ||
      (fileMayBeCatalogThemes(theme, installedPath) &&
        // A file this app sent for a theme the customer made is theirs, also
        // when its name starts like the catalog theme's.
        !sentOwnPaths.includes(installedPath ?? "")));
  // VibeTV holds a file the catalog names as an earlier revision of this theme
  // (#209). The app updates it on its own, but not while an app update is
  // pending, not again after that install failed, and a screensaver not during
  // standby; until then the row offers the same install.
  const updateAvailable =
    held && Boolean(theme?.earlierThemeSpecPaths?.includes(installedPath ?? ""));
  return { installed: held && !updateAvailable, sharesId, updateAvailable };
}

function ThemeListItem({
  busyAction,
  device,
  displayThemeId,
  item,
  installRow,
  installStatus,
  loadingEditorRow,
  onDeleteTheme,
  onEditTheme,
  onInstallTheme,
  filtersRef,
  onPreviewTheme,
  preparingInstallRow,
  screensaverInstallBlockedReason,
  selectedThemeId,
  state: { installed, sharesId, updateAvailable },
  themeInstallBlockedReason,
  themeInstallEnabled,
  themeStorageLocked,
  tokenHistoryUnavailable,
}: {
  busyAction: string | null;
  device: ThemeLibraryDeviceInfo | null;
  displayThemeId?: string;
  item: ThemeLibraryItem;
  installRow: string;
  installStatus?: ThemeInstallStatus | null;
  loadingEditorRow: string;
  onDeleteTheme: (theme: UserThemeRecord) => void;
  onEditTheme: (item: ThemeLibraryItem) => void;
  onInstallTheme: (item: ThemeLibraryItem) => void;
  filtersRef: RefObject<HTMLButtonElement | null>;
  onPreviewTheme: (theme: ThemeLibraryItem) => void;
  preparingInstallRow: string;
  screensaverInstallBlockedReason: string;
  selectedThemeId: string;
  state: RowInstallState;
  themeInstallBlockedReason: string;
  themeInstallEnabled: boolean;
  themeStorageLocked: boolean;
  tokenHistoryUnavailable: boolean;
}) {
  const isCustom = item.kind === "custom";
  // A catalog theme's elements are only known once its preview has loaded.
  const [publishedPack, setPublishedPack] = useState<ThemeRenderPack | null>(null);
  const showsNoTokens =
    tokenHistoryUnavailable &&
    themeShowsTokenTotals(
      isCustom ? item.custom.document.spec : publishedPack?.spec,
    );
  const installInFlight =
    busyAction === "install" || installStatus?.phase === "installing";
  const preparingInstall = preparingInstallRow === rowKey(item);
  const actionInFlight = Boolean(
    busyAction || preparingInstallRow || installInFlight,
  );
  // For a shared id the row that was pressed shows its install. With no such
  // row a finished install is shown where its file is held, and a running or
  // failed one in both rows, because nothing tells which it is.
  const visibleInstallStatus =
    installStatus?.themeId === item.themeId &&
    (!sharesId ||
      (installRow
        ? installRow === rowKey(item)
        : installStatus.phase !== "complete" || installed));
  const retryingFailedInstall = visibleInstallStatus && installStatus?.phase === "error";
  // The VibeTV cannot draw its active theme (#498): the way out is another
  // theme, so that state must not block installing one.
  const themeNotShown = device?.connectionState === "display_render_failed";
  const blocker = installBlockerFor({
    allowUnreadyInstall: retryingFailedInstall || themeNotShown,
    device,
    item,
    screensaverInstallBlockedReason,
    themeInstallBlockedReason,
    themeInstallEnabled,
  });
  // The button of this row started the install that may fail, so the focus
  // is put back on the card when the button turns into the pill.
  const installStartedHereRef = useRef(false);
  const wasInstalledRef = useRef(false);
  const previewButtonRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const blockedLabel = labelForInstallBlocker(blocker);
  const disabled = actionInFlight || (installed && !retryingFailedInstall) || Boolean(blocker);
  // The reasons are this file's own fixed sentences, written for themes; this
  // list may hold screensavers. None carries a name: the only variable part
  // is a firmware version.
  const title = disabled
      ? wordsForUsage(
          installDisabledReason({
            actionInFlight,
            installInFlight,
            installed,
            blocker,
          }),
          item.usage,
        )
      : `${updateAvailable ? "Update" : "Install"} ${item.title}`;
  const loadingEdit = loadingEditorRow === rowKey(item);
  const installLabel = labelForInstallButton({
    actionInFlight,
    blockedLabel: blocker ? blockedLabel : "",
    installInFlight: installInFlight || preparingInstall,
    // The row's notice says "Installed" from here on; the button says
    // the same while the app still reads VibeTV's settings (#579).
    installFinished:
      visibleInstallStatus && installStatus?.phase === "complete" && !preparingInstall,
    // A failed install of a theme VibeTV already holds is retried from this
    // button: the card has no "Try again" row of its own any more.
    installed: installed && !retryingFailedInstall,
    selected: item.themeId === selectedThemeId,
    disabled,
    updateAvailable,
  });

  // The slot is a lime button while the row can still be installed (greyed
  // while something holds it back); every other state is plain text.
  const installIsText =
    disabled && installLabel !== "Install" && installLabel !== "Update";
  // "Installed" is not a button any more: the picture carries a pill instead.
  // (An installed row keeps its pill while another action holds the buttons.)
  const rowInstalled =
    installLabel === "Installed" || (installed && !retryingFailedInstall);
  // This row's install is running: its Install button turns into
  // "Installing" with a spinner; the card itself never changes its height.
  const rowInstalling =
    preparingInstall ||
    installLabel === "Installing" ||
    (visibleInstallStatus && installStatus?.phase === "installing");
  // Active is the theme VibeTV shows, as its slot reports it. An update that is
  // offered for that theme keeps the pill, the other rows keep theirs.
  const isActiveTheme = item.themeId === displayThemeId;
  const statusPill: "Active" | "Installed" | null =
    isActiveTheme && (rowInstalled || installed || updateAvailable)
      ? "Active"
      : rowInstalled || installed
        ? "Installed"
        : null;
  useEffect(() => {
    const becameInstalled = rowInstalled && !wasInstalledRef.current;
    wasInstalledRef.current = rowInstalled;
    if (!becameInstalled || !installStartedHereRef.current) {
      return;
    }
    installStartedHereRef.current = false;
    // The focused Install button is gone with the install; the card's preview
    // button is always there, so a keyboard user keeps the place in the list.
    const focused = document.activeElement;
    if (!focused || focused === document.body) {
      previewButtonRef.current?.focus();
    }
  }, [rowInstalled]);
  // The card leaves the list when its update completes under the Update
  // available filter, and the focus on its button goes with it. The Filters
  // button takes the focus instead (#857). Unmounting is the last moment the
  // card still holds it.
  useLayoutEffect(() => {
    const card = cardRef.current;
    return () => {
      if (card?.contains(document.activeElement)) filtersRef.current?.focus();
    };
  }, [filtersRef]);

  return (
    <Item
      ref={cardRef}
      // The card's 1 px border plus 7 px = the template's 8 px inner space, so the picture is as wide as drawn.
      className="gap-2 rounded-[var(--radius-card)] p-[7px]"
      id={item.kind === "published" ? catalogThemeRowId(item.themeId) : undefined}
      role="listitem"
      // Every card looks the same; the pill on the picture says which one is active (7197 review, point 7).
      variant="outline"
    >
      <ItemMedia className="relative basis-full w-full">
        <Button
          aria-label={`Preview ${item.title}`}
          className="h-auto w-full justify-start rounded-[6px] p-0"
          onClick={() => onPreviewTheme(item)}
          ref={previewButtonRef}
          type="button"
          variant="ghost"
        >
          <ThemePreview onPack={setPublishedPack} theme={item} />
        </Button>
        {/* A pill on the picture says what the row is: Active (lime, black text) for the theme VibeTV shows, Installed (light) for the others on VibeTV. */}
        {statusPill ? (
          <span
            className={cn(
              "pointer-events-none absolute top-2 right-2 inline-flex h-6 items-center rounded-full px-3 text-[14px] leading-none font-semibold",
              statusPill === "Active"
                ? "bg-primary text-black"
                : "bg-card text-foreground shadow-[0_0_0_1px_color-mix(in_srgb,var(--foreground)_14%,transparent)]",
            )}
            data-testid="theme-status-pill"
            title={rowInstalled ? title : undefined}
          >
            {statusPill}
          </span>
        ) : null}
      </ItemMedia>
      <ItemContent className="basis-full gap-0.5 px-0.5">
        <div className="flex min-w-0 flex-col">
          <ItemTitle className="min-w-0 text-[13px] font-semibold">
            <span className="truncate">{item.title}</span>
            {isCustom ? <Badge variant="secondary">Custom</Badge> : null}
          </ItemTitle>
          <span className="shrink-0 text-[12px] font-normal text-muted-foreground">
            {item.usage === "screensaver" ? "Screensaver" : "Theme"}
          </span>
        </div>
        {showsNoTokens ? (
          <ItemDescription className="line-clamp-none">
            Shows -- while token history is unavailable. See Usage.
          </ItemDescription>
        ) : null}
      </ItemContent>
      <ItemActions className="min-h-7 basis-full justify-between gap-3 px-0.5">
        <span className="flex items-center gap-3">
          <Button
            className="h-7 px-0 font-normal"
            disabled={Boolean(loadingEditorRow)}
            onClick={() => void onEditTheme(item)}
            size="sm"
            type="button"
            variant="link"
          >
            {loadingEdit ? <Spinner data-icon="inline-start" /> : null}
            <span>{loadingEdit ? "Opening" : "Edit"}</span>
          </Button>
          {item.kind === "custom" ? (
            <Button
              aria-label={`Delete ${item.title}`}
              className="h-7 px-0 font-normal"
              disabled={themeStorageLocked}
              onClick={() => onDeleteTheme(item.custom)}
              title={
                themeStorageLocked
                  ? wordsForUsage("Theme storage needs attention before deleting themes.", item.usage)
                  : `Delete ${item.title}`
              }
              type="button"
              size="sm"
              variant="link"
            >
              <span>Delete</span>
            </Button>
          ) : null}
        </span>
        {/* Install is the primary (lime) action at the right edge. Once the
            row has nothing to install, the slot shows the other states as
            text; "Installed" is the pill on the picture, not a row here. */}
        {rowInstalling ? (
          // Same lime button, same width, the spinner says it is running.
          <Button
            aria-busy
            className="h-7 min-w-[104px] px-3 disabled:opacity-100"
            disabled
            type="button"
            size="sm"
          >
            <Spinner data-icon="inline-start" />
            <span>Installing</span>
          </Button>
        ) : rowInstalled ? null : (
          <Button
            className={cn(
              "h-7 px-3",
              installIsText ? "px-0 font-normal disabled:opacity-100 disabled:text-muted-foreground" : "min-w-[104px]",
            )}
            disabled={disabled}
            onClick={() => {
              if (!blocker) {
                installStartedHereRef.current = true;
                onInstallTheme(item);
              }
            }}
            title={title}
            type="button"
            size="sm"
            variant={installIsText ? "ghost" : "default"}
          >
            {installLabel}
          </Button>
        )}
      </ItemActions>
    </Item>
  );
}

// What holds a row's Install back, if anything: the screensaver switch, or the
// device and the theme's readiness. The row and the page's failed-install
// dialog ask the same question.
function installBlockerFor({
  allowUnreadyInstall,
  device,
  item,
  screensaverInstallBlockedReason,
  themeInstallBlockedReason,
  themeInstallEnabled,
}: {
  allowUnreadyInstall: boolean;
  device: ThemeLibraryDeviceInfo | null;
  item: ThemeLibraryItem;
  screensaverInstallBlockedReason: string;
  themeInstallBlockedReason: string;
  themeInstallEnabled: boolean;
}): ThemeInstallBlocker | null {
  if (screensaverInstallBlockedReason) {
    return { reason: screensaverInstallBlockedReason };
  }
  return item.kind === "published"
    ? buildThemeInstallBlocker({
        device,
        theme: item.product,
        allowUnreadyInstall,
        themeInstallBlockedReason,
        themeInstallEnabled,
      })
    : buildCustomThemeInstallBlocker({
        allowUnreadyInstall,
        device,
        themeInstallBlockedReason,
        themeInstallEnabled,
      });
}

function InstallErrorDialog({
  canRetry,
  onRetry,
  status,
  usage,
}: {
  canRetry: boolean;
  onRetry: () => void;
  status: ThemeInstallStatus;
  usage: ThemeStudioUsage;
}) {
  const [dismissedErrorAt, setDismissedErrorAt] = useState<string | null>(null);
  const noun = usage === "screensaver" ? "Screensaver" : "Theme";
  const retry = () => {
    setDismissedErrorAt(null);
    onRetry();
  };
  return (
    <SetupStepFailedDialog
      error={dismissedErrorAt === status.startedAt ? null : status.failure || {
        code: "theme_install_failed",
        message: `${noun} install failed.`,
        nextAction: status.error || `Keep VibeTV connected and try installing the ${noun.toLowerCase()} again.`,
      }}
      onOpenChange={(open) => { if (!open) setDismissedErrorAt(status.startedAt); }}
      onRetry={canRetry ? retry : undefined}
    />
  );
}

function labelForInstallButton({
  actionInFlight,
  blockedLabel,
  disabled,
  installFinished,
  installInFlight,
  installed,
  selected,
  updateAvailable,
}: {
  actionInFlight: boolean;
  blockedLabel: string;
  disabled: boolean;
  installFinished: boolean;
  installInFlight: boolean;
  installed: boolean;
  selected: boolean;
  updateAvailable: boolean;
}) {
  const action = updateAvailable ? "Update" : "Install";
  if (installFinished && actionInFlight) {
    return "Installed";
  }
  if (installInFlight && selected) {
    return "Installing";
  }
  if (actionInFlight) {
    return "Wait";
  }
  if (installed) {
    return "Installed";
  }
  if (disabled) {
    if (
      blockedLabel === "Setup First" ||
      blockedLabel === "Connect First" ||
      blockedLabel === "Turn on first"
    ) {
      return action;
    }
    return blockedLabel;
  }
  return action;
}

function buildCustomThemeInstallBlocker({
  allowUnreadyInstall = false,
  device,
  themeInstallBlockedReason,
  themeInstallEnabled,
}: {
  allowUnreadyInstall?: boolean;
  device: ThemeLibraryDeviceInfo | null;
  themeInstallBlockedReason: string;
  themeInstallEnabled: boolean;
}): ThemeInstallBlocker | null {
  if (device?.ready !== true && !(allowUnreadyInstall && device?.connected && device.paired)) {
    return { reason: themeInstallBlockedReason || "Connect VibeTV first." };
  }
  if (!device.paired) {
    return {
      reason: "Connect VibeTV first.",
      readinessTitle: "VibeTV connection required",
      readinessDetail:
        "This VibeTV is reachable, but theme install requires a completed connection first.",
      readinessIcon: <Lock size={22} aria-hidden />,
    };
  }
  if (!themeInstallEnabled) {
    return {
      reason:
        themeInstallBlockedReason || "Theme installs are not available right now.",
    };
  }
  return null;
}

function labelForInstallBlocker(blocker: ThemeInstallBlocker | null): string {
  const text = `${blocker?.reason || ""} ${blocker?.readinessTitle || ""}`;
  if (/companion|start companion/i.test(text)) {
    return "Setup First";
  }
  if (/connect|pair/i.test(text)) {
    return "Connect First";
  }
  if (/pack/i.test(text)) {
    return "Unavailable";
  }
  if (/firmware|update firmware/i.test(text)) {
    return "Update needed";
  }
  if (/board|support/i.test(text)) {
    return "Not supported";
  }
  if (/protected/i.test(text)) {
    return "Unavailable";
  }
  if (/show screensaver/i.test(text)) {
    return "Turn on first";
  }
  if (/paid|checkout/i.test(text)) {
    return "Checkout needed";
  }
  return "Unavailable";
}

function buildInstallReadiness({
  companionStatus,
  device,
  selectedTheme,
  themeInstallEnabled,
  windowsHost,
}: {
  companionStatus: ThemeLibraryCompanionStatus;
  device: ThemeLibraryDeviceInfo | null;
  selectedTheme?: ThemeProduct;
  themeInstallEnabled: boolean;
  windowsHost: boolean;
}) {
  const metadataBlocker = selectedTheme
    ? themeMetadataBlocker(selectedTheme)
    : null;
  if (
    metadataBlocker?.readinessTitle &&
    metadataBlocker.readinessDetail &&
    metadataBlocker.readinessIcon
  ) {
    return {
      title: metadataBlocker.readinessTitle,
      detail: metadataBlocker.readinessDetail,
      buttonReason: metadataBlocker.reason,
      icon: metadataBlocker.readinessIcon,
    };
  }
  if (companionStatus !== "online") {
    return {
      title: windowsHost ? "Install the app first" : "Install Mac App first",
      detail: "",
      buttonReason: windowsHost
        ? "Install the app first."
        : "Install Mac App first.",
      icon: <Wifi size={22} aria-hidden />,
    };
  }
  if (device?.ready !== true) {
    return {
      title: "VibeTV not found",
      detail:
        "Connect VibeTV on the same WiFi network before installing themes.",
      buttonReason: "Connect VibeTV first.",
      icon: <Monitor size={22} aria-hidden />,
    };
  }
  if (!device.paired) {
    return {
      title: "VibeTV connection required",
      detail:
        "VibeTV is reachable. Connect it once before theme install is available.",
      buttonReason: "Connect VibeTV first.",
      icon: <Lock size={22} aria-hidden />,
    };
  }

  const blocker = selectedTheme
    ? buildThemeInstallBlocker({
        device,
        theme: selectedTheme,
        themeInstallBlockedReason: "",
        themeInstallEnabled,
      })
    : null;
  if (
    blocker?.readinessTitle &&
    blocker.readinessDetail &&
    blocker.readinessIcon
  ) {
    return {
      title: blocker.readinessTitle,
      detail: blocker.readinessDetail,
      buttonReason: blocker.reason,
      icon: blocker.readinessIcon,
    };
  }

  if (!themeInstallEnabled) {
    const reason = "Theme installs are not available right now.";
    return {
      title: "Themes unavailable",
      detail: reason,
      buttonReason: reason,
      icon: <Lock size={22} aria-hidden />,
    };
  }
  return {
    title: "Ready for install",
    detail: "Choose a theme and install it on the connected VibeTV.",
    buttonReason: "",
    icon: <ShieldCheck size={22} aria-hidden />,
  };
}

function installDisabledReason({
  actionInFlight,
  installInFlight,
  installed,
  blocker,
}: {
  actionInFlight: boolean;
  installInFlight: boolean;
  installed: boolean;
  blocker: ThemeInstallBlocker | null;
}) {
  if (installInFlight) {
    return "Another install is already running.";
  }
  if (actionInFlight) {
    return "Please wait for the current step to finish.";
  }
  if (installed) {
    return "Theme is already installed.";
  }
  if (blocker?.reason) {
    return blocker.reason;
  }
  return "Install is not available right now.";
}

export function buildThemeInstallBlocker({
  allowUnreadyInstall = false,
  device,
  theme,
  themeInstallBlockedReason,
  themeInstallEnabled,
}: {
  allowUnreadyInstall?: boolean;
  device: ThemeLibraryDeviceInfo | null;
  theme: ThemeProduct;
  themeInstallBlockedReason: string;
  themeInstallEnabled: boolean;
}): ThemeInstallBlocker | null {
  const metadataBlocker = themeMetadataBlocker(theme);
  if (metadataBlocker) {
    return metadataBlocker;
  }
  const canInstallMissingTheme =
    allowUnreadyInstall &&
    device?.connected === true &&
    device.paired === true;
  if (device?.ready !== true && !canInstallMissingTheme) {
    return { reason: themeInstallBlockedReason || "Connect VibeTV first." };
  }
  if (!device.paired) {
    return {
      reason: "Connect VibeTV first.",
      readinessTitle: "VibeTV connection required",
      readinessDetail:
        "This VibeTV is reachable, but theme install requires a completed connection first.",
      readinessIcon: <Lock size={22} aria-hidden />,
    };
  }
  const boardBlocker = themeBoardBlocker(theme, device);
  if (boardBlocker) {
    return boardBlocker;
  }
  const capabilityBlocker = themeCapabilityBlocker(theme, device);
  if (capabilityBlocker) {
    return capabilityBlocker;
  }
  const firmwareBlocker = themeFirmwareBlocker(theme, device);
  if (firmwareBlocker) {
    return firmwareBlocker;
  }
  if (!themeInstallEnabled) {
    return {
      reason:
        themeInstallBlockedReason || "Theme installs are not available right now.",
    };
  }
  return null;
}

export function themeMetadataBlocker(
  theme: ThemeProduct,
): ThemeInstallBlocker | null {
  if (!theme.isFree || !isRemoteThemePackUrl(theme.packUrl)) {
    return {
      reason: "Theme is not available right now.",
      readinessTitle: "Theme unavailable",
      readinessDetail: "Choose another theme or try again later.",
      readinessIcon: <Library size={22} aria-hidden />,
    };
  }
  if (
    !theme.packSha256?.match(/^[a-f0-9]{64}$/i) ||
    !theme.packSizeBytes ||
    theme.packSizeBytes <= 0
  ) {
    return {
      reason: "Theme could not be verified.",
      readinessTitle: "Theme unavailable",
      readinessDetail: "Reload the theme catalog, then try again.",
      readinessIcon: <Library size={22} aria-hidden />,
    };
  }
  return null;
}

function themeBoardBlocker(
  theme: ThemeProduct,
  device: ThemeLibraryDeviceInfo,
): ThemeInstallBlocker | null {
  const boards = theme.compatibleBoards?.filter(Boolean) || [];
  if (!boards.length) {
    return null;
  }
  if (!device.board) {
    return {
      reason: "Check VibeTV first.",
      readinessTitle: "Check VibeTV first",
      readinessDetail:
        "Reconnect VibeTV, then try this theme again.",
      readinessIcon: <Monitor size={22} aria-hidden />,
    };
  }
  const normalizedDeviceBoard = normalizeBoard(device.board);
  const matches = boards.some(
    (board) =>
      normalizeBoard(board) === normalizedDeviceBoard ||
      normalizeBoard(board) === "all",
  );
  if (matches) {
    return null;
  }
  return {
    reason: "This theme does not support this VibeTV.",
    readinessTitle: "Not supported",
    readinessDetail: "Choose another theme for this VibeTV.",
    readinessIcon: <Lock size={22} aria-hidden />,
  };
}

function themeCapabilityBlocker(
  theme: ThemeProduct,
  device: ThemeLibraryDeviceInfo,
): ThemeInstallBlocker | null {
  const required = theme.requiredCapabilities || [];
  const unsupported = required.filter(
    (capability) =>
      capability !== "usage-slots-v1" &&
      capability !== "usage-windows-v1" &&
      capability !== "provider-slots-v1" &&
      capability !== "provider-assets-v1" &&
      capability !== "color-stops-v1" &&
      capability !== "text-valign-v1" &&
      capability !== "progress-arc-v1",
  );
  if (unsupported.length > 0) {
    return {
      reason: "This theme does not support this VibeTV.",
      readinessTitle: "Not supported",
      readinessDetail: "Choose another theme for this VibeTV.",
      readinessIcon: <Lock size={22} aria-hidden />,
    };
  }
  const missing = required.filter((capability) => {
    if (capability === "usage-slots-v1") {
      return device.capabilities?.theme?.supportsUsageSlotsV1 !== true;
    }
    if (capability === "usage-windows-v1") {
      return device.capabilities?.theme?.supportsUsageWindowsV1 !== true;
    }
    if (capability === "provider-slots-v1") {
      return device.capabilities?.theme?.supportsProviderSlotsV1 !== true;
    }
    if (capability === "provider-assets-v1") {
      return device.capabilities?.theme?.supportsProviderAssetsV1 !== true;
    }
    if (capability === "color-stops-v1") {
      return device.capabilities?.theme?.supportsColorStopsV1 !== true;
    }
    if (capability === "text-valign-v1") {
      return device.capabilities?.theme?.supportsTextValignV1 !== true;
    }
    if (capability === "progress-arc-v1") {
      return device.capabilities?.theme?.supportsProgressArcV1 !== true;
    }
    return true;
  });
  if (missing.length === 0) {
    return null;
  }
  return {
    firmwareUpgradeable: true,
    reason: "Update firmware first.",
    readinessTitle: "Firmware update needed",
    readinessDetail: `${theme.title} needs a VibeTV update before it can be installed.`,
    readinessIcon: <RefreshCw size={22} aria-hidden />,
  };
}

function themeFirmwareBlocker(
  theme: ThemeProduct,
  device: ThemeLibraryDeviceInfo,
): ThemeInstallBlocker | null {
  const required = theme.requiresFirmware?.trim();
  if (!required) {
    return null;
  }
  const requiredParsed = parseSemVer(required);
  if (!requiredParsed) {
    return null;
  }
  const deviceParsed = device.firmware ? parseSemVer(device.firmware) : null;
  if (!deviceParsed) {
    return {
      reason: "Check VibeTV first.",
      readinessTitle: "Check VibeTV first",
      readinessDetail: "Reconnect VibeTV, then try this theme again.",
      readinessIcon: <RefreshCw size={22} aria-hidden />,
    };
  }
  const matchingDevelopmentCore =
    deviceParsed.prerelease[0] === "dev" &&
    requiredParsed.prerelease.length === 0 &&
    deviceParsed.major === requiredParsed.major &&
    deviceParsed.minor === requiredParsed.minor &&
    deviceParsed.patch === requiredParsed.patch;
  if (
    compareSemVer(deviceParsed, requiredParsed) >= 0 ||
    matchingDevelopmentCore
  ) {
    return null;
  }
  return {
    firmwareUpgradeable: true,
    reason: `Firmware ${required} or newer is required.`,
    readinessTitle: "Firmware too old",
    readinessDetail: `${theme.title} requires firmware ${required} or newer. Update firmware before installing this theme.`,
    readinessIcon: <RefreshCw size={22} aria-hidden />,
  };
}

export function themeNeedsUpgradeableFirmware(
  theme: ThemeProduct,
  device: ThemeLibraryDeviceInfo | null,
  themeInstallEnabled: boolean,
): boolean {
  if (!themeInstallEnabled) {
    return false;
  }
  return Boolean(
    buildThemeInstallBlocker({
      allowUnreadyInstall: true,
      device,
      theme,
      themeInstallBlockedReason: "",
      themeInstallEnabled,
    })?.firmwareUpgradeable,
  );
}

function normalizeBoard(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

function ThemePreview({
  large,
  onPack,
  theme,
}: {
  large?: boolean;
  onPack?: (pack: ThemeRenderPack) => void;
  theme: ThemeLibraryItem;
}) {
  return (
    <ThemeRenderPreview
      animate={Boolean(large)}
      // Card picture and dialog picture have the same corners: 6 px (7197 review, point 9).
      className="aspect-square w-full rounded-[6px]"
      onPack={onPack}
      // A Theme Studio theme has no published pack to load: its spec only
      // exists in this app.
      pack={
        theme.kind === "custom"
          ? {
              ok: true,
              themeId: theme.themeId,
              name: theme.title,
              spec: theme.custom.document.spec,
              assets: theme.custom.document.assets,
            }
          : null
      }
      themeId={theme.themeId}
      themeSpecPath={
        theme.kind === "published" ? theme.product.themeSpecPath || "" : ""
      }
    />
  );
}

async function fetchThemePackForEditing(
  themeId: string,
  themeSpecPath?: string,
): Promise<{
  assets?: Record<string, ThemeStudioAsset>;
  name?: string;
  spec: unknown;
}> {
  const response = await fetch(themeRenderPackUrl(themeId, themeSpecPath));
  if (!response.ok) {
    throw new Error("Theme could not be opened.");
  }
  const payload = (await response.json()) as {
    assets?: Record<string, ThemeStudioAsset>;
    name?: string;
    spec?: unknown;
  };
  if (!payload.spec) {
    throw new Error("Theme could not be opened.");
  }
  return { assets: payload.assets || {}, name: payload.name, spec: payload.spec };
}

function allThemeIds(
  publishedThemes: ThemeProduct[],
  userThemes: UserThemeRecord[],
  exceptUserThemeId?: string,
): string[] {
  return [
    ...publishedThemes.map((theme) => theme.themeId),
    ...userThemes
      .filter((theme) => theme.id !== exceptUserThemeId)
      .map((theme) => theme.document.spec.themeId),
  ];
}

function formatRecoveryTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "recently";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function uniqueThemeId(base: string, existingIds: string[]): string {
  const used = new Set(existingIds.map((id) => slugThemeId(id)));
  const cleanBase = slugThemeId(base || "my-theme");
  if (!used.has(cleanBase)) {
    return cleanBase;
  }
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${cleanBase}-${index}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
  return `${cleanBase}-${Date.now()}`;
}

function slugThemeId(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (slug.length >= 3 && /^[a-z0-9]/.test(slug)) {
    return slug;
  }
  return "my-theme";
}

function titleFromThemeId(themeId: string): string {
  return themeId
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
