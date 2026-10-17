import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Selection state for the wizard's pickable cards, layered on top of the Item
 * primitive so they keep its transition, focus ring and hover behaviour.
 *
 * Selection is a colour change on a border that is always drawn. Adding and
 * removing the ring instead would snap, because a width change cannot be
 * transitioned.
 */
export function selectedItemClass(selected: boolean): string {
  return cn(
    "cursor-pointer rounded-[var(--radius-card)] text-left transition-all duration-150 ease-out",
    selected
      ? "border-ring ring-2 ring-ring/20"
      : "ring-0 ring-transparent hover:bg-muted/40",
  );
}

/**
 * Round radio mark for the display-mode and theme steps (variant B): an empty
 * ring when not picked, an ink disc with a check when picked. Always rendered,
 * so picking a card does not reflow it.
 */
export function SelectionDot({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-full border transition-colors duration-150",
        selected
          ? "border-foreground bg-foreground text-background"
          : "border-muted-foreground/50",
      )}
      data-selected={selected || undefined}
    >
      {selected ? <Check className="size-3" strokeWidth={3} /> : null}
    </span>
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
        "size-4 shrink-0 text-foreground transition-opacity duration-150",
        selected ? "opacity-100" : "opacity-0",
      )}
      data-selected={selected || undefined}
    />
  );
}
