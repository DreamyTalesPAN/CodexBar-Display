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
  formatDeviceTargetInput,
  normalizeManualDeviceTarget,
} from "./device-target-copy";

type DeviceTargetFormProps = {
  busy?: boolean;
  buttonLabel?: string;
  className?: string;
  disabled?: boolean;
  id: string;
  lastError?: ApiError | null;
  minimal?: boolean;
  onChange?: (target: string) => void;
  onSubmit?: (target: string) => void;
  searchingLabel?: string;
  value: string;
};

export function DeviceTargetForm({
  busy = false,
  buttonLabel = "Connect VibeTV",
  className,
  disabled = false,
  id,
  lastError,
  minimal = false,
  onChange,
  onSubmit,
  searchingLabel = "Searching",
  value,
}: DeviceTargetFormProps) {
  const formDisabled = disabled || busy;
  const [validationError, setValidationError] = useState("");
  const formClassName =
    className ||
    (minimal
      ? "grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"
      : "grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end");

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

  const descriptionId = minimal ? undefined : `${id}-description`;
  const describedBy = [descriptionId, validationError ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ") || undefined;

  return (
    <form onSubmit={handleSubmit}>
      <FieldGroup className={formClassName}>
        <Field className="min-w-0" data-invalid={Boolean(validationError)}>
          <FieldLabel className={minimal ? "sr-only" : undefined} htmlFor={id}>
            VibeTV address
          </FieldLabel>
          {!minimal ? (
            <FieldDescription id={descriptionId}>
              {deviceTargetHelpText(lastError)}
            </FieldDescription>
          ) : null}
          <Input
            aria-describedby={describedBy}
            aria-invalid={Boolean(validationError)}
            className="h-12 font-mono text-base"
            disabled={formDisabled}
            id={id}
            inputMode="decimal"
            onChange={(event) => {
              setValidationError("");
              onChange?.(event.target.value);
            }}
            placeholder={DEVICE_TARGET_PLACEHOLDER}
            spellCheck={false}
            type="text"
            value={formatDeviceTargetInput(value)}
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
