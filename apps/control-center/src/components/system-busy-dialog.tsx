"use client";

import { useEffect, useState } from "react";
import { SetupDialog } from "./setup/setup-dialog";

/**
 * Paul approved this wording on 2026-10-15 (#606). It says "computer" so the
 * same words are right on the Mac and on Windows.
 */
export const systemBusyCopy = {
  title: "Your computer is very busy",
  description:
    "VibeTV can't get new usage right now because your computer is low on memory. Close apps you don't need or restart your computer.",
  action: "OK",
};

/**
 * Whether the customer closed the dialog for the incident under way. Closed
 * stays closed while the computer stays busy and opens again for the next
 * incident. An incident is its start time: polls can pause while the window
 * is hidden, and a clear between two of them must not be missed.
 */
export function useSystemBusyDismissal(
  since: string | null,
): [boolean, () => void] {
  const [dismissedSince, setDismissedSince] = useState<string | null>(null);
  return [since !== null && since === dismissedSince, () => setDismissedSince(since)];
}

/**
 * Whether a dialog other than this one is open. The busy dialog comes up on
 * its own, so a page's own dialog (Run setup again, a theme preview, a
 * factory reset, a delete confirmation) can open under it, or be open when it
 * comes; it waits for that one instead of covering it, and returns once it is
 * closed. The first answer is read before the first render, so the busy dialog
 * never mounts over a dialog that was already open.
 */
function otherDialogOpen(ownTitles: string[]): boolean {
  return (
    typeof document !== "undefined" &&
    Array.from(
      document.querySelectorAll('[role="dialog"], [role="alertdialog"]'),
    ).some((dialog) => !ownTitles.some((title) =>
      title === systemBusyCopy.title
        ? dialog.getAttribute("data-notice-kind") === "system-busy"
        : dialog.querySelector('[data-slot="dialog-title"]')?.textContent === title,
    ))
  );
}

/**
 * Whether a dialog other than the ones titled `ownTitles` is open. Shared with
 * the provider overlay; each names the dialogs it waits for, so the two never
 * hide each other.
 */
export function useOtherDialogOpen(ownTitles: string[]): boolean {
  const key = ownTitles.join("\n");
  const [open, setOpen] = useState(() => otherDialogOpen(ownTitles));
  useEffect(() => {
    const titles = key.split("\n");
    const check = () => setOpen(otherDialogOpen(titles));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [key]);
  return open;
}

/** The computer is too starved for the usage engine to answer (#606). */
export function SystemBusyDialog({ onClose }: { onClose: () => void }) {
  if (useOtherDialogOpen([systemBusyCopy.title])) {
    return null;
  }
  return (
    <SetupDialog
      noticeKind="system-busy"
      description={systemBusyCopy.description}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open
      primaryAction={{ label: systemBusyCopy.action, onSelect: onClose }}
      showCloseButton={false}
      title={systemBusyCopy.title}
    />
  );
}
