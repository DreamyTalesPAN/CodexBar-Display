"use client";

import { SetupDialog } from "./setup-dialog";

export type SetupUsageCause =
  | "checking"
  | "not_set_up"
  | "setup_incomplete"
  | "unknown";

/**
 * One dialog, but never one sentence: "finish the setup your provider asks
 * for" and "try again" are different actions, and a customer who is told the
 * wrong one is stuck. The cause stays in the text.
 */
export const setupUsageCauseCopy: Record<
  SetupUsageCause,
  { description: string; title: string }
> = {
  checking: {
    description:
      "VibeTV is starting its built-in usage service and checking this Mac.",
    title: "Starting AI usage",
  },
  not_set_up: {
    description:
      "VibeTV could not finish setting up its built-in usage service on this Mac. Repair it, then try again.",
    title: "AI usage is not set up",
  },
  setup_incomplete: {
    description:
      "The built-in usage service is installed, but it still cannot read your AI usage. Finish the setup it asks for, then repair.",
    title: "Finish AI setup on this Mac",
  },
  unknown: {
    description:
      "VibeTV could not read AI usage on this Mac. Repair it. If it still fails, create a support report.",
    title: "AI usage could not start",
  },
};

type SetupUsageDialogProps = {
  cause: SetupUsageCause;
  onCreateSupportReport: () => void;
  onOpenChange: (open: boolean) => void;
  onRepair: () => void;
  open: boolean;
};

export function SetupUsageDialog({
  cause,
  onCreateSupportReport,
  onOpenChange,
  onRepair,
  open,
}: SetupUsageDialogProps) {
  return (
    <SetupDialog
      description={setupUsageCauseCopy[cause].description}
      onOpenChange={onOpenChange}
      open={open}
      primaryAction={{ label: "Repair", onSelect: onRepair }}
      // Shown over whatever the customer is doing, so it must not hold the
      // screen behind it: taking the app away is the very thing it reports.
      scrim={false}
      secondaryAction={{
        label: "Create support report",
        onSelect: onCreateSupportReport,
      }}
      title={setupUsageCauseCopy[cause].title}
    />
  );
}

/**
 * Which of the four causes the usage service is reporting. The engine says
 * whether it is missing or merely unconfigured, and that is the difference
 * between "install it" and "finish what it asks for".
 */
export function setupUsageCauseFor(setup: {
  engine?: { status?: string };
  status?: string;
} | null): SetupUsageCause {
  if (setup?.status === "checking") {
    return "checking";
  }
  if (setup?.engine?.status === "not_configured") {
    return "not_set_up";
  }
  if (setup?.status === "setup_required") {
    return "setup_incomplete";
  }
  return "unknown";
}
