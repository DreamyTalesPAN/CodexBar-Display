"use client";

import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import type { ApiError } from "./control-center-types";
import { SetupDialog } from "./setup/setup-dialog";
import { useOtherDialogOpen } from "./system-busy-dialog";
import type { UsageProviderAction } from "./usage-screen";

/**
 * The copy for one provider that needs the customer (Paul, 16.10.2026, frame
 * 3A). Sign-in states start the sign-in; access and setup go to Settings or
 * the setup, as the action says.
 */
export function providerActionCopy(action: UsageProviderAction) {
  const { name, state } = action;
  if (state === "permission_required") {
    return {
      title: `${name} needs access`,
      description: `VibeTV can't show ${name} until you allow access on this computer.`,
    };
  }
  if (state === "setup_required") {
    return {
      title: `${name} needs setup`,
      description: `VibeTV can't show ${name} until it is set up.`,
    };
  }
  return {
    title: `${name} needs a new sign-in`,
    description: `VibeTV can't show ${name} until you sign in again.`,
  };
}

/** The button label, which the tile's action already says for each state. */
function providerActionPrimary(action: UsageProviderAction): string {
  if (action.state === "permission_required") return "Open AI providers";
  if (action.state === "setup_required") return `Set up ${action.name}`;
  return `Sign in to ${action.name}`;
}

const actionKey = (id: string, action: UsageProviderAction) =>
  `${id}:${action.state}`;

/**
 * The one provider overlay to show: the first action not dismissed. A closed
 * overlay stays closed while the provider stays in that state. A provider that
 * is healthy again drops out of `actions`, which clears its dismissal, so it
 * returns when the cause comes back. React state only.
 */
export function useProviderActionDismissal(
  actions: Record<string, UsageProviderAction>,
): [{ id: string; action: UsageProviderAction } | null, () => void] {
  const entries = Object.entries(actions);
  const signature = entries.map(([id, action]) => actionKey(id, action)).join("\n");
  const [memory, setMemory] = useState({
    signature,
    dismissed: new Set<string>(),
  });
  let dismissed = memory.dismissed;
  if (memory.signature !== signature) {
    // The set of actions changed: keep only dismissals of actions still there.
    const current = new Set(signature ? signature.split("\n") : []);
    dismissed = new Set([...dismissed].filter((key) => current.has(key)));
    setMemory({ signature, dismissed });
  }
  const shown = entries.find(
    ([id, action]) => !dismissed.has(actionKey(id, action)),
  );
  const dismiss = () => {
    if (shown) {
      const key = actionKey(shown[0], shown[1]);
      setMemory((previous) => ({
        signature: previous.signature,
        dismissed: new Set(previous.dismissed).add(key),
      }));
    }
  };
  return [shown ? { id: shown[0], action: shown[1] } : null, dismiss];
}

/**
 * Over the page, centred and dimmed like a setup error. It waits while another
 * dialog is open, as the busy computer notice does. A failed sign-in start
 * shows in its description.
 */
export function ProviderActionDialog({
  action,
  error,
  onDismiss,
}: {
  action: UsageProviderAction;
  error?: ApiError | null;
  onDismiss: () => void;
}) {
  const copy = providerActionCopy(action);
  if (useOtherDialogOpen(copy.title)) {
    return null;
  }
  return (
    <SetupDialog
      description={
        error
          ? [error.message, error.nextAction].filter(Boolean).join(" ")
          : copy.description
      }
      icon={AlertTriangle}
      onOpenChange={(open) => {
        if (!open) {
          onDismiss();
        }
      }}
      open
      primaryAction={{ label: providerActionPrimary(action), onSelect: action.onAction }}
      secondaryAction={{ label: "Not now", onSelect: onDismiss }}
      title={copy.title}
    />
  );
}
