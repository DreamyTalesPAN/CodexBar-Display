"use client";

import { useId, useState } from "react";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
    </Field>
  );
}

export function NumberField({
  label,
  max,
  min = 0,
  onChange,
  value,
}: {
  label: string;
  max?: number;
  min?: number;
  onChange: (value: number) => void;
  value: number;
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        max={max}
        min={min}
        onChange={(event) => {
          const next = integerOrDefault(event.target.value, min);
          onChange(Math.max(min, Math.min(max ?? next, next)));
        }}
        type="number"
        value={value}
      />
    </Field>
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
  const id = useId();
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
    <Field data-invalid={!draftValid}>
      <FieldLabel htmlFor={`${id}-text`}>{label}</FieldLabel>
      <InputGroup className="h-11 rounded-[var(--radius-control)]">
        <InputGroupInput
          aria-invalid={!draftValid}
          className="font-mono"
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
          id={`${id}-text`}
        />
        <InputGroupAddon align="inline-start" className="p-0">
          <input
            aria-label={`${label} swatch`}
            className="h-10 w-10 cursor-pointer border-0 bg-transparent p-1"
            onChange={(event) => {
              const next = event.target.value.toUpperCase();
              setColorState({ draft: next, source: next });
              onChange(next);
            }}
            type="color"
            value={safeValue}
            id={`${id}-swatch`}
          />
        </InputGroupAddon>
      </InputGroup>
    </Field>
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
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select onValueChange={onChange} value={value}>
        <SelectTrigger className="h-11 w-full rounded-[var(--radius-control)]" id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map(([optionValue, optionLabel]) => (
              <SelectItem key={optionValue} value={optionValue}>
                {optionLabel}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}

function integerOrDefault(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
