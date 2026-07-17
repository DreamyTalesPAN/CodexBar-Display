"use client";

import {
  ArrowUpFromLine,
  Check,
  CircleHelp,
  Download,
  Monitor,
  Wifi,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  availableMacAppDmgDownloadUrl,
  type CompanionReleaseInfo,
} from "@/lib/companion-release";
import { hasFirmwareUpdate, type FirmwareUpdateInfo } from "@/lib/firmware";
import {
  type CompanionStatus,
  type DeviceInfo,
  type ReadinessTone,
  type UsageSnapshot,
} from "./control-center-types";
import { ControlCenterStatusIcon } from "./control-center-status-icon";
import { LiveVibeTVPreview } from "./live-vibetv-preview";

type OverviewScreenProps = {
  companionVersion?: string;
  companionRelease?: CompanionReleaseInfo | null;
  companionStatus: CompanionStatus;
  device: DeviceInfo | null;
  firmwareUpdate?: FirmwareUpdateInfo | null;
  usage?: UsageSnapshot | null;
  requiresMacAppMigration?: boolean;
};

export function OverviewScreen({
  companionVersion,
  companionRelease,
  companionStatus,
  device,
  firmwareUpdate,
  usage,
  requiresMacAppMigration = false,
}: OverviewScreenProps) {
  const connected = deviceIsConnected(device);
  const displayReady = Boolean(device?.ready);
  const hero = buildHeroCopy(companionStatus, connected);
  const firmwareUpdateAvailable = hasFirmwareUpdate(firmwareUpdate);
  const macAppUpdateAvailable = Boolean(companionRelease?.updateAvailable);
  const macAppMigrationUrl = requiresMacAppMigration
    ? availableMacAppDmgDownloadUrl(companionRelease)
    : undefined;

  return (
    <div className="mx-auto max-w-[1180px]">
      <section className="grid min-h-[500px] items-center gap-8 border-b border-[#747A60] py-8 lg:grid-cols-[minmax(0,520px)_minmax(420px,1fr)] lg:py-9">
        <div className="min-w-0">
          <div className="flex items-start gap-5">
            <StatusBadge tone={hero.tone}>{hero.icon}</StatusBadge>
            <div className="min-w-0">
              <h2 className="max-w-[440px] text-[clamp(2.8rem,5vw,4.5rem)] font-black leading-[1.05] tracking-normal text-[#1B1B1B]">
                {hero.title}
              </h2>
            </div>
          </div>

          <dl className="mt-9 max-w-[420px]">
            <StatusRow
              badge={
                requiresMacAppMigration
                  ? "New App"
                  : macAppUpdateAvailable
                    ? "Update"
                    : undefined
              }
              icon={<Wifi size={18} aria-hidden />}
              label="Mac App"
              value={labelForCompanion(companionStatus, companionVersion)}
            />
            <StatusRow
              icon={<Monitor size={18} aria-hidden />}
              label="VibeTV"
              value={connected ? "Connected" : "Not connected"}
            />
            <StatusRow
              icon={<Monitor size={18} aria-hidden />}
              label="Display"
              detail={displayReady ? undefined : "Start using any AI provider."}
              value={displayReady ? "Live" : "Waiting for first image"}
            />
            <StatusRow
              badge={firmwareUpdateAvailable ? "Update" : undefined}
              icon={<ArrowUpFromLine size={18} aria-hidden />}
              label="VibeTV firmware"
              value={device?.firmware || "Waiting for VibeTV"}
            />
          </dl>
          {requiresMacAppMigration ? (
            <MacAppMigrationCard downloadUrl={macAppMigrationUrl} />
          ) : null}
        </div>

        <div className="flex justify-center lg:justify-end">
          <LiveVibeTVPreview device={device} usage={usage || null} />
        </div>
      </section>
    </div>
  );
}

function MacAppMigrationCard({ downloadUrl }: { downloadUrl?: string }) {
  const downloadReady = Boolean(downloadUrl);
  return (
    <section
      aria-labelledby="mac-app-migration-title"
      className="mt-7 border border-[#747A60] bg-[#F9F9F9] p-4"
    >
      <div className="flex items-start gap-3">
        <Download
          className="mt-0.5 shrink-0 text-[#506600]"
          size={20}
          aria-hidden
        />
        <div className="min-w-0">
          <h3
            className="text-base font-black text-[#1B1B1B]"
            id="mac-app-migration-title"
          >
            {downloadReady ? "Update available" : "Update not ready"}
          </h3>
        </div>
      </div>
      {downloadUrl ? (
        <div className="mt-4">
          <a
            className="vibetv-button vibetv-button--large vibetv-button--full vibetv-button--primary"
            href={downloadUrl}
          >
            <Download size={20} aria-hidden />
            <span>Update</span>
          </a>
        </div>
      ) : null}
    </section>
  );
}

function StatusBadge({
  children,
  tone,
}: {
  children: ReactNode;
  tone: ReadinessTone;
}) {
  return (
    <ControlCenterStatusIcon variant={tone === "ready" ? "complete" : "neutral"}>
      {children}
    </ControlCenterStatusIcon>
  );
}

function StatusRow({
  badge,
  detail,
  icon,
  label,
  value,
}: {
  badge?: string;
  detail?: string;
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="grid min-h-[50px] grid-cols-[28px_1fr_120px] items-start gap-3 border-b border-[#747A60] py-3 last:border-b-0">
      <div className="pt-0.5 text-[#506600]">{icon}</div>
      <dt className="font-medium text-[#1B1B1B]">{label}</dt>
      <dd className="min-w-0 text-[#1B1B1B]">
        <div className="flex flex-wrap items-center gap-2">
          <span>{value}</span>
          {badge ? (
            <span className="rounded-full bg-[#CCFF00] px-2 py-0.5 text-xs font-semibold text-[#1B1B1B]">
              {badge}
            </span>
          ) : null}
        </div>
        {detail ? <div className="mt-1 text-sm text-[#444933]">{detail}</div> : null}
      </dd>
    </div>
  );
}

function buildHeroCopy(
  companionStatus: CompanionStatus,
  connected: boolean,
) {
  if (connected) {
    return {
      title: "VibeTV is connected",
      tone: "ready" as ReadinessTone,
      icon: <Check size={38} aria-hidden />,
    };
  }
  return {
    title: companionStatus === "missing" ? "Setup needed" : "VibeTV status",
    tone: "attention" as ReadinessTone,
    icon: <CircleHelp size={36} aria-hidden />,
  };
}

function labelForCompanion(
  status: CompanionStatus,
  companionVersion?: string,
): string {
  if (status === "online") {
    return companionVersion ? `Online ${companionVersion}` : "Online";
  }
  if (status === "missing") {
    return "Needs install";
  }
  return "Waiting for Mac App";
}

function deviceIsConnected(device: DeviceInfo | null): boolean {
  return Boolean(device?.connected && (device.deviceId || device.target));
}
