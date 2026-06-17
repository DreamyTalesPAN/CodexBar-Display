import { MonitorUp, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import type {
  CompanionStatus,
  DeviceInfo,
  DeviceMockupTheme,
  DeviceState,
} from "./control-center-types";

type DeviceMockupProps = {
  companionStatus: CompanionStatus;
  deviceState: DeviceState;
  device: DeviceInfo | null;
  themeInstallEnabled: boolean;
  activeTheme?: DeviceMockupTheme | null;
  freshnessLabel?: string;
};

export function DeviceMockup({
  companionStatus,
  deviceState,
  device,
  themeInstallEnabled,
  activeTheme,
  freshnessLabel,
}: DeviceMockupProps) {
  const connected = Boolean(device?.connected);
  const paired = Boolean(device?.paired) || deviceState === "paired";
  const headline = connected
    ? paired
      ? "CONTROL READY"
      : "DEVICE FOUND"
    : companionStatus === "missing"
      ? "BRIDGE MISSING"
      : "AWAITING SIGNAL";
  const subline = connected
    ? device?.target || "Local device link"
    : "Check bridge and discovery";
  const firmware = device?.firmware || "unknown firmware";
  const board = device?.board || "VibeTV square";
  const screenFill = connected ? "bg-[#CCFF00]" : "bg-[#EEEEEE]";
  const screenText = connected ? "text-[#1B1B1B]" : "text-[#444933]";
  const statusIcon = connected ? (
    <Wifi size={18} aria-hidden />
  ) : (
    <WifiOff size={18} aria-hidden />
  );

  return (
    <figure
      aria-label="VibeTV Gerätestatus"
      className="mx-auto w-full max-w-[420px]"
    >
      <div className="aspect-square border-[12px] border-[#1B1B1B] bg-[#444933] p-3">
        <div
          className={`flex h-full flex-col justify-between border border-[#747A60] ${screenFill} ${screenText}`}
        >
          <div className="flex items-center justify-between border-b border-[#747A60] px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-normal">
              <MonitorUp size={16} aria-hidden />
              VibeTV
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-normal">
              {statusIcon}
              {connected ? "Online" : "Offline"}
            </div>
          </div>

          <div className="px-5 py-6">
            <div className="text-[11px] font-semibold uppercase tracking-normal">
              Command Screen
            </div>
            <div className="mt-3 break-words text-3xl font-black uppercase leading-none tracking-normal sm:text-4xl">
              {headline}
            </div>
            <div className="mt-4 max-w-[260px] break-words text-sm font-semibold leading-5">
              {subline}
            </div>
          </div>

          <div className="grid grid-cols-2 border-t border-[#747A60] text-xs font-semibold">
            <div className="border-r border-[#747A60] px-4 py-3">
              <div className="uppercase tracking-normal">Theme</div>
              <div className="mt-1 break-words text-sm">
                {activeTheme?.title || "Status View"}
              </div>
            </div>
            <div className="px-4 py-3">
              <div className="uppercase tracking-normal">Firmware</div>
              <div className="mt-1 break-words text-sm">{firmware}</div>
            </div>
          </div>
        </div>
      </div>

      <figcaption className="border-x border-b border-[#747A60] bg-[#1B1B1B] px-4 py-3 text-[#EDEDED]">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-semibold uppercase tracking-normal">
          <span>{board}</span>
          <span className="inline-flex items-center gap-2">
            <ShieldCheck size={15} aria-hidden />
            {themeInstallEnabled ? "Write access on" : "Install locked"}
          </span>
        </div>
        <div className="mt-2 text-xs text-[#EDEDED]">
          Signal: {freshnessLabel || "local session"}
        </div>
      </figcaption>
    </figure>
  );
}
