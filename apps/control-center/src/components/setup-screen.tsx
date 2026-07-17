"use client";

import {
  Check,
  CircleHelp,
  Clipboard,
  Download,
  Loader2,
  Monitor,
  RefreshCw,
  Wifi,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { useMemo, useState, type ReactNode } from "react";
import {
  availableMacAppDmgDownloadUrl,
  type CompanionReleaseInfo,
} from "@/lib/companion-release";
import type {
  ApiError,
  CompanionStatus,
  DeviceCandidate,
  DeviceSearchState,
  DeviceState,
} from "./control-center-types";
import { DeviceTargetForm } from "./device-target-form";
import { ControlCenterStatusIcon } from "./control-center-status-icon";

type SetupScreenProps = {
  busyAction?: string | null;
  companionStatus: CompanionStatus;
  deviceCandidates?: DeviceCandidate[];
  deviceSearchState?: DeviceSearchState;
  deviceState: DeviceState;
  deviceTarget: string;
  lastError?: ApiError | null;
  onCheckCompanion?: () => void | Promise<void>;
  onCheckUpdates?: () => void | Promise<void>;
  onDeviceTargetChange?: (target: string) => void;
  onSearchDevices?: () => void;
  onSelectDevice?: (candidate: DeviceCandidate) => void;
  onRepairConnection?: (targetOverride?: string) => void;
  onResetSetup?: () => void;
  hostedMode?: boolean;
  macAppRelease?: CompanionReleaseInfo | null;
  previewStep?: "mac-app" | null;
  requiresMacAppMigration?: boolean;
  showIntro?: boolean;
  setupComplete: boolean;
};

type StepId = "wifi" | "mac-app" | "finish";
type StepState = "active" | "blocked" | "complete" | "pending";

export function SetupScreen({
  busyAction,
  companionStatus,
  deviceCandidates = [],
  deviceSearchState = "idle",
  deviceState,
  deviceTarget,
  lastError,
  onCheckCompanion,
  onCheckUpdates,
  onDeviceTargetChange,
  onSearchDevices,
  onSelectDevice,
  onRepairConnection,
  onResetSetup,
  hostedMode = false,
  macAppRelease = null,
  previewStep,
  requiresMacAppMigration = false,
  showIntro = true,
  setupComplete,
}: SetupScreenProps) {
  const [wifiConfirmedState, setWifiConfirmedState] = useState(false);
  const [dmgDownloadStarted, setDmgDownloadStarted] = useState(false);
  const [macAppConfirmedState, setMacAppConfirmedState] = useState(false);
  const macAppMissing = isCompanionMissingError(lastError);
  const macAppReady = companionStatus === "online";
  const macAppCheckFailed = macAppMissing && macAppConfirmedState;
  const forceMacAppStep = previewStep === "mac-app";
  const macAppConfirmed =
    !forceMacAppStep &&
    !macAppMissing &&
    (macAppConfirmedState || macAppReady || setupComplete);
  const wifiConfirmed =
    wifiConfirmedState ||
    setupComplete ||
    previewStep === "mac-app" ||
    hostedMode;
  const dmgUrl = availableMacAppDmgDownloadUrl(macAppRelease);
  const macAppReleaseCheckFailed = Boolean(
    macAppRelease?.status === "check_failed" ||
      macAppRelease?.dmgDownloadStatus === "check_failed",
  );
  const macAppStepTitle = hostedMode
    ? dmgUrl
      ? "Download Mac App"
      : "Mac App download not ready"
    : dmgUrl
      ? "Update available"
      : "Update not ready";
  const showControlCenterLauncher =
    !hostedMode &&
    showIntro &&
    !previewStep &&
    !lastError &&
    setupComplete;
  const migrationNotice = requiresMacAppMigration ? (
    <LegacyMacAppMigrationNotice
      checkFailed={macAppReleaseCheckFailed}
      checking={busyAction === "firmware-check"}
      downloadUrl={dmgUrl}
      onRetry={() => void onCheckUpdates?.()}
    />
  ) : null;

  const activeStep = useMemo(
    () =>
      hostedMode
        ? "mac-app"
        : previewStep || (setupComplete || wifiConfirmed ? "finish" : "wifi"),
    [
      hostedMode,
      previewStep,
      setupComplete,
      wifiConfirmed,
    ],
  );
  const stepStates = useMemo(
    () =>
      buildStepStates({
        activeStep,
        forceMacAppStep,
        macAppConfirmed,
        macAppReady,
        setupComplete,
        wifiConfirmed,
      }),
    [
      activeStep,
      forceMacAppStep,
      macAppConfirmed,
      macAppReady,
      setupComplete,
      wifiConfirmed,
    ],
  );

  function confirmWifi() {
    setWifiConfirmedState(true);
    onSearchDevices?.();
  }

  function confirmMacApp() {
    setMacAppConfirmedState(true);
    runCheckCompanion();
  }

  function runCheckCompanion() {
    void Promise.resolve(onCheckCompanion?.()).catch(() => undefined);
  }

  function retryConnect(targetOverride?: string) {
    onRepairConnection?.(targetOverride);
  }

  if (showControlCenterLauncher) {
    return (
      <div className="mx-auto max-w-[980px]">
        {migrationNotice}
        <section className="py-8 lg:min-h-[330px] lg:py-12">
          <div className="flex items-start gap-5">
            <ControlCenterStatusIcon variant="complete">
              <Check size={38} aria-hidden />
            </ControlCenterStatusIcon>
            <div className="min-w-0">
              <h2 className="max-w-[520px] text-[clamp(2.8rem,5vw,4.5rem)] font-black leading-[1.05] tracking-normal text-[#1B1B1B]">
                Setup complete
              </h2>
              <div className="mt-6">
                <Button
                  disabled={busyAction === "reset-setup"}
                  onClick={onResetSetup}
                  size="lg"
                  type="button"
                >
                  {busyAction === "reset-setup" ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <Clipboard data-icon="inline-start" aria-hidden />
                  )}
                  <span>
                    {busyAction === "reset-setup" ? "Resetting" : "Run setup again"}
                  </span>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[980px]">
      {migrationNotice}
      {showIntro ? (
        <section className="py-8 lg:min-h-[330px] lg:py-12">
          <div className="flex items-start gap-5">
            <ControlCenterStatusIcon
              variant={setupComplete ? "complete" : "neutral"}
            >
              {setupComplete ? (
                <Check size={38} aria-hidden />
              ) : (
                <Clipboard size={34} aria-hidden />
              )}
            </ControlCenterStatusIcon>
            <div className="min-w-0">
              <h2 className="max-w-[520px] text-[clamp(2.8rem,5vw,4.5rem)] font-black leading-[1.05] tracking-normal text-[#1B1B1B]">
                {setupComplete
                  ? "Setup complete"
                  : hostedMode
                    ? "Get the VibeTV Mac App"
                    : "Set up your VibeTV"}
              </h2>
              {setupComplete ? (
                <div className="mt-6 flex flex-wrap gap-3">
                  <Button
                    disabled={busyAction === "reset-setup"}
                    onClick={onResetSetup}
                    type="button"
                    variant="outline"
                  >
                    {busyAction === "reset-setup" ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <Clipboard data-icon="inline-start" aria-hidden />
                    )}
                    <span>
                      {busyAction === "reset-setup" ? "Resetting" : "Run setup again"}
                    </span>
                  </Button>
                </div>
              ) : null}
              {lastError && !macAppMissing ? (
                <ErrorNote error={lastError} />
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {!showIntro && lastError && !macAppMissing ? (
        <div className="pt-5">
          <ErrorNote error={lastError} />
        </div>
      ) : null}

      <section className="py-6">
        <ol className="grid gap-0">
          {!hostedMode && !forceMacAppStep ? (
            <SetupStep
              icon={<Wifi size={22} aria-hidden />}
              index={1}
              state={stepStates.wifi}
              title="Connect VibeTV to WiFi"
            >
              {activeStep === "wifi" ? (
                <div className="grid gap-5">
                  <ol className="grid gap-2 text-sm leading-6 text-[#444933]">
                    <li>1. Plug VibeTV into power.</li>
                    <li>2. Wait until VibeTV shows VibeTV-Setup.</li>
                    <li>3. Take your phone.</li>
                    <li>
                      4. Open WiFi settings and join{" "}
                      <strong className="font-black text-[#1B1B1B]">
                        VibeTV-Setup
                      </strong>
                      .
                    </li>
                    <li>
                      5. If the browser does not open automatically, open{" "}
                      <strong className="font-black text-[#1B1B1B]">
                        192.168.4.1
                      </strong>{" "}
                      on your phone.
                    </li>
                    <li>6. Choose your home WiFi and save.</li>
                    <li>
                      7. Wait until VibeTV says WiFi connected, then continue
                      here.
                    </li>
                  </ol>
                  <Button className="w-full" onClick={confirmWifi} size="lg" type="button">
                    <Check data-icon="inline-start" aria-hidden />
                    <span>VibeTV is on WiFi</span>
                  </Button>
                </div>
              ) : null}
            </SetupStep>
          ) : null}

          {hostedMode || forceMacAppStep ? (
            <SetupStep
              icon={<Download size={22} aria-hidden />}
              index={1}
              state={stepStates["mac-app"]}
              title={macAppStepTitle}
            >
              {activeStep === "mac-app" ? (
                <div className="grid min-w-0 gap-4">
                  {dmgUrl ? (
                    <div className="grid gap-3 border border-border bg-card p-4">
                      <Button asChild className="w-full" size="lg">
                        <a href={dmgUrl} onClick={() => setDmgDownloadStarted(true)}>
                        <Download data-icon="inline-start" />
                        <span>
                          {hostedMode
                            ? "Download Mac App"
                            : "Update"}
                        </span>
                        </a>
                      </Button>
                    </div>
                  ) : (
                    <div className="grid gap-3 border border-border bg-card p-4">
                      <p className="text-sm leading-6 text-[#444933]">
                        The signed Mac App download is not ready yet. Please try
                        again later.
                      </p>
                      <Button className="w-full" disabled size="lg" type="button">
                        <Download data-icon="inline-start" aria-hidden />
                        <span>
                          {hostedMode
                            ? "Mac App download not ready"
                            : "New Mac App not ready"}
                        </span>
                      </Button>
                    </div>
                  )}

                  {macAppCheckFailed ? (
                    <StatusNote icon={<RefreshCw size={16} aria-hidden />}>
                      Mac App did not answer. Make sure VibeTV Control Center is
                      in Applications and open, then try again.
                    </StatusNote>
                  ) : null}

                  {!hostedMode && dmgUrl ? (
                    <div className="flex flex-wrap gap-3">
                      <Button
                        className="w-full"
                        disabled={!dmgDownloadStarted || busyAction === "status"}
                        onClick={confirmMacApp}
                        size="lg"
                        type="button"
                      >
                        {busyAction === "status" ? (
                          <Spinner data-icon="inline-start" />
                        ) : (
                          <Check data-icon="inline-start" aria-hidden />
                        )}
                        <span>
                          {busyAction === "status" ? "Checking" : "Mac App is installed"}
                        </span>
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </SetupStep>
          ) : null}

          {!hostedMode && !forceMacAppStep ? (
            <SetupStep
              icon={<Monitor size={22} aria-hidden />}
              index={2}
              state={stepStates.finish}
              title="Verify VibeTV connection"
            >
              {activeStep === "finish" ? (
                <FinishSetupContent
                  busyAction={busyAction}
                  deviceCandidates={deviceCandidates}
                  deviceSearchState={deviceSearchState}
                  deviceState={deviceState}
                  deviceTarget={deviceTarget}
                  lastError={lastError}
                  onDeviceTargetChange={onDeviceTargetChange}
                  onSearchDevices={onSearchDevices}
                  onSelectDevice={onSelectDevice}
                  onRepairConnection={retryConnect}
                  setupComplete={setupComplete}
                />
              ) : null}
            </SetupStep>
          ) : null}
        </ol>
      </section>
    </div>
  );
}

function LegacyMacAppMigrationNotice({
  checkFailed,
  checking,
  downloadUrl,
  onRetry,
}: {
  checkFailed: boolean;
  checking: boolean;
  downloadUrl?: string;
  onRetry: () => void;
}) {
  return (
    <section className="py-6">
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="flex min-w-0 items-start gap-4">
          <ControlCenterStatusIcon size="step" variant="active">
            <Download size={22} aria-hidden />
          </ControlCenterStatusIcon>
          <div className="min-w-0">
            <h2 className="text-2xl font-black text-[#1B1B1B]">
              {downloadUrl ? "Update available" : "Update not ready"}
            </h2>
          </div>
        </div>
        {downloadUrl ? (
          <Button asChild className="w-full sm:w-auto" size="lg">
            <a href={downloadUrl}><Download data-icon="inline-start" /><span>Update</span></a>
          </Button>
        ) : checkFailed ? (
          <Button
            className="w-full"
            disabled={checking}
            onClick={onRetry}
            size="lg"
            type="button"
          >
            {checking ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RefreshCw data-icon="inline-start" aria-hidden />
            )}
            <span>{checking ? "Checking" : "Check again"}</span>
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function FinishSetupContent({
  busyAction,
  deviceCandidates,
  deviceSearchState,
  deviceState,
  deviceTarget,
  lastError,
  onDeviceTargetChange,
  onSearchDevices,
  onSelectDevice,
  onRepairConnection,
  setupComplete,
}: {
  busyAction?: string | null;
  deviceCandidates: DeviceCandidate[];
  deviceSearchState: DeviceSearchState;
  deviceState: DeviceState;
  deviceTarget: string;
  lastError?: ApiError | null;
  onDeviceTargetChange?: (target: string) => void;
  onSearchDevices?: () => void;
  onSelectDevice?: (candidate: DeviceCandidate) => void;
  onRepairConnection?: (targetOverride?: string) => void;
  setupComplete: boolean;
}) {
  if (setupComplete) {
    return <StatusNote>VibeTV is ready.</StatusNote>;
  }

  if (deviceSearchState === "searching" || busyAction === "search") {
    return (
      <StatusNote
        icon={<Loader2 className="animate-spin" size={16} aria-hidden />}
      >
        Searching for VibeTVs on your WiFi...
      </StatusNote>
    );
  }

  if (deviceSearchState === "multiple") {
    return (
      <div className="grid gap-4">
        <p className="text-sm leading-6 text-[#444933]">
          More than one VibeTV was found. Choose the one you want to connect.
        </p>
        <div className="grid gap-3">
          {deviceCandidates.map((candidate) => (
            <Button
              disabled={Boolean(busyAction)}
              key={`${candidate.deviceId || "legacy"}-${candidate.target}`}
              onClick={() => onSelectDevice?.(candidate)}
              type="button"
              variant="outline"
            >
              <Monitor data-icon="inline-start" aria-hidden />
              <span>{candidateLabel(candidate)}</span>
            </Button>
          ))}
        </div>
      </div>
    );
  }

  if (deviceSearchState === "not-found") {
    return (
      <div className="grid gap-5">
        <p className="text-sm leading-6 text-[#444933]">
          No VibeTV was found automatically. Enter the address shown on the
          VibeTV screen.
        </p>
        <DeviceTargetForm
          busy={busyAction === "repair"}
          buttonLabel="Connect VibeTV"
          className="grid gap-4"
          disabled={Boolean(busyAction)}
          id="setup-device-target"
          lastError={lastError}
          onChange={onDeviceTargetChange}
          onSubmit={onRepairConnection}
          searchingLabel="Connecting"
          value={deviceTarget}
        />
      </div>
    );
  }

  if (deviceSearchState === "failed") {
    return (
      <div className="grid gap-4">
        <p className="text-sm leading-6 text-[#444933]">
          Automatic search could not finish. Make sure VibeTV and this Mac are
          on the same WiFi, then try again.
        </p>
        <Button className="w-full" onClick={onSearchDevices} size="lg" type="button">
          <RefreshCw data-icon="inline-start" aria-hidden />
          <span>Try again</span>
        </Button>
      </div>
    );
  }

  if (deviceSearchState === "repair-failed") {
    return (
      <div className="grid gap-4">
        <p className="text-sm leading-6 text-[#444933]">
          VibeTV could not reconnect automatically. Make sure it is on the same
          WiFi as this Mac, then try again.
        </p>
        <Button className="w-full" onClick={onSearchDevices} size="lg" type="button">
          <RefreshCw data-icon="inline-start" aria-hidden />
          <span>Try again</span>
        </Button>
      </div>
    );
  }

  if (
    busyAction === "connect" ||
    busyAction === "discover" ||
    busyAction === "repair"
  ) {
    return (
      <StatusNote
        icon={<Loader2 className="animate-spin" size={16} aria-hidden />}
      >
        Reconnecting VibeTV...
      </StatusNote>
    );
  }

  return (
    <StatusNote>
      {deviceState === "offline"
        ? "VibeTV is offline. Run setup again to search for it."
        : "Waiting for automatic VibeTV search."}
    </StatusNote>
  );
}

function candidateLabel(candidate: DeviceCandidate): string {
  const details = [candidate.target];
  if (candidate.firmware) {
    details.push(`Firmware ${candidate.firmware}`);
  }
  return details.join(" · ");
}

function SetupStep({
  children,
  icon,
  index,
  state,
  title,
}: {
  children?: ReactNode;
  icon: ReactNode;
  index: number;
  state: StepState;
  title: string;
}) {
  const active = state === "active";
  const complete = state === "complete";
  return (
    <li
      className={`grid gap-4 border-b border-border px-0 py-5 last:border-b-0 md:grid-cols-[54px_minmax(0,1fr)] ${
        state === "blocked" ? "opacity-45" : ""
      }`}
    >
      <ControlCenterStatusIcon
        size="step"
        variant={complete ? "complete" : active ? "active" : "pending"}
      >
        {complete ? <Check size={22} aria-hidden /> : icon}
      </ControlCenterStatusIcon>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-bold uppercase text-[#506600]">
            Step {index}
          </p>
          <h3 className="text-xl font-black text-[#1B1B1B]">{title}</h3>
        </div>
        {children ? <div className="mt-4 min-w-0">{children}</div> : null}
      </div>
    </li>
  );
}

function StatusNote({
  children,
  icon,
}: {
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Alert className="max-w-[560px]" role="status">
      {icon || <Check aria-hidden />}
      <AlertTitle>{children}</AlertTitle>
    </Alert>
  );
}

function ErrorNote({ error }: { error: ApiError }) {
  return (
    <Alert className="mt-4 max-w-[560px]" variant="destructive">
      <CircleHelp aria-hidden />
      <AlertTitle>{error.message}</AlertTitle>
      <AlertDescription>{error.nextAction}</AlertDescription>
    </Alert>
  );
}

function buildStepStates({
  activeStep,
  forceMacAppStep,
  macAppConfirmed,
  macAppReady,
  setupComplete,
  wifiConfirmed,
}: {
  activeStep: StepId;
  forceMacAppStep: boolean;
  macAppConfirmed: boolean;
  macAppReady: boolean;
  setupComplete: boolean;
  wifiConfirmed: boolean;
}): Record<StepId, StepState> {
  return {
    wifi:
      wifiConfirmed || setupComplete
        ? "complete"
        : activeStep === "wifi"
          ? "active"
          : "blocked",
    "mac-app": forceMacAppStep
      ? "active"
      : macAppConfirmed || macAppReady || setupComplete
        ? "complete"
        : activeStep === "mac-app"
          ? "active"
          : wifiConfirmed
            ? "pending"
            : "blocked",
    finish: forceMacAppStep
      ? "blocked"
      : setupComplete
        ? "complete"
        : activeStep === "finish"
          ? "active"
          : "blocked",
  };
}

function isCompanionMissingError(error?: ApiError | null): boolean {
  return error?.code === "COMPANION_UNREACHABLE";
}
