"use client";

import {
  Check,
  Lock,
  PlugZap,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Wifi,
} from "lucide-react";
import type { ReactNode } from "react";

export type SettingsCompanionStatus = "unknown" | "online" | "missing";
export type SettingsDeviceState =
  | "unknown"
  | "online"
  | "offline"
  | "paired";

export type SettingsApiError = {
  code: string;
  message: string;
  nextAction: string;
};

export type SettingsDeviceInfo = {
  target?: string;
  connected: boolean;
  paired?: boolean;
  board?: string;
  firmware?: string;
  capabilities?: {
    display?: {
      brightness?: {
        supported?: boolean;
        minPercent?: number;
        maxPercent?: number;
      };
    };
    theme?: {
      supportsThemeSpecV1?: boolean;
      maxThemeGifBytes?: number;
    };
    transport?: {
      active?: string;
    };
  };
};

export type SettingsScreenProps = {
  companionStatus: SettingsCompanionStatus;
  deviceState: SettingsDeviceState;
  device: SettingsDeviceInfo | null;
  brightness: number | null;
  themeInstallEnabled: boolean;
  busyAction: string | null;
  lastError?: SettingsApiError | null;
  companionUrl?: string;
  onCheckBridge: () => void;
  onDiscoverDevice: () => void;
  onPairDevice: () => void;
  onBrightnessChange: (value: number) => void;
  onSaveBrightness: (value: number) => void;
};

export function SettingsScreen({
  companionStatus,
  deviceState,
  device,
  brightness,
  themeInstallEnabled,
  busyAction,
  companionUrl = "127.0.0.1:47832",
  onCheckBridge,
  onDiscoverDevice,
  onPairDevice,
  onBrightnessChange,
  onSaveBrightness,
}: SettingsScreenProps) {
  const brightnessSupport =
    device?.capabilities?.display?.brightness?.supported ?? true;
  const minBrightness =
    device?.capabilities?.display?.brightness?.minPercent ?? 10;
  const maxBrightness =
    device?.capabilities?.display?.brightness?.maxPercent ?? 100;
  const currentBrightness = brightness ?? minBrightness;
  const themeSpecReady = Boolean(
    device?.capabilities?.theme?.supportsThemeSpecV1,
  );

  return (
    <div className="mx-auto max-w-[1180px]">
      <section className="grid min-h-[330px] items-center gap-10 border-b border-[#747A60] py-10 lg:grid-cols-[minmax(0,560px)_minmax(360px,1fr)]">
        <div className="min-w-0">
          <div className="flex items-start gap-5">
            <HeroIcon>
              <SlidersHorizontal size={36} aria-hidden />
            </HeroIcon>
            <div className="min-w-0">
              <h2 className="max-w-[520px] text-[clamp(2.7rem,4.8vw,4.5rem)] font-black leading-[1.05] tracking-normal text-[#1B1B1B]">
                Control the essentials
              </h2>
            </div>
          </div>
        </div>

        <dl className="grid gap-0 border-y border-[#747A60]">
          <StatusRow
            icon={<PlugZap size={18} aria-hidden />}
            label="Bridge"
            value={labelForCompanion(companionStatus)}
          />
          <StatusRow
            icon={<Wifi size={18} aria-hidden />}
            label="Device"
            value={labelForDevice(deviceState, device)}
          />
          <StatusRow
            icon={<ShieldCheck size={18} aria-hidden />}
            label="Pairing"
            value={device?.paired ? "Paired" : "Open"}
          />
          <StatusRow
            detail={themeInstallEnabled ? undefined : "Protected"}
            icon={<Lock size={18} aria-hidden />}
            label="Install"
            value={themeInstallEnabled ? "Enabled" : "Protected"}
          />
        </dl>
      </section>

      <section className="border-b border-[#747A60] py-8">
        <h3 className="mb-5 text-base font-bold text-[#1B1B1B]">
          Device facts
        </h3>
        <dl className="grid gap-4 md:grid-cols-5">
          <Fact label="Target" value={device?.target || "Not reported"} />
          <Fact label="Board" value={device?.board || "Not reported"} />
          <Fact label="Firmware" value={device?.firmware || "Not reported"} />
          <Fact
            label="Transport"
            value={device?.capabilities?.transport?.active || "Not reported"}
          />
          <Fact
            label="ThemeSpec"
            value={themeSpecReady ? "Ready" : "Check required"}
          />
        </dl>
      </section>

      <section className="border-b border-[#747A60] py-8">
        <div className="min-w-0">
          <div className="mb-5 flex items-center justify-between gap-4">
            <h3 className="text-base font-bold text-[#1B1B1B]">
              Connection controls
            </h3>
            <span className="font-mono text-sm text-[#444933]">
              {companionUrl}
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <CommandButton
              busy={busyAction === "status"}
              icon={<PlugZap size={18} aria-hidden />}
              label="Check bridge"
              onClick={onCheckBridge}
            />
            <CommandButton
              busy={busyAction === "discover"}
              icon={<Search size={18} aria-hidden />}
              label="Find VibeTV"
              onClick={onDiscoverDevice}
            />
            <CommandButton
              busy={busyAction === "pair"}
              disabled={!device?.connected}
              icon={<ShieldCheck size={18} aria-hidden />}
              label="Pair device"
              onClick={onPairDevice}
            />
          </div>
        </div>
      </section>

      <section className="border-b border-[#747A60] py-8">
        <div>
          <div className="mb-5 flex items-center justify-between gap-4">
            <h3 className="text-base font-bold text-[#1B1B1B]">Display</h3>
            <span className="text-sm text-[#444933]">
              {brightness == null ? "Load required" : `${brightness}%`}
            </span>
          </div>
          <div className="grid gap-5">
            <div>
              <div className="mb-3 flex items-center justify-between text-sm text-[#444933]">
                <span>Brightness</span>
                <span className="font-semibold text-[#1B1B1B]">
                  {brightness == null ? "Open" : `${brightness}%`}
                </span>
              </div>
              <input
                aria-label="Brightness"
                className="h-2 w-full accent-[#CCFF00] disabled:opacity-50"
                disabled={!brightnessSupport || brightness == null}
                max={maxBrightness}
                min={minBrightness}
                onChange={(event) =>
                  onBrightnessChange(Number(event.target.value))
                }
                type="range"
                value={currentBrightness}
              />
              <div className="mt-2 flex justify-between text-xs text-[#444933]">
                <span>{minBrightness}%</span>
                <span>{maxBrightness}%</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <CommandButton
                busy={busyAction === "brightness"}
                disabled={!device?.connected || brightness == null}
                icon={<Check size={18} aria-hidden />}
                label="Save brightness"
                onClick={() => onSaveBrightness(currentBrightness)}
                primary
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function HeroIcon({ children }: { children: ReactNode }) {
  return (
    <div className="grid size-16 shrink-0 place-items-center rounded-full border border-[#747A60] bg-[#EEEEEE] text-[#1B1B1B]">
      {children}
    </div>
  );
}

function StatusRow({
  detail,
  icon,
  label,
  value,
}: {
  detail?: string;
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="grid min-h-[54px] grid-cols-[28px_1fr_120px] items-start gap-3 border-b border-[#747A60] py-3 last:border-b-0">
      <div className="pt-0.5 text-[#506600]">{icon}</div>
      <dt className="font-medium text-[#1B1B1B]">{label}</dt>
      <dd className="min-w-0 text-[#1B1B1B]">
        <span>{value}</span>
        {detail ? <div className="mt-1 text-sm text-[#444933]">{detail}</div> : null}
      </dd>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-r border-[#747A60] pr-5 last:border-r-0">
      <dt className="text-sm font-bold text-[#1B1B1B]">{label}</dt>
      <dd className="mt-1 truncate text-sm text-[#444933]">{value}</dd>
    </div>
  );
}

function CommandButton({
  busy,
  disabled,
  icon,
  label,
  onClick,
  primary,
}: {
  busy?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      className={`inline-flex h-12 items-center justify-center gap-2 border px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
        primary
          ? "border-[#CCFF00] bg-[#CCFF00] text-[#1B1B1B] hover:bg-[#ABD600]"
          : "border-[#747A60] bg-[#F9F9F9] text-[#1B1B1B] hover:bg-[#EEEEEE]"
      }`}
      disabled={disabled || busy}
      onClick={onClick}
      type="button"
    >
      {busy ? <RefreshCw className="animate-spin" size={18} /> : icon}
      <span>{busy ? "Working..." : label}</span>
    </button>
  );
}

function labelForCompanion(status: SettingsCompanionStatus): string {
  if (status === "online") {
    return "Online";
  }
  if (status === "missing") {
    return "Missing";
  }
  return "Check";
}

function labelForDevice(
  state: SettingsDeviceState,
  device: SettingsDeviceInfo | null,
): string {
  if (device?.connected) {
    return state === "paired" || device.paired ? "Connected" : "Found";
  }
  if (state === "offline") {
    return "Offline";
  }
  return "Check required";
}
