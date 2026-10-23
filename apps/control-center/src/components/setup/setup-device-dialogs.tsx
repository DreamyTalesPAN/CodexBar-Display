"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ApiError, DeviceCandidate } from "../control-center-types";
import {
  candidateAddress,
  DEVICE_TARGET_PLACEHOLDER,
  normalizeManualDeviceTarget,
} from "../device-target-copy";
import { cn } from "@/lib/utils";
import { candidateKey } from "./setup-connection";
import { SetupDialog } from "./setup-dialog";
import { moveAmongRadios } from "./setup-selectable-card";

const ADDRESS_ERROR = "Enter the IP address shown on the VibeTV screen.";

type AddressDialogProps = {
  /** Resolves with what to show under the field, or null once it succeeded. */
  onConnect: (target: string) => Promise<string | null>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

/** 02b — the manual way in when discovery does not find the right VibeTV. */
export function SetupAddressDialog({
  onConnect,
  onOpenChange,
  open,
}: AddressDialogProps) {
  // Keyed on `open` so each visit starts from an empty field instead of
  // resetting the previous attempt from an effect.
  return (
    <SetupAddressDialogForm
      key={open ? "open" : "closed"}
      onConnect={onConnect}
      onOpenChange={onOpenChange}
      open={open}
    />
  );
}

function SetupAddressDialogForm({
  onConnect,
  onOpenChange,
  open,
}: AddressDialogProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The address that did not answer is the one thing the customer needs to
  // correct, so a failure keeps the dialog and the typed value and puts the
  // reason under the field. On success the wizard has already closed this
  // dialog, so the trailing writes land on an unmounted form.
  async function submit() {
    if (busy) {
      // Enter reaches this even while the button is disabled.
      return;
    }
    const target = normalizeManualDeviceTarget(value);
    if (!target) {
      setError(ADDRESS_ERROR);
      return;
    }
    setError(null);
    setBusy(true);
    const failure = await onConnect(target);
    setBusy(false);
    setError(failure);
  }

  return (
    <SetupDialog
      description="Type the address shown on your VibeTV screen."
      onOpenChange={onOpenChange}
      open={open}
      primaryAction={{ busy, label: "Connect", onSelect: () => void submit() }}
      secondaryAction={{
        label: "Cancel",
        onSelect: () => onOpenChange(false),
      }}
      showCloseButton={false}
      title="Enter IP address"
    >
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor="setup-device-address">IP address</FieldLabel>
        <Input
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          className="font-mono"
          id="setup-device-address"
          inputMode="decimal"
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder={DEVICE_TARGET_PLACEHOLDER}
          value={value}
        />
        {error ? <FieldError>{error}</FieldError> : null}
      </Field>
    </SetupDialog>
  );
}

/** A newer Mac App exists; an old app can be why no VibeTV can be found (#561). */
export type MacAppUpdateOffer = { onUpdate: () => void; version: string };

/**
 * #561: when no VibeTV was found and a newer Mac App exists, setup offers that
 * update first, in its own dialog. There is no close X: "Scan again" is the
 * way out and leads on to the usual not-found help, which then carries no hint.
 */
export function SetupMacAppUpdateDialog({
  offer,
  onDismiss,
  onScanAgain,
}: {
  offer: MacAppUpdateOffer;
  onDismiss: () => void;
  onScanAgain: () => void;
}) {
  return (
    <SetupDialog
      description={`We couldn't find your VibeTV. ${
        offer.version ? `Version ${offer.version} is out` : "A newer version is out"
      }, and an older app may not find it. Setup scans again after the update.`}
      onOpenChange={(open) => {
        if (!open) {
          onDismiss();
        }
      }}
      open
      primaryAction={{ label: "Update Mac App", onSelect: offer.onUpdate }}
      secondaryAction={{ label: "Scan again", onSelect: onScanAgain }}
      title="Update the Mac App first"
    />
  );
}

type NotFoundDialogProps = {
  busy?: boolean;
  onEnterAddressManually: () => void;
  onOpenChange: (open: boolean) => void;
  onScanAgain: () => void;
  onUseCable: () => void;
  onUseWiFi: () => void;
  open: boolean;
  /** The app runs on Windows, where "your Mac" reads "your computer". */
  windowsHost?: boolean;
};

/** 02c — neither Cable nor WiFi discovery found a VibeTV. */
export function SetupDeviceNotFoundDialog({
  busy = false,
  onEnterAddressManually,
  onOpenChange,
  onScanAgain,
  onUseCable,
  onUseWiFi,
  open,
  windowsHost = false,
}: NotFoundDialogProps) {
  return (
    <SetupDialog
      description="Setup runs over the USB cable. Connect it, then scan again."
      onOpenChange={onOpenChange}
      open={open}
      primaryAction={{ busy, label: "Scan again", onSelect: onScanAgain }}
      secondaryAction={{
        label: "Enter IP manually",
        onSelect: onEnterAddressManually,
      }}
      title="We couldn't find your VibeTV"
      wide
    >
      <ul className="border-t border-foreground/10">
        <NotFoundChoice
          busy={busy}
          description={`Plug VibeTV into your ${windowsHost ? "computer" : "Mac"} with the cable that came with it.`}
          onSelect={onUseCable}
          title="Use the cable"
        />
        <NotFoundChoice
          busy={busy}
          description="For a VibeTV that is already set up on your WiFi."
          onSelect={onUseWiFi}
          title="Already on WiFi"
        />
      </ul>
    </SetupDialog>
  );
}

/** One way out of "not found": a quiet row with a chevron, as in the design. */
function NotFoundChoice({
  busy,
  description,
  onSelect,
  title,
}: {
  busy: boolean;
  description: string;
  onSelect: () => void;
  title: string;
}) {
  return (
    <li>
      <button
        className="flex w-full items-center gap-4 border-b border-foreground/10 py-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        disabled={busy}
        onClick={onSelect}
        type="button"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-semibold">{title}</span>
          <span className="text-muted-foreground">{description}</span>
        </span>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}

/**
 * Setup and pairing run only over the USB cable (issue #489); WiFi comes
 * afterwards, sent over that cable. Stays dismissible while discovery continues.
 */
export function SetupCableHelpDialog({
  onEnterAddressManually,
  onScanAgain,
  scanning = false,
}: {
  onEnterAddressManually: () => void;
  onScanAgain: () => void;
  scanning?: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)} type="button" variant="link">
        How to connect VibeTV
      </Button>
      <SetupDialog
        description="Setup runs over the USB cable. You can switch to WiFi afterwards."
        onOpenChange={setOpen}
        open={open}
        primaryAction={{
          busy: scanning,
          label: "Scan again",
          onSelect: onScanAgain,
        }}
        secondaryAction={{
          label: "Enter IP manually",
          onSelect: () => {
            setOpen(false);
            onEnterAddressManually();
          },
        }}
        title="Connect the USB cable"
        wide
      >
        <ol className="flex flex-col gap-3 text-left">
          {[
            "Plug VibeTV into this computer with the USB cable that came with it.",
            "Wait until the VibeTV screen lights up, then scan again here.",
            "To use WiFi, choose it after VibeTV is connected.",
          ].map((step, index) => (
            <li className="flex items-start gap-3" key={step}>
              <span aria-hidden className="w-4 text-muted-foreground">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </SetupDialog>
    </>
  );
}

type ConnectFailedDialogProps = {
  busy?: boolean;
  description: string;
  onEnterAddressManually: () => void;
  onOpenChange: (open: boolean) => void;
  onSearchAgain: () => void;
  /** Set when only the USB cable can pair this VibeTV (#489). */
  onUseCable?: () => void;
  open: boolean;
  title: string;
};

/** 02d — the VibeTV answered discovery but the connection did not complete. */
export function SetupConnectFailedDialog({
  busy = false,
  description,
  onEnterAddressManually,
  onOpenChange,
  onSearchAgain,
  onUseCable,
  open,
  title,
}: ConnectFailedDialogProps) {
  return (
    <SetupDialog
      description={description}
      onOpenChange={onOpenChange}
      open={open}
      primaryAction={
        onUseCable
          ? { busy, label: "Use the cable", onSelect: onUseCable }
          : { busy, label: "Search again", onSelect: onSearchAgain }
      }
      secondaryAction={{
        label: "Enter IP manually",
        onSelect: onEnterAddressManually,
      }}
      title={title}
    />
  );
}

type DevicePickerDialogProps = {
  candidates: DeviceCandidate[];
  /** The last connect attempt's failure, shown in place of the prompt. */
  error: ApiError | null;
  onConnect: (candidate: DeviceCandidate) => void;
  onOpenChange: (open: boolean) => void;
};

/**
 * The device step's list, over the current screen: the VibeTV was lost after
 * setup and the recovery search found VibeTVs it did not reconnect on its own.
 */
export function SetupDevicePickerDialog({
  candidates,
  error,
  onConnect,
  onOpenChange,
}: DevicePickerDialogProps) {
  const [selectedKey, setSelectedKey] = useState("");
  const selected =
    candidates.find((candidate) => candidateKey(candidate) === selectedKey) ??
    candidates.find((candidate) => candidate.known) ??
    candidates[0];
  // The Tab stop of the group: the selected VibeTV, or the first one.
  const selectedIndex = candidates.findIndex((candidate) => candidate === selected);
  return (
    <SetupDialog
      description={
        error?.nextAction ??
        "Choose it to connect again."
      }
      onOpenChange={onOpenChange}
      open
      primaryAction={{
        label: "Connect",
        onSelect: () => selected && onConnect(selected),
      }}
      secondaryAction={{ label: "Not now", onSelect: () => onOpenChange(false) }}
      showCloseButton={false}
      title={error?.message ?? "Your VibeTV is not reachable"}
      wide
    >
      {/* Frame 47: plain radio rows between hairlines, not the setup cards. */}
      <div
        aria-label="VibeTVs found"
        className="border-t border-foreground/10"
        onKeyDown={moveAmongRadios}
        role="radiogroup"
      >
        {candidates.map((candidate, index) => (
          <DevicePickerRow
            candidate={candidate}
            key={candidateKey(candidate)}
            onSelect={() => setSelectedKey(candidateKey(candidate))}
            selected={candidate === selected}
            tabStop={index === Math.max(selectedIndex, 0)}
          />
        ))}
      </div>
    </SetupDialog>
  );
}

type DevicePickerRowProps = {
  candidate: DeviceCandidate;
  onSelect: () => void;
  selected: boolean;
  /** The one radio of its group that Tab reaches. */
  tabStop: boolean;
};

function DevicePickerRow({ candidate, onSelect, selected, tabStop }: DevicePickerRowProps) {
  const address = candidateAddress(candidate.target);
  const cable = candidate.transport === "cable";
  const detail = [
    cable ? "" : address,
    candidate.firmware ? `Firmware ${candidate.firmware}` : "",
  ].filter(Boolean).join(" · ");
  const tag = [
    candidate.transport ? (cable ? "Cable" : "WiFi") : "",
    candidate.known ? "Previously connected" : "",
  ].filter(Boolean).join(" · ");
  return (
    <button
      aria-checked={selected}
      className="flex w-full items-center gap-4 rounded-md border-b border-foreground/10 py-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onSelect}
      role="radio"
      tabIndex={tabStop ? 0 : -1}
      type="button"
    >
      <span
        aria-hidden
        className={cn(
          "box-border size-4 shrink-0 rounded-full border-[1.5px] border-input",
          selected && "border-[5px] border-foreground bg-background",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold">
          VibeTV {candidate.deviceId || address}
        </span>
        {detail ? (
          <span className="mt-0.5 block text-[13px] text-muted-foreground">{detail}</span>
        ) : null}
      </span>
      {tag ? <span className="text-[13px] text-muted-foreground">{tag}</span> : null}
    </button>
  );
}
