"use client";

import {
  Check,
  Download,
  Monitor,
  RefreshCw,
  Server,
  ShieldCheck,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import type { CompanionReleaseInfo } from "@/lib/companion-release";
import { hasFirmwareUpdate, type FirmwareUpdateInfo } from "@/lib/firmware";
import {
  companionPackageLabel,
  hasCompleteMacPackages,
  usePreferredMacPackage,
  useCompanionRelease,
} from "./companion-installer-actions";

export type UpdatesCompanionStatus = "unknown" | "online" | "missing";

export type UpdatesDeviceInfo = {
  connected: boolean;
  board?: string;
  firmware?: string;
};

export type FirmwareUpdateStatus = {
  phase: "installing" | "complete" | "error";
  startedAt: string;
  finishedAt?: string;
  message?: string;
  progress?: number;
  logs: string[];
  result?: {
    firmware?: string;
    target?: string;
  };
  error?: string;
};

export type UpdatesScreenProps = {
  companionStatus: UpdatesCompanionStatus;
  device: UpdatesDeviceInfo | null;
  companionVersion?: string;
  firmwareUpdate?: FirmwareUpdateInfo | null;
  onCheckUpdates?: () => void;
  onCreateReport?: () => void;
  onInstallUpdate?: () => void;
  busyAction?: string | null;
  updateStatus?: FirmwareUpdateStatus | null;
};

export function UpdatesScreen({
  companionStatus,
  device,
  companionVersion,
  firmwareUpdate,
  onCheckUpdates,
  onCreateReport,
  onInstallUpdate,
  busyAction,
  updateStatus,
}: UpdatesScreenProps) {
  const {
    busy: companionCheckBusy,
    refresh: refreshCompanionRelease,
    release: companionRelease,
  } = useCompanionRelease(companionVersion);
  const installedFirmware =
    firmwareUpdate?.installedFirmware || device?.firmware || "Unknown";
  const latestFirmware = firmwareUpdate?.latestFirmware || "Checking";
  const updateAvailable = hasFirmwareUpdate(firmwareUpdate);
  const checking = Boolean(device?.firmware && !firmwareUpdate);
  const refreshing = busyAction === "firmware-check";
  const installingUpdate = busyAction === "firmware-update" ||
    updateStatus?.phase === "installing";
  const creatingReport = busyAction === "diagnostics";
  const checkFailed = firmwareUpdate?.status === "check_failed";
  const title = checking
    ? "Checking updates"
    : checkFailed
      ? "Update check failed"
      : updateAvailable
        ? "Update available"
        : "Up to date";
  const status = checking
    ? "Checking"
    : checkFailed
      ? "Check failed"
      : updateAvailable
        ? "Update available"
        : "Up to date";
  const macAppRunning = companionStatus === "online";
  const completeMacPackages = hasCompleteMacPackages(companionRelease);
  const showMacDownloadRow = !macAppRunning || completeMacPackages;
  const companionReleaseStatus = companionReleaseLabel({
    macAppRunning,
    release: companionRelease,
  });
  const companionInstalled =
    companionStatus === "missing"
      ? "Not running"
      : companionVersion || "Unknown";
  const companionAvailable =
    companionRelease?.latestVersion || companionRelease?.release || "Checking";
  const companionPackageStatus = macAppRunning && !completeMacPackages
    ? "Ready"
    : companionPackageLabel(companionRelease);
  const companionAction = companionInstallerAction({
    companionStatus,
    release: companionRelease,
  });
  const preferredPackage = usePreferredMacPackage();
  return (
    <div className="mx-auto max-w-[1180px]">
      <section className="min-h-[330px] border-b border-[#747A60] py-10">
        <div className="flex items-start gap-5">
          <HeroIcon active={!updateAvailable}>
            {updateAvailable ? (
              <RefreshCw size={36} aria-hidden />
            ) : (
              <Check size={38} aria-hidden />
            )}
          </HeroIcon>
          <div className="min-w-0">
            <h2 className="max-w-[560px] text-[clamp(3rem,5vw,5rem)] font-black leading-[1.05] tracking-normal text-[#1B1B1B]">
              {title}
            </h2>
          </div>
        </div>
      </section>

      <section className="border-b border-[#747A60] py-8">
        <h3 className="mb-6 text-base font-bold text-[#1B1B1B]">
          Mac App
        </h3>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
          <dl className="grid gap-0 border-y border-[#747A60]">
            <FirmwareRow
              icon={<Server size={20} aria-hidden />}
              label="Installed version"
              value={companionInstalled}
            />
            <FirmwareRow
              icon={<Download size={20} aria-hidden />}
              label="Latest version"
              value={companionAvailable}
            />
            {showMacDownloadRow ? (
              <FirmwareRow
                icon={<Download size={20} aria-hidden />}
                label="Mac App download"
                value={companionPackageStatus}
              />
            ) : null}
            <FirmwareRow
              icon={<Check size={20} aria-hidden />}
              label="Status"
              value={companionReleaseStatus}
            />
          </dl>

          <div className="flex items-start lg:justify-end">
            <CompanionUpdateAction
              action={companionAction}
              busy={companionCheckBusy}
              companionStatus={companionStatus}
              onCheckInstaller={refreshCompanionRelease}
              preferredPackage={preferredPackage}
              release={companionRelease}
            />
          </div>
        </div>
      </section>

      <section className="border-b border-[#747A60] py-8">
        <h3 className="mb-6 text-base font-bold text-[#1B1B1B]">
          Firmware update
        </h3>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
          <dl className="grid gap-0 border-y border-[#747A60]">
            <FirmwareRow
              icon={<Monitor size={20} aria-hidden />}
              label="Installed firmware"
              value={installedFirmware}
            />
            <FirmwareRow
              icon={<RefreshCw size={20} aria-hidden />}
              label="Available firmware"
              value={latestFirmware}
            />
            <FirmwareRow
              icon={<Check size={20} aria-hidden />}
              label="Status"
              value={status}
            />
          </dl>

          <div className="flex items-start lg:justify-end">
            <FirmwareUpdateAction
              checking={checking}
              installing={installingUpdate}
              onCheckUpdates={onCheckUpdates}
              onInstallUpdate={onInstallUpdate}
              refreshing={refreshing}
              updateAvailable={updateAvailable}
              updateReady={Boolean(device?.firmware)}
            />
          </div>
        </div>

        {updateStatus ? (
          <InlineUpdateProgress
            creatingReport={creatingReport}
            onCreateReport={onCreateReport}
            onRetry={onInstallUpdate}
            status={updateStatus}
          />
        ) : null}
      </section>
    </div>
  );
}

function FirmwareUpdateAction({
  checking,
  installing,
  onCheckUpdates,
  onInstallUpdate,
  refreshing,
  updateAvailable,
  updateReady,
}: {
  checking: boolean;
  installing: boolean;
  onCheckUpdates?: () => void;
  onInstallUpdate?: () => void;
  refreshing: boolean;
  updateAvailable: boolean;
  updateReady: boolean;
}) {
  if (updateAvailable) {
    return (
      <button
        className="inline-flex h-12 min-w-[190px] items-center justify-center gap-2 border border-[#1B1B1B] bg-[#1B1B1B] px-4 text-sm font-bold text-[#EDEDED] transition hover:bg-[#CCFF00] hover:text-[#1B1B1B] disabled:cursor-not-allowed disabled:bg-[#EEEEEE] disabled:text-[#444933] disabled:opacity-80"
        disabled={installing || !updateReady}
        onClick={onInstallUpdate}
        type="button"
      >
        {installing ? (
          <RefreshCw className="animate-spin" size={18} aria-hidden />
        ) : (
          <Download size={18} aria-hidden />
        )}
        <span>{installing ? "Updating VibeTV" : "Update now"}</span>
      </button>
    );
  }

  return (
    <button
      className="inline-flex h-12 min-w-[190px] items-center justify-center gap-2 border border-[#747A60] bg-[#CCFF00] px-4 text-sm font-semibold text-[#1B1B1B] transition hover:bg-[#ABD600] disabled:bg-[#F9F9F9] disabled:text-[#444933] disabled:opacity-80"
      disabled={checking || refreshing || !updateReady}
      onClick={onCheckUpdates}
      type="button"
    >
      {checking || refreshing ? (
        <RefreshCw className="animate-spin" size={18} aria-hidden />
      ) : (
        <RefreshCw size={18} aria-hidden />
      )}
      <span>
        {checking || refreshing ? "Checking updates" : "Check for updates"}
      </span>
    </button>
  );
}

function InlineUpdateProgress({
  creatingReport,
  onCreateReport,
  onRetry,
  status,
}: {
  creatingReport: boolean;
  onCreateReport?: () => void;
  onRetry?: () => void;
  status: FirmwareUpdateStatus;
}) {
  const failed = status.phase === "error";
  const complete = status.phase === "complete";
  const progress = clampUpdateProgress(
    failed || complete ? 100 : status.progress,
  );
  const title = failed
    ? "Update failed"
    : complete
      ? "Update complete"
      : "Updating VibeTV";
  const detail = failed
    ? status.error || "Update was not installed. Try again."
    : complete
      ? status.result?.firmware
        ? `Firmware ${status.result.firmware} is installed.`
        : "VibeTV is up to date."
      : status.message ||
        status.logs[status.logs.length - 1] ||
        "Preparing VibeTV update.";
  const previousSteps = failed || complete ? [] : status.logs.slice(-4, -1);

  return (
    <div className="mt-6" role="status" aria-live="polite">
      <div className="h-2 overflow-hidden border border-[#747A60] bg-[#F9F9F9]">
        <div
          className={`h-full bg-[#CCFF00] transition-[width] duration-300 ${
            failed || complete ? "" : "animate-pulse"
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mt-3 flex flex-col gap-3 border border-[#747A60] bg-[#F9F9F9] p-3 sm:flex-row sm:items-center sm:justify-between">
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
        {failed ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              className="h-10 min-w-[120px] border border-[#747A60] bg-[#F9F9F9] px-3 text-sm font-semibold text-[#1B1B1B] hover:bg-[#CCFF00] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!onRetry}
              onClick={onRetry}
              type="button"
            >
              Try again
            </button>
            <button
              className="h-10 min-w-[120px] border border-[#1B1B1B] bg-[#1B1B1B] px-3 text-sm font-semibold text-[#EDEDED] hover:bg-[#CCFF00] hover:text-[#1B1B1B] disabled:cursor-not-allowed disabled:bg-[#EEEEEE] disabled:text-[#444933]"
              disabled={!onCreateReport || creatingReport}
              onClick={onCreateReport}
              type="button"
            >
              {creatingReport ? "Creating report" : "Create report"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CompanionUpdateAction({
  action,
  busy,
  companionStatus,
  onCheckInstaller,
  preferredPackage,
  release,
}: {
  action: "install" | "repair" | "update";
  busy: boolean;
  companionStatus: UpdatesCompanionStatus;
  onCheckInstaller: () => void;
  preferredPackage: "macosArm64" | "macosAmd64" | null;
  release: CompanionReleaseInfo | null;
}) {
  const packageUrl = preferredPackage
    ? release?.packageDownloadUrls?.[preferredPackage]
    : release?.packageDownloadUrls?.macosArm64 ||
      release?.packageDownloadUrls?.macosAmd64;

  if (
    packageUrl &&
    (companionStatus === "missing" || release?.updateAvailable)
  ) {
    return (
      <a
        className="inline-flex h-12 min-w-[220px] items-center justify-center gap-2 border border-[#1B1B1B] bg-[#1B1B1B] px-5 text-sm font-bold text-[#EDEDED] transition hover:bg-[#CCFF00] hover:text-[#1B1B1B]"
        href={packageUrl}
      >
        <Download size={18} aria-hidden />
        <span>{companionActionLabel(action)}</span>
      </a>
    );
  }

  if (companionStatus === "online") {
    return null;
  }

  if (!release) {
    return <ActionStatus label="Checking" busy />;
  }

  if (release.status === "check_failed") {
    return (
      <button
        className="inline-flex h-12 min-w-[220px] items-center justify-center gap-2 border border-[#747A60] bg-[#F9F9F9] px-5 text-sm font-semibold text-[#1B1B1B] transition hover:bg-[#EEEEEE] disabled:cursor-not-allowed disabled:opacity-50"
        disabled={busy}
        onClick={onCheckInstaller}
        type="button"
      >
        <RefreshCw
          className={busy ? "animate-spin" : undefined}
          size={18}
          aria-hidden
        />
        <span>{busy ? "Checking" : "Try again"}</span>
      </button>
    );
  }

  if (!hasCompleteMacPackages(release)) {
    return <ActionStatus label="Not ready yet" />;
  }

  return (
    <ActionStatus label="Ready" />
  );
}

function companionActionLabel(action: "install" | "repair" | "update"): string {
  if (action === "update") {
    return "Update Mac App";
  }
  if (action === "repair") {
    return "Repair Mac App";
  }
  return "Install Mac App";
}

function companionInstallerAction({
  companionStatus,
  release,
}: {
  companionStatus: UpdatesCompanionStatus;
  release: CompanionReleaseInfo | null;
}): "install" | "repair" | "update" {
  if (companionStatus === "missing") {
    return "install";
  }
  if (release?.updateAvailable) {
    return "update";
  }
  return "repair";
}

function companionReleaseLabel({
  macAppRunning,
  release,
}: {
  macAppRunning: boolean;
  release: CompanionReleaseInfo | null;
}): string {
  if (macAppRunning) {
    if (release?.updateAvailable && hasCompleteMacPackages(release)) {
      return "Update available";
    }
    return "Ready";
  }
  if (!release) {
    return "Checking";
  }
  if (release.status === "available") {
    if (!hasCompleteMacPackages(release)) {
      return "Not ready yet";
    }
    return release.updateAvailable ? "Update available" : "Installer available";
  }
  if (release.status === "missing_asset") {
    return "Not ready yet";
  }
  return "Check failed";
}

function ActionStatus({ busy, label }: { busy?: boolean; label: string }) {
  return (
    <div className="inline-flex h-12 min-w-[220px] items-center justify-center gap-2 border border-[#747A60] bg-[#F9F9F9] px-5 text-sm font-semibold text-[#444933]">
      {busy ? <RefreshCw className="animate-spin" size={18} aria-hidden /> : null}
      <span>{label}</span>
    </div>
  );
}

function clampUpdateProgress(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 5;
  }
  return Math.max(5, Math.min(100, Math.round(value)));
}

function HeroIcon({
  active,
  children,
}: {
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`grid size-16 shrink-0 place-items-center rounded-full border border-[#747A60] text-[#1B1B1B] ${
        active ? "bg-[#CCFF00]" : "bg-[#EEEEEE]"
      }`}
    >
      {children}
    </div>
  );
}

function FirmwareRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="grid min-h-[64px] grid-cols-[32px_minmax(0,1fr)_180px] items-center gap-4 border-b border-[#747A60] py-4 last:border-b-0">
      <div className="text-[#506600]">{icon}</div>
      <dt className="font-bold text-[#1B1B1B]">{label}</dt>
      <dd className="text-right text-[#1B1B1B]">{value}</dd>
    </div>
  );
}
