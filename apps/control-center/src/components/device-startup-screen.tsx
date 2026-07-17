"use client";

import { Loader2, Monitor, RefreshCw } from "lucide-react";
import { ControlCenterButton } from "./control-center-button";
import type {
  ApiError,
  DeviceCandidate,
  DeviceSearchState,
  SupportDiagnostics,
} from "./control-center-types";
import { SupportReportActions } from "./support-report-actions";

type Props = {
  busyAction?: string | null;
  deviceCandidates: DeviceCandidate[];
  deviceSearchState: DeviceSearchState;
  lastError?: ApiError | null;
  diagnostics?: SupportDiagnostics | null;
  onCreateSupportReport?: () => void;
  onSearch: () => void;
  onSelect: (candidate: DeviceCandidate) => void;
};

export function DeviceStartupScreen({
  busyAction,
  deviceCandidates,
  deviceSearchState,
  lastError,
  diagnostics,
  onCreateSupportReport,
  onSearch,
  onSelect,
}: Props) {
  const connecting = busyAction === "select" || busyAction === "repair";
  const searching =
    !connecting &&
    (deviceSearchState === "idle" ||
      deviceSearchState === "searching" ||
      busyAction === "search");
  const choosing =
    !connecting &&
    deviceSearchState === "multiple" &&
    deviceCandidates.length > 1;
  const connectionFailed = deviceSearchState === "repair-failed";
  const failed =
    deviceSearchState === "not-found" || deviceSearchState === "failed";

  const title = connecting
    ? "Connecting to VibeTV"
    : choosing
      ? "Choose a VibeTV"
      : connectionFailed
        ? "VibeTV could not connect"
      : failed
        ? "VibeTV was not found"
        : "Looking for a VibeTV";
  const detail = connecting
    ? "Your VibeTV was found. Control Center is connecting now."
    : choosing
      ? "More than one VibeTV was found. Choose yours."
      : connectionFailed
        ? "VibeTV was found, but Control Center could not connect. Search again to retry."
      : failed
        ? "Make sure VibeTV and this Mac are on the same WiFi, then search again."
        : "Searching this WiFi for VibeTV for up to 30 seconds.";

  return (
    <main
      className="grid min-h-screen place-items-center bg-[#F9F9F9] px-6 py-12 text-[#1B1B1B]"
      data-testid="device-startup-screen"
    >
      <section
        aria-busy={searching || connecting}
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

        {choosing ? (
          <div className="grid gap-3 text-left">
            {deviceCandidates.map((candidate) => (
              <div
                className="grid gap-4 border border-[#747A60] bg-[#F9F9F9] p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                key={`${candidate.deviceId || "legacy"}-${candidate.target}`}
              >
                <DeviceCandidateDetails candidate={candidate} />
                <ControlCenterButton
                  disabled={Boolean(busyAction)}
                  fullWidth
                  icon={<Monitor size={18} aria-hidden />}
                  label="Connect this VibeTV"
                  onClick={() => onSelect(candidate)}
                  size="large"
                  variant="primary"
                />
              </div>
            ))}
          </div>
        ) : null}

        {lastError && (failed || connectionFailed) ? (
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

        {searching || connecting ? (
          <div
            className="flex min-h-12 items-center justify-center gap-3 text-base font-semibold text-[#444933]"
            role="status"
          >
            <Loader2 className="animate-spin" size={20} aria-hidden />
            <span>{connecting ? "Connecting…" : "Searching…"}</span>
          </div>
        ) : null}

        {choosing ? (
          <ControlCenterButton
            disabled={Boolean(busyAction)}
            fullWidth
            icon={<RefreshCw size={18} aria-hidden />}
            label="Search again"
            onClick={onSearch}
            size="large"
            variant="secondary"
          />
        ) : failed || connectionFailed ? (
          <ControlCenterButton
            fullWidth
            icon={<RefreshCw size={18} aria-hidden />}
            label="Search again"
            onClick={onSearch}
            size="large"
            variant="primary"
          />
        ) : null}

        <SupportReportActions
          busyAction={busyAction}
          diagnostics={diagnostics}
          onCreate={onCreateSupportReport}
        />
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
