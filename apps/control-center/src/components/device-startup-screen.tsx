"use client";

import { Check, Loader2, Monitor, RefreshCw } from "lucide-react";
import { useState } from "react";
import { ControlCenterButton } from "./control-center-button";
import { DeviceTargetForm } from "./device-target-form";
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
  deviceTarget: string;
  hasConfiguredDevice: boolean;
  lastError?: ApiError | null;
  diagnostics?: SupportDiagnostics | null;
  onCreateSupportReport?: () => void;
  onDecline: () => void;
  onDeviceTargetChange: (target: string) => void;
  onManualTarget: (target: string) => void;
  onSearch: () => void;
  onSelect: (candidate: DeviceCandidate) => void;
};

export function DeviceStartupScreen({
  busyAction,
  deviceCandidates,
  deviceSearchState,
  deviceTarget,
  hasConfiguredDevice,
  lastError,
  diagnostics,
  onCreateSupportReport,
  onDecline,
  onDeviceTargetChange,
  onManualTarget,
  onSearch,
  onSelect,
}: Props) {
  const [manualEntryOpen, setManualEntryOpen] = useState(false);
  const selecting = busyAction === "select";
  const manualConnecting =
    busyAction === "manual-target" || busyAction === "select";
  const reconnecting = busyAction === "repair";
  const searching =
    deviceSearchState === "searching" || busyAction === "search";
  const waiting = deviceSearchState === "waiting";
  const multiple = deviceSearchState === "multiple";
  const wifiSetupNeeded =
    deviceSearchState === "not-found" && !hasConfiguredDevice;
  const configuredDeviceNotFound =
    deviceSearchState === "not-found" && hasConfiguredDevice;
  const manualEntryAvailable =
    searching ||
    multiple ||
    wifiSetupNeeded ||
    configuredDeviceNotFound ||
    deviceSearchState === "failed" ||
    deviceSearchState === "repair-failed";

  let title = "Reconnecting to your VibeTV";
  let detail = "Checking your last connected VibeTV and your WiFi.";

  if (searching) {
    title = "Looking for your VibeTV";
    detail = hasConfiguredDevice
      ? "Searching your WiFi for your last connected VibeTV."
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
  } else if (multiple) {
    title = "Choose a VibeTV";
    detail =
      "More than one VibeTV was found. Choose the one you want to connect.";
  } else if (wifiSetupNeeded) {
    title = "Connect VibeTV to WiFi";
    detail = "No VibeTV was found. Connect it to WiFi, then search again.";
  } else if (
    configuredDeviceNotFound ||
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

        {multiple ? (
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

        {manualEntryAvailable ? (
          manualEntryOpen ? (
            <div className="grid gap-3 border border-[#747A60] bg-[#F9F9F9] p-4 text-left">
              <p className="text-sm leading-6 text-[#444933]">
                Enter the IP address shown on the VibeTV screen. You do not
                need to wait for automatic search to finish.
              </p>
              <DeviceTargetForm
                busy={manualConnecting}
                buttonLabel="Connect VibeTV"
                className="grid gap-4"
                disabled={
                  Boolean(busyAction) &&
                  busyAction !== "search" &&
                  !manualConnecting
                }
                id="startup-device-target"
                lastError={lastError}
                onChange={onDeviceTargetChange}
                onSubmit={onManualTarget}
                searchingLabel="Connecting"
                value={deviceTarget}
              />
            </div>
          ) : (
            <ControlCenterButton
              aria-expanded={false}
              fullWidth
              icon={<Monitor size={18} aria-hidden />}
              label="Enter VibeTV IP"
              onClick={() => setManualEntryOpen(true)}
              size="large"
              variant="secondary"
            />
          )
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

        {searching || selecting || reconnecting || waiting ? (
          <div
            className="flex min-h-12 items-center justify-center gap-3 text-base font-semibold text-[#444933]"
            role="status"
          >
            <Loader2 className="animate-spin" size={20} aria-hidden />
            <span>
              {selecting
                ? "Connecting…"
                : reconnecting
                  ? "Reconnecting…"
                  : waiting
                    ? "Waiting for usage…"
                    : "Searching…"}
            </span>
          </div>
        ) : null}

        {multiple ? (
          <div
            className={
              hasConfiguredDevice ? "grid gap-3 sm:grid-cols-2" : "grid gap-3"
            }
          >
            {hasConfiguredDevice ? (
              <ControlCenterButton
                disabled={Boolean(busyAction)}
                fullWidth
                label="Open Control Center"
                onClick={onDecline}
                size="large"
                variant="secondary"
              />
            ) : null}
            <ControlCenterButton
              disabled={Boolean(busyAction)}
              fullWidth
              icon={<RefreshCw size={18} aria-hidden />}
              label="Search again"
              onClick={onSearch}
              size="large"
              variant="secondary"
            />
          </div>
        ) : wifiSetupNeeded ? (
          <ControlCenterButton
            fullWidth
            icon={<Check size={18} aria-hidden />}
            label="VibeTV is on WiFi"
            onClick={onSearch}
            size="large"
            variant="primary"
          />
        ) : configuredDeviceNotFound ||
          deviceSearchState === "failed" ||
          deviceSearchState === "repair-failed" ? (
          <div
            className={
              hasConfiguredDevice ? "grid gap-3 sm:grid-cols-2" : "grid gap-3"
            }
          >
            <ControlCenterButton
              fullWidth
              icon={<RefreshCw size={18} aria-hidden />}
              label="Search again"
              onClick={onSearch}
              size="large"
              variant="primary"
            />
            {hasConfiguredDevice ? (
              <ControlCenterButton
                fullWidth
                label="Open Control Center"
                onClick={onDecline}
                size="large"
                variant="secondary"
              />
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
