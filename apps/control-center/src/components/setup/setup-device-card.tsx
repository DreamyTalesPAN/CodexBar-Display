"use client";

import Image from "next/image";
import { useCallback, useState } from "react";
import type {
  DeviceCandidate,
  DeviceInfo,
  UsageSnapshot,
} from "../control-center-types";
import type { DisplayFrameSnapshot } from "../live-vibetv-preview";
import { SetupVibeTV3DPreview } from "./setup-3d-preview";
import { candidateAddress } from "../device-target-copy";
import { SelectionDot, calmCardClass } from "./setup-selectable-card";
import { cn } from "@/lib/utils";

type SetupDeviceCardProps = {
  candidate: DeviceCandidate;
  /** The one radio of its group that Tab reaches. */
  tabStop: boolean;
  onSelect: () => void;
  selected: boolean;
  /**
   * Hardware WebGL: true draws the 3D VibeTV, empty until its model is on
   * screen; false (or no WebGL) shows the photo; null is still checking, empty.
   */
  preview3D?: boolean | null;
  /** What this VibeTV shows; only the VibeTV the app is connected to has a live screen. */
  previewDevice?: DeviceInfo | null;
  previewFrame?: DisplayFrameSnapshot | null;
  previewUsage?: UsageSnapshot | null;
};

const CHIP_CLASS =
  "rounded-md bg-muted px-2 py-px font-normal text-muted-foreground";

export function SetupDeviceCard({
  candidate,
  onSelect,
  preview3D = false,
  previewDevice = null,
  previewFrame = null,
  previewUsage = null,
  selected,
  tabStop,
}: SetupDeviceCardProps) {
  const [threeState, setThreeState] = useState<"loading" | "ready" | "failed">("loading");
  const onThreeReady = useCallback(() => setThreeState("ready"), []);
  const onThreeFailed = useCallback(() => setThreeState("failed"), []);
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
      <span aria-hidden className="pointer-events-none relative h-16 w-18 shrink-0">
        {preview3D === false || threeState === "failed" ? (
          <Image
            alt=""
            className="size-full object-contain"
            height={64}
            src="/images/vibetv-device-overview-cutout.png"
            width={72}
          />
        ) : null}
        {preview3D && threeState !== "failed" ? (
          // A small render of the same 3D VibeTV as the Overview. Its stage is
          // a little wider than the thumbnail (the device fills about 60 % of
          // it) and centred on it; it is drawn only in the background until
          // its model is on screen.
          <span
            className={cn(
              "absolute top-1/2 left-1/2 w-[112px] -translate-x-1/2 -translate-y-1/2",
              threeState === "ready" ? "" : "opacity-0",
            )}
          >
            <SetupVibeTV3DPreview
              className="aspect-[640/411] w-full"
              device={previewDevice}
              displayFrame={previewFrame}
              onReady={onThreeReady}
              onFailed={onThreeFailed}
              usage={previewUsage}
            />
          </span>
        ) : null}
      </span>
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
