"use client";

import {
  CircleAlert,
  Monitor,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type {
  ApiError,
  DeviceCandidate,
  DeviceSearchState,
  SupportDiagnostics,
} from "./control-center-types";
import { DeviceTargetForm } from "./device-target-form";
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
  const selecting = busyAction === "select";
  const manualConnecting = busyAction === "manual-target";
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
  const pairingAttention = isPairingAttentionError(lastError);
  const manualEntryAvailable =
    searching ||
    choosing ||
    wifiSetupNeeded ||
    configuredDeviceNotFound ||
    searchFailed ||
    repairFailed;

  let title = "Reconnecting to your VibeTV";
  let detail = "Checking your last connected VibeTV and your WiFi.";

  if (searching) {
    title = "Looking for your VibeTV";
    detail = hasConfiguredDevice
      ? "Searching your WiFi for your last connected VibeTV and alternatives."
      : "Searching your WiFi for a VibeTV.";
  } else if (selecting || manualConnecting) {
    title = "Connecting to VibeTV";
    detail = "Checking the selected VibeTV and waiting for a fresh image.";
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
    title = "We couldn't find your VibeTV";
    detail =
      "Connect VibeTV to WiFi, scan again, or enter the address shown on its screen.";
  } else if (pairingAttention) {
    title =
      lastError?.code === "pairing_rate_limited"
        ? "Pairing is paused for a moment"
        : "Confirm pairing on your VibeTV";
    detail = "VibeTV is reachable, but the secure connection needs attention.";
  } else if (repairFailed) {
    title = "VibeTV could not connect";
    detail = "The VibeTV was found, but the connection could not be completed.";
  } else if (searchFailed) {
    title = "VibeTV search could not finish";
    detail = "Check the Mac App and your WiFi, then search again.";
  } else if (configuredDeviceNotFound) {
    title = "We couldn't find your VibeTV";
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

  const visual = choosing ? (
    <Monitor aria-hidden />
  ) : wifiSetupNeeded ? (
    <Wifi aria-hidden />
  ) : configuredDeviceNotFound || searchFailed ? (
    <WifiOff aria-hidden />
  ) : repairFailed || pairingAttention ? (
    <CircleAlert aria-hidden />
  ) : undefined;

  const actions = choosing ? (
    <StartupActions
      busy={Boolean(busyAction)}
      hasConfiguredDevice={hasConfiguredDevice}
      onDecline={onDecline}
      onSearch={onSearch}
      searchVariant="outline"
    />
  ) : configuredDeviceNotFound || searchFailed || repairFailed || pairingAttention ? (
    <StartupActions
      busy={Boolean(busyAction)}
      hasConfiguredDevice={hasConfiguredDevice}
      onDecline={onDecline}
      onSearch={onSearch}
      searchLabel={pairingAttention ? "Pair again" : "Search again"}
    />
  ) : null;

  const manualEntryPrompt = searching || choosing
    ? "Or enter the IP address shown on your VibeTV screen:"
    : wifiSetupNeeded
      ? "Or enter the IP address shown on your VibeTV screen:"
      : "Enter the IP address shown on your VibeTV screen:";

  const manualTargetForm = manualEntryAvailable ? (
    <div className="grid gap-3">
      <p className="text-sm font-medium text-muted-foreground">
        {manualEntryPrompt}
      </p>
      <DeviceTargetForm
        busy={manualConnecting}
        buttonLabel="Connect VibeTV"
        disabled={
          Boolean(busyAction) && busyAction !== "search" && !manualConnecting
        }
        id="startup-device-target"
        lastError={lastError}
        minimal
        onChange={onDeviceTargetChange}
        onSubmit={onManualTarget}
        searchingLabel="Connecting"
        value={deviceTarget}
      />
    </div>
  ) : null;

  return (
    <SetupStatusScreen
      actions={actions}
      busy={searching || selecting || manualConnecting || reconnecting || waiting}
      description={detail}
      footer={
        <SupportReportActions
          align="center"
          busyAction={busyAction}
          diagnostics={diagnostics}
          emphasis="secondary"
          onCreate={onCreateSupportReport}
        />
      }
      statusLabel={statusLabel}
      testId="device-startup-screen"
      title={title}
      visual={visual}
    >
      <div className="grid gap-5">
        {choosing ? (
          <DeviceCandidateList
            busy={Boolean(busyAction) && !selecting}
            candidates={deviceCandidates}
            onSelect={onSelect}
            selecting={selecting}
          />
        ) : null}

        {wifiSetupNeeded ? (
          <>
            <WifiSetupInstructions />
            <Button className="w-full" onClick={onSearch} size="lg">
              <RefreshCw data-icon="inline-start" aria-hidden />
              <span>Scan WiFi again</span>
            </Button>
          </>
        ) : null}

        {lastError && !searching ? (
          <Alert variant={pairingAttention ? "destructive" : "default"}>
            <CircleAlert aria-hidden />
            <AlertTitle>{lastError.message}</AlertTitle>
            <AlertDescription>
              {startupErrorNextAction(lastError, repairFailed)}
            </AlertDescription>
          </Alert>
        ) : null}

        {manualTargetForm}
      </div>
    </SetupStatusScreen>
  );
}

function StartupActions({
  busy,
  hasConfiguredDevice,
  onDecline,
  onSearch,
  searchLabel = "Search again",
  searchVariant = "default",
}: {
  busy: boolean;
  hasConfiguredDevice: boolean;
  onDecline: () => void;
  onSearch: () => void;
  searchLabel?: string;
  searchVariant?: "default" | "outline";
}) {
  return (
    <div
      className={
        hasConfiguredDevice ? "grid gap-3 sm:grid-cols-2" : "grid gap-3"
      }
    >
      <Button
        className="w-full"
        disabled={busy}
        onClick={onSearch}
        size="lg"
        variant={searchVariant}
      >
        <RefreshCw data-icon="inline-start" aria-hidden />
        <span>{searchLabel}</span>
      </Button>
      {hasConfiguredDevice ? (
        <Button
          className="w-full"
          disabled={busy}
          onClick={onDecline}
          size="lg"
          variant="outline"
        >
          Open Control Center
        </Button>
      ) : null}
    </div>
  );
}

function startupErrorNextAction(error: ApiError, repairFailed: boolean) {
  if (repairFailed && error.code === "pair_failed") {
    return "Keep VibeTV powered on, then search again.";
  }
  return error.nextAction;
}

function isPairingAttentionError(error?: ApiError | null) {
  return (
    error?.code === "pairing_token_rejected" ||
    error?.code === "pairing_window_closed" ||
    error?.code === "pairing_rate_limited"
  );
}
