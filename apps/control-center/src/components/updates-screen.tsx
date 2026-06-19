"use client";

import { Check, Download, Monitor, RefreshCw, Server } from "lucide-react";
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

export type UpdatesScreenProps = {
  companionStatus: UpdatesCompanionStatus;
  device: UpdatesDeviceInfo | null;
  companionVersion?: string;
  firmwareUpdate?: FirmwareUpdateInfo | null;
  onCheckUpdates?: () => void;
  busyAction?: string | null;
};

export function UpdatesScreen({
  companionStatus,
  device,
  companionVersion,
  firmwareUpdate,
  onCheckUpdates,
  busyAction,
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
  const companionReleaseStatus = companionReleaseLabel(companionRelease);
  const companionInstalled =
    companionStatus === "missing"
      ? "Not running"
      : companionVersion || "Unknown";
  const companionAvailable =
    companionRelease?.latestVersion || companionRelease?.release || "Checking";
  const companionPackageStatus = companionPackageLabel(companionRelease);
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
          Companion app
        </h3>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
          <dl className="grid gap-0 border-y border-[#747A60]">
            <FirmwareRow
              icon={<Server size={20} aria-hidden />}
              label="Installed Companion"
              value={companionInstalled}
            />
            <FirmwareRow
              icon={<Download size={20} aria-hidden />}
              label="Release installer"
              value={companionAvailable}
            />
            <FirmwareRow
              icon={<Download size={20} aria-hidden />}
              label="Mac package"
              value={companionPackageStatus}
            />
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
            <button
              className="inline-flex h-12 min-w-[190px] items-center justify-center gap-2 border border-[#747A60] bg-[#CCFF00] px-4 text-sm font-semibold text-[#1B1B1B] transition hover:bg-[#ABD600] disabled:bg-[#F9F9F9] disabled:text-[#444933] disabled:opacity-80"
              disabled={checking || refreshing || !device?.firmware}
              onClick={onCheckUpdates}
              type="button"
            >
              {checking || refreshing ? (
                <RefreshCw className="animate-spin" size={18} />
              ) : (
                <RefreshCw size={18} aria-hidden />
              )}
              <span>
                {checking || refreshing ? "Checking updates" : "Check for updates"}
              </span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function CompanionUpdateAction({
  action,
  busy,
  onCheckInstaller,
  preferredPackage,
  release,
}: {
  action: "install" | "repair" | "update";
  busy: boolean;
  onCheckInstaller: () => void;
  preferredPackage: "macosArm64" | "macosAmd64" | null;
  release: CompanionReleaseInfo | null;
}) {
  const packageUrl = preferredPackage
    ? release?.packageDownloadUrls?.[preferredPackage]
    : release?.packageDownloadUrls?.macosArm64 ||
      release?.packageDownloadUrls?.macosAmd64;

  if (packageUrl) {
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

  return (
    <button
      className="inline-flex h-12 min-w-[220px] items-center justify-center gap-2 border border-[#1B1B1B] bg-[#1B1B1B] px-5 text-sm font-bold text-[#EDEDED] transition hover:bg-[#CCFF00] hover:text-[#1B1B1B] disabled:cursor-not-allowed disabled:border-[#747A60] disabled:bg-[#EEEEEE] disabled:text-[#444933]"
      disabled={busy || !release}
      onClick={onCheckInstaller}
      type="button"
    >
      <RefreshCw
        className={busy || !release ? "animate-spin" : undefined}
        size={18}
        aria-hidden
      />
      <span>{busy || !release ? "Checking" : "Check again"}</span>
    </button>
  );
}

function companionActionLabel(action: "install" | "repair" | "update"): string {
  if (action === "update") {
    return "Update Companion";
  }
  if (action === "repair") {
    return "Repair Companion";
  }
  return "Install Companion";
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

function companionReleaseLabel(release: CompanionReleaseInfo | null): string {
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
