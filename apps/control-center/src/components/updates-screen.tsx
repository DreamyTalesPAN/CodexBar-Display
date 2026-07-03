"use client";

import {
  Check,
  Copy,
  Download,
  Monitor,
  RefreshCw,
  Server,
  ShieldCheck,
  X,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { CompanionReleaseInfo } from "@/lib/companion-release";
import { hasFirmwareUpdate, type FirmwareUpdateInfo } from "@/lib/firmware";
import { ControlCenterButton } from "./control-center-button";
import {
  buildMacAppTerminalCommand,
  currentControlCenterOrigin,
} from "./mac-app-install-command";

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

export type MacAppUpdateStatus = {
  phase: "installing" | "complete" | "error";
  startedAt: string;
  finishedAt?: string;
  message?: string;
  progress?: number;
  logs: string[];
  result?: {
    version?: string;
  };
  error?: string;
};

export type UpdatesScreenProps = {
  companionStatus: UpdatesCompanionStatus;
  device: UpdatesDeviceInfo | null;
  companionVersion?: string;
  companionRelease?: CompanionReleaseInfo | null;
  macAppSelfUpdateEnabled?: boolean;
  firmwareUpdate?: FirmwareUpdateInfo | null;
  onCheckUpdates?: () => Promise<void> | void;
  onCreateReport?: () => void;
  onInstallMacAppUpdate?: (version?: string) => Promise<boolean> | boolean | void;
  onInstallUpdate?: () => Promise<boolean> | boolean | void;
  busyAction?: string | null;
  macAppUpdateStatus?: MacAppUpdateStatus | null;
  updateStatus?: FirmwareUpdateStatus | null;
};

export function UpdatesScreen({
  companionStatus,
  device,
  companionVersion,
  companionRelease = null,
  macAppSelfUpdateEnabled = false,
  firmwareUpdate,
  onCheckUpdates,
  onCreateReport,
  onInstallMacAppUpdate,
  onInstallUpdate,
  busyAction,
  macAppUpdateStatus,
  updateStatus,
}: UpdatesScreenProps) {
  const [macAppCommandCopied, setMacAppCommandCopied] = useState(false);
  const macAppTerminalCommand = useMemo(
    () => buildMacAppTerminalCommand(currentControlCenterOrigin()),
    [],
  );
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
  const macAppUpdateComplete = macAppUpdateStatus?.phase === "complete";
  const macAppUpdateAvailable = Boolean(
    companionRelease?.updateAvailable && !macAppUpdateComplete,
  );
  const manualMacAppUpdate = Boolean(
    companionRelease?.updateAvailable && !macAppSelfUpdateEnabled,
  );
  const anyUpdateAvailable = updateAvailable || macAppUpdateAvailable;
  const refreshing = busyAction === "firmware-check";
  const installingUpdate =
    busyAction === "firmware-update" || updateStatus?.phase === "installing";
  const installingMacAppUpdate =
    busyAction === "mac-app-update" ||
    macAppUpdateStatus?.phase === "installing";
  const installingAnyUpdate = installingUpdate || installingMacAppUpdate;
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
    updateStatus: macAppUpdateStatus,
  });
  const companionInstalled =
    companionStatus === "missing"
      ? "Not running"
      : companionVersion || "Unknown";
  const companionAvailable =
    macAppUpdateStatus?.phase === "complete" &&
    macAppUpdateStatus.result?.version
      ? macAppUpdateStatus.result.version
      : companionRelease?.latestVersion ||
        companionRelease?.release ||
        "Checking";
  const companionAction = companionInstallerAction({
    companionStatus,
    release: companionRelease,
  });
  const primaryCopyCommand = Boolean(
    companionStatus === "missing" || manualMacAppUpdate,
  );

  async function copyMacAppCommand() {
    await copyText(macAppTerminalCommand);
    setMacAppCommandCopied(true);
  }

  async function runPrimaryUpdate() {
    if (primaryCopyCommand) {
      await copyMacAppCommand();
      return;
    }

    if (!anyUpdateAvailable) {
      await onCheckUpdates?.();
      return;
    }

    if (macAppUpdateAvailable) {
      const macAppUpdated = await onInstallMacAppUpdate?.(
        companionRelease?.latestVersion,
      );
      if (macAppUpdated === false) {
        return;
      }
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
            <HeroIcon active={!anyUpdateAvailable}>
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
            commandCopied={macAppCommandCopied}
            copyCommand={primaryCopyCommand}
            copyLabel={companionActionLabel(companionAction)}
            disabled={
              installingAnyUpdate ||
              Boolean(busyAction && busyAction !== "firmware-check")
            }
            installingFirmware={installingUpdate}
            installingMacApp={installingMacAppUpdate}
            onClick={runPrimaryUpdate}
            updateAvailable={anyUpdateAvailable}
            updateReady={Boolean(
              primaryCopyCommand || anyUpdateAvailable || onCheckUpdates,
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

        {macAppUpdateStatus ? (
          <InlineMacAppUpdateProgress
            commandCopied={macAppCommandCopied}
            onCopyCommand={copyMacAppCommand}
            onRetry={() =>
              onInstallMacAppUpdate?.(companionRelease?.latestVersion)
            }
            status={macAppUpdateStatus}
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
  commandCopied,
  copyCommand,
  copyLabel,
  disabled,
  installingFirmware,
  installingMacApp,
  onClick,
  updateAvailable,
  updateReady,
}: {
  checking: boolean;
  commandCopied: boolean;
  copyCommand: boolean;
  copyLabel: string;
  disabled: boolean;
  installingFirmware: boolean;
  installingMacApp: boolean;
  onClick: () => void | Promise<void>;
  updateAvailable: boolean;
  updateReady: boolean;
}) {
  const installing = installingFirmware || installingMacApp;
  const label = installingMacApp
    ? "Updating Mac App"
    : installingFirmware
      ? "Updating VibeTV"
      : copyCommand
        ? commandCopied
          ? "Command copied"
          : copyLabel
        : updateAvailable
          ? "Update now"
          : checking
            ? "Checking updates"
            : "Check for updates";
  const icon = installing || checking ? (
    <RefreshCw className="animate-spin" size={20} aria-hidden />
  ) : copyCommand ? (
    <Copy size={20} aria-hidden />
  ) : updateAvailable ? (
    <Download size={20} aria-hidden />
  ) : (
    <RefreshCw size={20} aria-hidden />
  );

  return (
    <ControlCenterButton
      className="w-full sm:w-auto sm:min-w-[240px]"
      disabled={disabled || checking || !updateReady}
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

function InlineMacAppUpdateProgress({
  commandCopied,
  onCopyCommand,
  onRetry,
  status,
}: {
  commandCopied: boolean;
  onCopyCommand: () => void | Promise<void>;
  onRetry?: () => void;
  status: MacAppUpdateStatus;
}) {
  const failed = status.phase === "error";
  const complete = status.phase === "complete";
  const progress = clampUpdateProgress(
    failed || complete ? 100 : status.progress,
  );
  const title = failed
    ? "Mac App update failed"
    : complete
      ? "Mac App updated"
      : "Updating Mac App";
  const detail = failed
    ? status.error ||
      "Copy the update command and run it in Terminal, then try again."
    : complete
      ? status.result?.version
        ? `Mac App ${status.result.version} is installed.`
        : "Mac App is up to date."
      : status.message ||
        status.logs[status.logs.length - 1] ||
        "Preparing Mac App update.";
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
              icon={<Copy size={16} aria-hidden />}
              label={commandCopied ? "Command copied" : "Copy update command"}
              onClick={onCopyCommand}
              size="compact"
              variant="secondary"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function companionActionLabel(action: "install" | "repair" | "update"): string {
  if (action === "update") {
    return "Copy update command";
  }
  if (action === "repair") {
    return "Copy repair command";
  }
  return "Copy install command";
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
  updateStatus,
}: {
  macAppRunning: boolean;
  release: CompanionReleaseInfo | null;
  updateStatus?: MacAppUpdateStatus | null;
}): string {
  if (updateStatus?.phase === "installing") {
    return "Updating";
  }
  if (updateStatus?.phase === "complete") {
    return "Ready";
  }
  if (updateStatus?.phase === "error") {
    return "Needs attention";
  }
  if (macAppRunning) {
    if (release?.updateAvailable) {
      return "Update available";
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

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
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
