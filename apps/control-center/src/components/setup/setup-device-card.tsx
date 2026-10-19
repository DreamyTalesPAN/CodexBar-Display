"use client";

import Image from "next/image";
import type { DeviceCandidate } from "../control-center-types";
import { candidateAddress } from "../device-target-copy";
import { SelectionDot, calmCardClass } from "./setup-selectable-card";
import { cn } from "@/lib/utils";

type SetupDeviceCardProps = {
  candidate: DeviceCandidate;
  /** The one radio of its group that Tab reaches. */
  tabStop: boolean;
  onSelect: () => void;
  selected: boolean;
};

const CHIP_CLASS =
  "rounded-md bg-muted px-2 py-px font-normal text-muted-foreground";

export function SetupDeviceCard({
  candidate,
  onSelect,
  selected,
  tabStop,
}: SetupDeviceCardProps) {
  const address = candidateAddress(candidate.target);
  const cable = candidate.transport === "cable";
  return (
    <button
      aria-checked={selected}
      className={cn(calmCardClass(selected), "flex items-center gap-4 py-3 pr-5 pl-3")}
      onClick={onSelect}
      role="radio"
      tabIndex={tabStop ? 0 : -1}
      type="button"
    >
      <Image
        alt=""
        className="h-16 w-18 shrink-0 object-contain"
        height={64}
        src="/images/vibetv-device-overview-cutout.png"
        width={72}
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold whitespace-nowrap">
            VibeTV {candidate.deviceId || address}
          </span>
          {candidate.transport ? (
            <span className={CHIP_CLASS}>{cable ? "Cable" : "WiFi"}</span>
          ) : null}
          {candidate.known ? (
            <span className={CHIP_CLASS}>Previously connected</span>
          ) : null}
        </span>
        <span className="block text-muted-foreground">
          {cable ? "" : address}
          {!cable && candidate.firmware ? " · " : ""}
          {candidate.firmware ? `Firmware ${candidate.firmware}` : ""}
        </span>
      </span>
      <SelectionDot selected={selected} />
    </button>
  );
}
