"use client";

import {
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
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { isRemoteThemePackUrl } from "@/lib/theme-pack-url";
import {
  createBlankThemeSpec,
  importThemeSpec,
  normalizeThemeSpec,
  type ThemeStudioAsset,
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

export type ThemeLibraryScreenProps = {
  themes: ThemeProduct[];
  selectedTheme?: ThemeProduct;
  selectedThemeId: string;
  catalogIssue?: string;
  companionStatus: ThemeLibraryCompanionStatus;
  device: ThemeLibraryDeviceInfo | null;
  themeInstallEnabled: boolean;
  busyAction: string | null;
  installStatus?: ThemeInstallStatus | null;
  installEntry?: boolean;
  lastInstall?: ThemeInstallResult;
  requestedThemeId?: string;
  storefrontConfigured: boolean;
  onSelectTheme: (themeId: string) => void;
  onInstallCustomTheme: (payload: ThemeStudioInstallPayload) => Promise<boolean>;
  onInstallTheme: (theme: ThemeProduct) => Promise<unknown> | void;
};

export function ThemeLibraryScreen({
  themes,
  selectedTheme,
  selectedThemeId,
  busyAction,
  catalogIssue,
  device,
  installStatus,
  lastInstall,
  requestedThemeId,
  companionStatus,
  storefrontConfigured,
  themeInstallEnabled,
  onInstallCustomTheme,
  onSelectTheme,
  onInstallTheme,
}: ThemeLibraryScreenProps) {
  const visibleThemes = themes;
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
  const libraryThemes: ThemeLibraryItem[] = [
    ...userThemes.map((custom) => ({
      kind: "custom" as const,
      custom,
      id: custom.id,
      themeId: custom.document.spec.themeId,
      title: custom.document.packName,
    })),
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
    requestedThemeId && selectedThemeId === requestedThemeId && !displayTheme,
  );
  const readiness = requestedThemeMissing
    ? {
        title: "Choose an available theme",
        detail:
          "The requested Shopify theme is not available in this app catalog. Select another listed theme before starting install.",
        buttonReason: "Choose an available theme first.",
        icon: <Library size={22} aria-hidden />,
      }
    : buildInstallReadiness({
        companionStatus,
        device,
        selectedTheme: displayTheme,
        themeInstallEnabled,
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
    spec.themeId = uniqueThemeId("my-theme", existingIds);
    setLibraryError("");
    setEditingTheme({
      assets: {},
      packName: "New Theme",
      source: "blank",
      spec,
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
      });
      return;
    }

    setLoadingEditorThemeId(item.themeId);
    try {
      const payload = await fetchThemePackForEditing(item.product.themeId);
      const spec = importThemeSpec(payload.spec);
      const existingIds = allThemeIds(themes, userThemes);
      spec.themeId = uniqueThemeId(`${item.product.themeId}-custom`, existingIds);
      setEditingTheme({
        assets: payload.assets || {},
        libraryId: item.product.themeId,
        packName: `${payload.name || item.product.title} Custom`,
        source: "published",
        spec,
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
    spec.themeId = uniqueThemeId(spec.themeId, existingIds);
    const id = currentId || spec.themeId;
    const nextRecord: UserThemeRecord = {
      document: {
        assets: payload.assets,
        packName: payload.packName || titleFromThemeId(spec.themeId),
        spec,
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
    <div className="mx-auto max-w-[1180px]">
      <section className="grid gap-5 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <h2
          className="truncate text-3xl font-black leading-tight text-[#1B1B1B] outline-none"
          ref={libraryHeadingRef}
          tabIndex={-1}
        >
          Themes
        </h2>
        <Button onClick={openBlankTheme} type="button">
          <Plus data-icon="inline-start" aria-hidden />
          <span>Create Theme</span>
        </Button>
      </section>

      <section className="py-8">
        {storageWarning ? (
          <Alert className="mb-5">
            <Lock aria-hidden />
            <AlertTitle>Theme storage needs attention</AlertTitle>
            <AlertDescription>{storageWarning}</AlertDescription>
          </Alert>
        ) : null}
        {libraryError ? (
          <Alert className="mb-5" variant="destructive">
            <Lock aria-hidden />
            <AlertTitle>Theme action failed</AlertTitle>
            <AlertDescription>{libraryError}</AlertDescription>
          </Alert>
        ) : null}
        {recovery ? (
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
                  device={device}
                  displayThemeId={displayTheme?.themeId}
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
                  themeInstallBlockedReason={readiness.buttonReason}
                  themeInstallEnabled={themeInstallEnabled}
                  themeStorageLocked={storageLocked}
                />
              ))}
            </ItemGroup>
          </>
        )}
      </section>

      {previewTheme ? (
        <Dialog open onOpenChange={(open) => !open && setPreviewTheme(null)}>
          <DialogContent
            aria-describedby={undefined}
            className="max-h-[calc(100dvh-2rem)] max-w-[640px] overflow-y-auto sm:max-w-[640px]"
          >
            <DialogHeader>
              <DialogTitle className="truncate text-2xl font-black">{previewTheme.title}</DialogTitle>
            </DialogHeader>
            <ThemePreview large theme={previewTheme} />
          </DialogContent>
        </Dialog>
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
  storefrontConfigured,
}: {
  catalogIssue?: string;
  requestedThemeId?: string;
  storefrontConfigured: boolean;
}) {
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
          Choose another theme below, or open the theme shop.
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
  selectedThemeId,
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
  selectedThemeId: string;
  themeInstallBlockedReason: string;
  themeInstallEnabled: boolean;
  themeStorageLocked: boolean;
}) {
  const theme = item.kind === "published" ? item.product : null;
  const isCustom = item.kind === "custom";
  const installed =
    lastInstall?.themeId === item.themeId || device?.activeTheme === item.themeId;
  const installInFlight =
    busyAction === "install" || installStatus?.phase === "installing";
  const preparingInstall = preparingInstallThemeId === item.themeId;
  const actionInFlight = Boolean(
    busyAction || preparingInstallThemeId || installInFlight,
  );
  const visibleInstallStatus = Boolean(
    installStatus?.themeId === item.themeId,
  );
  const blocker = theme
    ? buildThemeInstallBlocker({
        device,
        theme,
        themeInstallBlockedReason,
        themeInstallEnabled,
      })
    : buildCustomThemeInstallBlocker({
        device,
        themeInstallBlockedReason,
        themeInstallEnabled,
      });
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
      variant={item.themeId === displayThemeId ? "muted" : "outline"}
    >
      <ItemMedia className="w-28 sm:w-36">
        <Button
          aria-label={`Preview ${item.title}`}
          className="h-auto w-full justify-start p-0"
          onClick={() => onPreviewTheme(item)}
          type="button"
          variant="ghost"
        >
          <ThemePreview theme={item} />
        </Button>
      </ItemMedia>
      <ItemContent className="min-w-[180px]">
          <ItemTitle className="text-lg font-bold">{item.title}</ItemTitle>
          <ItemDescription className="font-semibold uppercase text-ring">
            {isCustom ? "Custom" : "Published"}
          </ItemDescription>
      </ItemContent>
      <ItemActions
          className={cn(
            "basis-full grid w-full gap-2 sm:basis-auto sm:w-auto",
            isCustom ? "sm:grid-cols-3" : "sm:grid-cols-2",
          )}
        >
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
          <Button
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
          {item.kind === "custom" ? (
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
}: {
  canRetry: boolean;
  onRetry: () => void;
  status: ThemeInstallStatus;
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
      ? "Theme is active on VibeTV."
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
  if (!device?.connected) {
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
  if (!device?.connected) {
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
  device,
  theme,
  themeInstallBlockedReason,
  themeInstallEnabled,
}: {
  device: ThemeLibraryDeviceInfo | null;
  theme: ThemeProduct;
  themeInstallBlockedReason: string;
  themeInstallEnabled: boolean;
}): ThemeInstallBlocker | null {
  const metadataBlocker = themeMetadataBlocker(theme);
  if (metadataBlocker) {
    return metadataBlocker;
  }
  if (!device?.connected) {
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
  if (!theme.isFree) {
    return {
      reason: "Get this theme first.",
      readinessTitle: "Checkout needed",
      readinessDetail:
        "Open the theme shop to get this theme before installing it.",
      readinessIcon: <Lock size={22} aria-hidden />,
    };
  }
  if (!theme.packUrl) {
    return {
      reason: "Theme is not available right now.",
      readinessTitle: "Theme unavailable",
      readinessDetail: "Choose another theme or try again later.",
      readinessIcon: <Library size={22} aria-hidden />,
    };
  }
  if (!isRemoteThemePackUrl(theme.packUrl)) {
    return {
      reason: "Theme is not available right now.",
      readinessTitle: "Theme unavailable",
      readinessDetail: "Choose another theme or try again later.",
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

function themeFirmwareBlocker(
  theme: ThemeProduct,
  device: ThemeLibraryDeviceInfo,
): ThemeInstallBlocker | null {
  const required = theme.requiresFirmware?.trim();
  if (!required) {
    return null;
  }
  if (!device.firmware) {
    return {
      reason: "Check VibeTV first.",
      readinessTitle: "Check VibeTV first",
      readinessDetail: "Reconnect VibeTV, then try this theme again.",
      readinessIcon: <RefreshCw size={22} aria-hidden />,
    };
  }
  if (compareVersions(device.firmware, required) >= 0) {
    return null;
  }
  return {
    reason: `Firmware ${required} or newer is required.`,
    readinessTitle: "Firmware too old",
    readinessDetail: `${theme.title} requires firmware ${required} or newer. Update firmware before installing this theme.`,
    readinessIcon: <RefreshCw size={22} aria-hidden />,
  };
}

function normalizeBoard(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  const maxLength = Math.max(leftParts.length, rightParts.length, 3);
  for (let index = 0; index < maxLength; index += 1) {
    const diff = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function parseVersion(value: string): number[] {
  const matches = value.match(/\d+/g);
  if (!matches?.length) {
    return [0, 0, 0];
  }
  return matches.map((part) => Number(part));
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
    status: "idle" | "loading" | "ready" | "error";
    themeId: string;
  }>({
    pack: null,
    status: "idle",
    themeId: "",
  });
  const className = large
    ? "relative block aspect-square w-full overflow-hidden border border-border bg-muted"
    : "relative block size-28 overflow-hidden border border-border bg-muted sm:size-36";
  const themeId = theme.themeId;
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
    (packState.themeId === themeId && packState.status === "ready"
      ? packState.pack
      : null);
  const status =
    customPack ? "ready" : packState.themeId === themeId ? packState.status : "loading";

  useEffect(() => {
    if (theme.kind === "custom") {
      return;
    }
    if (!themeId) {
      return;
    }

    const controller = new AbortController();
    fetch(themeRenderPackUrl(themeId), { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error("theme preview unavailable");
        }
        return response.json() as Promise<ThemeRenderPack>;
      })
      .then((payload) => {
        setPackState({
          pack: payload,
          status: payload?.spec ? "ready" : "error",
          themeId,
        });
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setPackState({ pack: null, status: "error", themeId });
      });

    return () => controller.abort();
  }, [theme.kind, themeId]);

  return (
    <span className={className}>
      <ThemeSpecPreview
        animate={Boolean(large)}
        pack={pack}
        status={status}
        themeId={themeId}
      />
    </span>
  );
}

async function fetchThemePackForEditing(themeId: string): Promise<{
  assets?: Record<string, ThemeStudioAsset>;
  name?: string;
  spec: unknown;
}> {
  const response = await fetch(themeRenderPackUrl(themeId));
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
