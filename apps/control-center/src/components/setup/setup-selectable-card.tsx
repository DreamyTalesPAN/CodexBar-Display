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

// Written out in full: Tailwind only finds class names that appear whole.
const CARD_RING =
  "shadow-[0_0_0_1px_color-mix(in_srgb,var(--foreground)_10%,transparent)]";
const CARD_RING_SELECTED =
  "shadow-[0_0_0_1px_color-mix(in_srgb,var(--foreground)_10%,transparent),0_0_0_3px_color-mix(in_srgb,var(--vibetv-support)_25%,transparent)]";

/**
 * The calm card of the Setup Wizard (variant B): a 12px card with a 10% ink
 * ring, and a soft 3px ring in the brand colour when picked. The ring is a
 * shadow, so picking a card never moves it.
 */
export function calmCardClass(selected: boolean): string {
  return cn(
    "block w-full cursor-pointer rounded-[var(--radius-card)] bg-card text-left text-[13px] outline-none transition-shadow duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
    selected ? CARD_RING_SELECTED : CARD_RING,
  );
}

/**
 * The scroll box of a wizard list (themes, providers). A scroll box clips at
 * its padding edge, and a card's ring is drawn outside the card: 1 px at rest,
 * 3 px picked, 2 px with keyboard focus. A box with no padding cut the first
 * row's top and, at a width the cards fill exactly, the sides (Paul, 23.10.).
 * 4 px of padding on top and at both sides is the room; the negative side
 * margin takes it back, so the cards stand where they stood. The caller takes
 * the same 4 px off its top margin and adds them to its max height.
 */
export const RING_SCROLL_BOX_CLASS =
  "-mx-1 overflow-y-auto px-1 pt-1 pb-6 [mask-image:linear-gradient(to_bottom,black_calc(100%_-_24px),transparent)]";

/**
 * Round radio mark for the device, connection, display-mode and theme cards
 * (variant B): an empty ring when not picked, an ink disc with a check when
 * picked. Always rendered, so picking a card does not reflow it.
 */
export function SelectionDot({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-full transition-colors duration-150",
        selected
          ? "bg-foreground text-background"
          : "shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_25%,transparent)]",
      )}
      data-selected={selected || undefined}
    >
      {selected ? <Check className="size-3" strokeWidth={3} /> : null}
    </span>
  );
}

/**
 * Settings keeps the plain check; only the wizard uses the round mark above.
 * Always rendered so picking a card cannot reflow the row it sits in.
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
