import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

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
