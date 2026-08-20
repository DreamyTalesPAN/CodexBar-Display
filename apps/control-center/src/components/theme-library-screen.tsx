"use client";

import {
  CircleAlert,
  Edit3,
  Library,
  Lock,
  Monitor,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Wifi,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  AlertAction,
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
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemFooter,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  hasFirmwareUpdate,
  type FirmwareUpdateInfo,
} from "@/lib/firmware";
import { compareSemVer, parseSemVer } from "@/lib/semver";
import { cn } from "@/lib/utils";
import { isRemoteThemePackUrl } from "@/lib/theme-pack-url";
import {
  createBlankThemeSpec,
  importThemeSpec,
  normalizeThemeSpec,
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
import type { StandbySettings } from "./control-center-types";
import {
  THEME_CATALOG_PREVIEW_FRAME,
  ThemeSpecPreview,
  type ThemeRenderPack,
} from "./live-vibetv-preview";
import {
  ThemeStudioScreen,
  type ThemeStudioEditorTheme,
  type ThemeStudioInstallPayload,
  type ThemeStudioSavePayload,
} from "./theme-studio-screen";

export type ThemeLibraryCompanionStatus = "unknown" | "online" | "missing";

export type ThemeLibraryDeviceInfo = {
  connected: boolean;
  paired?: boolean;
  ready?: boolean;
  board?: string;
  firmware?: string;
  activeTheme?: string;
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
    }
  | {
      kind: "published";
      id: string;
      product: ThemeProduct;
      themeId: string;
      title: string;
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
};

export type ThemeSetupFirmwareUpdateStatus = {
  phase: "installing" | "complete" | "attention" | "error";
  message?: string;
  retryAllowed?: boolean;
  error?: string;
  progress?: number;
};

export type ThemeLibraryScreenProps = {
  themes: ThemeProduct[];
  usage?: ThemeStudioUsage;
  selectedTheme?: ThemeProduct;
  selectedThemeId: string;
  catalogIssue?: string;
  companionStatus: ThemeLibraryCompanionStatus;
  device: ThemeLibraryDeviceInfo | null;
  themeInstallEnabled: boolean;
  busyAction: string | null;
  installStatus?: ThemeInstallStatus | null;
  firmwareUpdate?: FirmwareUpdateInfo | null;
  firmwareUpdateStatus?: ThemeSetupFirmwareUpdateStatus | null;
  installEntry?: boolean;
  lastInstall?: ThemeInstallResult;
  requestedThemeId?: string;
  setupMode?: boolean;
  storefrontConfigured: boolean;
  standby?: StandbySettings | null;
  onSelectTheme: (themeId: string) => void;
  onInstallCustomTheme: (payload: ThemeStudioInstallPayload) => Promise<boolean>;
  onInstallFirmwareUpdate?: () => Promise<boolean> | boolean | void;
  onInstallTheme: (theme: ThemeProduct) => Promise<unknown> | void;
  onSaveStandby?: (value: StandbySettings) => Promise<void> | void;
};

export function ThemeLibraryScreen({
  themes,
  usage = "live",
  selectedTheme,
  selectedThemeId,
  busyAction,
  catalogIssue,
  device,
  installStatus,
  firmwareUpdate,
  firmwareUpdateStatus,
  lastInstall,
  requestedThemeId,
  setupMode = false,
  companionStatus,
  storefrontConfigured,
  standby,
  themeInstallEnabled,
  onInstallCustomTheme,
  onInstallFirmwareUpdate,
  onSelectTheme,
  onInstallTheme,
  onSaveStandby,
}: ThemeLibraryScreenProps) {
  const visibleThemes = themes.filter(
    (theme) => (theme.usage || "live") === usage,
  );
  const screensavers = usage === "screensaver";
  const [userThemes, setUserThemes] = useState<UserThemeRecord[]>([]);
  const [recovery, setRecovery] = useState<ThemeStudioRecovery | null>(null);
  const [editingTheme, setEditingTheme] =
    useState<ThemeStudioEditorTheme | null>(null);
  const [libraryError, setLibraryError] = useState("");
  const [storageWarning, setStorageWarning] = useState("");
  const [storageLocked, setStorageLocked] = useState(false);
  const [deleteTheme, setDeleteTheme] = useState<UserThemeRecord | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteReturnFocusRef = useRef<HTMLElement | null>(null);
  const libraryHeadingRef = useRef<HTMLHeadingElement>(null);
  const [loadingEditorThemeId, setLoadingEditorThemeId] = useState("");
  const [preparingInstallThemeId, setPreparingInstallThemeId] = useState("");
  const [previewTheme, setPreviewTheme] = useState<ThemeLibraryItem | null>(null);
  const recoveryMatchesUsage =
    (recovery ? themeDocumentUsage(recovery.document) : "live") === usage;
  const libraryThemes: ThemeLibraryItem[] = [
    ...(setupMode
      ? []
      : userThemes
          .filter(
            (custom) => themeDocumentUsage(custom.document) === usage,
          )
          .map((custom) => ({
            kind: "custom" as const,
            custom,
            id: custom.id,
            themeId: custom.document.spec.themeId,
            title: custom.document.packName,
          }))),
    ...visibleThemes.map((product) => ({
      kind: "published" as const,
      id: product.id,
      product,
      themeId: product.themeId,
      title: product.title,
    })),
  ];
  const displayTheme =
    selectedTheme ||
    visibleThemes.find((theme) => theme.themeId === selectedThemeId);
  const catalogEmpty = libraryThemes.length === 0;
  const requestedThemeMissing = Boolean(
    !screensavers &&
    !setupMode &&
      requestedThemeId &&
      selectedThemeId === requestedThemeId &&
      !displayTheme,
  );
  const readiness = setupMode
    ? {
        title: "Choose your VibeTV theme",
        detail: "",
        buttonReason: "",
        icon: <Library size={22} aria-hidden />,
      }
    : requestedThemeMissing
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
      });
  const setupNeedsFirmwareUpdate =
    setupMode &&
    themeInstallEnabled &&
    visibleThemes.some((theme) =>
      themeNeedsUpgradeableFirmware(theme, device, themeInstallEnabled),
    );
  useEffect(() => {
    if (setupMode) {
      return;
    }
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
  }, [setupMode]);

  function persistUserThemes(next: UserThemeRecord[]) {
    if (storageLocked) {
      throw new Error(
        storageWarning || "Browser storage must be repaired before saving themes.",
      );
    }
    const result = writeUserThemes(next);
    if (!result.ok) {
      setLibraryError(result.error.message);
      throw new Error(result.error.message);
    }
    setUserThemes(result.value.themes);
  }

  function openBlankTheme() {
    const existingIds = allThemeIds(themes, userThemes);
    const spec = createBlankThemeSpec();
    spec.themeId = uniqueThemeId(
      screensavers ? "my-screensaver" : "my-theme",
      existingIds,
    );
    setLibraryError("");
    setEditingTheme({
      assets: {},
      packName: screensavers ? "New Screensaver" : "New Theme",
      source: "blank",
      spec,
      ...(screensavers ? { usage } : {}),
    });
  }

  async function openThemeEditor(item: ThemeLibraryItem) {
    setLibraryError("");
    if (item.kind === "custom") {
      setEditingTheme({
        assets: item.custom.document.assets,
        libraryId: item.custom.id,
        packName: item.custom.document.packName,
        source: "custom",
        spec: item.custom.document.spec,
        usage: themeDocumentUsage(item.custom.document),
      });
      return;
    }

    setLoadingEditorThemeId(item.themeId);
    try {
      const payload = await fetchThemePackForEditing(
        item.product.themeId,
        item.product.themeSpecPath,
      );
      const spec = importThemeSpec(payload.spec);
      const existingIds = allThemeIds(themes, userThemes);
      spec.themeId = uniqueThemeId(`${item.product.themeId}-custom`, existingIds);
      setEditingTheme({
        assets: payload.assets || {},
        libraryId: item.product.themeId,
        packName: `${payload.name || item.product.title} Custom`,
        source: "published",
        spec,
        usage: item.product.usage || "live",
      });
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : "Theme could not be opened.",
      );
    } finally {
      setLoadingEditorThemeId("");
    }
  }

  async function saveThemeFromEditor(payload: ThemeStudioSavePayload) {
    const now = new Date().toISOString();
    const currentId = payload.libraryId
      ? userThemes.find((theme) => theme.id === payload.libraryId)?.id
      : undefined;
    const existingIds = allThemeIds(themes, userThemes, currentId);
    const spec = normalizeThemeSpec(payload.spec);
    const savedUsage = payload.usage || editingTheme?.usage || usage;
    spec.themeId = uniqueThemeId(spec.themeId, existingIds);
    const id = currentId || spec.themeId;
    const nextRecord: UserThemeRecord = {
      document: {
        assets: payload.assets,
        packName: payload.packName || titleFromThemeId(spec.themeId),
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

  function discardRecovery() {
    const result = clearThemeStudioRecovery();
    if (!result.ok) {
      setLibraryError(result.error.message);
      return;
    }
    setRecovery(null);
  }

  function confirmDeleteTheme(): boolean {
    if (!deleteTheme) {
      return false;
    }
    try {
      persistUserThemes(userThemes.filter((theme) => theme.id !== deleteTheme.id));
      setDeleteTheme(null);
      setDeleteError("");
      window.setTimeout(() => libraryHeadingRef.current?.focus(), 0);
      return true;
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "Theme could not be deleted.",
      );
      return false;
    }
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
    onSelectTheme(item.themeId);
    if (item.kind === "published") {
      await onInstallTheme(item.product);
      return;
    }

    setPreparingInstallThemeId(item.themeId);
    try {
      await onInstallCustomTheme({
        assets: item.custom.document.assets,
        packName: item.custom.document.packName,
        spec: item.custom.document.spec,
        ...(themeDocumentUsage(item.custom.document) === "screensaver"
          ? { usage: "screensaver" as const }
          : {}),
      });
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : "Theme could not be prepared.",
      );
    } finally {
      setPreparingInstallThemeId("");
    }
  }

  if (editingTheme) {
    return (
      <ThemeStudioScreen
        deviceCapabilities={themeStudioCapabilitiesFromDevice(device)}
        initialTheme={editingTheme}
        onBackToLibrary={() => setEditingTheme(null)}
        onInstallTheme={onInstallCustomTheme}
        onRecoveryDiscarded={() => setRecovery(null)}
        onSaveToLibrary={saveThemeFromEditor}
        saveBlockedReason={storageLocked ? storageWarning : undefined}
      />
    );
  }

  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[1180px]",
        setupMode && "px-5 sm:px-7 lg:px-10",
      )}
      data-theme-setup={setupMode ? "" : undefined}
    >
      <section
        className={cn(
          "grid gap-5 py-5",
          !setupMode &&
            "sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center",
        )}
      >
        <div>
          <h2
            className={cn(
              "text-3xl font-black leading-tight text-[#1B1B1B] outline-none",
              !setupMode && "truncate",
            )}
            ref={libraryHeadingRef}
            tabIndex={-1}
          >
            {setupMode
              ? "Choose your VibeTV theme"
              : screensavers
                ? "Screensavers"
                : "Themes"}
          </h2>
          {!setupMode ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {screensavers
                ? "Choose what appears when VibeTV enters standby after being idle."
                : "Customize how your live usage screen looks while VibeTV is active."}
            </p>
          ) : null}
        </div>
        {!setupMode ? (
          <Button onClick={openBlankTheme} type="button">
            <Plus data-icon="inline-start" aria-hidden />
            <span>{screensavers ? "Create Screensaver" : "Create Theme"}</span>
          </Button>
        ) : null}
      </section>

      {/* Installing a screensaver only makes sense while the screensaver is
          turned on; management (create, edit, preview) stays available. */}
      {screensavers && !setupMode && standby ? (
        <section className="space-y-3 pb-5">
          <Field className="border-y py-4" orientation="horizontal">
            <FieldLabel htmlFor="vibetv-library-standby">
              Show screensaver
            </FieldLabel>
            <Switch
              aria-label="Show screensaver"
              checked={standby.enabled}
              disabled={busyAction === "standby" || device?.ready !== true}
              id="vibetv-library-standby"
              onCheckedChange={(enabled) =>
                onSaveStandby?.({ ...standby, enabled })
              }
            />
          </Field>
          {!standby.enabled ? (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertTitle>Screensaver is turned off</AlertTitle>
              <AlertDescription>
                Turn on Show screensaver to install and use a screensaver.
              </AlertDescription>
            </Alert>
          ) : null}
        </section>
      ) : null}

      <section className="py-8">
        {setupNeedsFirmwareUpdate ? (
          <ThemeSetupFirmwareUpdate
            firmwareUpdate={firmwareUpdate}
            onInstallFirmwareUpdate={onInstallFirmwareUpdate}
            status={firmwareUpdateStatus}
          />
        ) : null}
        {!setupMode && storageWarning ? (
          <Alert className="mb-5">
            <Lock aria-hidden />
            <AlertTitle>Theme storage needs attention</AlertTitle>
            <AlertDescription>{storageWarning}</AlertDescription>
          </Alert>
        ) : null}
        {!setupMode && libraryError ? (
          <Alert className="mb-5" variant="destructive">
            <Lock aria-hidden />
            <AlertTitle>Theme action failed</AlertTitle>
            <AlertDescription>{libraryError}</AlertDescription>
          </Alert>
        ) : null}
        {!setupMode && recovery && recoveryMatchesUsage ? (
          <RecoveryCard
            onDiscard={discardRecovery}
            onResume={resumeRecovery}
            recovery={recovery}
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

            <ItemGroup>
              {libraryThemes.map((theme) => (
                <ThemeListItem
                  busyAction={busyAction}
                  screensaverInstallLocked={
                    screensavers && !setupMode && Boolean(standby) && !standby?.enabled
                  }
                  device={device}
                  displayThemeId={setupMode ? undefined : displayTheme?.themeId}
                  item={theme}
                  installStatus={installStatus}
                  key={theme.themeId}
                  lastInstall={lastInstall}
                  loadingEditorThemeId={loadingEditorThemeId}
                  onEditTheme={openThemeEditor}
                  onDeleteTheme={requestDeleteTheme}
                  onInstallTheme={installLibraryTheme}
                  onPreviewTheme={setPreviewTheme}
                  preparingInstallThemeId={preparingInstallThemeId}
                  selectedThemeId={selectedThemeId}
                  setupMode={setupMode}
                  usage={usage}
                  themeInstallBlockedReason={readiness.buttonReason}
                  themeInstallEnabled={themeInstallEnabled}
                  themeStorageLocked={storageLocked}
                />
              ))}
            </ItemGroup>
          </>
        )}
      </section>

      {!setupMode && previewTheme ? (
        <Dialog open onOpenChange={(open) => !open && setPreviewTheme(null)}>
          <DialogContent
            aria-describedby="theme-library-example-data"
            className="max-h-[calc(100dvh-2rem)] max-w-[640px] overflow-y-auto sm:max-w-[640px]"
          >
            <DialogHeader>
              <DialogTitle className="truncate text-2xl font-black">{previewTheme.title}</DialogTitle>
            </DialogHeader>
            <p
              className="-mt-2 text-sm text-muted-foreground"
              id="theme-library-example-data"
            >
              Example data · This is a catalog preview, not live VibeTV data.
            </p>
            <ThemePreview large theme={previewTheme} />
          </DialogContent>
        </Dialog>
      ) : null}
      {!setupMode && deleteTheme ? (
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
  onDiscard,
  onResume,
  recovery,
}: {
  onDiscard: () => void;
  onResume: () => void;
  recovery: ThemeStudioRecovery;
}) {
  return (
    <div className="mb-6 grid gap-4 border border-border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="text-base font-bold text-[#1B1B1B]">
          Continue your unsaved theme
        </div>
        <p className="mt-1 text-sm leading-6 text-[#444933]">
          {recovery.document.packName} was last changed {formatRecoveryTime(recovery.updatedAt)}.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Button onClick={onDiscard} type="button" variant="outline">
          Discard
        </Button>
        <Button onClick={onResume} type="button">
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
  return (
    <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent className="sm:max-w-[520px]">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {theme.document.packName}?</AlertDialogTitle>
          <AlertDialogDescription>
          This deletes the local library copy only. It does not remove or change
          the theme currently active on VibeTV.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <Alert variant="destructive"><Lock /><AlertTitle>Theme could not be deleted</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus onClick={onCancel}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              if (!onConfirm()) {
                event.preventDefault();
              }
            }}
            variant="destructive"
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
  if (screensavers && !catalogIssue) {
    return (
      <Empty className="border bg-card py-10">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Monitor aria-hidden />
          </EmptyMedia>
          <EmptyTitle>No screensavers yet</EmptyTitle>
          <EmptyDescription>
            Create a screensaver to add it to this list.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const detail = requestedThemeId
    ? "This theme is not available right now. Reload the catalog or try again later."
    : storefrontConfigured || catalogIssue
      ? "Themes could not be loaded right now. Reload the catalog or try again later."
      : "Themes are not available from this page right now. Try again later.";

  return (
    <Empty className="border bg-card py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Lock aria-hidden />
        </EmptyMedia>
        <EmptyTitle>Themes unavailable</EmptyTitle>
        <EmptyDescription>{detail}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={() => window.location.reload()} type="button">
          <RefreshCw data-icon="inline-start" aria-hidden />
          Reload catalog
        </Button>
      </EmptyContent>
    </Empty>
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
    <div className="mb-6 flex gap-3 border border-border bg-card p-4 text-sm text-muted-foreground">
      <Library
        className="mt-0.5 shrink-0 text-[#5E7200]"
        size={18}
        aria-hidden
      />
      <div className="min-w-0">
        <div className="font-semibold text-[#1B1B1B]">
          Theme is not available
        </div>
        <div className="mt-1 break-words">
          Choose another theme below.
        </div>
      </div>
    </div>
  );
}

function ThemeListItem({
  busyAction,
  device,
  displayThemeId,
  item,
  installStatus,
  lastInstall,
  loadingEditorThemeId,
  onDeleteTheme,
  onEditTheme,
  onInstallTheme,
  onPreviewTheme,
  preparingInstallThemeId,
  screensaverInstallLocked = false,
  selectedThemeId,
  setupMode,
  usage,
  themeInstallBlockedReason,
  themeInstallEnabled,
  themeStorageLocked,
}: {
  busyAction: string | null;
  device: ThemeLibraryDeviceInfo | null;
  displayThemeId?: string;
  item: ThemeLibraryItem;
  installStatus?: ThemeInstallStatus | null;
  lastInstall?: ThemeInstallResult;
  loadingEditorThemeId: string;
  onDeleteTheme: (theme: UserThemeRecord) => void;
  onEditTheme: (item: ThemeLibraryItem) => void;
  onInstallTheme: (item: ThemeLibraryItem) => void;
  onPreviewTheme: (theme: ThemeLibraryItem) => void;
  preparingInstallThemeId: string;
  screensaverInstallLocked?: boolean;
  selectedThemeId: string;
  setupMode: boolean;
  usage: ThemeStudioUsage;
  themeInstallBlockedReason: string;
  themeInstallEnabled: boolean;
  themeStorageLocked: boolean;
}) {
  const theme = item.kind === "published" ? item.product : null;
  const isCustom = item.kind === "custom";
  const installed =
    lastInstall?.themeId === item.themeId ||
    (usage === "live" && device?.activeTheme === item.themeId);
  const installInFlight =
    busyAction === "install" || installStatus?.phase === "installing";
  const preparingInstall = preparingInstallThemeId === item.themeId;
  const actionInFlight = Boolean(
    busyAction || preparingInstallThemeId || installInFlight,
  );
  const visibleInstallStatus = Boolean(
    installStatus?.themeId === item.themeId,
  );
  const screensaverLockBlocker: ThemeInstallBlocker | null =
    screensaverInstallLocked
      ? { reason: "Turn on Show screensaver first." }
      : null;
  const blocker =
    screensaverLockBlocker ??
    (theme
      ? buildThemeInstallBlocker({
          device,
          theme,
          allowUnreadyInstall: setupMode,
          themeInstallBlockedReason,
          themeInstallEnabled,
        })
      : buildCustomThemeInstallBlocker({
          device,
          themeInstallBlockedReason,
          themeInstallEnabled,
        }));
  const blockedLabel = labelForInstallBlocker(blocker);
  const disabled = actionInFlight || installed || Boolean(blocker);
  const title = disabled
      ? installDisabledReason({
          actionInFlight,
          installInFlight,
          installed,
          blocker,
        })
      : `Install ${item.title}`;
  const loadingEdit = loadingEditorThemeId === item.themeId;

  return (
    <Item
      role="listitem"
      variant={
        !setupMode && item.themeId === displayThemeId ? "muted" : "outline"
      }
    >
      <ItemMedia className="w-28 sm:w-36">
        {setupMode ? (
          <ThemePreview theme={item} />
        ) : (
          <Button
            aria-label={`Preview ${item.title}`}
            className="h-auto w-full justify-start p-0"
            onClick={() => onPreviewTheme(item)}
            type="button"
            variant="ghost"
          >
            <ThemePreview theme={item} />
          </Button>
        )}
      </ItemMedia>
      <ItemContent className="min-w-[180px]">
        <ItemTitle className="text-lg font-bold">{item.title}</ItemTitle>
        {!setupMode && isCustom ? (
          <Badge variant="secondary">Custom</Badge>
        ) : null}
      </ItemContent>
      <ItemActions
        className={cn(
          "basis-full grid w-full gap-2 sm:basis-auto sm:w-auto",
          setupMode
            ? "sm:grid-cols-1"
            : isCustom
              ? "sm:grid-cols-3"
              : "sm:grid-cols-2",
        )}
      >
        {!setupMode ? (
          <Button
            disabled={Boolean(loadingEditorThemeId)}
            onClick={() => void onEditTheme(item)}
            size="sm"
            type="button"
            variant="outline"
          >
            {loadingEdit ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Edit3 data-icon="inline-start" aria-hidden />
            )}
            <span>{loadingEdit ? "Opening" : "Edit"}</span>
          </Button>
        ) : null}
        <Button
          className={
            setupMode ? "h-12 text-base sm:h-9 sm:text-[0.8rem]" : undefined
          }
          disabled={disabled}
          onClick={() => {
            if (!blocker) {
              onInstallTheme(item);
            }
          }}
          title={title}
          type="button"
          size="sm"
        >
          {labelForInstallButton({
            actionInFlight,
            blockedLabel,
            installInFlight: installInFlight || preparingInstall,
            installed,
            selected: item.themeId === selectedThemeId,
            disabled,
          })}
        </Button>
        {!setupMode && item.kind === "custom" ? (
          <Button
            aria-label={`Delete ${item.title}`}
            disabled={themeStorageLocked}
            onClick={() => onDeleteTheme(item.custom)}
            title={
              themeStorageLocked
                ? "Theme storage needs attention before deleting themes."
                : `Delete ${item.title}`
            }
            type="button"
            size="sm"
            variant="destructive"
          >
            <Trash2 data-icon="inline-start" aria-hidden />
            <span>Delete</span>
          </Button>
        ) : null}
      </ItemActions>
      {visibleInstallStatus ? (
        <ItemFooter className="block">
          <InlineInstallProgress
            canRetry={!disabled}
            onRetry={() => onInstallTheme(item)}
            status={installStatus!}
            usage={usage}
          />
        </ItemFooter>
      ) : null}
    </Item>
  );
}

function InlineInstallProgress({
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
  const failed = status.phase === "error";
  const complete = status.phase === "complete";
  const progress = clampInstallProgress(
    failed || complete ? 100 : status.progress,
  );
  const title = failed
    ? "Install failed"
    : complete
      ? "Installed"
      : "Installing";
  const detail = failed
    ? status.error || "Theme was not installed. Try again."
    : complete
      ? usage === "screensaver"
        ? "Screensaver is ready on VibeTV."
        : "Theme is active on VibeTV."
      : status.message ||
        status.logs[status.logs.length - 1] ||
        "Preparing theme install.";
  const previousSteps = failed || complete ? [] : status.logs.slice(-4, -1);

  return (
    <div className="flex flex-col gap-3" role="status" aria-live="polite">
      <Progress className={failed || complete ? "" : "animate-pulse"} value={progress} />
      <Alert variant={failed ? "destructive" : "default"}>
          {failed ? (
            <X aria-hidden />
          ) : complete ? (
            <ShieldCheck aria-hidden />
          ) : (
            <Spinner />
          )}
          <AlertTitle>{title}</AlertTitle>
          <AlertDescription>
            <p>{detail}</p>
            {previousSteps.length > 0 ? (
              <ol className="mt-2 flex flex-col gap-1 text-xs leading-5">
                {previousSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            ) : null}
          </AlertDescription>
        {failed && canRetry ? (
          <AlertAction>
            <Button onClick={onRetry} size="sm" type="button" variant="outline">
              Try again
            </Button>
          </AlertAction>
        ) : null}
      </Alert>
    </div>
  );
}

function clampInstallProgress(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 5;
  }
  return Math.max(5, Math.min(100, Math.round(value)));
}

function labelForInstallButton({
  actionInFlight,
  blockedLabel,
  disabled,
  installInFlight,
  installed,
  selected,
}: {
  actionInFlight: boolean;
  blockedLabel: string;
  disabled: boolean;
  installInFlight: boolean;
  installed: boolean;
  selected: boolean;
}) {
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
    if (blockedLabel === "Setup First" || blockedLabel === "Connect First") {
      return "Install";
    }
    return blockedLabel;
  }
  return "Install";
}

function buildCustomThemeInstallBlocker({
  device,
  themeInstallBlockedReason,
  themeInstallEnabled,
}: {
  device: ThemeLibraryDeviceInfo | null;
  themeInstallBlockedReason: string;
  themeInstallEnabled: boolean;
}): ThemeInstallBlocker | null {
  if (device?.ready !== true) {
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
    return "Update Needed";
  }
  if (/board|support/i.test(text)) {
    return "Not Supported";
  }
  if (/protected/i.test(text)) {
    return "Unavailable";
  }
  if (/show screensaver/i.test(text)) {
    return "Turn On First";
  }
  if (/paid|checkout/i.test(text)) {
    return "Checkout Needed";
  }
  return "Unavailable";
}

function buildInstallReadiness({
  companionStatus,
  device,
  selectedTheme,
  themeInstallEnabled,
}: {
  companionStatus: ThemeLibraryCompanionStatus;
  device: ThemeLibraryDeviceInfo | null;
  selectedTheme?: ThemeProduct;
  themeInstallEnabled: boolean;
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
      title: "Install Mac App first",
      detail: "",
      buttonReason: "Install Mac App first.",
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
    return {
      title: "Themes unavailable",
      detail: "Theme installs are not available right now.",
      buttonReason: "Theme installs are not available right now.",
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
    return "Another theme install is already running.";
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

function buildThemeInstallBlocker({
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

function themeMetadataBlocker(theme: ThemeProduct): ThemeInstallBlocker | null {
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
      capability !== "provider-slots-v1",
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

function ThemeSetupFirmwareUpdate({
  firmwareUpdate,
  onInstallFirmwareUpdate,
  status,
}: {
  firmwareUpdate?: FirmwareUpdateInfo | null;
  onInstallFirmwareUpdate?: () => Promise<boolean> | boolean | void;
  status?: ThemeSetupFirmwareUpdateStatus | null;
}) {
  const installing = status?.phase === "installing";
  const failed = status?.phase === "error";
  const attention = status?.phase === "attention";
  const complete = status?.phase === "complete";
  const updateAvailable = hasFirmwareUpdate(firmwareUpdate);
  const canStartUpdate =
    updateAvailable &&
    Boolean(onInstallFirmwareUpdate) &&
    !installing &&
    !complete;
  const title = installing
    ? "Updating VibeTV"
    : failed || attention
      ? "VibeTV update needs attention"
      : complete
        ? "VibeTV updated"
        : updateAvailable
          ? "Update VibeTV to continue"
          : firmwareUpdate
            ? "VibeTV update needed"
            : "Checking for a VibeTV update";
  const detail = installing
    ? status?.message || "Keep VibeTV powered on while the update installs."
    : failed || attention
      ? status?.error ||
        status?.message ||
        "The update could not be completed."
      : complete
        ? "Checking theme support. Install a theme when its button becomes available."
        : updateAvailable
          ? "Install the firmware update first. Then choose and install a theme."
          : firmwareUpdate?.message ||
            "Theme install stays locked until a compatible update is available.";

  return (
    <Alert className="mb-5" variant={failed ? "destructive" : "default"}>
      {installing ? (
        <RefreshCw className="animate-spin" aria-hidden />
      ) : complete ? (
        <ShieldCheck aria-hidden />
      ) : (
        <RefreshCw aria-hidden />
      )}
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{detail}</AlertDescription>
      {installing ? (
        <Progress
          aria-label="VibeTV update progress"
          className="mt-3"
          value={clampInstallProgress(status?.progress)}
        />
      ) : null}
      {canStartUpdate ||
      (updateAvailable &&
        (failed || attention) &&
        status?.retryAllowed !== false &&
        onInstallFirmwareUpdate) ? (
        <AlertAction>
          <Button
            onClick={() => void onInstallFirmwareUpdate?.()}
            size="sm"
            type="button"
          >
            <RefreshCw data-icon="inline-start" aria-hidden />
            <span>
              {failed || attention ? "Try update again" : "Update VibeTV"}
            </span>
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
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
  theme,
}: {
  large?: boolean;
  theme: ThemeLibraryItem;
}) {
  const [packState, setPackState] = useState<{
    pack: ThemeRenderPack | null;
    requestKey: string;
    status: "idle" | "loading" | "ready" | "error";
  }>({
    pack: null,
    requestKey: "",
    status: "idle",
  });
  const className = large
    ? "relative block aspect-square w-full overflow-hidden border border-border bg-muted"
    : "relative block size-28 overflow-hidden rounded-lg border border-border bg-muted sm:size-36";
  const themeId = theme.themeId;
  const themeSpecPath =
    theme.kind === "published" ? theme.product.themeSpecPath || "" : "";
  const requestKey = `${themeId}\n${themeSpecPath}`;
  const customPack =
    theme.kind === "custom"
      ? {
          ok: true,
          themeId,
          name: theme.title,
          spec: theme.custom.document.spec,
          assets: theme.custom.document.assets,
        }
      : null;
  const pack =
    customPack ||
    (packState.requestKey === requestKey && packState.status === "ready"
      ? packState.pack
      : null);
  const status =
    customPack
      ? "ready"
      : packState.requestKey === requestKey
        ? packState.status
        : "loading";

  useEffect(() => {
    if (theme.kind === "custom") {
      return;
    }
    if (!themeId) {
      return;
    }

    const controller = new AbortController();
    fetch(themeRenderPackUrl(themeId, themeSpecPath), {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("theme preview unavailable");
        }
        return response.json() as Promise<ThemeRenderPack>;
      })
      .then((payload) => {
        setPackState({
          pack: payload,
          requestKey,
          status: payload?.spec ? "ready" : "error",
        });
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setPackState({ pack: null, requestKey, status: "error" });
      });

    return () => controller.abort();
  }, [requestKey, theme.kind, themeId, themeSpecPath]);

  return (
    <span className={className}>
      <ThemeSpecPreview
        animate={Boolean(large)}
        frame={THEME_CATALOG_PREVIEW_FRAME}
        pack={pack}
        status={status}
        themeId={themeId}
      />
    </span>
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
