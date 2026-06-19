"use client";

import {
  Check,
  PlugZap,
  RefreshCw,
  Search,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  CompanionPrimaryAction,
  useCompanionRelease,
} from "./companion-installer-actions";
import {
  DEVICE_TARGET_PLACEHOLDER,
  deviceTargetHelpText,
} from "./device-target-copy";

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
  device: SettingsDeviceInfo | null;
  brightness: number | null;
  busyAction: string | null;
  lastError?: SettingsApiError | null;
  companionUrl?: string;
  deviceTarget: string;
  onCheckBridge: () => void;
  onConnectDevice: (targetOverride?: string) => void;
  onDeviceTargetChange: (target: string) => void;
  onBrightnessChange: (value: number) => void;
  onSaveBrightness: (value: number) => void;
};

export function SettingsScreen({
  companionStatus,
  device,
  brightness,
  busyAction,
  lastError,
  companionUrl = "127.0.0.1:47832",
  deviceTarget,
  onCheckBridge,
  onConnectDevice,
  onDeviceTargetChange,
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
  const localActionBusy = Boolean(busyAction);
  const companionMissing = companionStatus === "missing";
  const companionOnline = companionStatus === "online";
  const {
    busy: companionReleaseBusy,
    refresh: refreshCompanionRelease,
    release: companionRelease,
  } = useCompanionRelease(undefined, { enabled: companionMissing });

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
          {companionMissing ? (
            <StepGate
              detail="You need Companion on this computer before VibeTV can be connected."
              title="Install Companion first"
            >
              <CompanionPrimaryAction
                busy={companionReleaseBusy}
                onRetry={refreshCompanionRelease}
                release={companionRelease}
              />
            </StepGate>
          ) : null}
          {!companionMissing && !companionOnline ? (
            <StepGate
              detail="Check whether Companion is running on this computer before connecting VibeTV."
              title="Check Companion first"
            >
              <CommandButton
                busy={busyAction === "status"}
                busyLabel="Checking"
                disabled={localActionBusy && busyAction !== "status"}
                icon={<PlugZap size={18} aria-hidden />}
                label="Check Companion"
                onClick={onCheckBridge}
                primary
              />
            </StepGate>
          ) : null}
          {companionOnline && lastError ? (
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
          {companionOnline ? (
            <>
              <div className="mb-4 grid gap-2">
                <label
                  className="text-sm font-bold text-[#1B1B1B]"
                  htmlFor="device-target"
                >
                  VibeTV target
                </label>
                <p className="text-sm leading-6 text-[#444933]">
                  {deviceTargetHelpText(lastError)}
                </p>
                <input
                  className="h-12 border border-[#747A60] bg-[#F9F9F9] px-3 font-mono text-sm text-[#1B1B1B] outline-none transition placeholder:text-[#747A60] focus:border-[#5E7200] disabled:cursor-not-allowed disabled:bg-[#EEEEEE] disabled:text-[#444933]"
                  disabled={localActionBusy}
                  id="device-target"
                  onChange={(event) => onDeviceTargetChange(event.target.value)}
                  placeholder={DEVICE_TARGET_PLACEHOLDER}
                  spellCheck={false}
                  type="text"
                  value={deviceTarget}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <CommandButton
                  busy={busyAction === "status"}
                  disabled={localActionBusy && busyAction !== "status"}
                  icon={<PlugZap size={18} aria-hidden />}
                  label="Check Companion"
                  onClick={onCheckBridge}
                />
                <CommandButton
                  busy={busyAction === "connect"}
                  busyLabel="Connecting"
                  disabled={localActionBusy && busyAction !== "connect"}
                  icon={<Search size={18} aria-hidden />}
                  label="Connect VibeTV"
                  onClick={() => onConnectDevice(deviceTarget)}
                  primary
                />
              </div>
            </>
          ) : null}
        </div>
      </section>

      {companionOnline ? (
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
      ) : null}

      {companionOnline ? (
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
                disabled={!brightnessSupport || brightness == null || localActionBusy}
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
                disabled={
                  !device?.connected ||
                  brightness == null ||
                  (localActionBusy && busyAction !== "brightness")
                }
                icon={<Check size={18} aria-hidden />}
                label="Save brightness"
                onClick={() => onSaveBrightness(currentBrightness)}
                primary
              />
            </div>
          </div>
        </div>
      </section>
      ) : null}
    </div>
  );
}

function StepGate({
  children,
  detail,
  title,
}: {
  children: ReactNode;
  detail: string;
  title: string;
}) {
  return (
    <div className="grid gap-5 border border-[#747A60] bg-[#F9F9F9] p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <h4 className="text-base font-bold text-[#1B1B1B]">{title}</h4>
        <p className="mt-1 max-w-[640px] text-sm leading-6 text-[#444933]">
          {detail}
        </p>
      </div>
      <div className="flex md:justify-end">{children}</div>
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
  busyLabel = "Working...",
  disabled,
  icon,
  label,
  onClick,
  primary,
}: {
  busy?: boolean;
  busyLabel?: string;
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
      <span>{busy ? busyLabel : label}</span>
    </button>
  );
}
