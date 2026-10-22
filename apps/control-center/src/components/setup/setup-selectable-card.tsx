import { Check } from "lucide-react";
import type { KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

const ARROW_STEP: Record<string, number> = {
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -1,
};

/**
 * Keys for a group of choices (a radio group): the arrows move focus to the
 * next or previous radio, wrapping around, and select it, as native radio
 * inputs do. Selecting only marks the choice in every setup picker, so the
 * arrows may select. Tab reaches the group once: see the tabIndex each card
 * gets from its group.
 */
export function moveAmongRadios(event: KeyboardEvent<HTMLElement>) {
  const step = ARROW_STEP[event.key];
  if (!step) {
    return;
  }
  const radios = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]:not(:disabled)'),
  );
  const at = radios.indexOf(event.target as HTMLElement);
  if (at < 0) {
    return;
  }
  event.preventDefault();
  const next = radios[(at + step + radios.length) % radios.length];
  next.focus();
  next.click();
}

/**
 * Selection state for the wizard's pickable cards, layered on top of the Item
 * primitive so they keep its transition, focus ring and hover behaviour.
 *
 * Selection is a colour change on a border that is always drawn. Adding and
 * removing the ring instead would snap, because a width change cannot be
 * transitioned.
 *
 * `ink` frames the chosen card in ink instead of the lime-olive ring colour.
 * Settings uses it (calm rule: lime only for primary fill and switch on); the
 * wizard keeps the ring colour.
 */
export function selectedItemClass(selected: boolean, ink = false): string {
  const chosenFrame = ink
    ? // Resting frame is a faint ink ring; the focus ring is full ink (#776).
      cn(
        "border-foreground ring-2 ring-foreground/20",
        "focus-visible:border-foreground focus-visible:ring-foreground",
      )
    : "border-ring ring-2 ring-ring/20";
  return cn(
    "cursor-pointer rounded-[var(--radius-card)] text-left transition-all duration-150 ease-out",
    selected
      ? chosenFrame
      : "ring-0 ring-transparent hover:bg-muted/40",
  );
}

/**
 * Always rendered so picking a card cannot reflow the row it sits in; only its
 * opacity changes.
 */
export function SelectionCheck({ selected }: { selected: boolean }) {
  return (
    <Check
      aria-hidden
      className={cn(
        "size-4 shrink-0 text-[var(--vibetv-support)] transition-opacity duration-150",
        selected ? "opacity-100" : "opacity-0",
      )}
      data-selected={selected || undefined}
    />
  );
}
