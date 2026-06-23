"use client";

import {
  Check,
  Clipboard,
  Copy,
  Download,
  Loader2,
  Monitor,
  RefreshCw,
  Wifi,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  ApiError,
  CompanionStatus,
  DeviceInfo,
  DeviceState,
} from "./control-center-types";
import { DeviceTargetForm } from "./device-target-form";

const AGENT_PROMPT = `Please install the VibeTV Mac App on this Mac.

VibeTV is a small WiFi desk display for showing usage and theme screens. Its firmware and Mac App source are open source here:
https://github.com/DreamyTalesPAN/CodexBar-Display

First check whether you can run Terminal commands on this Mac.

If you can run Terminal commands:
- check whether the required command-line tools are available
- if a required tool is missing, install the missing dependency first
- if macOS asks for admin approval, system permission, or manual approval, stop and tell me exactly what to approve

If you cannot run Terminal commands:
- do not stop
- tell me this prompt works best in a local coding agent with Terminal access, for example Claude Code or Codex
- if I can use one of those tools, tell me to paste this full prompt there instead
- if I cannot use one of those tools, continue with the manual steps below
- guide me click by click
- tell me to press Command + Space
- tell me to type Terminal
- tell me to press Enter
- tell me exactly what to paste
- tell me to press Enter again
- ask me to send you a screenshot of the result
- read the screenshot, decide whether setup worked, and give me the next exact step

Run this Terminal command:

curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install-control-center-companion.sh | bash

After it finishes, verify it with:

curl -fsS http://127.0.0.1:47832/v1/status

Then tell me:
- what was installed
- whether any dependencies were installed
- whether the status check worked
- the next step: return to app.vibetv.shop, choose Allow when the browser asks for access, and continue setup

Do not flash firmware, install themes, reset WiFi, or write to my VibeTV. Only install and verify the Mac App.`;

const TERMINAL_COMMAND =
  "curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install-control-center-companion.sh | bash";

type SetupScreenProps = {
  busyAction?: string | null;
  companionStatus: CompanionStatus;
  device: DeviceInfo | null;
  deviceState: DeviceState;
  deviceTarget: string;
  lastError?: ApiError | null;
  onCheckCompanion?: () => void | Promise<void>;
  onConnectDevice?: (targetOverride?: string) => void;
  onDeviceTargetChange?: (target: string) => void;
  previewStep?: "mac-app" | null;
  setupComplete: boolean;
  themeInstallEnabled: boolean;
};

type StepId = "wifi" | "mac-app" | "browser-access" | "finish";
type SetupMode = "agentic" | "manual";
type StepState = "active" | "blocked" | "complete" | "pending";

export function SetupScreen({
  busyAction,
  companionStatus,
  device,
  deviceState,
  deviceTarget,
  lastError,
  onCheckCompanion,
  onConnectDevice,
  onDeviceTargetChange,
  previewStep,
  setupComplete,
  themeInstallEnabled,
}: SetupScreenProps) {
  const [wifiConfirmedState, setWifiConfirmedState] = useState(false);
  const [agentPromptCopied, setAgentPromptCopied] = useState(false);
  const [promptPreviewOpen, setPromptPreviewOpen] = useState(false);
  const [terminalCommandCopied, setTerminalCommandCopied] = useState(false);
  const [setupMode, setSetupMode] = useState<SetupMode>("agentic");
  const autoConnectStarted = useRef(false);
  const localAccessNeeded = isLocalNetworkAccessError(lastError);
  const macAppReady = companionStatus === "online";
  const connected = Boolean(device?.connected && device.paired);
  const wifiConfirmed =
    wifiConfirmedState || setupComplete || previewStep === "mac-app";
  const connecting = busyAction === "connect" || busyAction === "discover";

  useEffect(() => {
    if (
      !wifiConfirmed ||
      !macAppReady ||
      setupComplete ||
      connected ||
      connecting ||
      localAccessNeeded ||
      autoConnectStarted.current
    ) {
      return;
    }
    autoConnectStarted.current = true;
    onConnectDevice?.();
  }, [
    connected,
    connecting,
    localAccessNeeded,
    macAppReady,
    onConnectDevice,
    setupComplete,
    wifiConfirmed,
  ]);

  const activeStep = useMemo(
    () =>
      previewStep ||
      buildActiveStep({
        companionStatus,
        localAccessNeeded,
        macAppReady,
        setupComplete,
        wifiConfirmed,
      }),
    [
      companionStatus,
      localAccessNeeded,
      macAppReady,
      previewStep,
      setupComplete,
      wifiConfirmed,
    ],
  );
  const stepStates = useMemo(
    () =>
      buildStepStates({
        activeStep,
        macAppReady,
        setupComplete,
        wifiConfirmed,
      }),
    [activeStep, macAppReady, setupComplete, wifiConfirmed],
  );

  function confirmWifi() {
    setWifiConfirmedState(true);
    runCheckCompanion();
  }

  function runCheckCompanion() {
    void Promise.resolve(onCheckCompanion?.()).catch(() => undefined);
  }

  function retryConnect() {
    autoConnectStarted.current = true;
    onConnectDevice?.();
  }

  return (
    <div className="mx-auto max-w-[980px]">
      <section className="border-b border-[#747A60] py-8 lg:min-h-[330px] lg:py-12">
        <div className="flex items-start gap-5">
          <div className="grid size-16 shrink-0 place-items-center rounded-full border border-[#747A60] bg-[#EEEEEE] text-[#1B1B1B]">
            {setupComplete ? (
              <Check size={38} aria-hidden />
            ) : (
              <Clipboard size={34} aria-hidden />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="max-w-[520px] text-[clamp(2.8rem,5vw,4.5rem)] font-black leading-[1.05] tracking-normal text-[#1B1B1B]">
              {setupComplete ? "Setup complete" : "Set up your VibeTV"}
            </h2>
          </div>
        </div>
      </section>

      <section className="py-6">
        <ol className="grid gap-0 border-y border-[#747A60]">
          <SetupStep
            icon={<Wifi size={22} aria-hidden />}
            index={1}
            state={stepStates.wifi}
            title="Connect VibeTV to WiFi"
          >
            {activeStep === "wifi" ? (
              <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <ol className="grid gap-2 text-sm leading-6 text-[#444933]">
                  <li>1. Take your phone.</li>
                  <li>
                    2. Open WiFi settings and join{" "}
                    <strong className="font-black text-[#1B1B1B]">
                      VibeTV-Setup
                    </strong>
                    .
                  </li>
                  <li>
                    3. Open{" "}
                    <strong className="font-black text-[#1B1B1B]">
                      192.168.4.1
                    </strong>{" "}
                    on your phone.
                  </li>
                  <li>4. Choose your home WiFi and save.</li>
                  <li>
                    5. Wait until VibeTV says WiFi connected, then continue
                    here.
                  </li>
                </ol>
                <PrimaryButton
                  icon={<Check size={18} aria-hidden />}
                  label="VibeTV is on WiFi"
                  onClick={confirmWifi}
                />
              </div>
            ) : null}
          </SetupStep>

          <SetupStep
            icon={<Download size={22} aria-hidden />}
            index={2}
            state={stepStates["mac-app"]}
            title="Install Mac App"
          >
            {activeStep === "mac-app" ? (
              <div className="grid min-w-0 gap-4">
                <div
                  aria-label="Mac App setup method"
                  className="grid max-w-[440px] grid-cols-2 border border-[#747A60]"
                  role="tablist"
                >
                  <SetupModeTab
                    active={setupMode === "agentic"}
                    label="Agentic setup"
                    onClick={() => setSetupMode("agentic")}
                  />
                  <SetupModeTab
                    active={setupMode === "manual"}
                    label="Manual setup"
                    onClick={() => setSetupMode("manual")}
                  />
                </div>

                {setupMode === "agentic" ? (
                  <div className="grid min-w-0 gap-4">
                    <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                      <div className="min-w-0 max-w-full overflow-hidden border border-[#747A60] bg-[#F9F9F9]">
                        <button
                          aria-expanded={promptPreviewOpen}
                          className="flex min-h-12 w-full items-center justify-between gap-4 px-4 py-3 text-left text-sm font-bold text-[#1B1B1B]"
                          onClick={() =>
                            setPromptPreviewOpen((current) => !current)
                          }
                          type="button"
                        >
                          <span>Prompt preview</span>
                          <span className="text-[#506600]">
                            {promptPreviewOpen ? "Hide" : "Show"}
                          </span>
                        </button>
                        {!promptPreviewOpen ? (
                          <p className="border-t border-[#747A60] px-4 py-3 text-xs leading-5 text-[#444933] [overflow-wrap:anywhere]">
                            Please install the VibeTV Mac App on this Mac.
                            VibeTV is a small WiFi desk display for showing
                            usage and theme screens.
                          </p>
                        ) : null}
                        {promptPreviewOpen ? (
                          <pre className="max-h-[280px] w-full max-w-full overflow-auto whitespace-pre-wrap border-t border-[#747A60] bg-[#EEEEEE] p-4 text-xs leading-5 text-[#1B1B1B] [overflow-wrap:anywhere]">
                            {AGENT_PROMPT}
                          </pre>
                        ) : null}
                      </div>
                      <PrimaryButton
                        icon={<Copy size={18} aria-hidden />}
                        label={agentPromptCopied ? "Prompt copied" : "Copy prompt"}
                        onClick={async () => {
                          await copyText(AGENT_PROMPT);
                          setAgentPromptCopied(true);
                        }}
                      />
                    </div>

                    {agentPromptCopied ? (
                      <StatusNote>
                        Paste the prompt into your coding agent. This page will
                        move on when the Mac App is running.
                      </StatusNote>
                    ) : null}
                  </div>
                ) : null}

                {setupMode === "manual" ? (
                  <div className="grid gap-3 border border-[#747A60] bg-[#F9F9F9] p-4">
                    <p className="text-sm leading-6 text-[#444933]">
                      Open Terminal, paste this command, then press Enter.
                    </p>
                    <code className="block overflow-x-auto border border-[#747A60] bg-[#EEEEEE] p-3 text-xs text-[#1B1B1B]">
                      {TERMINAL_COMMAND}
                    </code>
                    <SecondaryButton
                      icon={<Copy size={16} aria-hidden />}
                      label={
                        terminalCommandCopied
                          ? "Command copied"
                          : "Copy terminal command"
                      }
                      onClick={async () => {
                        await copyText(TERMINAL_COMMAND);
                        setTerminalCommandCopied(true);
                      }}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
          </SetupStep>

          <SetupStep
            icon={<Wifi size={22} aria-hidden />}
            index={3}
            state={stepStates["browser-access"]}
            title="Allow browser access"
          >
            {activeStep === "browser-access" ? (
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <p className="text-sm leading-6 text-[#444933]">
                  Chrome needs permission so this website can talk to the Mac
                  App on this computer.
                </p>
                <PrimaryButton
                  busy={busyAction === "status"}
                  busyLabel="Checking"
                  icon={<Wifi size={18} aria-hidden />}
                  label="Allow access"
                  onClick={runCheckCompanion}
                />
              </div>
            ) : null}
          </SetupStep>

          <SetupStep
            icon={<Monitor size={22} aria-hidden />}
            index={4}
            state={stepStates.finish}
            title="Finish setup"
          >
            {activeStep === "finish" ? (
              <FinishSetupContent
                busyAction={busyAction}
                connected={connected}
                deviceState={deviceState}
                deviceTarget={deviceTarget}
                lastError={lastError}
                onConnectDevice={retryConnect}
                onDeviceTargetChange={onDeviceTargetChange}
                setupComplete={setupComplete}
                themeInstallEnabled={themeInstallEnabled}
              />
            ) : null}
          </SetupStep>
        </ol>
      </section>
    </div>
  );
}

function FinishSetupContent({
  busyAction,
  connected,
  deviceState,
  deviceTarget,
  lastError,
  onConnectDevice,
  onDeviceTargetChange,
  setupComplete,
  themeInstallEnabled,
}: {
  busyAction?: string | null;
  connected: boolean;
  deviceState: DeviceState;
  deviceTarget: string;
  lastError?: ApiError | null;
  onConnectDevice?: (targetOverride?: string) => void;
  onDeviceTargetChange?: (target: string) => void;
  setupComplete: boolean;
  themeInstallEnabled: boolean;
}) {
  if (setupComplete) {
    return <StatusNote>VibeTV is ready.</StatusNote>;
  }

  if (connected && !themeInstallEnabled) {
    return (
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <p className="text-sm leading-6 text-[#444933]">
          The Mac App is connected but needs an update before themes can be
          installed.
        </p>
        <PrimaryButton
          icon={<RefreshCw size={18} aria-hidden />}
          label="Check again"
          onClick={() => onConnectDevice?.()}
        />
      </div>
    );
  }

  if (busyAction === "connect" || busyAction === "discover") {
    return (
      <StatusNote
        icon={<Loader2 className="animate-spin" size={16} aria-hidden />}
      >
        Connecting VibeTV...
      </StatusNote>
    );
  }

  if (deviceState === "offline") {
    return (
      <div className="grid gap-5">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <p className="text-sm leading-6 text-[#444933]">
            Make sure VibeTV is powered on and connected to the same WiFi.
          </p>
          <PrimaryButton
            icon={<RefreshCw size={18} aria-hidden />}
            label="Try again"
            onClick={() => onConnectDevice?.()}
          />
        </div>
        <DeviceTargetForm
          busy={busyAction === "connect"}
          buttonLabel="Use this address"
          className="grid gap-4"
          disabled={Boolean(busyAction)}
          id="setup-device-target"
          lastError={lastError}
          onChange={onDeviceTargetChange}
          onSubmit={onConnectDevice}
          searchingLabel="Connecting"
          value={deviceTarget}
        />
      </div>
    );
  }

  return (
    <StatusNote
      icon={<Loader2 className="animate-spin" size={16} aria-hidden />}
    >
      Connecting VibeTV...
    </StatusNote>
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
      <div
        className={`grid size-11 place-items-center rounded-full border ${
          complete
            ? "border-[#1B1B1B] bg-[#CCFF00] text-[#1B1B1B]"
            : active
              ? "border-[#1B1B1B] bg-[#1B1B1B] text-[#CCFF00]"
              : "border-[#747A60] bg-[#F9F9F9] text-[#506600]"
        }`}
      >
        {complete ? <Check size={22} aria-hidden /> : icon}
      </div>
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

function SetupModeTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-selected={active}
      className={`min-h-12 border-r border-[#747A60] px-4 py-2 text-sm font-black last:border-r-0 ${
        active
          ? "bg-[#1B1B1B] text-[#EDEDED]"
          : "bg-[#F9F9F9] text-[#1B1B1B] hover:bg-[#EEEEEE]"
      }`}
      onClick={onClick}
      role="tab"
      type="button"
    >
      {label}
    </button>
  );
}

function PrimaryButton({
  busy,
  busyLabel,
  icon,
  label,
  onClick,
}: {
  busy?: boolean;
  busyLabel?: string;
  icon?: ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      className="inline-flex min-h-12 min-w-[220px] items-center justify-center gap-2 border border-[#1B1B1B] bg-[#1B1B1B] px-5 py-2 text-sm font-bold text-[#EDEDED] transition hover:bg-[#CCFF00] hover:text-[#1B1B1B] disabled:cursor-not-allowed disabled:border-[#747A60] disabled:bg-[#EEEEEE] disabled:text-[#444933]"
      disabled={busy}
      onClick={onClick}
      type="button"
    >
      {busy ? <Loader2 className="animate-spin" size={18} aria-hidden /> : icon}
      <span>{busy ? busyLabel || label : label}</span>
    </button>
  );
}

function SecondaryButton({
  icon,
  label,
  onClick,
}: {
  icon?: ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      className="inline-flex min-h-12 min-w-[190px] items-center justify-center gap-2 border border-[#747A60] bg-[#F9F9F9] px-5 py-2 text-sm font-semibold text-[#1B1B1B] transition hover:bg-[#EEEEEE]"
      onClick={onClick}
      type="button"
    >
      {icon}
      <span>{label}</span>
    </button>
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

function buildActiveStep({
  companionStatus,
  localAccessNeeded,
  macAppReady,
  setupComplete,
  wifiConfirmed,
}: {
  companionStatus: CompanionStatus;
  localAccessNeeded: boolean;
  macAppReady: boolean;
  setupComplete: boolean;
  wifiConfirmed: boolean;
}): StepId {
  if (setupComplete) {
    return "finish";
  }
  if (!wifiConfirmed) {
    return "wifi";
  }
  if (localAccessNeeded) {
    return "browser-access";
  }
  if (!macAppReady && companionStatus !== "online") {
    return "mac-app";
  }
  return "finish";
}

function buildStepStates({
  activeStep,
  macAppReady,
  setupComplete,
  wifiConfirmed,
}: {
  activeStep: StepId;
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
    "mac-app": macAppReady
      ? "complete"
      : activeStep === "mac-app"
        ? "active"
        : wifiConfirmed
          ? "pending"
          : "blocked",
    "browser-access": macAppReady
      ? "complete"
      : activeStep === "browser-access"
        ? "active"
        : "blocked",
    finish: setupComplete
      ? "complete"
      : activeStep === "finish"
        ? "active"
        : "blocked",
  };
}

function isLocalNetworkAccessError(error?: ApiError | null): boolean {
  return error?.code === "LOCAL_NETWORK_ACCESS_REQUIRED";
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}
