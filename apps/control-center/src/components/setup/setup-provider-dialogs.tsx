import { TriangleAlert } from "lucide-react";

import type { ApiError } from "../control-center-types";
import { SetupDialog } from "./setup-dialog";

type ProviderStepFailedDialogProps = {
  error: ApiError | null;
  onOpenChange: (open: boolean) => void;
  /** Offered when the step can simply ask the companion again. */
  onRetry?: () => void;
};

/**
 * 03e / 04b — the companion refused what the step asked for.
 *
 * The provider and display steps write through the companion, and it applies
 * gates the screen cannot fully anticipate: a provider whose exact check went
 * stale, a display still naming a provider that has since been turned off.
 * The provider list itself is read the same way, and a read that failed left
 * the step reporting that no providers matched -- an empty list with a closed
 * Continue and nothing said. Without this the refusal was swallowed and
 * Continue simply did nothing, which reads as a broken button rather than as
 * something to fix.
 */
export function SetupProviderStepFailedDialog({
  error,
  onOpenChange,
  onRetry,
}: ProviderStepFailedDialogProps) {
  return (
    <SetupDialog
      description={error?.nextAction ?? ""}
      icon={TriangleAlert}
      onOpenChange={onOpenChange}
      open={Boolean(error)}
      primaryAction={
        onRetry
          ? {
              label: "Try again",
              onSelect: () => {
                onOpenChange(false);
                onRetry();
              },
            }
          : { label: "OK", onSelect: () => onOpenChange(false) }
      }
      title={error?.message ?? ""}
    />
  );
}
