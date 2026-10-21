"use client";

import { ChevronDown, Pipette } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
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

// The twelve colours of the palette, as drawn in the template (frame "Theme
// Studio: Farbwahl"): four greys, then warm to cool, no blue.
export const COLOR_PALETTE = [
  "#1B1B1B",
  "#6B6B6B",
  "#C9C9C9",
  "#F5F5F5",
  "#E0723F",
  "#F2A65A",
  "#E5C94A",
  "#9DBA4C",
  "#4FA08B",
  "#D9667A",
  "#9B6FB0",
  "#8A6A4F",
] as const;

// A colour row of the Details block: the field shows the colour and its hex
// code (the code can be typed); the palette opens directly below the field,
// inside Details, so it scrolls with it. "More colours…" opens the system
// colour picker.
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
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const systemPickerRef = useRef<HTMLInputElement>(null);
  const draftValue =
    colorState.source === normalizedValue ? colorState.draft : normalizedValue;
  const draftValid = /^#[0-9A-Fa-f]{6}$/.test(draftValue);
  const setDraftValue = (draft: string) =>
    setColorState({ draft, source: normalizedValue });
  const paletteId = `${id}-palette`;

  // Details scrolls inside itself: bring the palette into view when it opens.
  useEffect(() => {
    if (open) paletteRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  function commitDraft() {
    if (/^#[0-9A-Fa-f]{6}$/.test(draftValue)) {
      const normalized = draftValue.toUpperCase();
      setDraftValue(normalized);
      onChange(normalized);
      return;
    }
    setDraftValue(safeValue.toUpperCase());
  }

  function pick(next: string) {
    const upper = next.toUpperCase();
    setColorState({ draft: upper, source: upper });
    onChange(upper);
  }

  return (
    <Field data-invalid={!draftValid}>
      <FieldLabel htmlFor={`${id}-text`}>{label}</FieldLabel>
      <div
        className="relative"
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.stopPropagation();
            setOpen(false);
            toggleRef.current?.focus();
          }
        }}
        ref={wrapRef}
      >
        <InputGroup className="h-11 rounded-[var(--radius-control)]">
          <InputGroupAddon align="inline-start" className="pl-2 pr-0">
            <button
              aria-controls={open ? paletteId : undefined}
              aria-expanded={open}
              aria-haspopup="true"
              aria-label={`${label} palette`}
              className="size-6 cursor-pointer rounded-[5px] border-0 p-0 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]"
              onClick={() => setOpen((current) => !current)}
              ref={toggleRef}
              style={{ background: safeValue }}
              type="button"
            />
          </InputGroupAddon>
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
              } else if (event.key === "Escape" && !open) {
                setDraftValue(safeValue.toUpperCase());
                event.currentTarget.blur();
              }
            }}
            value={draftValue}
            id={`${id}-text`}
          />
          <InputGroupAddon align="inline-end" className="pr-2.5">
            <span
              aria-hidden
              className="cursor-pointer text-muted-foreground"
              onClick={() => setOpen((current) => !current)}
            >
              <ChevronDown
                aria-hidden
                className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`}
              />
            </span>
          </InputGroupAddon>
        </InputGroup>
        {open ? (
          <div
            aria-label={`${label} palette`}
            className="mt-1.5 mr-0 ml-auto box-border w-full max-w-[232px] scroll-mb-3 rounded-xl bg-popover p-3 shadow-[0_0_0_1px_color-mix(in_srgb,var(--foreground)_10%,transparent),0_4px_12px_rgba(0,0,0,0.08)]"
            data-testid="color-palette"
            id={paletteId}
            ref={paletteRef}
            role="group"
          >
            <div className="grid grid-cols-6 gap-2">
              {COLOR_PALETTE.map((color) => {
                const selected = color === normalizedValue;
                return (
                  <button
                    aria-label={color}
                    aria-pressed={selected}
                    className={`aspect-square w-full cursor-pointer rounded-full border-0 p-0 ${
                      selected
                        ? "shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12),0_0_0_2px_var(--popover),0_0_0_4px_var(--foreground)]"
                        : "shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]"
                    }`}
                    key={color}
                    onClick={() => {
                      pick(color);
                      setOpen(false);
                      toggleRef.current?.focus();
                    }}
                    style={{ background: color }}
                    type="button"
                  />
                );
              })}
            </div>
            <div className="-mx-1 mt-3 -mb-1 border-t border-foreground/10 pt-1.5">
              <button
                className="flex h-[34px] w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-2 text-left text-[14.5px] font-semibold text-foreground hover:bg-muted"
                onClick={() => {
                  const picker = systemPickerRef.current;
                  if (!picker) return;
                  if (typeof picker.showPicker === "function") picker.showPicker();
                  else picker.click();
                }}
                type="button"
              >
                <Pipette aria-hidden className="size-4 text-muted-foreground" />
                More colours…
              </button>
            </div>
          </div>
        ) : null}
        {/* The system picker stays what it was: it opens from "More colours…". */}
        <input
          aria-label={`${label} swatch`}
          className="pointer-events-none absolute bottom-0 left-0 size-0 opacity-0"
          id={`${id}-swatch`}
          onChange={(event) => pick(event.target.value)}
          ref={systemPickerRef}
          tabIndex={-1}
          type="color"
          value={safeValue}
        />
      </div>
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
