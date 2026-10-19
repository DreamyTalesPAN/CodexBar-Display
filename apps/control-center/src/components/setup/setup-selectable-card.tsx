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
    ? "border-foreground ring-2 ring-foreground/20"
    : "border-ring ring-2 ring-ring/20";
  return cn(
    "cursor-pointer rounded-[var(--radius-card)] text-left transition-all duration-150 ease-out",
    selected
      ? chosenFrame
      : "ring-0 ring-transparent hover:bg-muted/40",
  );
}

/**
 * Round radio mark for the device, connection, display-mode and theme cards
 * (variant B): an empty
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
