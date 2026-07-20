"use client";

import { Loader2, Monitor, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  ApiError,
  DeviceCandidate,
  DeviceSearchState,
} from "./control-center-types";

type Props = {
  busyAction?: string | null;
  deviceCandidates: DeviceCandidate[];
  deviceSearchState: DeviceSearchState;
  lastError?: ApiError | null;
  onDecline: () => void;
  onSearch: () => void;
  onSelect: (candidate: DeviceCandidate) => void;
};

export function DeviceStartupScreen({
  busyAction,
  deviceCandidates,
  deviceSearchState,
  lastError,
  onDecline,
  onSearch,
  onSelect,
}: Props) {
  const selecting = busyAction === "select";
  const reconnecting = busyAction === "repair";
  const searching =
    deviceSearchState === "searching" || busyAction === "search";
  const alternate =
    deviceSearchState === "alternate" && deviceCandidates.length === 1;
  const multiple = deviceSearchState === "multiple";

  let title = "Reconnecting to your VibeTV";
  let detail = "Checking your last connected VibeTV and your WiFi.";

  if (searching) {
    title = "Looking for your VibeTV";
    detail = "Searching your WiFi for your last connected VibeTV and alternatives.";
  } else if (selecting) {
    title = "Connecting to VibeTV";
    detail = "Connecting the selected VibeTV and waiting for a fresh image.";
  } else if (reconnecting) {
    title = "Reconnecting to your VibeTV";
    detail = "Your saved VibeTV was found. Waiting for a fresh image.";
  } else if (alternate) {
    title = "Another VibeTV was found";
    detail =
      "Your last connected VibeTV is not available. Connect to this VibeTV instead?";
  } else if (multiple) {
    title = "Choose a VibeTV";
    detail =
      "Your last connected VibeTV is not available. Choose another VibeTV to connect.";
  } else if (
    deviceSearchState === "not-found" ||
    deviceSearchState === "failed" ||
    deviceSearchState === "repair-failed"
  ) {
    title = "VibeTV was not found";
    detail =
      "Make sure VibeTV and this Mac are on the same WiFi, then search again.";
  }

  return (
    <main
      className="grid min-h-screen place-items-center bg-[#F9F9F9] px-6 py-12 text-[#1B1B1B]"
      data-testid="device-startup-screen"
    >
      <section
        aria-busy={searching || selecting || reconnecting}
        aria-live="polite"
        className="grid w-full max-w-[720px] gap-7 text-center"
      >
        <div className="text-[clamp(3rem,7vw,5rem)] font-black uppercase leading-none tracking-normal">
          VIBETV
        </div>

        <div className="grid gap-3">
          <h1 className="text-[clamp(2rem,4vw,3.25rem)] font-black leading-tight">
            {title}
          </h1>
          <p className="mx-auto max-w-[620px] text-base leading-7 text-[#444933] sm:text-lg">
            {detail}
          </p>
        </div>

        {alternate || multiple ? (
          <div className="grid gap-3 text-left">
            {deviceCandidates.map((candidate) => (
              <div
                className="grid gap-4 border border-[#747A60] bg-[#F9F9F9] p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                key={`${candidate.deviceId || "legacy"}-${candidate.target}`}
              >
                <DeviceCandidateDetails candidate={candidate} />
                <Button
                  className="w-full"
                  disabled={Boolean(busyAction)}
                  onClick={() => onSelect(candidate)}
                  size="lg"
                >
                  {selecting ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Monitor aria-hidden />
                  )}
                  {selecting ? "Connecting" : "Connect this VibeTV"}
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        {lastError && !searching ? (
          <div
            className="grid gap-1 border border-[#747A60] px-4 py-3 text-left text-sm text-[#444933]"
            role="alert"
          >
            <strong className="font-black text-[#1B1B1B]">
              {lastError.message}
            </strong>
            <span>{lastError.nextAction}</span>
          </div>
        ) : null}

        {searching || selecting || reconnecting ? (
          <div className="flex min-h-12 items-center justify-center gap-3 text-base font-semibold text-[#444933]" role="status">
            <Loader2 className="animate-spin" size={20} aria-hidden />
            <span>
              {selecting
                ? "Connecting…"
                : reconnecting
                  ? "Reconnecting…"
                  : "Searching…"}
            </span>
          </div>
        ) : null}

        {alternate || multiple ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              className="w-full"
              disabled={Boolean(busyAction)}
              onClick={onDecline}
              size="lg"
              variant="outline"
            >
              Not now
            </Button>
            <Button
              className="w-full"
              disabled={Boolean(busyAction)}
              onClick={onSearch}
              size="lg"
              variant="outline"
            >
              <RefreshCw aria-hidden />
              Search again
            </Button>
          </div>
        ) : deviceSearchState === "not-found" ||
          deviceSearchState === "failed" ||
          deviceSearchState === "repair-failed" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              className="w-full"
              onClick={onSearch}
              size="lg"
            >
              <RefreshCw aria-hidden />
              Search again
            </Button>
            <Button
              className="w-full"
              onClick={onDecline}
              size="lg"
              variant="outline"
            >
              Not now
            </Button>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function DeviceCandidateDetails({
  candidate,
}: {
  candidate: DeviceCandidate;
}) {
  const address = candidateAddress(candidate.target);
  return (
    <div className="min-w-0">
      <p className="break-words text-lg font-black text-[#1B1B1B]">
        VibeTV {candidate.deviceId || address}
      </p>
      <p className="mt-1 break-words text-sm leading-6 text-[#444933]">
        IP address: {address}
        {candidate.firmware ? ` · Firmware ${candidate.firmware}` : ""}
      </p>
      {candidate.known ? (
        <p className="mt-1 text-sm font-bold text-[#506600]">
          Previously connected
        </p>
      ) : null}
    </div>
  );
}

function candidateAddress(target: string): string {
  try {
    return new URL(target).hostname || target;
  } catch {
    return target.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  }
}
