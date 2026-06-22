"use client";

import {
  ArrowUpFromLine,
  Check,
  CircleHelp,
  Monitor,
  Play,
  SlidersHorizontal,
  Wifi,
} from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";
import { hasFirmwareUpdate, type FirmwareUpdateInfo } from "@/lib/firmware";
import {
  CompanionPrimaryAction,
  useCompanionRelease,
} from "./companion-installer-actions";
import type {
  ApiError,
  CompanionStatus,
  DeviceInfo,
  DeviceState,
  ReadinessTone,
} from "./control-center-types";
import { DeviceTargetForm } from "./device-target-form";

type OverviewScreenProps = {
  companionStatus: CompanionStatus;
  deviceState: DeviceState;
  device: DeviceInfo | null;
  busyAction?: string | null;
  lastError?: ApiError | null;
  firmwareUpdate?: FirmwareUpdateInfo | null;
  deviceTarget: string;
  onCheckCompanion?: () => void;
  onConnectDevice?: (targetOverride?: string) => void;
  onDeviceTargetChange?: (target: string) => void;
};

export function OverviewScreen({
  companionStatus,
  deviceState,
  device,
  busyAction,
  lastError,
  firmwareUpdate,
  deviceTarget,
  onCheckCompanion,
  onConnectDevice,
  onDeviceTargetChange,
}: OverviewScreenProps) {
  const connected = Boolean(device?.connected);
  const paired = Boolean(device?.paired || deviceState === "paired");
  const companionMissing = companionStatus === "missing";
  const {
    busy: companionReleaseBusy,
    refresh: refreshCompanionRelease,
    release: companionRelease,
  } = useCompanionRelease(undefined, { enabled: companionMissing });
  const hero = buildHeroCopy({ companionStatus, connected, lastError });
  const setup = buildSetupState({
    companionStatus,
    connected,
    paired,
    deviceState,
    lastError,
  });
  const localActionBusy = Boolean(busyAction);
  const firmwareUpdateAvailable = hasFirmwareUpdate(firmwareUpdate);
  const showTargetControl = companionStatus === "online" && !connected;

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

      {setup ? (
        <section className="border-b border-[#747A60] py-6">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="flex min-w-0 gap-4">
              <div className="grid size-11 shrink-0 place-items-center rounded-full bg-[#1B1B1B] text-[#CCFF00]">
                {setup.icon}
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-[#1B1B1B]">
                  {setup.title}
                </h3>
                {setup.detail ? (
                  <p className="mt-1 max-w-[720px] text-sm leading-6 text-[#444933]">
                    {setup.detail}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex md:justify-end">
              {companionMissing ? (
                <CompanionPrimaryAction
                  busy={companionReleaseBusy}
                  onRetry={refreshCompanionRelease}
                  release={companionRelease}
                />
              ) : null}
              {setup.action === "check" ? (
                <PrimarySetupButton
                  busy={busyAction === "status"}
                  busyLabel="Checking"
                  disabled={localActionBusy && busyAction !== "status"}
                  icon={<Wifi size={18} aria-hidden />}
                  label="Start setup"
                  onClick={onCheckCompanion}
                />
              ) : null}
              {setup.action === "connect" ? (
                <PrimarySetupButton
                  busy={busyAction === "connect"}
                  busyLabel="Connecting"
                  disabled={localActionBusy && busyAction !== "connect"}
                  icon={<Monitor size={18} aria-hidden />}
                  label="Connect VibeTV"
                  onClick={() => onConnectDevice?.()}
                />
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {showTargetControl ? (
        <section className="border-b border-[#747A60] py-6">
          <DeviceTargetForm
            busy={busyAction === "connect"}
            disabled={localActionBusy}
            buttonLabel="Connect VibeTV"
            id="overview-device-target"
            lastError={lastError}
            onChange={onDeviceTargetChange}
            onSubmit={onConnectDevice}
            searchingLabel="Connecting"
            value={deviceTarget}
          />
        </section>
      ) : null}
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
  lastError,
}: {
  companionStatus: CompanionStatus;
  connected: boolean;
  lastError?: ApiError | null;
}) {
  if (companionStatus === "missing") {
    return {
      title: "Install Mac App",
      tone: "attention" as ReadinessTone,
      icon: <CircleHelp size={36} aria-hidden />,
      detail: lastError?.nextAction,
    };
  }
  if (connected) {
    return {
      title: "VibeTV is connected",
      tone: "ready" as ReadinessTone,
      icon: <Check size={38} aria-hidden />,
    };
  }
  return {
    title: "Connect VibeTV",
    tone: "attention" as ReadinessTone,
    icon: <SlidersHorizontal size={34} aria-hidden />,
  };
}

function buildSetupState({
  companionStatus,
  connected,
  paired,
  deviceState,
  lastError,
}: {
  companionStatus: CompanionStatus;
  connected: boolean;
  paired: boolean;
  deviceState: DeviceState;
  lastError?: ApiError | null;
}): {
  action?: "check" | "connect";
  detail: string;
  icon: ReactNode;
  title: string;
} | null {
  if (companionStatus === "missing") {
    return {
      title: "Install Mac App first",
      detail: "",
      icon: <Play size={22} aria-hidden />,
    };
  }
  if (companionStatus !== "online") {
    return {
      title: "Start setup",
      detail: "We will check this Mac first, then show the next step.",
      icon: <Wifi size={22} aria-hidden />,
      action: "check",
    };
  }
  if (connected && !paired) {
    return {
      title: "Connect VibeTV",
      detail: "Pair this VibeTV once so this Mac can manage it.",
      icon: <Monitor size={22} aria-hidden />,
      action: "connect",
    };
  }
  if (!connected && deviceState === "offline") {
    return {
      title: "Connect VibeTV",
      detail:
        lastError?.nextAction ||
        "Keep VibeTV powered on and connected to the same WiFi.",
      icon: <Monitor size={22} aria-hidden />,
    };
  }
  if (connected) {
    return null;
  }
  return {
    title: "Connect VibeTV",
    detail: "Keep VibeTV powered on and connected to the same WiFi.",
    icon: <Wifi size={22} aria-hidden />,
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

function PrimarySetupButton({
  busy,
  busyLabel,
  disabled,
  icon,
  label,
  onClick,
}: {
  busy?: boolean;
  busyLabel: string;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      className="inline-flex h-12 min-w-[220px] items-center justify-center gap-2 border border-[#1B1B1B] bg-[#1B1B1B] px-5 text-sm font-bold text-[#EDEDED] transition hover:bg-[#CCFF00] hover:text-[#1B1B1B] disabled:cursor-not-allowed disabled:border-[#747A60] disabled:bg-[#EEEEEE] disabled:text-[#444933]"
      disabled={disabled || busy}
      onClick={onClick}
      type="button"
    >
      {icon}
      <span>{busy ? busyLabel : label}</span>
    </button>
  );
}
