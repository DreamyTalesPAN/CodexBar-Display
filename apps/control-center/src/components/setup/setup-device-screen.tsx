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
  SupportDiagnostics,
  WiFiNetwork,
} from "../control-center-types";
import { candidateKey, type SetupTransport } from "./setup-connection";
import { SetupDeviceCard } from "./setup-device-card";
import { SetupWiFiPhoneDialog } from "./setup-device-dialogs";
import { selectedItemClass } from "./setup-selectable-card";
import { cn } from "@/lib/utils";
import type { ConnectPhase } from "./setup-connect-log";
import { SetupLog, type SetupLogLine } from "./setup-log";
import {
  SetupWizardScreen,
  SetupWizardSubtitle,
  SetupWizardTitle,
} from "./setup-wizard-screen";

type SetupDeviceScreenProps = {
  candidates: DeviceCandidate[];
  setupWiFiCount?: number;
  alternativeTransport?: SetupTransport;
  connecting?: boolean;
  /** Names the work in flight, so the button reports it instead of "Connecting" throughout. */
  connectPhase?: ConnectPhase;
  logLines: SetupLogLine[];
  aiFixPrompt?: () => string;
  onConnect: () => void;
  onBack?: () => void;
  onChooseTransport: (transport: SetupTransport) => void;
  onConfigureWiFi: (ssid: string, password: string) => Promise<void>;
  onEditWiFi?: () => void;
  onCreateSupportReport?: () => Promise<SupportDiagnostics | null>;
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
  setupWiFiCount = 0,
  connecting = false,
  connectPhase,
  logLines,
  aiFixPrompt,
  onConnect,
  onBack,
  onChooseTransport,
  onConfigureWiFi,
  onEditWiFi,
  onCreateSupportReport,
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
  const [wifiName, setWifiName] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [manualWiFiName, setManualWiFiName] = useState(false);
  const [wifiSubmitting, setWiFiSubmitting] = useState(false);
  const [connectionChoice, setConnectionChoice] =
    useState<SetupTransport>("cable");
  const waitingForWiFi = wifiSetupPhase === "waiting" && wifiWaitingViaCable;
  const showWiFiForm =
    wifiSetupPhase === "credentials" || (waitingForWiFi && wifiCredentialsSent);
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
  return (
    <SetupWizardScreen
      label="Choose your VibeTV"
      aiFixPrompt={aiFixPrompt}
      onBack={wifiBusy ? undefined : onBack}
      onCreateSupportReport={onCreateSupportReport}
    >
      <SetupWizardTitle>{title}</SetupWizardTitle>
      {/*
        Once a VibeTV is being connected the count is no longer what the
        customer is waiting on -- the log below is. Reporting one there also
        outlived its own truth: the search state is neither idle nor searching
        during a connect, so the count was the only thing left to render.
      */}
      {connecting ? null : (
        <SetupWizardSubtitle>
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
            className="mt-4 grid w-full grid-cols-2 items-stretch gap-4"
            disabled={connecting}
            onValueChange={(value) => {
              if (value === "cable" || value === "wifi")
                setConnectionChoice(value);
            }}
            type="single"
            value={connectionChoice}
            variant="outline"
          >
            {(["cable", "wifi"] as const).map((mode) => {
              const Icon = mode === "cable" ? Cable : Wifi;
              const count = candidates.filter((candidate) =>
                mode === "cable"
                  ? candidate.transport === "cable"
                  : candidate.transport !== "cable",
              ).length + (mode === "wifi" ? setupWiFiCount : 0);
              return (
                <ToggleGroupItem
                  aria-label={mode === "cable" ? "Cable" : "WiFi"}
                  className={cn(
                    selectedItemClass(connectionChoice === mode),
                    "h-auto min-w-0 flex-col items-start justify-start gap-2 p-4 whitespace-normal bg-card data-[state=on]:bg-card",
                  )}
                  key={mode}
                  value={mode}
                >
                  <Icon aria-hidden />
                  <span>{mode === "cable" ? "Cable" : "WiFi"}</span>
                  <span className="text-xs leading-relaxed font-normal text-muted-foreground">
                    {mode === "cable"
                      ? "Fastest and most reliable. VibeTV needs no network access."
                      : "No cable on your desk — VibeTV can stand anywhere."}
                  </span>
                  <span className="mt-auto flex items-center gap-2 pt-1 font-mono text-xs font-normal text-muted-foreground">
                    <span
                      aria-hidden
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        count
                          ? "bg-[var(--vibetv-support)]"
                          : "bg-muted-foreground",
                      )}
                    />
                    {`${count} ${count === 1 ? "VibeTV" : "VibeTVs"} found`}
                  </span>
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
          <Button
            className="mt-4 w-full"
            disabled={connecting}
            onClick={() => onChooseTransport(connectionChoice)}
            type="button"
          >
            Connect
          </Button>
        </>
      ) : null}

      {showWiFiForm ? (
        <form className="mt-4 w-full text-left" onSubmit={submitWiFi}>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="setup-wifi-network">WiFi network</FieldLabel>
              {manualWiFiName ? (
                <Input
                  autoComplete="off"
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
                  <SelectTrigger className="w-full" id="setup-wifi-network">
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
                          <Wifi aria-hidden />
                          <span className="min-w-0 flex-1 truncate">
                            {network.ssid}
                          </span>
                          {network.encrypted ? (
                            <LockKeyhole aria-label="Encrypted" />
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
            <div className="flex flex-wrap justify-between gap-2">
              <Button
                disabled={wifiScanning || wifiBusy}
                onClick={onScanWiFiNetworks}
                size="sm"
                type="button"
                variant="link"
              >
                Scan again
              </Button>
              <Button
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
            <Field>
              <FieldLabel htmlFor="setup-wifi-password">
                WiFi password
              </FieldLabel>
              <Input
                autoComplete="current-password"
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
              disabled={wifiScanning || wifiBusy || !wifiName.trim() || passwordMissing}
              type="submit"
            >
              {wifiBusy ? <Spinner data-icon="inline-start" /> : null}
              {wifiBusy ? "Connecting to WiFi…" : "Connect to WiFi"}
            </Button>
            {waitingForWiFi && onEditWiFi ? (
              <Button type="button" variant="link" onClick={onEditWiFi}>
                Edit WiFi details
              </Button>
            ) : null}
          </FieldGroup>
        </form>
      ) : null}

      {wifiSetupPhase === "waiting" && !wifiWaitingViaCable ? (
        <SetupWiFiPhoneDialog
          onEnterAddressManually={onEnterAddressManually}
          onScanAgain={onSearchAgain}
          scanning={searching}
        />
      ) : null}

      {showCandidates ? (
        <ItemGroup
          aria-label={`VibeTVs found ${transport === "cable" ? "by Cable" : "on your WiFi"}`}
          className="mt-4 gap-3"
          role="radiogroup"
        >
          {candidates.map((candidate) => (
            <SetupDeviceCard
              candidate={candidate}
              key={`${candidate.deviceId || "legacy"}-${candidate.target}`}
              onSelect={() => onSelect(candidate)}
              selected={selectedTarget === candidateKey(candidate)}
            />
          ))}
        </ItemGroup>
      ) : null}

      {showCandidates ? (
        <Button
          className="mt-4 w-full"
          disabled={connecting || !selectedTarget}
          onClick={onConnect}
          type="button"
        >
          {connecting ? <Spinner data-icon="inline-start" /> : null}
          <span>{connecting ? connectingLabel(connectPhase) : "Connect"}</span>
        </Button>
      ) : null}
      {/*
        The step's own way to try again, not a dialog's. Every dialog that
        offered one could be dismissed, and dismissing it left a scan that had
        answered with nothing on a screen whose only remaining control was the
        address field. One standing control covers every way a scan can end.
      */}
      {!showModeChoice &&
      !connecting &&
      !searching &&
      (!wifiSetupPhase || waitingForWiFi) ? (
        <Button
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
          disabled={connecting}
          onClick={onEnterAddressManually}
          size="sm"
          type="button"
          variant="link"
        >
          Enter IP address manually
        </Button>
      ) : null}

      {alternativeTransport && !showWiFiForm ? (
        <Button
          disabled={connecting}
          onClick={() => onChooseTransport(alternativeTransport)}
          size="sm"
          type="button"
          variant="link"
        >
          Use {alternativeTransport === "cable" ? "Cable" : "WiFi"} instead
        </Button>
      ) : null}

      {!showModeChoice ? (
        <SetupLog
          className="mt-4"
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
  const suffix = transport === "cable" ? " by Cable" : " on your WiFi";
  return count === 1
    ? `1 VibeTV found${suffix}.`
    : `${count} VibeTVs found${suffix}.`;
}

function signalLabel(rssi: number): string {
  return rssi >= -60 ? "Strong" : rssi >= -75 ? "Medium" : "Weak";
}
