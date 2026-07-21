"use client";

import { Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  ApiError,
  DeviceCandidate,
  DeviceSearchState,
  SupportDiagnostics,
} from "./control-center-types";
import { SupportReportActions } from "./support-report-actions";
import {
  DeviceCandidateList,
  WifiSetupInstructions,
} from "./setup-device-components";
import { SetupStatusScreen } from "./setup-status-screen";

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

  const statusLabel = reconnecting
    ? "Reconnecting…"
    : waiting
      ? "Waiting for usage…"
      : searching
        ? "Searching…"
        : undefined;

  const actions = choosing ? (
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
  ) : null;

  return (
    <SetupStatusScreen
      actions={actions}
      busy={searching || selecting || reconnecting || waiting}
      description={detail}
      footer={
        <SupportReportActions
          busyAction={busyAction}
          diagnostics={diagnostics}
          onCreate={onCreateSupportReport}
        />
      }
      statusLabel={statusLabel}
      testId="device-startup-screen"
      title={title}
    >
      <>
        {choosing ? (
          <DeviceCandidateList
            busy={Boolean(busyAction)}
            candidates={deviceCandidates}
            onSelect={onSelect}
            selecting={selecting}
          />
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

      </>
    </SetupStatusScreen>
  );
}
