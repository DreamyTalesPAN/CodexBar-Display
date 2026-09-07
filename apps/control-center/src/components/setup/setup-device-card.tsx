"use client";

import { Badge } from "@/components/ui/badge";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import type { DeviceCandidate } from "../control-center-types";
import { candidateAddress } from "../device-target-copy";
import { SelectionCheck, selectedItemClass } from "./setup-selectable-card";
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
      className={cn(selectedItemClass(selected), "bg-card px-4 py-3.5")}
      variant="outline"
    >
      <button
        aria-checked={selected}
        onClick={onSelect}
        role="radio"
        type="button"
      >
        <ItemContent>
          <ItemTitle className="flex-wrap">
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
          <ItemDescription className="font-mono text-xs">
            {cable ? "" : address}
            {!cable && candidate.firmware ? " · " : ""}
            {candidate.firmware ? `Firmware ${candidate.firmware}` : ""}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <SelectionCheck selected={selected} />
        </ItemActions>
      </button>
    </Item>
  );
}
