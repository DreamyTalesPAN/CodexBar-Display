"use client";

import { Button } from "@/components/ui/button";
import { ItemGroup } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Cable, Wifi } from "lucide-react";
import { useState, type FormEvent } from "react";
import type {
  DeviceCandidate,
  SupportDiagnostics,
  WiFiNetwork,
} from "../control-center-types";
import { candidateKey, type SetupTransport } from "./setup-connection";
import { SetupDeviceCard } from "./setup-device-card";
import type { ConnectPhase } from "./setup-connect-log";
import { SetupLog, type SetupLogLine } from "./setup-log";
import {
  SetupWizardScreen,
  SetupWizardSubtitle,
  SetupWizardTitle,
} from "./setup-wizard-screen";

type SetupDeviceScreenProps = {
  candidates: DeviceCandidate[];
  alternativeTransport?: SetupTransport;
  connecting?: boolean;
  /** Names the work in flight, so the button reports it instead of "Connecting" throughout. */
  connectPhase?: ConnectPhase;
  logLines: SetupLogLine[];
  aiFixPrompt?: () => string;
  onConnect: () => void;
  onChooseTransport: (transport: SetupTransport) => void;
  onConfigureWiFi: (ssid: string, password: string) => Promise<void>;
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
  wifiScanError?: string | null;
  wifiScanning?: boolean;
  wifiSetupPhase?: "credentials" | "waiting";
  wifiWaitingViaCable?: boolean;
};

export function SetupDeviceScreen({
  alternativeTransport,
  candidates,
  connecting = false,
  connectPhase,
  logLines,
  aiFixPrompt,
  onConnect,
  onChooseTransport,
  onConfigureWiFi,
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
  wifiScanError,
  wifiScanning = false,
  wifiSetupPhase,
  wifiWaitingViaCable = false,
}: SetupDeviceScreenProps) {
  const [wifiName, setWifiName] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [manualWiFiName, setManualWiFiName] = useState(false);
  const [wifiError, setWifiError] = useState("");

  async function submitWiFi(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ssid = wifiName.trim();
    if (!ssid) {
      setWifiError("Enter your WiFi name.");
      return;
    }
    setWifiError("");
    await onConfigureWiFi(ssid, wifiPassword);
    setWifiPassword("");
  }

  const title = showModeChoice
    ? "Choose how VibeTV connects"
    : wifiSetupPhase === "credentials"
      ? "Connect VibeTV to WiFi"
      : wifiSetupPhase === "waiting"
        ? "Connect VibeTV to WiFi"
        : showCandidates
          ? "Choose your VibeTV"
          : connecting
            ? "Connecting to VibeTV"
            : "Choose your VibeTV";
  return (
    <SetupWizardScreen
      label="Choose your VibeTV"
      aiFixPrompt={aiFixPrompt}
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
            ? "Choose Cable or WiFi."
            : wifiSetupPhase === "credentials"
              ? "Choose a visible network or enter a hidden WiFi name."
              : wifiSetupPhase === "waiting"
                ? "VibeTV is connecting. The app will continue when it appears on WiFi."
                : searching
                  ? "Looking for VibeTVs on your WiFi."
                  : showCandidates
                    ? foundLabel(candidates.length, transport)
                    : "VibeTV is being connected automatically."}
        </SetupWizardSubtitle>
      )}

      {showModeChoice ? (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Button
            className="h-auto min-h-28 flex-col gap-3 whitespace-normal"
            disabled={connecting}
            onClick={() => onChooseTransport("cable")}
            type="button"
            variant="outline"
          >
            <Cable aria-hidden />
            <span>Cable</span>
          </Button>
          <Button
            className="h-auto min-h-28 flex-col gap-3 whitespace-normal"
            disabled={connecting}
            onClick={() => onChooseTransport("wifi")}
            type="button"
            variant="outline"
          >
            <Wifi aria-hidden />
            <span>WiFi</span>
          </Button>
        </div>
      ) : null}

      {wifiSetupPhase === "credentials" ? (
        <form className="mt-4 grid gap-4 text-left" onSubmit={submitWiFi}>
          <Field>
            <FieldLabel htmlFor="setup-wifi-network">WiFi network</FieldLabel>
            {manualWiFiName ? (
              <Input
                autoComplete="off"
                disabled={wifiScanning || connecting}
                id="setup-wifi-network"
                maxLength={32}
                onChange={(event) => {
                  setWifiName(event.target.value);
                  setWifiError("");
                }}
                placeholder="WiFi name"
                value={wifiName}
              />
            ) : (
              <Select
                disabled={wifiScanning || connecting}
                onValueChange={(value) => {
                  setWifiName(value);
                  setWifiError("");
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
                  {wifiNetworks.map((network) => (
                    <SelectItem key={network.ssid} value={network.ssid}>
                      {network.ssid} · {signalLabel(network.rssi)} ·{" "}
                      {network.encrypted ? "Encrypted" : "Open"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={wifiScanning || connecting}
              onClick={onScanWiFiNetworks}
              size="sm"
              type="button"
              variant="link"
            >
              Scan again
            </Button>
            <Button
              disabled={wifiScanning || connecting}
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
            <FieldLabel htmlFor="setup-wifi-password">WiFi password</FieldLabel>
            <Input
              autoComplete="current-password"
              disabled={wifiScanning || connecting}
              id="setup-wifi-password"
              maxLength={64}
              onChange={(event) => setWifiPassword(event.target.value)}
              type="password"
              value={wifiPassword}
            />
          </Field>
          {wifiError || wifiScanError ? (
            <p className="text-sm text-destructive" role="alert">
              {wifiError || wifiScanError}
            </p>
          ) : null}
          <Button
            disabled={wifiScanning || connecting || !wifiName.trim()}
            type="submit"
          >
            Connect to WiFi
          </Button>
        </form>
      ) : null}

      {wifiSetupPhase === "waiting" && !wifiWaitingViaCable ? (
        <ol className="mt-4 grid list-decimal gap-2 pl-5 text-left text-sm text-muted-foreground">
          <li>Plug in VibeTV and wait for the VibeTV-Setup network.</li>
          <li>
            On your phone, join WiFi <strong>VibeTV-Setup</strong>.
          </li>
          <li>
            Open <strong>192.168.4.1</strong> and choose your home WiFi.
          </li>
          <li>Return here when VibeTV says WiFi connected.</li>
        </ol>
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
      {!showModeChoice && wifiSetupPhase !== "credentials" && !searching ? (
        <Button
          disabled={connecting}
          onClick={onSearchAgain}
          size="sm"
          type="button"
          variant="link"
        >
          {wifiSetupPhase === "waiting" ? "Scan WiFi again" : "Search again"}
        </Button>
      ) : null}
      {!showModeChoice && wifiSetupPhase !== "credentials" ? (
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

      {alternativeTransport ? (
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

      <SetupLog className="mt-4" lines={logLines} running={connecting} />
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
