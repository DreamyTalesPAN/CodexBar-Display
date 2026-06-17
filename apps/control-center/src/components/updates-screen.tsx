"use client";

import { Check, Monitor, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

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
  onCheckBridge?: () => void;
  busyAction?: string | null;
};

const LATEST_FIRMWARE_VERSION = "1.0.34";

export function UpdatesScreen({
  device,
  onCheckBridge,
  busyAction,
}: UpdatesScreenProps) {
  const installedFirmware = device?.firmware || LATEST_FIRMWARE_VERSION;
  const updateAvailable = installedFirmware !== LATEST_FIRMWARE_VERSION;

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
              {updateAvailable ? "Update available" : "Up to date"}
            </h2>
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
              value={LATEST_FIRMWARE_VERSION}
            />
            <FirmwareRow
              icon={<Check size={20} aria-hidden />}
              label="Status"
              value={updateAvailable ? "Update available" : "Up to date"}
            />
          </dl>

          <div className="flex items-start lg:justify-end">
            <button
              className="inline-flex h-12 min-w-[190px] items-center justify-center gap-2 border border-[#747A60] bg-[#CCFF00] px-4 text-sm font-semibold text-[#1B1B1B] transition hover:bg-[#ABD600] disabled:bg-[#F9F9F9] disabled:text-[#444933] disabled:opacity-80"
              disabled={!updateAvailable || busyAction === "status"}
              onClick={onCheckBridge}
              type="button"
            >
              {busyAction === "status" ? (
                <RefreshCw className="animate-spin" size={18} />
              ) : (
                <RefreshCw size={18} aria-hidden />
              )}
              <span>
                {updateAvailable
                  ? "Update firmware"
                  : "Firmware up to date"}
              </span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
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
