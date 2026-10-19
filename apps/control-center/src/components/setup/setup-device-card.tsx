"use client";

import { Badge } from "@/components/ui/badge";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import Image from "next/image";
import type { DeviceCandidate } from "../control-center-types";
import { candidateAddress } from "../device-target-copy";
import { SelectionDot, selectedItemClass } from "./setup-selectable-card";
import { cn } from "@/lib/utils";

type SetupDeviceCardProps = {
  candidate: DeviceCandidate;
  onSelect: () => void;
  selected: boolean;
};

export function SetupDeviceCard({
  candidate,
  onSelect,
  selected,
}: SetupDeviceCardProps) {
  const address = candidateAddress(candidate.target);
  const cable = candidate.transport === "cable";
  return (
    <Item
      asChild
      className={cn(selectedItemClass(selected), "bg-card py-3 pr-5 pl-3")}
      variant="outline"
    >
      <button
        aria-checked={selected}
        onClick={onSelect}
        role="radio"
        type="button"
      >
        <Image
          alt=""
          className="h-16 w-18 shrink-0 object-contain"
          height={64}
          src="/images/vibetv-device-overview-cutout.png"
          width={72}
        />
        <ItemContent>
          <ItemTitle className="flex-wrap font-semibold">
            <span className="whitespace-nowrap">
              VibeTV {candidate.deviceId || address}
            </span>
            {candidate.transport ? (
              <Badge variant="secondary">{cable ? "Cable" : "WiFi"}</Badge>
            ) : null}
            {candidate.known ? (
              <Badge variant="secondary">Previously connected</Badge>
            ) : null}
          </ItemTitle>
          <ItemDescription className="text-[13px]">
            {cable ? "" : address}
            {!cable && candidate.firmware ? " · " : ""}
            {candidate.firmware ? `Firmware ${candidate.firmware}` : ""}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <SelectionDot selected={selected} />
        </ItemActions>
      </button>
    </Item>
  );
}
