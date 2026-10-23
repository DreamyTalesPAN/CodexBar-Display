"use client";

import { Button } from "@/components/ui/button";
import { ItemGroup } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Cable, LockKeyhole, Wifi } from "lucide-react";
import { useState, type FormEvent } from "react";
import type {
  ApiError,
  DeviceCandidate,
  DeviceInfo,
  SupportDiagnostics,
  UsageSnapshot,
  WiFiNetwork,
} from "../control-center-types";
import type { DisplayFrameSnapshot } from "../live-vibetv-preview";
import { useHardware3D } from "./setup-3d-preview";
import { candidateKey, type SetupTransport } from "./setup-connection";
import { SetupDeviceCard } from "./setup-device-card";
import {
  type MacAppUpdateOffer,
  SetupCableHelpDialog,
  SetupMacAppUpdateDialog,
} from "./setup-device-dialogs";
import { SelectionDot, calmCardClass, moveAmongRadios } from "./setup-selectable-card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { ConnectPhase } from "./setup-connect-log";
import { SetupLog, type SetupLogLine } from "./setup-log";
import {
  CALM_BUTTON_CLASS,
  CALM_LINK_CLASS,
  CALM_SUBTITLE_CLASS,
  CALM_TITLE_CLASS,
  SetupWizardScreen,
  SetupWizardSubtitle,
  SetupWizardTitle,
} from "./setup-wizard-screen";

/** Label and field of the WiFi form: 13px, labels semibold, 44px fields. */
const CALM_LABEL_CLASS = "text-[13px] font-semibold";
const CALM_INPUT_CLASS = "h-11 w-full text-[13px] md:text-[13px]";

type SetupDeviceScreenProps = {
  candidates: DeviceCandidate[];
  /**
   * The VibeTV the app is connected to and what it shows. Its row in the list
   * shows that screen on the 3D VibeTV; a VibeTV the app is not connected to
   * has no live screen yet.
   */
  previewDevice?: DeviceInfo | null;
  previewFrame?: DisplayFrameSnapshot | null;
  previewUsage?: UsageSnapshot | null;
  alternativeTransport?: SetupTransport;
  connecting?: boolean;
  /** Names the work in flight, so the button reports it instead of "Connecting" throughout. */
  connectPhase?: ConnectPhase;
  /** Share of the firmware really written, from the update's own log; no bar without it. */
  firmwarePercent?: number;
  logLines: SetupLogLine[];
  /** A newer Mac App exists; offered first while no VibeTV turns up (#561). */
  macAppUpdate?: MacAppUpdateOffer;
  onDismissMacAppUpdate?: () => void;
  aiFixPrompt?: () => string;
  onConnect: () => void;
  onBack?: () => void;
  /** Back was pressed while a step runs: it shows "Stopping…" until that step is over. */
  stopping?: boolean;
  onChooseTransport: (transport: SetupTransport) => void;
  onConfigureWiFi: (ssid: string, password: string) => Promise<void>;
  onEditWiFi?: () => void;
  onCreateSupportReport?: () => Promise<SupportDiagnostics | null>;
  /** The app runs on Windows; the Help menu words its outcomes for it. */
  windowsHost?: boolean;
  onEnterAddressManually: () => void;
  onSearchAgain: () => void;
  onScanWiFiNetworks: () => void;
  onSelect: (candidate: DeviceCandidate) => void;
  /** No scan has produced a result yet, so there is no count to report. */
  searching?: boolean;
  showCandidates?: boolean;
  showModeChoice?: boolean;
  selectedTarget: string | null;
  transport?: SetupTransport;
  wifiNetworks?: WiFiNetwork[];
  onWiFiError: (message: string | null) => void;
  wifiScanning?: boolean;
  wifiSetupPhase?: "credentials" | "waiting";
  wifiWaitingViaCable?: boolean;
  wifiCredentialsSent?: boolean;
};

export function SetupDeviceScreen({
  alternativeTransport,
  candidates,
  previewDevice = null,
  previewFrame = null,
  previewUsage = null,
  connecting = false,
  connectPhase,
  firmwarePercent,
  logLines,
  macAppUpdate,
  onDismissMacAppUpdate = () => {},
  aiFixPrompt,
  onConnect,
  onBack,
  stopping,
  onChooseTransport,
  onConfigureWiFi,
  onEditWiFi,
  onCreateSupportReport,
  windowsHost,
  onEnterAddressManually,
  onSearchAgain,
  onScanWiFiNetworks,
  onSelect,
  searching = false,
  showCandidates = true,
  showModeChoice = false,
  selectedTarget,
  transport,
  wifiNetworks = [],
  onWiFiError,
  wifiScanning = false,
  wifiSetupPhase,
  wifiWaitingViaCable = false,
  wifiCredentialsSent = false,
}: SetupDeviceScreenProps) {
  const preview3D = useHardware3D();
  const [wifiName, setWifiName] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [manualWiFiName, setManualWiFiName] = useState(false);
  const [wifiSubmitting, setWiFiSubmitting] = useState(false);
  const [connectionChoice, setConnectionChoice] =
    useState<SetupTransport>("cable");
  const waitingForWiFi = wifiSetupPhase === "waiting" && wifiWaitingViaCable;
  // Once the details are sent the form steps aside for the log; Edit WiFi
  // details brings it back with what was typed.
  const showWiFiForm = wifiSetupPhase === "credentials";
  const isPreviewDevice = (candidate: DeviceCandidate) =>
    Boolean(
      candidate.deviceId &&
        previewDevice?.deviceId &&
        candidate.deviceId.toLowerCase() === previewDevice.deviceId.toLowerCase(),
    );
  // The single 3D model follows the connected VibeTV's row; row 0 keeps it
  // when no row is the connected one, so one VibeTV always shows the 3D model.
  const live3DIndex = Math.max(candidates.findIndex(isPreviewDevice), 0);
  const wifiBusy = connecting || wifiSubmitting || waitingForWiFi;
  const passwordRequired = manualWiFiName ||
    wifiNetworks.find((network) => network.ssid === wifiName)?.encrypted !== false;
  const passwordMissing = passwordRequired && !wifiPassword;

  async function submitWiFi(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (wifiBusy || wifiScanning) return;
    const ssid = wifiName.trim();
    if (!ssid) {
      onWiFiError("Enter your WiFi name.");
      return;
    }
    if (passwordMissing) {
      onWiFiError("Enter your WiFi password.");
      return;
    }
    onWiFiError(null);
    setWiFiSubmitting(true);
    try {
      await onConfigureWiFi(ssid, wifiPassword);
    } catch (error) {
      const failure = error as ApiError;
      onWiFiError(
        [failure?.message, failure?.nextAction].filter(Boolean).join(" ") ||
          "VibeTV could not save these WiFi details. Check the Cable and try again.",
      );
    } finally {
      setWiFiSubmitting(false);
    }
  }

  const title = showModeChoice
    ? "How should VibeTV connect?"
    : wifiSetupPhase
      ? "Connect VibeTV to WiFi"
      : connecting && !showCandidates
        ? "Connecting to VibeTV"
        : "Choose your VibeTV";
  // The Tab stop of the group: the selected VibeTV, or the first one.
  const selectedIndex = candidates.findIndex(
    (candidate) => candidateKey(candidate) === selectedTarget,
  );
  return (
    <SetupWizardScreen
      label="Choose your VibeTV"
      aiFixPrompt={aiFixPrompt}
      // The details are being sent: nothing to leave yet.
      onBack={wifiSubmitting ? undefined : onBack}
      stopping={stopping}
      onCreateSupportReport={onCreateSupportReport}
      windowsHost={windowsHost}
    >
      <SetupWizardTitle className={CALM_TITLE_CLASS}>{title}</SetupWizardTitle>
      {/*
        Once a VibeTV is being connected the count is no longer what the
        customer is waiting on -- the log below is. Reporting one there also
        outlived its own truth: the search state is neither idle nor searching
        during a connect, so the count was the only thing left to render.
      */}
      {connecting ? null : (
        <SetupWizardSubtitle className={CALM_SUBTITLE_CLASS}>
          {showModeChoice
            ? "You can change this later in Settings."
            : showWiFiForm
              ? "Pick the network VibeTV should join. The details are sent over the cable."
              : wifiSetupPhase === "waiting"
                ? "VibeTV is connecting. The app will continue when it appears on WiFi."
                : searching
                  ? transport === "cable"
                    ? "Looking for VibeTVs connected by Cable."
                    : "Looking for VibeTVs on your WiFi."
                  : showCandidates
                    ? foundLabel(candidates.length, transport)
                    : null}
        </SetupWizardSubtitle>
      )}

      {showModeChoice ? (
        <>
          <ToggleGroup
            aria-label="Connection method"
            className="mt-8 grid w-full grid-cols-2 items-stretch gap-4"
            disabled={connecting}
            onValueChange={(value) => {
              if (value === "cable" || value === "wifi")
                setConnectionChoice(value);
            }}
            type="single"
            value={connectionChoice}
          >
            {(["cable", "wifi"] as const).map((mode) => {
              const Icon = mode === "cable" ? Cable : Wifi;
              const count = candidates.filter((candidate) =>
                mode === "cable"
                  ? candidate.transport === "cable"
                  : candidate.transport !== "cable",
              ).length;
              return (
                <ToggleGroupItem
                  aria-label={mode === "cable" ? "Cable" : "WiFi"}
                  className={cn(
                    calmCardClass(connectionChoice === mode),
                    "flex h-auto min-w-0 flex-col items-start justify-start gap-2 p-5 text-[13px] font-normal whitespace-normal hover:bg-card data-[state=on]:bg-card aria-pressed:bg-card",
                  )}
                  key={mode}
                  value={mode}
                >
                  <span className="flex w-full items-center gap-2.5">
                    <Icon aria-hidden />
                    <span className="font-semibold">{mode === "cable" ? "Cable" : "WiFi"}</span>
                    <span className="ml-auto">
                      <SelectionDot selected={connectionChoice === mode} />
                    </span>
                  </span>
                  <span className="text-[13px] leading-normal font-normal text-muted-foreground">
                    {mode === "cable"
                      ? "Fastest and most reliable. VibeTV needs no network access."
                      : "No cable on your desk — VibeTV can stand anywhere."}
                  </span>
                  <span className="mt-auto flex items-center gap-2 pt-2 text-[13px] font-normal text-muted-foreground">
                    <span
                      aria-hidden
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        count
                          ? "bg-foreground"
                          : "shadow-[inset_0_0_0_1px_var(--muted-foreground)]",
                      )}
                    />
                    {`${count} ${count === 1 ? "VibeTV" : "VibeTVs"} found`}
                  </span>
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
          <Button
            className={CALM_BUTTON_CLASS}
            disabled={connecting}
            onClick={() => onChooseTransport(connectionChoice)}
            type="button"
          >
            Connect
          </Button>
        </>
      ) : null}

      {showWiFiForm ? (
        <form className="mt-8 flex w-full flex-1 flex-col text-left" onSubmit={submitWiFi}>
          <FieldGroup className="flex-1 gap-0">
            <Field>
              <FieldLabel className={CALM_LABEL_CLASS} htmlFor="setup-wifi-network">
                WiFi network
              </FieldLabel>
              {manualWiFiName ? (
                <Input
                  autoComplete="off"
                  className={CALM_INPUT_CLASS}
                  disabled={wifiScanning || wifiBusy}
                  id="setup-wifi-network"
                  maxLength={32}
                  onChange={(event) => {
                    setWifiName(event.target.value);
                    onWiFiError(null);
                  }}
                  placeholder="WiFi name"
                  value={wifiName}
                />
              ) : (
                <Select
                  disabled={wifiScanning || wifiBusy}
                  onValueChange={(value) => {
                    setWifiName(value);
                    onWiFiError(null);
                  }}
                  value={wifiName}
                >
                  <SelectTrigger
                    className={cn(
                      CALM_INPUT_CLASS,
                      "flex items-center justify-between gap-2 py-0 pr-3 pl-3 text-left data-[size=default]:h-11 *:data-[slot=select-value]:flex-1 *:data-[slot=select-value]:gap-2",
                    )}
                    id="setup-wifi-network"
                  >
                    <SelectValue
                      placeholder={
                        wifiScanning
                          ? "Scanning…"
                          : wifiNetworks.length === 0
                            ? "No networks found"
                            : "Choose WiFi"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {wifiNetworks.map((network) => (
                        <SelectItem key={network.ssid} value={network.ssid}>
                          <Wifi aria-hidden className="text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate">
                            {network.ssid}
                          </span>
                          {network.encrypted ? (
                            <LockKeyhole aria-label="Encrypted" className="text-muted-foreground" />
                          ) : null}
                          <span className="sr-only">
                            {signalLabel(network.rssi)} signal
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
            </Field>
            <div className="mt-3 flex flex-wrap justify-between gap-2">
              <Button
                className={CALM_LINK_CLASS}
                disabled={wifiScanning || wifiBusy}
                onClick={onScanWiFiNetworks}
                size="sm"
                type="button"
                variant="link"
              >
                Scan again
              </Button>
              <Button
                className={CALM_LINK_CLASS}
                disabled={wifiScanning || wifiBusy}
                onClick={() => {
                  setManualWiFiName((current) => !current);
                  setWifiName("");
                }}
                size="sm"
                type="button"
                variant="link"
              >
                {manualWiFiName
                  ? "Choose visible network"
                  : "Enter hidden network"}
              </Button>
            </div>
            <Field className="mt-6 mb-8">
              <FieldLabel className={CALM_LABEL_CLASS} htmlFor="setup-wifi-password">
                WiFi password
              </FieldLabel>
              <Input
                autoComplete="current-password"
                className={CALM_INPUT_CLASS}
                disabled={wifiScanning || wifiBusy}
                id="setup-wifi-password"
                maxLength={64}
                onChange={(event) => setWifiPassword(event.target.value)}
                required={passwordRequired}
                type="password"
                value={wifiPassword}
              />
            </Field>
            <Button
              className={CALM_BUTTON_CLASS}
              disabled={wifiScanning || wifiBusy || !wifiName.trim() || passwordMissing}
              type="submit"
            >
              {wifiBusy ? <Spinner data-icon="inline-start" /> : null}
              {wifiBusy ? "Connecting to WiFi…" : "Connect to WiFi"}
            </Button>
          </FieldGroup>
        </form>
      ) : null}

      {wifiSetupPhase === "waiting" && !wifiWaitingViaCable ? (
        macAppUpdate ? (
          <SetupMacAppUpdateDialog
            offer={macAppUpdate}
            onDismiss={onDismissMacAppUpdate}
            onScanAgain={() => {
              onDismissMacAppUpdate();
              onSearchAgain();
            }}
          />
        ) : (
          <SetupCableHelpDialog
            onEnterAddressManually={onEnterAddressManually}
            onScanAgain={onSearchAgain}
            scanning={searching}
          />
        )
      ) : null}

      {showCandidates ? (
        <ItemGroup
          aria-label={transport ? `VibeTVs found ${transport === "cable" ? "by Cable" : "on your WiFi"}` : "VibeTVs found"}
          className="mt-8 gap-2"
          onKeyDown={moveAmongRadios}
          role="radiogroup"
        >
          {candidates.map((candidate, index) => (
            <SetupDeviceCard
              candidate={candidate}
              key={`${candidate.deviceId || "legacy"}-${candidate.target}`}
              onSelect={() => onSelect(candidate)}
              preview3D={index === live3DIndex ? preview3D : false}
              previewDevice={isPreviewDevice(candidate) ? previewDevice : null}
              previewFrame={isPreviewDevice(candidate) ? previewFrame : null}
              previewUsage={isPreviewDevice(candidate) ? previewUsage : null}
              selected={selectedTarget === candidateKey(candidate)}
              tabStop={index === Math.max(selectedIndex, 0)}
            />
          ))}
        </ItemGroup>
      ) : null}

      {showCandidates ? (
        <Button
          className={CALM_BUTTON_CLASS}
          disabled={connecting || !selectedTarget}
          onClick={onConnect}
          type="button"
        >
          {connecting ? <Spinner data-icon="inline-start" /> : null}
          <span>{connecting ? connectingLabel(connectPhase) : "Connect"}</span>
        </Button>
      ) : null}
      {!showModeChoice ? (
        <>
          <SetupLog
            className="mt-8 empty:mt-0"
            lines={
              waitingForWiFi && wifiCredentialsSent
                ? [
                    {
                      id: "wifi-sent",
                      text: "WiFi details sent over cable",
                      tone: "done",
                    },
                    {
                      id: "wifi-wait",
                      text: "waiting for VibeTV on the network",
                    },
                    ...logLines,
                  ]
                : logLines
            }
            running={connecting || wifiBusy}
          />
          {connectPhase === "updating-firmware" && firmwarePercent !== undefined ? (
            <Progress aria-hidden className="mt-4" value={firmwarePercent} />
          ) : null}
        </>
      ) : null}
      {/*
        The step's own way to try again, not a dialog's. Every dialog that
        offered one could be dismissed, and dismissing it left a scan that had
        answered with nothing on a screen whose only remaining control was the
        address field. One standing control covers every way a scan can end.
      */}
      <div className="mt-5 flex justify-center gap-6 empty:hidden">
        {waitingForWiFi && onEditWiFi ? (
          <Button
            className={CALM_LINK_CLASS}
            onClick={onEditWiFi}
            size="sm"
            type="button"
            variant="link"
          >
            Edit WiFi details
          </Button>
        ) : null}
        {!showModeChoice &&
        !connecting &&
        !searching &&
        (!wifiSetupPhase || waitingForWiFi) ? (
          <Button
            className={CALM_LINK_CLASS}
            disabled={connecting}
            onClick={onSearchAgain}
            size="sm"
            type="button"
            variant="link"
          >
            Search again
          </Button>
        ) : null}
        {!showModeChoice &&
        !showWiFiForm &&
        !connecting &&
        transport !== "cable" &&
        !wifiSetupPhase ? (
          <Button
            className={CALM_LINK_CLASS}
            disabled={connecting}
            onClick={onEnterAddressManually}
            size="sm"
            type="button"
            variant="link"
          >
            Enter IP address manually
          </Button>
        ) : null}
      </div>

      {alternativeTransport && !showWiFiForm ? (
        <Button
          className={cn(CALM_LINK_CLASS, "mt-5")}
          disabled={connecting}
          onClick={() => onChooseTransport(alternativeTransport)}
          size="sm"
          type="button"
          variant="link"
        >
          Use {alternativeTransport === "cable" ? "Cable" : "WiFi"} instead
        </Button>
      ) : null}

    </SetupWizardScreen>
  );
}

/**
 * A firmware install is the longest thing behind this button and the one the
 * customer must not unplug through. Reporting all of it as "Connecting" hid
 * that entirely.
 */
function connectingLabel(phase: ConnectPhase | undefined): string {
  switch (phase) {
    case "checking-firmware":
      return "Checking firmware";
    case "updating-firmware":
      return "Updating firmware";
    default:
      return "Connecting";
  }
}

function foundLabel(count: number, transport?: SetupTransport): string {
  const suffix = transport === "cable" ? " by Cable" : transport === "wifi" ? " on your WiFi" : "";
  return count === 1
    ? `1 VibeTV found${suffix}.`
    : `${count} VibeTVs found${suffix}.`;
}

function signalLabel(rssi: number): string {
  return rssi >= -60 ? "Strong" : rssi >= -75 ? "Medium" : "Weak";
}
