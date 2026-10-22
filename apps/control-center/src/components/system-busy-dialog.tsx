"use client";

import { useState } from "react";
import { useWaitsForPageDialog } from "./announcement-gate";
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
 * The computer is too starved for the usage engine to answer (#606). An
 * announcement: it waits while a page dialog is open (#632).
 */
export function SystemBusyDialog({ onClose }: { onClose: () => void }) {
  if (useWaitsForPageDialog()) {
    return null;
  }
  return (
    <SetupDialog
      announcement
      noticeKind="system-busy"
      description={systemBusyCopy.description}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open
      primaryAction={{ label: systemBusyCopy.action, onSelect: onClose }}
      // An announcement over whatever the customer is doing: the app behind
      // it keeps working, and the customer's own dialog keeps the focus when
      // both open together (#632).
      onOpenAutoFocus={(event) => event.preventDefault()}
      scrim={false}
      showCloseButton={false}
      title={systemBusyCopy.title}
    />
  );
}
