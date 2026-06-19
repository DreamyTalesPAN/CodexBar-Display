"use client";

import Image from "next/image";
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
import { useState } from "react";
import { isRemoteThemePackUrl } from "@/lib/theme-pack-url";
import type { ThemeProduct, ThemeSource } from "@/lib/themes";
import {
  CompanionDownloadActions,
  CompanionReleaseNotice,
  useCompanionRelease,
} from "./companion-installer-actions";
import type { ApiError } from "./control-center-types";
import { DeviceTargetForm } from "./device-target-form";

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
  logs: string[];
  result?: ThemeInstallResult;
  error?: string;
};

export type ThemeLibraryScreenProps = {
  themes: ThemeProduct[];
  selectedTheme?: ThemeProduct;
  selectedThemeId: string;
  catalogIssue?: string;
  catalogSource: ThemeSource;
  companionStatus: ThemeLibraryCompanionStatus;
  device: ThemeLibraryDeviceInfo | null;
  deviceTarget: string;
  themeInstallEnabled: boolean;
  busyAction: string | null;
  installStatus?: ThemeInstallStatus | null;
  installEntry?: boolean;
  lastError?: ApiError | null;
  lastInstall?: ThemeInstallResult;
  requestedThemeId?: string;
  storefrontConfigured: boolean;
  onDeviceTargetChange?: (target: string) => void;
  onSelectTheme: (themeId: string) => void;
  onInstallTheme: (theme: ThemeProduct) => void;
  onCheckBridge?: () => void;
  onDiscoverDevice?: (targetOverride?: string) => void;
  onPairDevice?: () => void;
};

export function ThemeLibraryScreen({
  themes,
  selectedTheme,
  selectedThemeId,
  busyAction,
  catalogIssue,
  catalogSource,
  device,
  deviceTarget,
  installStatus,
  installEntry,
  lastError,
  lastInstall,
  requestedThemeId,
  companionStatus,
  storefrontConfigured,
  themeInstallEnabled,
  onCheckBridge,
  onDeviceTargetChange,
  onDiscoverDevice,
  onSelectTheme,
  onInstallTheme,
  onPairDevice,
}: ThemeLibraryScreenProps) {
  const visibleThemes = themes;
  const [previewTheme, setPreviewTheme] = useState<ThemeProduct | null>(null);
  const displayTheme =
    selectedTheme ||
    visibleThemes.find((theme) => theme.themeId === selectedThemeId);
  const catalogEmpty = visibleThemes.length === 0;
  const requestedThemeMissing = Boolean(
    requestedThemeId &&
      selectedThemeId === requestedThemeId &&
      !displayTheme,
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
  const companionMissing = companionStatus === "missing";
  const pairingRequired =
    companionStatus === "online" && Boolean(device?.connected) && !device?.paired;
  const {
    busy: companionReleaseBusy,
    refresh: refreshCompanionRelease,
    release: companionRelease,
  } = useCompanionRelease(undefined, { enabled: companionMissing });
  const showTargetControl = companionStatus === "online" && !device?.connected;
  const localActionBusy = Boolean(busyAction);

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
                    : installEntry
                      ? "Check install readiness"
                      : "Choose a theme"}
              </h2>
              {installEntry && displayTheme ? (
                <p className="mt-4 max-w-[640px] text-base leading-7 text-[#444933]">
                  {displayTheme.title} is selected. Install starts only when
                  Companion, VibeTV discovery and the write gate are ready.
                </p>
              ) : null}
              {installEntry && requestedThemeMissing ? (
                <p className="mt-4 max-w-[640px] text-base leading-7 text-[#444933]">
                  The Shopify link requested {requestedThemeId}, but this theme
                  is not in the app catalog right now.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-[#747A60] py-8">
        {catalogEmpty ? (
          <CatalogEmptyState
            catalogIssue={catalogIssue}
            catalogSource={catalogSource}
            requestedThemeId={requestedThemeId}
            storefrontConfigured={storefrontConfigured}
          />
        ) : (
          <>
            {requestedThemeMissing ? (
              <MissingRequestedThemeNotice requestedThemeId={requestedThemeId} />
            ) : null}

            <div className="mb-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,auto)] lg:items-start">
              <div className="flex min-w-0 gap-4">
                <div className="grid size-11 shrink-0 place-items-center rounded-full bg-[#1B1B1B] text-[#CCFF00]">
                  {readiness.icon}
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-[#1B1B1B]">
                    {readiness.title}
                  </h3>
                  <p className="mt-1 max-w-[720px] text-sm leading-6 text-[#444933]">
                    {readiness.detail}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap lg:max-w-[620px] lg:justify-end">
                {companionMissing ? (
                  <>
                    <CompanionDownloadActions release={companionRelease} />
                    <CompanionReleaseNotice release={companionRelease} />
                    <button
                      className="inline-flex h-12 min-w-[190px] items-center justify-center gap-2 border border-[#747A60] bg-[#F9F9F9] px-4 text-sm font-semibold text-[#1B1B1B] transition hover:bg-[#EEEEEE] disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={companionReleaseBusy}
                      onClick={refreshCompanionRelease}
                      type="button"
                    >
                      {companionReleaseBusy ? (
                        <RefreshCw className="animate-spin" size={18} />
                      ) : (
                        <RefreshCw size={18} aria-hidden />
                      )}
                      <span>
                        {companionReleaseBusy ? "Checking" : "Check installer"}
                      </span>
                    </button>
                  </>
                ) : null}
                {companionStatus !== "online" ? (
                  <button
                    className="inline-flex h-12 items-center justify-center gap-2 border border-[#747A60] bg-[#F9F9F9] px-4 text-sm font-semibold text-[#1B1B1B] transition hover:bg-[#CCFF00] disabled:cursor-not-allowed disabled:bg-[#EEEEEE] disabled:text-[#444933]"
                    disabled={localActionBusy}
                    onClick={onCheckBridge}
                    type="button"
                  >
                    {busyAction === "status" ? (
                      <RefreshCw className="animate-spin" size={17} />
                    ) : (
                      <Wifi size={17} aria-hidden />
                    )}
                    {busyAction === "status" ? "Checking" : "Check bridge"}
                  </button>
                ) : null}
                {companionStatus === "online" && !device?.connected ? (
                  <button
                    className="inline-flex h-12 items-center justify-center gap-2 border border-[#747A60] bg-[#1B1B1B] px-4 text-sm font-semibold text-[#EDEDED] transition hover:bg-[#CCFF00] hover:text-[#1B1B1B] disabled:cursor-not-allowed disabled:bg-[#EEEEEE] disabled:text-[#444933]"
                    disabled={localActionBusy}
                    onClick={() => onDiscoverDevice?.(deviceTarget)}
                    type="button"
                  >
                    {busyAction === "discover" ? (
                      <RefreshCw className="animate-spin" size={17} />
                    ) : (
                      <Monitor size={17} aria-hidden />
                    )}
                    {busyAction === "discover" ? "Searching" : "Find VibeTV"}
                  </button>
                ) : null}
                {pairingRequired ? (
                  <button
                    className="inline-flex h-12 items-center justify-center gap-2 border border-[#1B1B1B] bg-[#1B1B1B] px-4 text-sm font-semibold text-[#EDEDED] transition hover:bg-[#CCFF00] hover:text-[#1B1B1B] disabled:cursor-not-allowed disabled:bg-[#EEEEEE] disabled:text-[#444933]"
                    disabled={localActionBusy}
                    onClick={onPairDevice}
                    type="button"
                  >
                    {busyAction === "pair" ? (
                      <RefreshCw className="animate-spin" size={17} />
                    ) : (
                      <Lock size={17} aria-hidden />
                    )}
                    <span>{busyAction === "pair" ? "Pairing" : "Pair VibeTV"}</span>
                  </button>
                ) : null}
              </div>
            </div>

            {showTargetControl ? (
              <DeviceTargetForm
                busy={busyAction === "discover"}
                className="mb-6 grid gap-4 border border-[#747A60] bg-[#F9F9F9] p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
                disabled={localActionBusy}
                id="theme-library-device-target"
                lastError={lastError}
                onChange={onDeviceTargetChange}
                onSubmit={onDiscoverDevice}
                value={deviceTarget}
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
  catalogSource,
  requestedThemeId,
  storefrontConfigured,
}: {
  catalogIssue?: string;
  catalogSource: ThemeSource;
  requestedThemeId?: string;
  storefrontConfigured: boolean;
}) {
  const detail =
    catalogIssue ||
    (storefrontConfigured
      ? "Shopify is configured, but the theme collection did not return any VibeTV theme products."
      : "Shopify Storefront settings are missing, so the app cannot load customer themes.");

  return (
    <div className="grid gap-5 border-y border-[#747A60] py-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div className="flex min-w-0 gap-4">
        <div className="grid size-11 shrink-0 place-items-center rounded-full bg-[#1B1B1B] text-[#CCFF00]">
          <Lock size={22} aria-hidden />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-bold text-[#1B1B1B]">
            No installable themes loaded
          </h3>
          <p className="mt-1 max-w-[760px] text-sm leading-6 text-[#444933]">
            {detail}
          </p>
          {requestedThemeId ? (
            <p className="mt-2 max-w-[760px] break-words font-mono text-xs leading-5 text-[#444933]">
              Requested theme: {requestedThemeId}
            </p>
          ) : null}
          <p className="mt-2 text-xs font-semibold uppercase tracking-normal text-[#506600]">
            Catalog source: {catalogSource}
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
        <button
          className="inline-flex h-12 min-w-[190px] items-center justify-center gap-2 border border-[#1B1B1B] bg-[#1B1B1B] px-4 text-sm font-semibold text-[#EDEDED] transition hover:bg-[#CCFF00] hover:text-[#1B1B1B]"
          onClick={() => window.location.reload()}
          type="button"
        >
          <RefreshCw size={18} aria-hidden />
          <span>Reload catalog</span>
        </button>
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
          Shopify theme link was not found
        </div>
        <div className="mt-1 break-words">
          The app catalog does not contain {requestedThemeId}. Choose another
          theme below, or fix the product metafield before sending this link to
          customers.
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
    lastInstall?.themeId === theme.themeId || device?.activeTheme === theme.themeId;
  const installInFlight = busyAction === "install";
  const actionInFlight = Boolean(busyAction);
  const visibleInstallStatus = installStatus?.themeId === theme.themeId;
  const blocker = buildThemeInstallBlocker({
    device,
    theme,
    themeInstallBlockedReason,
    themeInstallEnabled,
  });
  const disabled =
    actionInFlight ||
    installed ||
    Boolean(blocker);
  const canSelectInstead =
    !actionInFlight &&
    !installed &&
    Boolean(blocker) &&
    theme.themeId !== displayThemeId;
  const title = canSelectInstead
    ? `Select ${theme.title}`
    : disabled
      ? installDisabledReason({ actionInFlight, installInFlight, installed, blocker })
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
  const progressWidth = failed || complete ? "w-full" : "w-2/3";
  const title = failed ? "Install failed" : complete ? "Installed" : "Installing";

  return (
    <div className="px-0 pb-4">
      <div className="mr-3 h-2 overflow-hidden border border-[#747A60] bg-[#F9F9F9]">
        <div
          className={`h-full bg-[#CCFF00] ${progressWidth} ${
            failed || complete ? "" : "animate-pulse"
          }`}
        />
      </div>
      <details className="mr-3 mt-3" open={failed || undefined}>
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-bold text-[#1B1B1B]">
          {failed ? (
            <X size={16} aria-hidden />
          ) : complete ? (
            <ShieldCheck size={16} aria-hidden />
          ) : (
            <RefreshCw className="animate-spin" size={16} aria-hidden />
          )}
          <span>{title}</span>
          <span className="font-normal text-[#444933]">
            {status.logs.length} log lines
          </span>
        </summary>
        {failed && canRetry ? (
          <button
            className="mt-3 border border-[#747A60] bg-[#F9F9F9] px-3 py-1 text-xs font-semibold text-[#1B1B1B] hover:bg-[#CCFF00]"
            onClick={onRetry}
            type="button"
          >
            Retry install
          </button>
        ) : null}
        <ol className="mt-3 divide-y divide-[#747A60] border-y border-[#747A60]">
          {status.logs.slice(-8).map((line, index) => (
            <li
              className="grid grid-cols-[32px_minmax(0,1fr)] gap-3 py-2 text-sm text-[#444933]"
              key={`${line}-${index}`}
            >
              <span className="font-mono text-xs text-[#506600]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="break-words">{line}</span>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

function labelForInstallButton({
  actionInFlight,
  canSelectInstead,
  disabled,
  installInFlight,
  installed,
  selected,
}: {
  actionInFlight: boolean;
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
    return "Locked";
  }
  return "Install";
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
      title: "Companion required",
      detail:
        "Themes can be browsed now. Installing needs the local Companion running on this computer.",
      buttonReason: "Start Companion first.",
      icon: <Wifi size={22} aria-hidden />,
    };
  }
  if (!device?.connected) {
    return {
      title: "VibeTV not found",
      detail:
        "Companion is online. Search for VibeTV on the same WiFi network before enabling install.",
      buttonReason: "Find VibeTV first.",
      icon: <Monitor size={22} aria-hidden />,
    };
  }
  if (!device.paired) {
    return {
      title: "Pairing required",
      detail:
        "VibeTV is reachable. Pair it once before theme install writes are allowed.",
      buttonReason: "Pair VibeTV first.",
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
  if (blocker?.readinessTitle && blocker.readinessDetail && blocker.readinessIcon) {
    return {
      title: blocker.readinessTitle,
      detail: blocker.readinessDetail,
      buttonReason: blocker.reason,
      icon: blocker.readinessIcon,
    };
  }

  if (!themeInstallEnabled) {
    return {
      title: "Install protected",
      detail:
        "Device reads are ready. Theme install writes stay locked until the hardware-safe release gate is enabled.",
      buttonReason: "Theme install is protected for this release gate.",
      icon: <Lock size={22} aria-hidden />,
    };
  }
  return {
    title: "Ready for install",
    detail:
      "Companion and VibeTV are online, and this Companion build allows theme install writes.",
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
    return "Another local action is already running.";
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
    return { reason: themeInstallBlockedReason || "Find VibeTV first." };
  }
  if (!device.paired) {
    return {
      reason: "Pair VibeTV first.",
      readinessTitle: "Pairing required",
      readinessDetail:
        "This VibeTV is reachable, but theme install writes require pairing first.",
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
      reason: themeInstallBlockedReason || "Theme install is protected.",
    };
  }
  return null;
}

function themeMetadataBlocker(theme: ThemeProduct): ThemeInstallBlocker | null {
  if (!theme.isFree) {
    return {
      reason: "Paid theme checkout is not supported in this MVP.",
      readinessTitle: "Free themes only",
      readinessDetail:
        "This MVP installs free themes only. Paid theme checkout and entitlement checks are not part of this release.",
      readinessIcon: <Lock size={22} aria-hidden />,
    };
  }
  if (!theme.packUrl) {
    return {
      reason: "Theme pack URL is missing.",
      readinessTitle: "Theme pack missing",
      readinessDetail:
        "This Shopify theme is missing the technical pack URL, so it cannot be installed yet.",
      readinessIcon: <Library size={22} aria-hidden />,
    };
  }
  if (!isRemoteThemePackUrl(theme.packUrl)) {
    return {
      reason: "Theme pack URL must be an http(s) download URL.",
      readinessTitle: "Theme pack URL invalid",
      readinessDetail:
        "This Shopify theme has a technical pack URL, but it is not an http(s) download URL. Fix the product metafield before install.",
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
      reason: "Device board must be read before install.",
      readinessTitle: "Board check required",
      readinessDetail:
        "This theme declares compatible boards. Read the VibeTV device facts before installing it.",
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
    reason: `Theme does not support ${device.board}.`,
    readinessTitle: "Board not supported",
    readinessDetail: `${theme.title} does not list ${device.board} as a compatible VibeTV board.`,
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
      reason: "Device firmware must be read before install.",
      readinessTitle: "Firmware check required",
      readinessDetail:
        "This theme declares a minimum firmware version. Read the VibeTV firmware before installing it.",
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
  return value.trim().toLowerCase().replace(/[_\s]+/g, "-");
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
  const className = large
    ? "relative block aspect-square w-full overflow-hidden border border-[#747A60] bg-[#EEEEEE]"
    : "relative block size-24 overflow-hidden border border-[#747A60] bg-[#EEEEEE]";

  return (
    <span className={className}>
      {theme.imageUrl ? (
        <Image
          alt={theme.imageAlt || theme.title}
          className="object-cover"
          fill
          sizes={large ? "320px" : "(min-width: 1280px) 300px, 50vw"}
          src={theme.imageUrl}
        />
      ) : (
        <span className="grid h-full place-items-center bg-[#1B1B1B] text-center text-sm font-semibold text-[#EDEDED]">
          <Monitor size={large ? 36 : 24} aria-hidden />
        </span>
      )}
    </span>
  );
}
