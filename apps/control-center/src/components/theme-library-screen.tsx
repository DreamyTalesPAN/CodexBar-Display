"use client";

import {
  Edit3,
  Library,
  Lock,
  Monitor,
  Plus,
  RefreshCw,
  ShieldCheck,
  Wifi,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { isRemoteThemePackUrl } from "@/lib/theme-pack-url";
import {
  createBlankThemeSpec,
  importThemeSpec,
  normalizeThemeSpec,
  type ThemeStudioAsset,
  type ThemeStudioDraft,
  type ThemeStudioSpec,
} from "@/lib/theme-studio";
import type { ThemeProduct } from "@/lib/themes";
import { ControlCenterButton } from "./control-center-button";
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
};

type ThemeInstallBlocker = {
  reason: string;
  readinessTitle?: string;
  readinessDetail?: string;
  readinessIcon?: ReactNode;
};

type UserThemeRecord = {
  draft: ThemeStudioDraft;
  id: string;
  originThemeId?: string;
  updatedAt: string;
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

const USER_THEMES_STORAGE_KEY = "vibetv.controlCenter.userThemes";

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
  const [editingTheme, setEditingTheme] =
    useState<ThemeStudioEditorTheme | null>(null);
  const [libraryError, setLibraryError] = useState("");
  const [loadingEditorThemeId, setLoadingEditorThemeId] = useState("");
  const [preparingInstallThemeId, setPreparingInstallThemeId] = useState("");
  const [previewTheme, setPreviewTheme] = useState<ThemeLibraryItem | null>(null);
  const libraryThemes: ThemeLibraryItem[] = [
    ...userThemes.map((custom) => ({
      kind: "custom" as const,
      custom,
      id: custom.id,
      themeId: custom.draft.spec.themeId,
      title: custom.draft.packName,
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
      setUserThemes(readUserThemes());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function persistUserThemes(next: UserThemeRecord[]) {
    setUserThemes(next);
    writeUserThemes(next);
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
        assets: item.custom.draft.assets || {},
        libraryId: item.custom.id,
        packName: item.custom.draft.packName,
        source: "custom",
        spec: item.custom.draft.spec,
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

  function saveThemeFromEditor(payload: ThemeStudioSavePayload) {
    const now = new Date().toISOString();
    const currentId =
      payload.source === "custom" && payload.libraryId
        ? payload.libraryId
        : undefined;
    const existingIds = allThemeIds(themes, userThemes, currentId);
    const spec = normalizeThemeSpec(payload.spec);
    spec.themeId = uniqueThemeId(spec.themeId, existingIds);
    const id = currentId || spec.themeId;
    const nextRecord: UserThemeRecord = {
      draft: {
        assets: payload.assets,
        packName: payload.packName || titleFromThemeId(spec.themeId),
        savedAt: now,
        spec,
      },
      id,
      originThemeId:
        payload.source === "published" ? payload.libraryId || undefined : undefined,
      updatedAt: now,
    };
    const next = [
      nextRecord,
      ...userThemes.filter((theme) => theme.id !== id),
    ];
    persistUserThemes(next);
    setEditingTheme(null);
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
        assets: item.custom.draft.assets || {},
        packName: item.custom.draft.packName,
        spec: item.custom.draft.spec,
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
        initialTheme={editingTheme}
        onBackToLibrary={() => setEditingTheme(null)}
        onInstallTheme={onInstallCustomTheme}
        onSaveToLibrary={saveThemeFromEditor}
      />
    );
  }

  return (
    <div className="mx-auto max-w-[1180px]">
      <section className="grid gap-5 border-b border-[#747A60] py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <h2 className="truncate text-3xl font-black leading-tight text-[#1B1B1B]">
          Themes
        </h2>
        <ControlCenterButton
          icon={<Plus size={18} aria-hidden />}
          label="New Theme"
          onClick={openBlankTheme}
          variant="primary"
        />
      </section>

      <section className="border-b border-[#747A60] py-8">
        {libraryError ? (
          <div className="mb-5 flex gap-3 border border-[#7D2633] bg-[#FFE3E8] p-4 text-sm text-[#7D2633]">
            <Lock className="mt-0.5 shrink-0" size={18} aria-hidden />
            <div>{libraryError}</div>
          </div>
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

            <ul className="divide-y divide-[#747A60] border-y border-[#747A60]">
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
                  onInstallTheme={installLibraryTheme}
                  onPreviewTheme={setPreviewTheme}
                  preparingInstallThemeId={preparingInstallThemeId}
                  selectedThemeId={selectedThemeId}
                  themeInstallBlockedReason={readiness.buttonReason}
                  themeInstallEnabled={themeInstallEnabled}
                />
              ))}
            </ul>
          </>
        )}
      </section>

      {previewTheme ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#1B1B1B]/80 p-4 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`${previewTheme.title} preview`}
        >
          <div className="max-h-[calc(100dvh-2rem)] w-full max-w-[640px] overflow-y-auto border border-[#747A60] bg-[#F9F9F9] p-5">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h3 className="truncate text-2xl font-black text-[#1B1B1B]">
                {previewTheme.title}
              </h3>
              <button
                aria-label="Close preview"
                autoFocus
                className="grid size-10 place-items-center border border-[#747A60] bg-[#F9F9F9] text-[#1B1B1B] hover:bg-[#CCFF00]"
                onClick={() => setPreviewTheme(null)}
                type="button"
              >
                <X size={20} aria-hidden />
              </button>
            </div>
            <ThemePreview large theme={previewTheme} />
          </div>
        </div>
      ) : null}
    </div>
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
    ? "This theme is not available right now. Open the theme shop or choose another theme later."
    : storefrontConfigured || catalogIssue
      ? "Themes could not be loaded right now. Reload the page or open the theme shop."
      : "Themes are not available from this page right now. Open the theme shop instead.";

  return (
    <div className="grid gap-5 border-y border-[#747A60] py-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div className="flex min-w-0 gap-4">
        <div className="grid size-11 shrink-0 place-items-center rounded-full bg-[#1B1B1B] text-[#CCFF00]">
          <Lock size={22} aria-hidden />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-bold text-[#1B1B1B]">
            Themes unavailable
          </h3>
          <p className="mt-1 max-w-[760px] text-sm leading-6 text-[#444933]">
            {detail}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
        <a
          className="inline-flex h-12 min-w-[190px] items-center justify-center gap-2 border border-[#747A60] bg-[#F9F9F9] px-4 text-sm font-semibold text-[#1B1B1B] transition hover:bg-[#EEEEEE]"
          href="https://vibetv.shop/collections/themes-2"
        >
          <Library size={18} aria-hidden />
          <span>Open theme shop</span>
        </a>
        <ControlCenterButton
          icon={<RefreshCw size={18} aria-hidden />}
          label="Reload catalog"
          onClick={() => window.location.reload()}
          variant="primary"
        />
      </div>
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
    <div className="mb-6 flex gap-3 border border-[#747A60] bg-[#F9F9F9] p-4 text-sm text-[#444933]">
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
  onEditTheme,
  onInstallTheme,
  onPreviewTheme,
  preparingInstallThemeId,
  selectedThemeId,
  themeInstallBlockedReason,
  themeInstallEnabled,
}: {
  busyAction: string | null;
  device: ThemeLibraryDeviceInfo | null;
  displayThemeId?: string;
  item: ThemeLibraryItem;
  installStatus?: ThemeInstallStatus | null;
  lastInstall?: ThemeInstallResult;
  loadingEditorThemeId: string;
  onEditTheme: (item: ThemeLibraryItem) => void;
  onInstallTheme: (item: ThemeLibraryItem) => void;
  onPreviewTheme: (theme: ThemeLibraryItem) => void;
  preparingInstallThemeId: string;
  selectedThemeId: string;
  themeInstallBlockedReason: string;
  themeInstallEnabled: boolean;
}) {
  const theme = item.kind === "published" ? item.product : null;
  const isCustom = item.kind === "custom";
  const installed =
    lastInstall?.themeId === item.themeId || device?.activeTheme === item.themeId;
  const installInFlight = busyAction === "install";
  const preparingInstall = preparingInstallThemeId === item.themeId;
  const actionInFlight = Boolean(busyAction || preparingInstallThemeId);
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
    <li className={item.themeId === displayThemeId ? "bg-[#EEEEEE]" : ""}>
      <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-4 py-4 transition sm:grid-cols-[96px_minmax(0,1fr)_auto] sm:items-center sm:gap-5">
        <button
          aria-label={`Preview ${item.title}`}
          className="text-left"
          onClick={() => onPreviewTheme(item)}
          type="button"
        >
          <ThemePreview theme={item} />
        </button>
        <div className="min-w-0">
          <div className="truncate text-lg font-bold text-[#1B1B1B]">
            {item.title}
          </div>
          <div className="mt-1 text-xs font-black uppercase text-[#5E7200]">
            {isCustom ? "Custom" : "Published"}
          </div>
        </div>
        <div className="col-span-2 grid gap-2 sm:col-span-1 sm:mr-3 sm:grid-cols-2">
          <ControlCenterButton
            busy={loadingEdit}
            disabled={Boolean(loadingEditorThemeId) && !loadingEdit}
            icon={<Edit3 size={16} aria-hidden />}
            label={loadingEdit ? "Opening" : "Edit"}
            onClick={() => void onEditTheme(item)}
            size="compact"
            variant="secondary"
          />
          <button
            className="h-11 min-w-[96px] border border-[#747A60] bg-[#F9F9F9] px-4 text-sm font-semibold text-[#1B1B1B] transition hover:bg-[#CCFF00] disabled:cursor-not-allowed disabled:bg-[#EEEEEE] disabled:text-[#444933] disabled:opacity-70 sm:h-10"
            disabled={disabled}
            onClick={() => {
              if (!blocker) {
                onInstallTheme(item);
              }
            }}
            title={title}
            type="button"
          >
            {labelForInstallButton({
              actionInFlight,
              blockedLabel,
              installInFlight: installInFlight || preparingInstall,
              installed,
              selected: item.themeId === selectedThemeId,
              disabled,
            })}
          </button>
        </div>
      </div>
      {visibleInstallStatus ? (
        <InlineInstallProgress
          canRetry={!disabled}
          onRetry={() => onInstallTheme(item)}
          status={installStatus!}
        />
      ) : null}
    </li>
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
    <div className="px-0 pb-4">
      <div className="mr-3 h-2 overflow-hidden border border-[#747A60] bg-[#F9F9F9]">
        <div
          className={`h-full bg-[#CCFF00] transition-[width] duration-300 ${
            failed || complete ? "" : "animate-pulse"
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mr-3 mt-3 flex flex-col gap-3 border border-[#747A60] bg-[#F9F9F9] p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          {failed ? (
            <X className="mt-0.5 shrink-0" size={16} aria-hidden />
          ) : complete ? (
            <ShieldCheck className="mt-0.5 shrink-0" size={16} aria-hidden />
          ) : (
            <RefreshCw
              className="mt-0.5 shrink-0 animate-spin"
              size={16}
              aria-hidden
            />
          )}
          <div className="min-w-0">
            <div className="text-sm font-bold text-[#1B1B1B]">{title}</div>
            <div className="mt-1 break-words text-sm leading-6 text-[#444933]">
              {detail}
            </div>
            {previousSteps.length > 0 ? (
              <ol className="mt-2 space-y-1 text-xs leading-5 text-[#5D634F]">
                {previousSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            ) : null}
          </div>
        </div>
        {failed && canRetry ? (
          <button
            className="h-10 min-w-[120px] border border-[#747A60] bg-[#F9F9F9] px-3 text-sm font-semibold text-[#1B1B1B] hover:bg-[#CCFF00]"
            onClick={onRetry}
            type="button"
          >
            Try again
          </button>
        ) : null}
      </div>
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
    ? "relative block aspect-square w-full overflow-hidden border border-[#747A60] bg-[#EEEEEE]"
    : "relative block size-24 overflow-hidden border border-[#747A60] bg-[#EEEEEE]";
  const themeId = theme.themeId;
  const customPack =
    theme.kind === "custom"
      ? {
          ok: true,
          themeId,
          name: theme.title,
          spec: theme.custom.draft.spec,
          assets: theme.custom.draft.assets || {},
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
      <ThemeSpecPreview pack={pack} status={status} themeId={themeId} />
    </span>
  );
}

function readUserThemes(): UserThemeRecord[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(USER_THEMES_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map(readUserTheme)
      .filter((theme): theme is UserThemeRecord => Boolean(theme));
  } catch {
    return [];
  }
}

function readUserTheme(value: unknown): UserThemeRecord | null {
  if (!isRecord(value) || !isRecord(value.draft)) {
    return null;
  }
  const draft = value.draft;
  if (!isRecord(draft.spec) || typeof draft.packName !== "string") {
    return null;
  }
  return {
    draft: {
      assets: isRecord(draft.assets)
        ? (draft.assets as Record<string, ThemeStudioAsset>)
        : {},
      packName: draft.packName,
      savedAt: typeof draft.savedAt === "string" ? draft.savedAt : "",
      spec: normalizeThemeSpec(draft.spec as ThemeStudioSpec),
    },
    id:
      typeof value.id === "string" && value.id.trim()
        ? value.id.trim()
        : normalizeThemeSpec(draft.spec as ThemeStudioSpec).themeId,
    originThemeId:
      typeof value.originThemeId === "string" ? value.originThemeId : undefined,
    updatedAt:
      typeof value.updatedAt === "string"
        ? value.updatedAt
        : typeof draft.savedAt === "string"
          ? draft.savedAt
          : "",
  };
}

function writeUserThemes(themes: UserThemeRecord[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(USER_THEMES_STORAGE_KEY, JSON.stringify(themes));
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
      .map((theme) => theme.draft.spec.themeId),
  ];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
