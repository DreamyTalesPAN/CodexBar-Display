"use client";

import { CircleAlert, WifiOff } from "lucide-react";
import { useState } from "react";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  DEVICE_TARGET_PLACEHOLDER,
  normalizeManualDeviceTarget,
} from "../device-target-copy";
import { SetupDialog } from "./setup-dialog";

const ADDRESS_ERROR = "Enter the IP address shown on the VibeTV screen.";

type AddressDialogProps = {
  busy?: boolean;
  onConnect: (target: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

/** 02b — the manual way in when discovery does not find the right VibeTV. */
export function SetupAddressDialog({
  busy = false,
  onConnect,
  onOpenChange,
  open,
}: AddressDialogProps) {
  // Keyed on `open` so each visit starts from an empty field instead of
  // resetting the previous attempt from an effect.
  return (
    <SetupAddressDialogForm
      busy={busy}
      key={open ? "open" : "closed"}
      onConnect={onConnect}
      onOpenChange={onOpenChange}
      open={open}
    />
  );
}

function SetupAddressDialogForm({
  busy,
  onConnect,
  onOpenChange,
  open,
}: AddressDialogProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const target = normalizeManualDeviceTarget(value);
    if (!target) {
      setError(ADDRESS_ERROR);
      return;
    }
    setError(null);
    onConnect(target);
  }

  return (
    <SetupDialog
      description="Type the address shown on your VibeTV screen."
      onOpenChange={onOpenChange}
      open={open}
      primaryAction={{ busy, label: "Connect", onSelect: submit }}
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
              submit();
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
  open: boolean;
};

/** 02c — nothing answered on this WiFi. */
export function SetupDeviceNotFoundDialog({
  busy = false,
  onEnterAddressManually,
  onOpenChange,
  onScanAgain,
  open,
}: NotFoundDialogProps) {
  return (
    <SetupDialog
      description="Connect it to your WiFi, then scan again."
      icon={WifiOff}
      onOpenChange={onOpenChange}
      open={open}
      primaryAction={{ busy, label: "Scan again", onSelect: onScanAgain }}
      secondaryAction={{
        label: "Enter IP manually",
        onSelect: onEnterAddressManually,
      }}
      title="We couldn't find your VibeTV"
    >
      <ol className="grid list-decimal gap-2 pl-5 text-left text-sm text-muted-foreground">
        <li>Plug in your VibeTV and wait for the VibeTV-Setup network.</li>
        <li>
          On your phone, join the WiFi network <strong>VibeTV-Setup</strong>.
        </li>
        <li>
          Open <strong>192.168.4.1</strong> and choose your home WiFi.
        </li>
        <li>Wait until the screen says WiFi connected.</li>
      </ol>
    </SetupDialog>
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
