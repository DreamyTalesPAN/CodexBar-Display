"use client";

import {
  Check,
  PlugZap,
  RefreshCw,
  Search,
  ShieldCheck,
  TriangleAlert,
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
  device: SettingsDeviceInfo | null;
  brightness: number | null;
  busyAction: string | null;
  lastError?: SettingsApiError | null;
  companionUrl?: string;
  deviceTarget: string;
  onCheckBridge: () => void;
  onDeviceTargetChange: (target: string) => void;
  onDiscoverDevice: (targetOverride?: string) => void;
  onPairDevice: () => void;
  onBrightnessChange: (value: number) => void;
  onSaveBrightness: (value: number) => void;
};

export function SettingsScreen({
  device,
  brightness,
  busyAction,
  lastError,
  companionUrl = "127.0.0.1:47832",
  deviceTarget,
  onCheckBridge,
  onDeviceTargetChange,
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
          {lastError ? (
            <div className="mb-5 flex gap-3 border border-[#747A60] bg-[#F9F9F9] p-4 text-sm text-[#444933]">
              <TriangleAlert
                className="mt-0.5 shrink-0 text-[#5E7200]"
                size={18}
                aria-hidden
              />
              <div className="min-w-0">
                <div className="font-semibold text-[#1B1B1B]">
                  {lastError.message}
                </div>
                <div className="mt-1 break-words">{lastError.nextAction}</div>
              </div>
            </div>
          ) : null}
          <div className="mb-4 grid gap-2">
            <label
              className="text-sm font-bold text-[#1B1B1B]"
              htmlFor="device-target"
            >
              VibeTV target
            </label>
            <input
              className="h-12 border border-[#747A60] bg-[#F9F9F9] px-3 font-mono text-sm text-[#1B1B1B] outline-none transition placeholder:text-[#747A60] focus:border-[#5E7200]"
              id="device-target"
              onChange={(event) => onDeviceTargetChange(event.target.value)}
              placeholder="vibetv.local or 192.168.178.163"
              spellCheck={false}
              type="text"
              value={deviceTarget}
            />
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
              onClick={() => onDiscoverDevice(deviceTarget)}
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
        <h3 className="mb-5 text-base font-bold text-[#1B1B1B]">
          Device facts
        </h3>
        <dl className="divide-y divide-[#747A60] border-y border-[#747A60]">
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-h-[52px] gap-1 py-3 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-start sm:gap-6">
      <dt className="text-sm font-bold text-[#1B1B1B]">{label}</dt>
      <dd className="break-words text-sm leading-6 text-[#444933]">{value}</dd>
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
