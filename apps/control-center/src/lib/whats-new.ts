// "What's new": what a customer is told once after an update, on Overview, and
// can read again under Updates. Newest last. An entry is one title and one
// sentence that says how to use it; pure fixes get none.
//
// An id never changes: the app stores the ones a customer has seen, and each
// approval entry names the ones its change adds
// (docs/control-center-ui-principles.md). The approval gate and the customer
// flows read the ids from this file, so each stays a plain string on its
// `id:` line.

import { Keyboard, Percent, Repeat, type LucideIcon } from "lucide-react";

export type WhatsNewEntry = {
  id: string;
  icon: LucideIcon;
  title: string;
  /** "{shortcut}" stands for the keys of the shortcut for the next provider. */
  body: string;
  /** The entry offers "Show me in Settings". */
  inSettings?: boolean;
};

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    id: "provider-shortcut",
    icon: Keyboard,
    title: "Switch providers with a shortcut",
    body: "Press {shortcut} in any app to show the next provider on VibeTV.",
  },
  {
    id: "switch-providers-interval",
    icon: Repeat,
    title: "Choose how often VibeTV switches",
    body: "In Automatic mode VibeTV can switch when your activity changes, or every 30 seconds, every minute or every 5 minutes.",
    inSettings: true,
  },
  {
    id: "usage-display",
    icon: Percent,
    title: "Show what is used or what is left",
    body: "Choose whether VibeTV shows how much of your limit you have used or how much remains.",
    inSettings: true,
  },
];

const STORAGE_KEY = "vibetv.controlCenter.seenWhatsNew";
/** More than three at once is a list nobody reads. */
const SHOWN = 3;

/** The ids this customer has seen, or null while nothing is stored. */
export function seenWhatsNew(): string[] | null {
  try {
    const stored: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) || "null",
    );
    return Array.isArray(stored)
      ? stored.filter((id): id is string => typeof id === "string")
      : null;
  } catch {
    // localStorage may be unavailable in private or restricted browser contexts.
    return null;
  }
}

/**
 * Stores every entry there is as seen, and returns their ids. Also the ones
 * that did not fit on the notice: they are older than what was shown.
 */
export function markWhatsNewSeen(): string[] {
  const seen = WHATS_NEW.map(({ id }) => id);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seen));
  } catch {
    // See above.
  }
  return seen;
}

/** The newest entries that are not in `seen`, at most three. */
export function newestWhatsNew(seen: string[] | null = null): WhatsNewEntry[] {
  return WHATS_NEW.filter(({ id }) => !seen?.includes(id)).slice(-SHOWN);
}
