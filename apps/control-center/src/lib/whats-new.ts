// "What's new": what a customer is told once after an update, on Overview, and
// can read again under Updates. Newest last. An entry is one title and one
// sentence that says how to use it; pure fixes get none.
//
// A theme that is added to the catalog always gets an entry, with its catalog
// id as `theme`. Those are told first and beside the three others.
//
// An id never changes: the app stores the ones a customer has seen, and each
// approval entry names the ones its change adds
// (docs/control-center-ui-principles.md). The approval gate and the customer
// flows read the ids from this file, so each stays a plain string on its
// `id:` line.

import {
  Keyboard,
  PanelsTopLeft,
  Percent,
  Repeat,
  type LucideIcon,
} from "lucide-react";

export type WhatsNewEntry = {
  id: string;
  icon: LucideIcon;
  title: string;
  /** "{shortcut}" stands for the keys of the shortcut for the next provider. */
  body: string;
  /** The Settings section the entry is about; offers "Show me in Settings". */
  inSettings?: "settings-display" | "settings-display-mode";
  /** The catalog id of the theme the entry announces; offers "Show me in Themes". */
  theme?: string;
};

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    id: "theme-gauge",
    icon: PanelsTopLeft,
    title: "New theme: Gauge",
    body: "A half ring that fills as you use your limit.",
    theme: "gauge",
  },
  {
    id: "theme-token-counter",
    icon: PanelsTopLeft,
    title: "New theme: Token Counter",
    body: "The tokens of your session as one large number.",
    theme: "token-counter",
  },
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
    inSettings: "settings-display-mode",
  },
  {
    id: "usage-display",
    icon: Percent,
    title: "Show what is used or what is left",
    body: "Choose whether VibeTV shows how much of your limit you have used or how much remains.",
    inSettings: "settings-display",
  },
];

/** The id of a catalog theme's row in Themes, where "Show me in Themes" goes. */
export function catalogThemeRowId(themeId: string): string {
  return `catalog-theme-${themeId}`;
}

const STORAGE_KEY = "vibetv.controlCenter.seenWhatsNew";
/** More than three of a kind at once is a list nobody reads. */
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

/**
 * The newest entries that are not in `seen`: new themes first, at most three,
 * then at most three of the others.
 */
export function newestWhatsNew(seen: string[] | null = null): WhatsNewEntry[] {
  const unseen = WHATS_NEW.filter(({ id }) => !seen?.includes(id));
  return [
    ...unseen.filter(({ theme }) => theme).slice(-SHOWN),
    ...unseen.filter(({ theme }) => !theme).slice(-SHOWN),
  ];
}
