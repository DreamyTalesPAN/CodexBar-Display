"use client";

import { useState } from "react";

const COLOR_FALLBACK = "#000000";

export function TextField({
  label,
  onChange,
  type = "text",
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  type?: "password" | "text";
  value: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-black uppercase tracking-normal text-[#444933]">
        {label}
      </span>
      <input
        className="min-h-11 w-full border border-[#747A60] bg-[#F9F9F9] px-3 text-sm text-[#1B1B1B] outline-none focus:border-[#5E7200]"
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
    </label>
  );
}

export function NumberField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-black uppercase tracking-normal text-[#444933]">
        {label}
      </span>
      <input
        className="min-h-11 w-full border border-[#747A60] bg-[#F9F9F9] px-3 text-sm text-[#1B1B1B] outline-none focus:border-[#5E7200]"
        min={0}
        onChange={(event) => onChange(integerOrDefault(event.target.value, 0))}
        type="number"
        value={value}
      />
    </label>
  );
}

export function ColorField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const safeValue = /^#[0-9A-Fa-f]{6}$/.test(value) ? value : COLOR_FALLBACK;
  const normalizedValue = safeValue.toUpperCase();
  const [colorState, setColorState] = useState({
    draft: normalizedValue,
    source: normalizedValue,
  });
  const draftValue =
    colorState.source === normalizedValue ? colorState.draft : normalizedValue;
  const draftValid = /^#[0-9A-Fa-f]{6}$/.test(draftValue);
  const setDraftValue = (draft: string) =>
    setColorState({ draft, source: normalizedValue });

  function commitDraft() {
    if (/^#[0-9A-Fa-f]{6}$/.test(draftValue)) {
      const normalized = draftValue.toUpperCase();
      setDraftValue(normalized);
      onChange(normalized);
      return;
    }
    setDraftValue(safeValue.toUpperCase());
  }

  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-black uppercase tracking-normal text-[#444933]">
        {label}
      </span>
      <span className="grid min-h-11 grid-cols-[44px_minmax(0,1fr)] overflow-hidden border border-[#747A60] bg-[#F9F9F9]">
        <input
          aria-label={`${label} swatch`}
          className="h-11 w-11 cursor-pointer border-0 bg-transparent p-1"
          onChange={(event) => {
            const next = event.target.value.toUpperCase();
            setColorState({ draft: next, source: next });
            onChange(next);
          }}
          type="color"
          value={safeValue}
        />
        <input
          aria-invalid={!draftValid}
          className="min-w-0 border-0 bg-[#F9F9F9] px-3 font-mono text-sm text-[#1B1B1B] outline-none"
          onBlur={commitDraft}
          onChange={(event) => setDraftValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitDraft();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              setDraftValue(safeValue.toUpperCase());
              event.currentTarget.blur();
            }
          }}
          value={draftValue}
        />
      </span>
    </label>
  );
}

export function SelectField({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
  value: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-black uppercase tracking-normal text-[#444933]">
        {label}
      </span>
      <select
        className="min-h-11 w-full border border-[#747A60] bg-[#F9F9F9] px-3 text-sm text-[#1B1B1B] outline-none focus:border-[#5E7200]"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function integerOrDefault(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
