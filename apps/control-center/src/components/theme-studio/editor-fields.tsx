"use client";

import { useId, useState } from "react";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";

const COLOR_FALLBACK = "#000000";

export function NumberField({
  label,
  max,
  onChange,
  value,
}: {
  label: string;
  max?: number;
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
        min={0}
        onChange={(event) => onChange(integerOrDefault(event.target.value, 0))}
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
          aria-describedby={draftValid ? undefined : `${id}-error`}
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
      {draftValid ? null : (
        <FieldError id={`${id}-error`}>
          Use a 6-digit hex color, like #FFAA00.
        </FieldError>
      )}
    </Field>
  );
}

function integerOrDefault(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
