"use client";

import {
  ArrowUpFromLine,
  Check,
  CircleHelp,
  Monitor,
  SlidersHorizontal,
  Wifi,
} from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";
import { hasFirmwareUpdate, type FirmwareUpdateInfo } from "@/lib/firmware";
import type {
  CompanionStatus,
  DeviceInfo,
  DeviceState,
  ReadinessTone,
} from "./control-center-types";

type OverviewScreenProps = {
  companionStatus: CompanionStatus;
  deviceState: DeviceState;
  device: DeviceInfo | null;
  firmwareUpdate?: FirmwareUpdateInfo | null;
};

export function OverviewScreen({
  companionStatus,
  deviceState,
  device,
  firmwareUpdate,
}: OverviewScreenProps) {
  const connected = Boolean(device?.connected);
  const hero = buildHeroCopy({ companionStatus, connected });
  const firmwareUpdateAvailable = hasFirmwareUpdate(firmwareUpdate);

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
              icon={<Wifi size={18} aria-hidden />}
              label="Mac App"
              value={labelForCompanion(companionStatus)}
            />
            <StatusRow
              icon={<Monitor size={18} aria-hidden />}
              label="VibeTV"
              value={labelForDevice(deviceState, device)}
            />
            <StatusRow
              badge={firmwareUpdateAvailable ? "Update" : undefined}
              icon={<ArrowUpFromLine size={18} aria-hidden />}
              label="Firmware"
              value={device?.firmware || "Waiting for VibeTV"}
            />
          </dl>
        </div>

        <div className="flex justify-center lg:justify-end">
          <Image
            alt="VibeTV device showing the current usage theme"
            className="h-auto w-full max-w-[520px]"
            height={510}
            priority
            src="/images/vibetv-device-overview.png"
            width={570}
          />
        </div>
      </section>
    </div>
  );
}

function StatusBadge({
  children,
  tone,
}: {
  children: ReactNode;
  tone: ReadinessTone;
}) {
  const fill = tone === "ready" ? "bg-[#CCFF00]" : "bg-[#EEEEEE]";
  return (
    <div
      className={`grid size-16 shrink-0 place-items-center rounded-full border border-[#747A60] text-[#1B1B1B] ${fill}`}
    >
      {children}
    </div>
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
  connected,
}: {
  companionStatus: CompanionStatus;
  connected: boolean;
}) {
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
    icon:
      companionStatus === "missing" ? (
        <CircleHelp size={36} aria-hidden />
      ) : (
        <SlidersHorizontal size={34} aria-hidden />
      ),
  };
}

function labelForCompanion(status: CompanionStatus): string {
  if (status === "online") {
    return "Online";
  }
  if (status === "missing") {
    return "Needs install";
  }
  return "Waiting for Mac App";
}

function labelForDevice(state: DeviceState, device: DeviceInfo | null): string {
  if (device?.connected) {
    return state === "paired" || device.paired ? "Connected" : "Found";
  }
  if (state === "offline") {
    return "Offline";
  }
  return "Waiting for device";
}
