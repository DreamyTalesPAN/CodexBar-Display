"use client";

import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DeviceCandidate } from "../control-center-types";
import { candidateAddress } from "../setup-device-components";

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
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-[var(--radius-card)] bg-card p-4 text-left ring-1 ring-foreground/10",
        selected && "outline-2 outline-ring/30",
      )}
      onClick={onSelect}
      type="button"
    >
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold whitespace-nowrap">
            VibeTV {candidate.deviceId || address}
          </span>
          {candidate.known ? (
            <Badge variant="secondary">Previously connected</Badge>
          ) : null}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {address}
          {candidate.firmware ? ` · Firmware ${candidate.firmware}` : ""}
        </span>
      </span>
      {selected ? (
        <Check className="size-4 shrink-0 text-[var(--vibetv-support)]" />
      ) : null}
    </button>
  );
}
