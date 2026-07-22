"use client";

import { Monitor, RefreshCw } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ControlCenterButton } from "./control-center-button";
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
  const labelClassName = minimal
    ? "sr-only"
    : "text-sm font-bold text-[#1B1B1B]";
  const inputClassName = minimal
    ? "h-12 w-full border border-[#747A60] bg-[#F9F9F9] px-3 font-mono text-base text-[#1B1B1B] outline-none transition placeholder:text-[#747A60] focus:border-[#5E7200] disabled:cursor-not-allowed disabled:bg-[#EEEEEE] disabled:text-[#444933]"
    : "mt-3 h-12 w-full border border-[#747A60] bg-[#F9F9F9] px-3 font-mono text-sm text-[#1B1B1B] outline-none transition placeholder:text-[#747A60] focus:border-[#5E7200] disabled:cursor-not-allowed disabled:bg-[#EEEEEE] disabled:text-[#444933]";

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
    <form className={formClassName} onSubmit={handleSubmit}>
      <div className="min-w-0">
        <label className={labelClassName} htmlFor={id}>
          VibeTV address
        </label>
        {!minimal ? (
          <p className="mt-1 max-w-[720px] text-sm leading-6 text-[#444933]">
            {deviceTargetHelpText(lastError)}
          </p>
        ) : null}
        <input
          className={inputClassName}
          disabled={formDisabled}
          id={id}
          aria-invalid={Boolean(validationError)}
          aria-describedby={validationError ? `${id}-error` : undefined}
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
          <p className="mt-2 text-sm font-semibold text-[#8A2500]" id={`${id}-error`}>
            {validationError}
          </p>
        ) : null}
      </div>
      <ControlCenterButton
        disabled={formDisabled}
        icon={
          busy ? (
            <RefreshCw className="animate-spin" size={18} aria-hidden />
          ) : (
            <Monitor size={18} aria-hidden />
          )
        }
        label={busy ? searchingLabel : buttonLabel}
        type="submit"
        variant="primary"
      />
    </form>
  );
}
