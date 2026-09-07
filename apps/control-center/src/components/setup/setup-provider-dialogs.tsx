import { TriangleAlert } from "lucide-react";

import type { ApiError } from "../control-center-types";
import { SetupDialog } from "./setup-dialog";

type StepFailedDialogProps = {
  dismissible?: boolean;
  error: ApiError | null;
  onOpenChange: (open: boolean) => void;
  /** Offered when the step can simply ask the companion again. */
  onRetry?: () => void;
  retryLabel?: string;
};

/**
 * The companion or catalog refused what the current setup step asked for.
 *
 * The provider and display steps write through the companion, and it applies
 * gates the screen cannot fully anticipate: provider state that changed after
 * rendering, or a display still naming a provider that has since been turned
 * off.
 * The provider list itself is read the same way, and a read that failed left
 * the step reporting that no providers matched -- an empty list with a closed
 * Continue and nothing said. Without this the refusal was swallowed and
 * Continue simply did nothing, which reads as a broken button rather than as
 * something to fix.
 */
export function SetupStepFailedDialog({
  dismissible = true,
  error,
  onOpenChange,
  onRetry,
  retryLabel = "Try again",
}: StepFailedDialogProps) {
  const visibleError = error?.code === "COMPANION_UNREACHABLE" ? null : error;
  return (
    <SetupDialog
      description={visibleError?.nextAction ?? ""}
      icon={TriangleAlert}
      onOpenChange={onOpenChange}
      open={Boolean(visibleError)}
      primaryAction={
        onRetry
          ? {
              label: retryLabel,
              onSelect: () => {
                onOpenChange(false);
                onRetry();
              },
            }
          : { label: "OK", onSelect: () => onOpenChange(false) }
      }
      showCloseButton={dismissible}
      title={visibleError?.message ?? ""}
    />
  );
}
