"use client";

import { Monitor, RefreshCw } from "lucide-react";
import type { FormEvent } from "react";
import type { ApiError } from "./control-center-types";
import {
  DEVICE_TARGET_PLACEHOLDER,
  deviceTargetHelpText,
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
  buttonLabel = "Search target",
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit?.(value);
  }

  return (
    <form className={className} onSubmit={handleSubmit}>
      <div className="min-w-0">
        <label className="text-sm font-bold text-[#1B1B1B]" htmlFor={id}>
          VibeTV target
        </label>
        <p className="mt-1 max-w-[720px] text-sm leading-6 text-[#444933]">
          {deviceTargetHelpText(lastError)}
        </p>
        <input
          className="mt-3 h-12 w-full border border-[#747A60] bg-[#F9F9F9] px-3 font-mono text-sm text-[#1B1B1B] outline-none transition placeholder:text-[#747A60] focus:border-[#5E7200] disabled:cursor-not-allowed disabled:bg-[#EEEEEE] disabled:text-[#444933]"
          disabled={formDisabled}
          id={id}
          onChange={(event) => onChange?.(event.target.value)}
          placeholder={DEVICE_TARGET_PLACEHOLDER}
          spellCheck={false}
          type="text"
          value={value}
        />
      </div>
      <button
        className="inline-flex h-12 min-w-[190px] items-center justify-center gap-2 border border-[#1B1B1B] bg-[#1B1B1B] px-4 text-sm font-semibold text-[#EDEDED] transition hover:bg-[#CCFF00] hover:text-[#1B1B1B] disabled:cursor-not-allowed disabled:bg-[#EEEEEE] disabled:text-[#444933]"
        disabled={formDisabled}
        type="submit"
      >
        {busy ? (
          <RefreshCw className="animate-spin" size={18} aria-hidden />
        ) : (
          <Monitor size={18} aria-hidden />
        )}
        <span>{busy ? searchingLabel : buttonLabel}</span>
      </button>
    </form>
  );
}
