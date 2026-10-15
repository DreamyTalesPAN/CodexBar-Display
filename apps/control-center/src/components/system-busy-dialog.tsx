"use client";

import { useState } from "react";
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
 * stays closed while the computer stays busy and opens again only once the
 * condition has gone and come back.
 */
export function useSystemBusyDismissal(busy: boolean): [boolean, () => void] {
  const [dismissed, setDismissed] = useState(false);
  const [wasBusy, setWasBusy] = useState(busy);
  if (busy !== wasBusy) {
    setWasBusy(busy);
    if (!busy) {
      setDismissed(false);
    }
  }
  return [dismissed, () => setDismissed(true)];
}

/** The computer is too starved for the usage engine to answer (#606). */
export function SystemBusyDialog({ onClose }: { onClose: () => void }) {
  return (
    <SetupDialog
      description={systemBusyCopy.description}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open
      primaryAction={{ label: systemBusyCopy.action, onSelect: onClose }}
      // An announcement over whatever the customer is doing: the app behind
      // it keeps working.
      scrim={false}
      showCloseButton={false}
      title={systemBusyCopy.title}
    />
  );
}
