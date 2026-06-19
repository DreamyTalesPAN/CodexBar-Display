"use client";

import { Check, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

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
  onBrightnessChange: (value: number) => void;
  onSaveBrightness: (value: number) => void;
};

export function SettingsScreen({
  device,
  brightness,
  busyAction,
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
  const localActionBusy = Boolean(busyAction);

  return (
    <div className="mx-auto max-w-[1180px]">
      <section className="border-b border-[#747A60] py-8">
        <div>
          <div className="mb-5 flex items-center justify-between gap-4">
            <h3 className="text-base font-bold text-[#1B1B1B]">Display</h3>
            <span className="text-sm text-[#444933]">
              {brightness == null ? "Loading" : `${brightness}%`}
            </span>
          </div>
          <div className="grid gap-5">
            <div>
              <div className="mb-3 flex items-center justify-between text-sm text-[#444933]">
                <span>Brightness</span>
                <span className="font-semibold text-[#1B1B1B]">
                  {brightness == null ? "Loading" : `${brightness}%`}
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
