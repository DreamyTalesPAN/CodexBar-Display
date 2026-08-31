import { TriangleAlert } from "lucide-react";

import type { ApiError } from "../control-center-types";
import { SetupDialog } from "./setup-dialog";

type ProviderStepFailedDialogProps = {
  error: ApiError | null;
  onOpenChange: (open: boolean) => void;
};

/**
 * 03e / 04b — the companion refused what the step asked for.
 *
 * The provider and display steps write through the companion, and it applies
 * gates the screen cannot fully anticipate: a provider whose exact check went
 * stale, a display still naming a provider that has since been turned off.
 * Without this the refusal was swallowed and Continue simply did nothing,
 * which reads as a broken button rather than as something to fix.
 */
export function SetupProviderStepFailedDialog({
  error,
  onOpenChange,
}: ProviderStepFailedDialogProps) {
  return (
    <SetupDialog
      description={error?.nextAction ?? ""}
      icon={TriangleAlert}
      onOpenChange={onOpenChange}
      open={Boolean(error)}
      primaryAction={{ label: "OK", onSelect: () => onOpenChange(false) }}
      title={error?.message ?? ""}
    />
  );
}
