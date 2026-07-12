"use client";

import {
  Check,
  Clipboard,
  Download,
  Loader2,
  Monitor,
  RefreshCw,
  Wifi,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { CompanionReleaseInfo } from "@/lib/companion-release";
import type {
  ApiError,
  CompanionStatus,
  DeviceState,
} from "./control-center-types";
import { ControlCenterButton } from "./control-center-button";
import { DeviceTargetForm } from "./device-target-form";
import { ControlCenterStatusIcon } from "./control-center-status-icon";

type SetupScreenProps = {
  busyAction?: string | null;
  companionStatus: CompanionStatus;
  deviceState: DeviceState;
  deviceTarget: string;
  lastError?: ApiError | null;
  onCheckCompanion?: () => void | Promise<void>;
  onDeviceTargetChange?: (target: string) => void;
  onRepairConnection?: (targetOverride?: string) => void;
  onResetSetup?: () => void;
  hostedMode?: boolean;
  macAppRelease?: CompanionReleaseInfo | null;
  previewStep?: "mac-app" | null;
  showIntro?: boolean;
  setupComplete: boolean;
};

type StepId = "wifi" | "mac-app" | "finish";
type StepState = "active" | "blocked" | "complete" | "pending";

export function SetupScreen({
  busyAction,
  companionStatus,
  deviceState,
  deviceTarget,
  lastError,
  onCheckCompanion,
  onDeviceTargetChange,
  onRepairConnection,
  onResetSetup,
  hostedMode = false,
  macAppRelease = null,
  previewStep,
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
  const dmgUrl = macAppRelease?.dmgDownloadUrl;
  const macAppStepTitle = hostedMode
    ? dmgUrl
      ? "Download Mac App"
      : "Mac App download not ready"
    : dmgUrl
      ? "Update Mac App"
      : "Mac App update not ready";
  const showControlCenterLauncher =
    !hostedMode &&
    showIntro &&
    !previewStep &&
    !lastError &&
    setupComplete;

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
    onRepairConnection?.();
  }

  function confirmMacApp() {
    setMacAppConfirmedState(true);
    runCheckCompanion();
  }

  function runCheckCompanion() {
    void Promise.resolve(onCheckCompanion?.()).catch(() => undefined);
  }

  function retryConnect() {
    onRepairConnection?.();
  }

  if (showControlCenterLauncher) {
    return (
      <div className="mx-auto max-w-[980px]">
        <section className="border-b border-[#747A60] py-8 lg:min-h-[330px] lg:py-12">
          <div className="flex items-start gap-5">
            <ControlCenterStatusIcon variant="complete">
              <Check size={38} aria-hidden />
            </ControlCenterStatusIcon>
            <div className="min-w-0">
              <h2 className="max-w-[520px] text-[clamp(2.8rem,5vw,4.5rem)] font-black leading-[1.05] tracking-normal text-[#1B1B1B]">
                Setup complete
              </h2>
              <div className="mt-6">
                <PrimaryButton
                  busy={busyAction === "reset-setup"}
                  busyLabel="Resetting"
                  icon={<Clipboard size={18} aria-hidden />}
                  label="Run setup again"
                  onClick={onResetSetup}
                  size="large"
                />
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[980px]">
      {showIntro ? (
        <section className="border-b border-[#747A60] py-8 lg:min-h-[330px] lg:py-12">
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
                  <SecondaryButton
                    busy={busyAction === "reset-setup"}
                    busyLabel="Resetting"
                    icon={<Clipboard size={16} aria-hidden />}
                    label="Run setup again"
                    onClick={onResetSetup}
                  />
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
        <ol className="grid gap-0 border-y border-[#747A60]">
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
                  <PrimaryButton
                    fullWidth
                    icon={<Check size={18} aria-hidden />}
                    label="VibeTV is on WiFi"
                    onClick={confirmWifi}
                    size="large"
                  />
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
                    <div className="grid gap-3 border border-[#747A60] bg-[#F9F9F9] p-4">
                      <p className="text-sm leading-6 text-[#444933]">
                        {hostedMode
                          ? "Download VibeTV Control Center, open the DMG, drag the app into Applications, then open it."
                          : "Download the latest VibeTV Control Center, replace the copy in Applications, then open it again."}
                      </p>
                      <a
                        className="vibetv-button vibetv-button--large vibetv-button--full vibetv-button--primary"
                        href={dmgUrl}
                        onClick={() => setDmgDownloadStarted(true)}
                      >
                        <Download size={18} aria-hidden />
                        <span>
                          {hostedMode
                            ? "Download Mac App"
                            : "Download Mac App update"}
                        </span>
                      </a>
                    </div>
                  ) : (
                    <div className="grid gap-3 border border-[#747A60] bg-[#F9F9F9] p-4">
                      <p className="text-sm leading-6 text-[#444933]">
                        The signed Mac App download is not ready yet. Please try
                        again later.
                      </p>
                      <PrimaryButton
                        disabled
                        fullWidth
                        icon={<Download size={18} aria-hidden />}
                        label={
                          hostedMode
                            ? "Mac App download not ready"
                            : "Mac App update not ready"
                        }
                        size="large"
                      />
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
                      <PrimaryButton
                        busy={busyAction === "status"}
                        busyLabel="Checking"
                        disabled={!dmgDownloadStarted}
                        fullWidth
                        icon={<Check size={18} aria-hidden />}
                        label="Mac App is installed"
                        onClick={confirmMacApp}
                        size="large"
                      />
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
                  deviceState={deviceState}
                  deviceTarget={deviceTarget}
                  lastError={lastError}
                  onDeviceTargetChange={onDeviceTargetChange}
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

function FinishSetupContent({
  busyAction,
  deviceState,
  deviceTarget,
  lastError,
  onDeviceTargetChange,
  onRepairConnection,
  setupComplete,
}: {
  busyAction?: string | null;
  deviceState: DeviceState;
  deviceTarget: string;
  lastError?: ApiError | null;
  onDeviceTargetChange?: (target: string) => void;
  onRepairConnection?: (targetOverride?: string) => void;
  setupComplete: boolean;
}) {
  if (setupComplete) {
    return <StatusNote>VibeTV is ready.</StatusNote>;
  }

  if (deviceState === "offline") {
    return (
      <div className="grid gap-5">
        <p className="text-sm leading-6 text-[#444933]">
          Make sure VibeTV is powered on and connected to the same WiFi.
        </p>
        <DeviceTargetForm
          busy={busyAction === "repair"}
          buttonLabel="Fix connection"
          className="grid gap-4"
          disabled={Boolean(busyAction)}
          id="setup-device-target"
          lastError={lastError}
          onChange={onDeviceTargetChange}
          onSubmit={onRepairConnection}
          searchingLabel="Reconnecting"
          value={deviceTarget}
        />
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
    <div className="grid gap-4">
      <p className="text-sm leading-6 text-[#444933]">
        Make sure VibeTV is powered on and connected to the same WiFi.
      </p>
      <DeviceTargetForm
        busy={busyAction === "repair"}
        buttonLabel="Fix connection"
        className="grid gap-4"
        disabled={Boolean(busyAction)}
        id="setup-device-target"
        lastError={lastError}
        onChange={onDeviceTargetChange}
        onSubmit={onRepairConnection}
        searchingLabel="Reconnecting"
        value={deviceTarget}
      />
    </div>
  );
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
      className={`grid gap-4 border-b border-[#747A60] px-0 py-5 last:border-b-0 md:grid-cols-[54px_minmax(0,1fr)] ${
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

function PrimaryButton({
  busy,
  busyLabel,
  disabled,
  fullWidth,
  icon,
  label,
  onClick,
  size,
}: {
  busy?: boolean;
  busyLabel?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  icon?: ReactNode;
  label: string;
  onClick?: () => void;
  size?: "default" | "large" | "compact";
}) {
  return (
    <ControlCenterButton
      busy={busy}
      busyLabel={busyLabel}
      disabled={disabled}
      fullWidth={fullWidth}
      icon={icon}
      label={label}
      onClick={onClick}
      size={size}
      variant="primary"
    />
  );
}

function SecondaryButton({
  busy,
  busyLabel,
  disabled,
  fullWidth,
  icon,
  label,
  onClick,
  size,
}: {
  busy?: boolean;
  busyLabel?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  icon?: ReactNode;
  label: string;
  onClick?: () => void;
  size?: "default" | "large" | "compact";
}) {
  return (
    <ControlCenterButton
      busy={busy}
      busyLabel={busyLabel}
      disabled={disabled}
      fullWidth={fullWidth}
      icon={icon}
      label={label}
      onClick={onClick}
      size={size}
      variant="secondary"
    />
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
    <div
      className="inline-flex min-h-12 items-center gap-2 border border-[#747A60] bg-[#F9F9F9] px-4 py-2 text-sm font-semibold text-[#444933]"
      role="status"
    >
      {icon || <Check size={16} aria-hidden />}
      <span>{children}</span>
    </div>
  );
}

function ErrorNote({ error }: { error: ApiError }) {
  return (
    <div
      className="mt-4 grid max-w-[560px] gap-1 border border-[#747A60] bg-[#F9F9F9] px-4 py-3 text-sm text-[#444933]"
      role="alert"
    >
      <strong className="font-black text-[#1B1B1B]">{error.message}</strong>
      <span>{error.nextAction}</span>
    </div>
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
