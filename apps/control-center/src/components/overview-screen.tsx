"use client";

import {
  ArrowUpFromLine,
  Check,
  CircleHelp,
  Download,
  Monitor,
  RefreshCw,
  SlidersHorizontal,
  Wifi,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  availableMacAppDmgDownloadUrl,
  type CompanionReleaseInfo,
} from "@/lib/companion-release";
import { hasFirmwareUpdate, type FirmwareUpdateInfo } from "@/lib/firmware";
import {
  deviceImageIsStuck,
  type CompanionStatus,
  type DeviceInfo,
  type DeviceState,
  type ReadinessTone,
  type UsageSnapshot,
} from "./control-center-types";
import { ControlCenterStatusIcon } from "./control-center-status-icon";
import { LiveVibeTVPreview } from "./live-vibetv-preview";

type OverviewScreenProps = {
  companionVersion?: string;
  companionRelease?: CompanionReleaseInfo | null;
  companionStatus: CompanionStatus;
  deviceState: DeviceState;
  device: DeviceInfo | null;
  firmwareUpdate?: FirmwareUpdateInfo | null;
  usage?: UsageSnapshot | null;
  busyAction?: string | null;
  onReloadImage?: () => void;
  requiresMacAppMigration?: boolean;
};

export function OverviewScreen({
  busyAction,
  companionVersion,
  companionRelease,
  companionStatus,
  deviceState,
  device,
  firmwareUpdate,
  usage,
  onReloadImage,
  requiresMacAppMigration = false,
}: OverviewScreenProps) {
  const imageStuck = deviceImageIsStuck(device);
  const reloadingImage = busyAction === "reload-display";
  const ready = Boolean(device?.ready && !imageStuck);
  const healthDetail = deviceHealthDetail(device);
  const hero = buildHeroCopy({
    companionStatus,
    ready,
    reachable: Boolean(device?.connected),
    imageStuck,
    reloadingImage,
  });
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
              detail={imageStuck ? imageStuckDetail(device) : healthDetail}
              value={labelForDevice(deviceState, device, reloadingImage)}
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
          {imageStuck && onReloadImage ? (
            <div className="mt-7">
              <button
                className="inline-flex min-h-11 items-center justify-center gap-2 border border-[#747A60] bg-[#CCFF00] px-5 text-sm font-bold text-[#1B1B1B] transition hover:bg-[#ABD600] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={reloadingImage}
                onClick={onReloadImage}
                type="button"
              >
                <RefreshCw
                  className={reloadingImage ? "animate-spin" : undefined}
                  size={18}
                  aria-hidden
                />
                <span>{reloadingImage ? "Reloading image" : "Reload image"}</span>
              </button>
            </div>
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

function buildHeroCopy({
  companionStatus,
  ready,
  reachable,
  imageStuck,
  reloadingImage,
}: {
  companionStatus: CompanionStatus;
  ready: boolean;
  reachable: boolean;
  imageStuck: boolean;
  reloadingImage: boolean;
}) {
  if (reloadingImage) {
    return {
      title: "VibeTV is updating image",
      tone: "attention" as ReadinessTone,
      icon: <RefreshCw className="animate-spin" size={34} aria-hidden />,
    };
  }
  if (imageStuck) {
    return {
      title: "Image is stuck",
      tone: "attention" as ReadinessTone,
      icon: <RefreshCw size={34} aria-hidden />,
    };
  }
  if (ready) {
    return {
      title: "VibeTV is connected",
      tone: "ready" as ReadinessTone,
      icon: <Check size={38} aria-hidden />,
    };
  }
  if (reachable) {
    return {
      title: "VibeTV screen is not ready",
      tone: "attention" as ReadinessTone,
      icon: <SlidersHorizontal size={34} aria-hidden />,
    };
  }
  return {
    title: companionStatus === "missing" ? "Setup needed" : "VibeTV status",
    tone: "attention" as ReadinessTone,
    icon:
      companionStatus === "missing" ? (
        <CircleHelp size={36} aria-hidden />
      ) : (
        <SlidersHorizontal size={34} aria-hidden />
      ),
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

function labelForDevice(
  state: DeviceState,
  device: DeviceInfo | null,
  reloadingImage: boolean,
): string {
  if (reloadingImage) {
    return "Reloading image";
  }
  if (deviceImageIsStuck(device)) {
    return "Image is stuck";
  }
  if (device?.connectionState === "reconnecting") {
    return "Reconnecting…";
  }
  if (device?.ready) {
    return "Connected";
  }
  if (device?.connected) {
    return "Found";
  }
  if (state === "offline") {
    return "Offline";
  }
  return "Waiting for device";
}

function imageStuckDetail(device: DeviceInfo | null): string {
  const error = device?.display?.themeSpec?.renderError?.trim();
  if (error === "low_heap_full_render") {
    return "The connection works. VibeTV is freeing memory and redrawing the image.";
  }
  return "The connection works, but VibeTV could not redraw the current screen.";
}

function deviceHealthDetail(device: DeviceInfo | null): string | undefined {
  const resetReason = device?.health?.resetReason?.trim();
  if (resetReason && resetReason.toLowerCase() === "exception") {
    return "VibeTV restarted after a firmware exception. If this keeps happening, reconnect power and run setup again.";
  }
  if (device?.connectionState === "reconnecting") {
    return "VibeTV is temporarily unavailable. The Mac App is reconnecting automatically.";
  }
  if (device?.connected && device.health?.error) {
    return "VibeTV is reachable, but health details are temporarily unavailable.";
  }
  if (device?.connected && !device.ready) {
    return device.stream?.running && !device.stream.healthy
      ? "VibeTV is reachable, but the Mac App has not delivered the first image yet."
      : "VibeTV is reachable, but the first image has not appeared yet.";
  }
  return undefined;
}
