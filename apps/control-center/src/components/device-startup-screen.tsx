"use client";

import { Check, Loader2, Monitor, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  hasConfiguredDevice: boolean;
  lastError?: ApiError | null;
  diagnostics?: SupportDiagnostics | null;
  onCreateSupportReport?: () => void;
  onDecline: () => void;
  onSearch: () => void;
  onSelect: (candidate: DeviceCandidate) => void;
};

export function DeviceStartupScreen({
  busyAction,
  deviceCandidates,
  deviceSearchState,
  hasConfiguredDevice,
  lastError,
  diagnostics,
  onCreateSupportReport,
  onDecline,
  onSearch,
  onSelect,
}: Props) {
  const selecting = busyAction === "select";
  const reconnecting = busyAction === "repair";
  const searching =
    deviceSearchState === "searching" || busyAction === "search";
  const waiting = deviceSearchState === "waiting";
  const choosing =
    deviceSearchState === "multiple" && deviceCandidates.length > 0;
  const singleReplacement =
    choosing && hasConfiguredDevice && deviceCandidates.length === 1;
  const wifiSetupNeeded =
    deviceSearchState === "not-found" && !hasConfiguredDevice;
  const configuredDeviceNotFound =
    deviceSearchState === "not-found" && hasConfiguredDevice;
  const repairFailed = deviceSearchState === "repair-failed";
  const searchFailed = deviceSearchState === "failed";

  let title = "Reconnecting to your VibeTV";
  let detail = "Checking your last connected VibeTV and your WiFi.";

  if (searching) {
    title = "Looking for your VibeTV";
    detail = hasConfiguredDevice
      ? "Searching your WiFi for your last connected VibeTV and alternatives."
      : "Searching your WiFi for a VibeTV.";
  } else if (selecting) {
    title = "Connecting to VibeTV";
    detail = "Connecting the selected VibeTV and waiting for a fresh image.";
  } else if (reconnecting) {
    title = "Reconnecting to your VibeTV";
    detail = "Your saved VibeTV was found. Waiting for a fresh image.";
  } else if (waiting) {
    title = "Connecting to VibeTV";
    detail = "VibeTV was found. Waiting for the first usage data.";
  } else if (singleReplacement) {
    title = "Another VibeTV was found";
    detail =
      "Your last connected VibeTV is not available. Connect to this VibeTV instead?";
  } else if (choosing) {
    title = "Choose a VibeTV";
    detail = hasConfiguredDevice
      ? "Your last connected VibeTV is not available. Choose another VibeTV to connect."
      : "More than one VibeTV was found. Choose the one you want to connect.";
  } else if (wifiSetupNeeded) {
    title = "Connect VibeTV to WiFi";
    detail = "No VibeTV was found. Connect it to WiFi, then search again.";
  } else if (repairFailed) {
    title = "VibeTV could not connect";
    detail = "The VibeTV was found, but the connection could not be completed.";
  } else if (searchFailed) {
    title = "VibeTV search could not finish";
    detail = "Check the Mac App and your WiFi, then search again.";
  } else if (configuredDeviceNotFound) {
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
        aria-busy={searching || selecting || reconnecting || waiting}
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

        {wifiSetupNeeded ? <WifiSetupInstructions /> : null}

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

        {searching || reconnecting || waiting ? (
          <div
            className="flex min-h-12 items-center justify-center gap-3 text-base font-semibold text-[#444933]"
            role="status"
          >
            <Loader2 className="animate-spin" size={20} aria-hidden />
            <span>
              {reconnecting
                ? "Reconnecting…"
                : waiting
                  ? "Waiting for usage…"
                  : "Searching…"}
            </span>
          </div>
        ) : null}

        {choosing ? (
          <div
            className={
              hasConfiguredDevice ? "grid gap-3 sm:grid-cols-2" : "grid gap-3"
            }
          >
            {hasConfiguredDevice ? (
              <Button
                className="w-full"
                disabled={Boolean(busyAction)}
                onClick={onDecline}
                size="lg"
                variant="outline"
              >
                Open Control Center
              </Button>
            ) : null}
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
        ) : wifiSetupNeeded ? (
          <Button className="w-full" onClick={onSearch} size="lg">
            <Check aria-hidden />
            VibeTV is on WiFi
          </Button>
        ) : configuredDeviceNotFound || searchFailed || repairFailed ? (
          <div
            className={
              hasConfiguredDevice ? "grid gap-3 sm:grid-cols-2" : "grid gap-3"
            }
          >
            <Button className="w-full" onClick={onSearch} size="lg">
              <RefreshCw aria-hidden />
              Search again
            </Button>
            {hasConfiguredDevice ? (
              <Button
                className="w-full"
                onClick={onDecline}
                size="lg"
                variant="outline"
              >
                Open Control Center
              </Button>
            ) : null}
          </div>
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

function WifiSetupInstructions() {
  return (
    <div className="border-y border-[#747A60] py-6 text-left sm:px-6">
      <ol className="grid gap-3 text-base leading-7 text-[#444933] sm:text-lg">
        <li>1. Plug VibeTV into power.</li>
        <li>2. Wait until VibeTV shows VibeTV-Setup.</li>
        <li>3. Take your phone.</li>
        <li>
          4. Open WiFi settings and join <strong>VibeTV-Setup</strong>.
        </li>
        <li>
          5. If the browser does not open automatically, open{" "}
          <strong>192.168.4.1</strong> on your phone.
        </li>
        <li>6. Choose your home WiFi and save.</li>
        <li>7. Wait until VibeTV says WiFi connected, then continue here.</li>
      </ol>
    </div>
  );
}

function DeviceCandidateDetails({ candidate }: { candidate: DeviceCandidate }) {
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
