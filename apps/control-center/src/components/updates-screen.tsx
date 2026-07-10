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
import { useState, type ReactNode } from "react";
import type { CompanionReleaseInfo } from "@/lib/companion-release";
import { hasFirmwareUpdate, type FirmwareUpdateInfo } from "@/lib/firmware";
import { ControlCenterButton } from "./control-center-button";
import { ControlCenterStatusIcon } from "./control-center-status-icon";

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
  companionRelease?: CompanionReleaseInfo | null;
  firmwareUpdate?: FirmwareUpdateInfo | null;
  onCheckUpdates?: () => Promise<void> | void;
  onCreateReport?: () => void;
  onInstallUpdate?: () => Promise<boolean> | boolean | void;
  busyAction?: string | null;
  updateStatus?: FirmwareUpdateStatus | null;
};

export function UpdatesScreen({
  companionStatus,
  device,
  companionVersion,
  companionRelease = null,
  firmwareUpdate,
  onCheckUpdates,
  onCreateReport,
  onInstallUpdate,
  busyAction,
  updateStatus,
}: UpdatesScreenProps) {
  const [macAppDownloadStarted, setMacAppDownloadStarted] = useState(false);
  const installedFirmware =
    firmwareUpdate?.installedFirmware || device?.firmware || "Unknown";
  const canCheckFirmware = Boolean(device?.board && device?.firmware);
  const checking = Boolean(canCheckFirmware && !firmwareUpdate);
  const macAppRunning = companionStatus === "online";
  const checkingMacApp = Boolean(macAppRunning && !companionRelease);
  const checkingUpdates = checking || checkingMacApp;
  const latestFirmware =
    firmwareUpdate?.latestFirmware || (checking ? "Checking" : "Not available");
  const updateAvailable = hasFirmwareUpdate(firmwareUpdate);
  const macAppUpdateAvailable = Boolean(companionRelease?.updateAvailable);
  const macAppDownloadUrl = macAppUpdateAvailable
    ? companionRelease?.dmgDownloadUrl
    : undefined;
  const macAppDownloadReady = Boolean(macAppDownloadUrl);
  const anyUpdateAvailable = updateAvailable || macAppUpdateAvailable;
  const refreshing = busyAction === "firmware-check";
  const installingUpdate =
    busyAction === "firmware-update" || updateStatus?.phase === "installing";
  const installingAnyUpdate = installingUpdate;
  const creatingReport = busyAction === "diagnostics";
  const macAppCheckFailed =
    macAppRunning && companionRelease?.status === "check_failed";
  const checkFailed = firmwareUpdate?.status === "check_failed" || macAppCheckFailed;
  const title = checkingUpdates
    ? "Checking updates"
    : checkFailed
      ? "Update check failed"
      : anyUpdateAvailable
        ? "Update available"
        : "Up to date";
  const status = checking
    ? "Checking"
    : checkFailed
      ? "Check failed"
      : !canCheckFirmware && !firmwareUpdate
        ? "Not available"
        : updateAvailable
          ? "Update available"
          : "Up to date";
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

  async function runPrimaryUpdate() {
    if (macAppUpdateAvailable) {
      return;
    }

    if (!anyUpdateAvailable) {
      await onCheckUpdates?.();
      return;
    }

    if (updateAvailable) {
      await onInstallUpdate?.();
    }
  }

  return (
    <div className="mx-auto max-w-[1180px]">
      <section className="min-h-[330px] border-b border-[#747A60] py-10">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-5">
            <HeroIcon variant={anyUpdateAvailable ? "neutral" : "complete"}>
              {anyUpdateAvailable ? (
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
          <PrimaryUpdateAction
            checking={checkingUpdates || refreshing}
            disabled={
              installingAnyUpdate ||
              Boolean(busyAction && busyAction !== "firmware-check")
            }
            downloadUrl={macAppDownloadUrl}
            installingFirmware={installingUpdate}
            macAppUpdateAvailable={macAppUpdateAvailable}
            onDownloadStart={() => setMacAppDownloadStarted(true)}
            onClick={runPrimaryUpdate}
            updateAvailable={anyUpdateAvailable}
            updateReady={Boolean(
              macAppUpdateAvailable
                ? macAppDownloadReady
                : anyUpdateAvailable || onCheckUpdates,
            )}
          />
        </div>
      </section>

      <section className="border-b border-[#747A60] py-8">
        <h3 className="mb-6 text-base font-bold text-[#1B1B1B]">Mac App</h3>

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
          <FirmwareRow
            icon={<Check size={20} aria-hidden />}
            label="Status"
            value={companionReleaseStatus}
          />
        </dl>

        {macAppUpdateAvailable ? (
          <MacAppDmgUpdateNote
            downloadReady={macAppDownloadReady}
            downloadStarted={macAppDownloadStarted}
          />
        ) : null}
      </section>

      <section className="border-b border-[#747A60] py-8">
        <h3 className="mb-6 text-base font-bold text-[#1B1B1B]">
          Firmware update
        </h3>

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

function PrimaryUpdateAction({
  checking,
  disabled,
  downloadUrl,
  installingFirmware,
  macAppUpdateAvailable,
  onDownloadStart,
  onClick,
  updateAvailable,
  updateReady,
}: {
  checking: boolean;
  disabled: boolean;
  downloadUrl?: string;
  installingFirmware: boolean;
  macAppUpdateAvailable: boolean;
  onDownloadStart: () => void;
  onClick: () => void | Promise<void>;
  updateAvailable: boolean;
  updateReady: boolean;
}) {
  if (macAppUpdateAvailable && downloadUrl && !disabled && !checking) {
    return (
      <a
        className="vibetv-button vibetv-button--large vibetv-button--primary w-full sm:w-auto sm:min-w-[240px]"
        href={downloadUrl}
        onClick={onDownloadStart}
      >
        <Download size={20} aria-hidden />
        <span>Download Mac App update</span>
      </a>
    );
  }

  const label = installingFirmware
    ? "Updating VibeTV"
    : macAppUpdateAvailable
      ? downloadUrl
        ? "Download Mac App update"
        : "Mac App update not ready"
      : updateAvailable
        ? "Update now"
        : checking
          ? "Checking updates"
          : "Check for updates";
  const icon = installingFirmware || checking ? (
    <RefreshCw className="animate-spin" size={20} aria-hidden />
  ) : updateAvailable ? (
    <Download size={20} aria-hidden />
  ) : (
    <RefreshCw size={20} aria-hidden />
  );

  return (
    <ControlCenterButton
      className="w-full sm:w-auto sm:min-w-[240px]"
      disabled={
        disabled || checking || !updateReady || macAppUpdateAvailable
      }
      icon={icon}
      label={label}
      onClick={onClick}
      size="large"
      variant="primary"
    />
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
            <ControlCenterButton
              disabled={!onRetry}
              label="Try again"
              onClick={onRetry}
              size="compact"
              variant="secondary"
            />
            <ControlCenterButton
              label={creatingReport ? "Creating report" : "Create report"}
              disabled={!onCreateReport || creatingReport}
              onClick={onCreateReport}
              size="compact"
              variant="primary"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MacAppDmgUpdateNote({
  downloadReady,
  downloadStarted,
}: {
  downloadReady: boolean;
  downloadStarted: boolean;
}) {
  return (
    <div
      className="mt-6 border border-[#747A60] bg-[#F9F9F9] p-4 text-sm leading-6 text-[#444933]"
      role="status"
    >
      {downloadReady ? (
        <>
          <strong className="font-black text-[#1B1B1B]">
            {downloadStarted ? "Download started." : "Update with the DMG."}
          </strong>{" "}
          Quit VibeTV Control Center, open the downloaded DMG, drag VibeTV
          Control Center into Applications, and choose Replace. Then open the
          app from Applications again. This replaces the installed app instead
          of creating a second Terminal-installed copy.
        </>
      ) : (
        <>
          <strong className="font-black text-[#1B1B1B]">
            Mac App update is not ready yet.
          </strong>{" "}
          No installer will run. Check again after the signed Mac App download
          is available.
        </>
      )}
    </div>
  );
}

function companionReleaseLabel({
  macAppRunning,
  release,
}: {
  macAppRunning: boolean;
  release: CompanionReleaseInfo | null;
}): string {
  if (macAppRunning) {
    if (release?.updateAvailable) {
      return release.dmgDownloadUrl ? "Download ready" : "Update waiting";
    }
    if (release?.status === "check_failed") {
      return "Check failed";
    }
    return "Ready";
  }
  if (!release) {
    return "Checking";
  }
  if (release.status === "available") {
    return "Setup needed";
  }
  if (release.status === "missing_asset") {
    return "Setup needed";
  }
  return "Check failed";
}

function clampUpdateProgress(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 5;
  }
  return Math.max(5, Math.min(100, Math.round(value)));
}

function HeroIcon({
  children,
  variant = "neutral",
}: {
  children: ReactNode;
  variant?: "complete" | "neutral";
}) {
  return (
    <ControlCenterStatusIcon variant={variant}>
      {children}
    </ControlCenterStatusIcon>
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
