"use client";

import {
  CircleAlert,
  Download,
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
  ProviderSetupInfo,
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
  deviceTarget?: string;
  lastError?: ApiError | null;
  diagnostics?: SupportDiagnostics | null;
  onCreateSupportReport?: () => void;
  onRepairUsageService?: () => void;
  onDeviceTargetChange?: (target: string) => void;
  onManualTarget?: (target: string) => void;
  onPair: () => void;
  onSearch: () => void;
  onSelect: (candidate: DeviceCandidate) => void;
  providerRecovery?: boolean;
  showCodexBarFallback?: boolean;
  providerSetup?: ProviderSetupInfo | null;
  selectingDeviceTarget?: string;
  supportReportBusy?: boolean;
};

export function DeviceStartupScreen({
  busyAction,
  deviceCandidates,
  deviceSearchState,
  deviceTarget = "",
  lastError,
  diagnostics,
  onCreateSupportReport,
  onRepairUsageService,
  onDeviceTargetChange,
  onManualTarget,
  onPair,
  onSearch,
  onSelect,
  selectingDeviceTarget,
  supportReportBusy = false,
  providerRecovery = false,
  showCodexBarFallback = false,
  providerSetup,
}: Props) {
  const selecting = busyAction === "select";
  const manualConnecting = busyAction === "manual-target";
  const reconnecting = busyAction === "repair";
  const searching =
    deviceSearchState === "searching" || busyAction === "search";
  const waiting = deviceSearchState === "waiting";
  const providerRecoveryView = providerRecovery
    ? describeProviderRecovery(
        providerSetup,
        busyAction,
        lastError,
        showCodexBarFallback,
      )
    : null;
  const providerRecoveryBusy = Boolean(
    providerRecoveryView?.checking ||
      busyAction === "providers-retry" ||
      busyAction === "usage-service-repair",
  );
  const choosing =
    deviceSearchState === "multiple" && deviceCandidates.length > 0;
  const legacyRecovery =
    lastError?.code === "legacy_pairing_recovery_required";
  const connectionAttention = isConnectionAttentionError(lastError);
  const wifiSetupNeeded =
    deviceSearchState === "not-found" &&
    !manualConnecting &&
    !selecting &&
    !connectionAttention;
  const repairFailed = deviceSearchState === "repair-failed";
  const searchFailed = deviceSearchState === "failed";
  const manualEntryAvailable =
    !providerRecoveryView &&
    (searching || choosing || wifiSetupNeeded || searchFailed || repairFailed) &&
    !legacyRecovery;

  let title = "Set up your VibeTV";
  let detail = "Choose a VibeTV on your WiFi.";

  if (providerRecoveryView) {
    title = providerRecoveryView.title;
    detail = providerRecoveryView.detail;
  } else if (searching) {
    title = "Looking for your VibeTV";
    detail = "Searching your WiFi for a VibeTV.";
  } else if (selecting || manualConnecting) {
    title = "Connecting to VibeTV";
    detail = "Connecting to the selected VibeTV.";
  } else if (reconnecting) {
    title = "Reconnecting to your VibeTV";
    detail = "Connecting to your saved VibeTV.";
  } else if (waiting) {
    title = "Connecting to VibeTV";
    detail = "VibeTV was found. Waiting for the first live preview.";
  } else if (legacyRecovery) {
    title = "Reconnect this VibeTV";
    detail = "Follow these steps, then connect VibeTV again.";
  } else if (choosing) {
    title = "Choose a VibeTV";
    detail = "Choose the VibeTV you want to connect.";
  } else if (connectionAttention) {
    title = "Reconnect this VibeTV";
    detail = "VibeTV is reachable. Press Connect to reconnect it.";
  } else if (wifiSetupNeeded) {
    title = "We couldn't find your VibeTV";
    detail =
      "Connect VibeTV to WiFi, scan again, or enter the address shown on its screen.";
  } else if (repairFailed) {
    title = "VibeTV could not connect";
    detail = "The VibeTV was found, but the connection could not be completed.";
  } else if (searchFailed) {
    title = "VibeTV search could not finish";
    detail = "Check the Mac App and your WiFi, then search again.";
  }

  const statusLabel = providerRecoveryView?.checking
    ? "Checking AI setup…"
    : providerRecoveryView
      ? undefined
      : reconnecting
      ? "Reconnecting…"
      : waiting
        ? "Waiting for live preview…"
        : searching
          ? "Searching…"
          : undefined;

  const visual = providerRecoveryView && !providerRecoveryView.checking ? (
    <CircleAlert aria-hidden />
  ) : choosing ? (
    <Monitor aria-hidden />
  ) : wifiSetupNeeded ? (
    <Wifi aria-hidden />
  ) : searchFailed ? (
    <WifiOff aria-hidden />
  ) : repairFailed || connectionAttention ? (
    <CircleAlert aria-hidden />
  ) : undefined;

  const actions = providerRecoveryView && !providerRecoveryView.checking ? (
    <div className="grid gap-3">
      <Button
        className="w-full"
        disabled={providerRecoveryBusy}
        onClick={onRepairUsageService}
        size="lg"
      >
        <RefreshCw data-icon="inline-start" aria-hidden />
        <span>Try again</span>
      </Button>
      {showCodexBarFallback ? (
        <Button asChild className="w-full" size="lg" variant="outline">
          <a href="https://github.com/steipete/CodexBar/releases/latest">
            <Download data-icon="inline-start" aria-hidden />
            <span>Download CodexBar</span>
          </a>
        </Button>
      ) : null}
    </div>
  ) : legacyRecovery ? null : choosing ? (
    <StartupActions
      busy={Boolean(busyAction)}
      onSearch={onSearch}
      searchVariant="outline"
    />
  ) : searchFailed || repairFailed || connectionAttention ? (
    <StartupActions
      busy={Boolean(busyAction)}
      onSearch={connectionAttention ? onPair : onSearch}
      searchLabel={connectionAttention ? "Connect" : "Search again"}
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
        buttonLabel="Connect"
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
      busy={
        searching ||
        selecting ||
        manualConnecting ||
        reconnecting ||
        (waiting && !providerRecoveryView) ||
        providerRecoveryBusy
      }
      description={detail}
      footer={
        <SupportReportActions
          align="center"
          creating={supportReportBusy}
          diagnostics={diagnostics}
          emphasis="secondary"
          onCreate={onCreateSupportReport}
          createLabel={
            providerRecoveryView
              ? "Create support report"
              : "Create report"
          }
        />
      }
      statusLabel={statusLabel}
      testId="device-startup-screen"
      title={title}
      visual={visual}
    >
      <div className="grid gap-5">
        {!providerRecoveryView && choosing ? (
          <DeviceCandidateList
            busy={Boolean(busyAction) && !selecting}
            candidates={deviceCandidates}
            onSelect={onSelect}
            selectingTarget={selectingDeviceTarget}
          />
        ) : null}

        {!providerRecoveryView && wifiSetupNeeded ? (
          <>
            <WifiSetupInstructions />
            <Button className="w-full" onClick={onSearch} size="lg">
              <RefreshCw data-icon="inline-start" aria-hidden />
              <span>Scan WiFi again</span>
            </Button>
          </>
        ) : null}

        {!providerRecoveryView && legacyRecovery && !searching ? (
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertTitle>Reconnect this VibeTV</AlertTitle>
            <AlertDescription>
              <ol className="grid list-decimal gap-2 pl-5">
                <li>
                  Unplug VibeTV and plug it back in three times. After the third
                  start, leave it powered on.
                </li>
                <li>
                  When VibeTV shows VibeTV-Setup, use your phone to connect it
                  to your home WiFi again.
                </li>
                <li>
                  Return to this app. When VibeTV appears, click Connect within
                  30 minutes.
                </li>
              </ol>
            </AlertDescription>
          </Alert>
        ) : lastError && !searching ? (
          <Alert variant={connectionAttention ? "destructive" : "default"}>
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

function describeProviderRecovery(
  providerSetup: ProviderSetupInfo | null | undefined,
  busyAction: string | null | undefined,
  lastError: ApiError | null | undefined,
  showCodexBarFallback: boolean,
) {
  const setupStatus = normalizedProviderStatus(providerSetup?.status);
  if (
    !lastError &&
    (!providerSetup ||
      setupStatus === "checking" ||
      busyAction === "providers-retry" ||
      busyAction === "usage-service-repair")
  ) {
    return {
      checking: true,
      detail: "VibeTV is starting its built-in usage service and checking this Mac.",
      title: "Starting AI usage",
    };
  }

  if (showCodexBarFallback) {
    return {
      checking: false,
      detail:
        "VibeTV needs CodexBar to read AI usage, but could not complete the setup here. Download and open CodexBar, then try again.",
      title: "CodexBar is needed",
    };
  }

  if (setupStatus === "ready") {
    return {
      checking: true,
      detail: "AI usage is ready. VibeTV is loading the first live image.",
      title: "Starting your VibeTV display",
    };
  }

  return {
    checking: false,
    detail:
      "VibeTV could not read AI usage on this Mac. Try again. If it still fails, create a support report.",
    title: "AI usage could not start",
  };
}

function normalizedProviderStatus(value?: string) {
  return value?.trim().toLowerCase().replace(/^provider_/, "") || "";
}

function StartupActions({
  busy,
  onSearch,
  searchLabel = "Search again",
  searchVariant = "default",
}: {
  busy: boolean;
  onSearch: () => void;
  searchLabel?: string;
  searchVariant?: "default" | "outline";
}) {
  return (
    <div className="grid gap-3">
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
    </div>
  );
}

function startupErrorNextAction(error: ApiError, repairFailed: boolean) {
  if (isConnectionAttentionError(error)) {
    return error.nextAction || "Press Connect again.";
  }
  if (
    repairFailed &&
    (error.code === "pair_failed" || error.code === "connect_failed")
  ) {
    return "Keep VibeTV powered on, then search again.";
  }
  return error.nextAction;
}

function isConnectionAttentionError(error?: ApiError | null) {
  return (
    error?.code === "legacy_pairing_recovery_required" ||
    error?.code === "connect_failed" ||
    error?.code === "connect_temporarily_unavailable" ||
    error?.code === "pairing_token_rejected" ||
    error?.code === "pairing_window_closed" ||
    error?.code === "pairing_rate_limited"
  );
}
