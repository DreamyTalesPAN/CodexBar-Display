"use client";

import { Monitor } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { ApiError } from "./control-center-types";
import {
  DEVICE_TARGET_PLACEHOLDER,
  deviceTargetHelpText,
  normalizeManualDeviceTarget,
} from "./device-target-copy";

type DeviceTargetFormProps = {
  busy?: boolean;
  buttonLabel?: string;
  className?: string;
  disabled?: boolean;
  id: string;
  lastError?: ApiError | null;
  onChange?: (target: string) => void;
  onSubmit?: (target: string) => void;
  searchingLabel?: string;
  value: string;
};

export function DeviceTargetForm({
  busy = false,
  buttonLabel = "Connect VibeTV",
  className = "grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end",
  disabled = false,
  id,
  lastError,
  onChange,
  onSubmit,
  searchingLabel = "Searching",
  value,
}: DeviceTargetFormProps) {
  const formDisabled = disabled || busy;
  const [validationError, setValidationError] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeManualDeviceTarget(value);
    if (!normalized) {
      setValidationError(
        "Enter the IP address shown on the VibeTV screen.",
      );
      return;
    }
    setValidationError("");
    onSubmit?.(normalized);
  }

  return (
    <form onSubmit={handleSubmit}>
      <FieldGroup className={className}>
        <Field className="min-w-0" data-invalid={Boolean(validationError)}>
          <FieldLabel htmlFor={id}>
          VibeTV address
          </FieldLabel>
          <FieldDescription id={`${id}-description`}>
            {deviceTargetHelpText(lastError)}
          </FieldDescription>
          <Input
          className="h-12 font-mono"
          disabled={formDisabled}
          id={id}
          aria-invalid={Boolean(validationError)}
          aria-describedby={`${id}-description${validationError ? ` ${id}-error` : ""}`}
          onChange={(event) => {
            setValidationError("");
            onChange?.(event.target.value);
          }}
          placeholder={DEVICE_TARGET_PLACEHOLDER}
          spellCheck={false}
          type="text"
          value={value}
        />
          {validationError ? (
            <FieldError id={`${id}-error`}>
            {validationError}
            </FieldError>
          ) : null}
        </Field>
        <Button className="h-12" disabled={formDisabled} type="submit">
          {busy ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <Monitor data-icon="inline-start" aria-hidden />
          )}
          <span>{busy ? searchingLabel : buttonLabel}</span>
        </Button>
      </FieldGroup>
    </form>
  );
}
