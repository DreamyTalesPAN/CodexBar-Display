"use client";

import { SetupDialog } from "./setup-dialog";

type SetupRecoveryDialogsProps = {
  onHide: () => void;
  onRestart: () => void;
  onRetry: () => void;
  /** null while the background service is answering normally. */
  phase: "repairing" | "failed" | null;
  retrying: boolean;
};

/**
 * The background service dying is shown over whatever the customer was doing,
 * on every screen, rather than replacing the app with a page of its own.
 *
 * It used to appear only before the customer had entered the app once, which
 * meant a service that died later said nothing at all.
 *
 * It dims the screen behind it like every other dialog (the approved template
 * draws the same grey backdrop on both), but the dim takes no clicks: an
 * announcement about the background service must leave the app usable --
 * taking it away is the very thing this is reporting.
 */
export function SetupRecoveryDialogs({
  onHide,
  onRestart,
  onRetry,
  phase,
  retrying,
}: SetupRecoveryDialogsProps) {
  return (
    <>
      <SetupDialog
        // Hide, not Cancel: the repair is an unregister and re-register of the
        // background service that runs to the end either way, and nothing at
        // any layer can stop it part way.
        description="The background service stopped responding and is restarting automatically. Your setup stays saved."
        onOpenChange={(open) => !open && onHide()}
        open={phase === "repairing"}
        primaryAction={{ label: "Hide", onSelect: onHide }}
        scrim={false}
        showCloseButton={false}
        title="Repairing VibeTV Control Center"
      />
      <SetupDialog
        description="The background service could not be restarted automatically. Your setup stays saved."
        onOpenChange={(open) => !open && onHide()}
        open={phase === "failed"}
        primaryAction={{
          busy: retrying,
          label: "Try automatic repair again",
          onSelect: onRetry,
        }}
        secondaryAction={{
          label: "Restart Control Center",
          onSelect: onRestart,
        }}
        scrim={false}
        title="VibeTV Control Center needs attention"
        wide
      />
    </>
  );
}
