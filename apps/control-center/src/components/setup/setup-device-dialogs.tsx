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
import {
  DEVICE_TARGET_PLACEHOLDER,
  normalizeManualDeviceTarget,
} from "../device-target-copy";
import { SetupDialog } from "./setup-dialog";

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
  onSetUpWiFi: () => void;
  open: boolean;
};

/** 02c — neither Cable nor WiFi discovery found a VibeTV. */
export function SetupDeviceNotFoundDialog({
  busy = false,
  onEnterAddressManually,
  onOpenChange,
  onScanAgain,
  onUseCable,
  onSetUpWiFi,
  open,
}: NotFoundDialogProps) {
  return (
    <SetupDialog
      description="Pick the way that fits your desk, then scan again."
      onOpenChange={onOpenChange}
      open={open}
      primaryAction={{ busy, label: "Scan again", onSelect: onScanAgain }}
      secondaryAction={{
        label: "Enter IP manually",
        onSelect: onEnterAddressManually,
      }}
      title="We couldn't find your VibeTV"
    >
      <ItemGroup className="gap-1">
        <Item asChild>
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
                Plug VibeTV into your Mac with the cable that came with it.
              </ItemDescription>
            </ItemContent>
          </button>
        </Item>
        <Item asChild>
          <button
            className="text-left"
            disabled={busy}
            onClick={onSetUpWiFi}
            type="button"
          >
            <ItemMedia variant="icon">
              <Wifi />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Set up WiFi with your phone</ItemTitle>
              <ItemDescription>Four steps, no cable needed.</ItemDescription>
            </ItemContent>
          </button>
        </Item>
      </ItemGroup>
    </SetupDialog>
  );
}

/** The phone path stays a dismissible dialog while discovery continues. */
export function SetupWiFiPhoneDialog({
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
        Set up WiFi with your phone
      </Button>
      <SetupDialog
        description="Set it up with your phone — VibeTV opens its own network for that."
        icon={CircleAlert}
        onOpenChange={setOpen}
        open={open}
        primaryAction={{
          busy: scanning,
          label: "Scan WiFi again",
          onSelect: onScanAgain,
        }}
        secondaryAction={{
          label: "Enter IP manually",
          onSelect: () => {
            setOpen(false);
            onEnterAddressManually();
          },
        }}
        title="No VibeTV on your WiFi yet"
      >
        <ol className="flex flex-col gap-4 text-left text-sm leading-relaxed">
          {[
            <>
              Plug VibeTV into power and wait for the{" "}
              <strong>VibeTV-Setup</strong> network.
            </>,
            <>
              On your phone, join the WiFi network <strong>VibeTV-Setup</strong>
              .
            </>,
            <>
              Open <strong className="font-mono">192.168.4.1</strong> and choose
              your home WiFi.
            </>,
            <>Wait until VibeTV says “WiFi connected”, then scan again here.</>,
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
  open,
  title,
}: ConnectFailedDialogProps) {
  return (
    <SetupDialog
      description={description}
      icon={CircleAlert}
      onOpenChange={onOpenChange}
      open={open}
      primaryAction={{ busy, label: "Search again", onSelect: onSearchAgain }}
      secondaryAction={{
        label: "Enter IP manually",
        onSelect: onEnterAddressManually,
      }}
      title={title}
    />
  );
}
