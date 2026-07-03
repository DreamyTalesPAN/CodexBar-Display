"use client";

import {
  Library,
  Lock,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Wifi,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { isRemoteThemePackUrl } from "@/lib/theme-pack-url";
import type { ThemeProduct } from "@/lib/themes";
import { ControlCenterButton } from "./control-center-button";
import { themeRenderPackUrl } from "./control-center-runtime";
import {
  ThemeSpecPreview,
  type ThemeRenderPack,
} from "./live-vibetv-preview";

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
  onInstallTheme: (theme: ThemeProduct) => void;
};

export function ThemeLibraryScreen({
  themes,
  selectedTheme,
  selectedThemeId,
  busyAction,
  catalogIssue,
  device,
  installStatus,
  installEntry,
  lastInstall,
  requestedThemeId,
  companionStatus,
  storefrontConfigured,
  themeInstallEnabled,
  onSelectTheme,
  onInstallTheme,
}: ThemeLibraryScreenProps) {
  const visibleThemes = themes;
  const [previewTheme, setPreviewTheme] = useState<ThemeProduct | null>(null);
  const displayTheme =
    selectedTheme ||
    visibleThemes.find((theme) => theme.themeId === selectedThemeId);
  const catalogEmpty = visibleThemes.length === 0;
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
  const setupBlocked =
    companionStatus !== "online" ||
    !device?.connected ||
    !device.paired;

  return (
    <div className="mx-auto max-w-[1180px]">
      <section className="min-h-[330px] border-b border-[#747A60] py-10">
        <div className="min-w-0">
          <div className="flex items-start gap-5">
            <HeroIcon>
              <Library size={36} aria-hidden />
            </HeroIcon>
            <div className="min-w-0">
              <h2 className="max-w-[520px] text-[clamp(2.7rem,4.8vw,4.5rem)] font-black leading-[1.05] tracking-normal text-[#1B1B1B]">
                {catalogEmpty
                  ? "Theme catalog unavailable"
                  : requestedThemeMissing
                    ? "Theme not available"
                    : "Choose a theme"}
              </h2>
              {installEntry && requestedThemeMissing ? (
                <p className="mt-4 max-w-[640px] text-base leading-7 text-[#444933]">
                  This theme is not available right now. Choose another theme
                  below.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {!setupBlocked ? (
        <section className="border-b border-[#747A60] py-8">
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
              {visibleThemes.map((theme) => (
                <ThemeListItem
                  busyAction={busyAction}
                  device={device}
                  displayThemeId={displayTheme?.themeId}
                  installStatus={installStatus}
                  key={theme.themeId}
                  lastInstall={lastInstall}
                  onInstallTheme={onInstallTheme}
                  onPreviewTheme={setPreviewTheme}
                  onSelectTheme={onSelectTheme}
                  selectedThemeId={selectedThemeId}
                  theme={theme}
                  themeInstallBlockedReason={readiness.buttonReason}
                  themeInstallEnabled={themeInstallEnabled}
                />
              ))}
            </ul>
          </>
        )}
        </section>
      ) : null}

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
  installStatus,
  lastInstall,
  onInstallTheme,
  onPreviewTheme,
  onSelectTheme,
  selectedThemeId,
  theme,
  themeInstallBlockedReason,
  themeInstallEnabled,
}: {
  busyAction: string | null;
  device: ThemeLibraryDeviceInfo | null;
  displayThemeId?: string;
  installStatus?: ThemeInstallStatus | null;
  lastInstall?: ThemeInstallResult;
  onInstallTheme: (theme: ThemeProduct) => void;
  onPreviewTheme: (theme: ThemeProduct) => void;
  onSelectTheme: (themeId: string) => void;
  selectedThemeId: string;
  theme: ThemeProduct;
  themeInstallBlockedReason: string;
  themeInstallEnabled: boolean;
}) {
  const installed =
    lastInstall?.themeId === theme.themeId ||
    device?.activeTheme === theme.themeId;
  const installInFlight = busyAction === "install";
  const actionInFlight = Boolean(busyAction);
  const visibleInstallStatus = installStatus?.themeId === theme.themeId;
  const blocker = buildThemeInstallBlocker({
    device,
    theme,
    themeInstallBlockedReason,
    themeInstallEnabled,
  });
  const blockedLabel = labelForInstallBlocker(blocker);
  const disabled = actionInFlight || installed || Boolean(blocker);
  const canSelectInstead =
    !actionInFlight &&
    !installed &&
    Boolean(blocker) &&
    theme.themeId !== displayThemeId;
  const title = canSelectInstead
    ? `Select ${theme.title}`
    : disabled
      ? installDisabledReason({
          actionInFlight,
          installInFlight,
          installed,
          blocker,
        })
      : `Install ${theme.title}`;

  return (
    <li className={theme.themeId === displayThemeId ? "bg-[#EEEEEE]" : ""}>
      <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-4 py-4 transition sm:grid-cols-[96px_minmax(0,1fr)_auto] sm:items-center sm:gap-5">
        <button
          aria-label={`Preview ${theme.title}`}
          className="text-left"
          onClick={() => onPreviewTheme(theme)}
          type="button"
        >
          <ThemePreview theme={theme} />
        </button>
        <div className="min-w-0">
          <div className="truncate text-lg font-bold text-[#1B1B1B]">
            {theme.title}
          </div>
          <div className="mt-1 line-clamp-1 text-sm leading-6 text-[#444933]">
            {theme.description || "Theme from the VibeTV catalog."}
          </div>
        </div>
        <button
          className="col-span-2 h-11 min-w-[96px] border border-[#747A60] bg-[#F9F9F9] px-4 text-sm font-semibold text-[#1B1B1B] transition hover:bg-[#CCFF00] disabled:cursor-not-allowed disabled:bg-[#EEEEEE] disabled:text-[#444933] disabled:opacity-70 sm:col-span-1 sm:mr-3 sm:h-10"
          disabled={disabled && !canSelectInstead}
          onClick={() => {
            onSelectTheme(theme.themeId);
            if (!blocker) {
              onInstallTheme(theme);
            }
          }}
          title={title}
          type="button"
        >
          {labelForInstallButton({
            actionInFlight,
            blockedLabel,
            canSelectInstead,
            installInFlight,
            installed,
            selected: theme.themeId === selectedThemeId,
            disabled,
          })}
        </button>
      </div>
      {visibleInstallStatus ? (
        <InlineInstallProgress
          canRetry={!disabled}
          onRetry={() => onInstallTheme(theme)}
          status={installStatus}
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
  canSelectInstead,
  disabled,
  installInFlight,
  installed,
  selected,
}: {
  actionInFlight: boolean;
  blockedLabel: string;
  canSelectInstead: boolean;
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
  if (canSelectInstead) {
    return "Select";
  }
  if (disabled) {
    return blockedLabel;
  }
  return "Install";
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

function HeroIcon({ children }: { children: ReactNode }) {
  return (
    <div className="grid size-16 shrink-0 place-items-center rounded-full border border-[#747A60] bg-[#EEEEEE] text-[#1B1B1B]">
      {children}
    </div>
  );
}

function ThemePreview({
  large,
  theme,
}: {
  large?: boolean;
  theme: ThemeProduct;
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
  const pack =
    packState.themeId === themeId && packState.status === "ready"
      ? packState.pack
      : null;
  const status =
    packState.themeId === themeId ? packState.status : "loading";

  useEffect(() => {
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
  }, [themeId]);

  return (
    <span className={className}>
      <ThemeSpecPreview pack={pack} status={status} themeId={themeId} />
    </span>
  );
}
