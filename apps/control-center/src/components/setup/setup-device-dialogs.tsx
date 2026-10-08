"use client";

import { Cable, CircleAlert, Wifi } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ApiError, DeviceCandidate } from "../control-center-types";
import {
  DEVICE_TARGET_PLACEHOLDER,
  normalizeManualDeviceTarget,
} from "../device-target-copy";
import { candidateKey } from "./setup-connection";
import { SetupDeviceCard } from "./setup-device-card";
import { SetupDialog } from "./setup-dialog";
import { selectedItemClass } from "./setup-selectable-card";

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
      title="Enter IP address"
      tone="neutral"
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

// The two ways out of "not found" are buttons, so they look like the
// connection cards in Settings: outlined, on the card background, with hover.
const notFoundChoiceClass = `${selectedItemClass(false)} bg-card p-4 disabled:cursor-not-allowed disabled:opacity-50`;

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
    >
      <ItemGroup className="gap-3">
        <Item asChild className={notFoundChoiceClass} variant="outline">
          <button
            className="text-left"
            disabled={busy}
            onClick={onUseCable}
            type="button"
          >
            <ItemMedia variant="icon">
              <Cable />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Use the cable</ItemTitle>
              <ItemDescription>
                Plug VibeTV into your {windowsHost ? "computer" : "Mac"} with
                the cable that came with it.
              </ItemDescription>
            </ItemContent>
          </button>
        </Item>
        <Item asChild className={notFoundChoiceClass} variant="outline">
          <button
            className="text-left"
            disabled={busy}
            onClick={onUseWiFi}
            type="button"
          >
            <ItemMedia variant="icon">
              <Wifi />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Already on WiFi</ItemTitle>
              <ItemDescription>
                For a VibeTV that is already set up on your WiFi.
              </ItemDescription>
            </ItemContent>
          </button>
        </Item>
      </ItemGroup>
    </SetupDialog>
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
        icon={Cable}
        tone="neutral"
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
      >
        <ol className="flex flex-col gap-4 text-left text-sm leading-relaxed">
          {[
            <>
              Plug VibeTV into this computer with the USB cable that came with
              it.
            </>,
            <>Wait until the VibeTV screen lights up, then scan again here.</>,
            <>To use WiFi, choose it after VibeTV is connected.</>,
          ].map((step, index) => (
            <li className="flex items-start gap-3" key={index}>
              <span
                aria-hidden
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground"
              >
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
      icon={CircleAlert}
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
  return (
    <SetupDialog
      description={
        error?.nextAction ??
        "Your VibeTV is not reachable. Choose it to connect again."
      }
      icon={CircleAlert}
      onOpenChange={onOpenChange}
      open
      primaryAction={{
        label: "Connect",
        onSelect: () => selected && onConnect(selected),
      }}
      title={error?.message ?? "Choose your VibeTV"}
    >
      <ItemGroup aria-label="VibeTVs found" className="gap-3" role="radiogroup">
        {candidates.map((candidate) => (
          <SetupDeviceCard
            candidate={candidate}
            key={candidateKey(candidate)}
            onSelect={() => setSelectedKey(candidateKey(candidate))}
            selected={candidate === selected}
          />
        ))}
      </ItemGroup>
    </SetupDialog>
  );
}
