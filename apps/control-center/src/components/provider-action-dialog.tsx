"use client";

import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import type { ApiError } from "./control-center-types";
import { SetupDialog } from "./setup/setup-dialog";
import { systemBusyCopy, useOtherDialogOpen } from "./system-busy-dialog";
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
  return {
    title: `${name} needs a new sign-in`,
    description: `VibeTV can't show ${name} until you sign in again.`,
  };
}

/** The button label, which the tile's action already says for each state. */
function providerActionPrimary(action: UsageProviderAction): string {
  // A sign-in the Companion cannot start goes to Settings, like a permission:
  // the button says where it leads (Codex review on #783).
  if (action.state === "permission_required" || action.inSettings) return "Open AI providers";
  return `Sign in to ${action.name}`;
}

const actionKey = (id: string, action: UsageProviderAction) =>
  `${id}:${action.state}`;

/**
 * The one provider overlay to show: the first action not dismissed. A closed
 * overlay stays closed while the provider stays in that state. A provider that
 * is healthy again drops out of `actions`, which clears its dismissal and its
 * failure, so it returns when the cause comes back. A failed sign-in start is
 * reported with `reportSignIn`; it reopens that overlay with the error. React
 * state only.
 */
export function useProviderActionDismissal(
  actions: Record<string, UsageProviderAction>,
  /** Settings is the page: it lists the provider in its own dialog, so the overlay counts as seen. */
  onSettings = false,
  /** Providers not healthy yet (see providerUnresolvedIds): their dismissal holds until a healthy or switched-off result. */
  unresolvedIds: string[] = [],
): [
  { id: string; action: UsageProviderAction; error: ApiError | null } | null,
  () => void,
  (id: string, state: string, error: ApiError | null, rearm: boolean, signIn: object) => void,
  (id: string) => object,
] {
  const entries = Object.entries(actions);
  const signature = entries.map(([id, action]) => actionKey(id, action)).join("\n");
  const unresolved = unresolvedIds.join("\n");
  const [memory, setMemory] = useState({
    signature,
    unresolved,
    dismissed: new Set<string>(),
    failures: new Map<string, ApiError>(),
    // The latest sign-in start per provider (#679). Only its reply counts.
    signIns: new Map<string, object>(),
  });
  let { dismissed, failures, signIns } = memory;
  if (memory.signature !== signature || memory.unresolved !== unresolved) {
    // The set of actions changed: keep what is still there, and what is still
    // not healthy yet (a checking, stale or timeout read is not a healthy result).
    const current = new Set(signature ? signature.split("\n") : []);
    const held = new Set(unresolvedIds);
    // A provider that left its action forgets its sign-in: a reply for it
    // after its return must not reopen or clear the new incident.
    const ids = new Set(entries.map(([id]) => id));
    signIns = new Map(
      [...memory.signIns].filter(([id]) => ids.has(id) || held.has(id)),
    );
    dismissed = new Set(
      [...dismissed].filter(
        (key) => current.has(key) || held.has(key.split(":")[0]),
      ),
    );
    failures = new Map(
      [...failures].filter(
        ([key]) => current.has(key) || held.has(key.split(":")[0]),
      ),
    );
    setMemory({ signature, unresolved, dismissed, failures, signIns });
  }
  let shown: [string, UsageProviderAction] | undefined = entries.find(
    ([id, action]) => !dismissed.has(actionKey(id, action)),
  );
  if (onSettings && shown) {
    // Seen on Settings, whatever way the page was opened: every action present
    // is marked in one update, so the page never re-renders once per provider.
    const seen = entries.map(([id, action]) => actionKey(id, action));
    setMemory((previous) => ({
      ...previous,
      dismissed: new Set([...previous.dismissed, ...seen]),
    }));
    shown = undefined;
  }
  const dismiss = () => {
    if (shown) {
      const key = actionKey(shown[0], shown[1]);
      setMemory((previous) => {
        const failuresLeft = new Map(previous.failures);
        failuresLeft.delete(key);
        return {
          ...previous,
          dismissed: new Set(previous.dismissed).add(key),
          failures: failuresLeft,
        };
      });
    }
  };
  // rearm: the sign-in was started from the overlay or a Usage tile, so a failure
  // reopens the overlay; one started in Settings shows there and stays put.
  const reportSignIn = (
    id: string,
    state: string,
    error: ApiError | null,
    rearm: boolean,
    signIn: object,
  ) => {
    const key = `${id}:${state}`;
    setMemory((previous) => {
      // A reply from a superseded sign-in must not reopen or clear the newer one.
      if (previous.signIns.get(id) !== signIn) {
        return previous;
      }
      // A reply that comes after its action ended must not revive it.
      if (
        error &&
        !previous.signature.split("\n").includes(key) &&
        !unresolvedIds.includes(id)
      ) {
        return previous;
      }
      const failuresNow = new Map(previous.failures);
      const dismissedNow = new Set(previous.dismissed);
      if (error) {
        failuresNow.set(key, error);
        if (rearm) {
          // A new failure reopens the overlay of that provider, to show it.
          dismissedNow.delete(key);
        }
      } else {
        failuresNow.delete(key);
      }
      return { ...previous, dismissed: dismissedNow, failures: failuresNow };
    });
  };
  // A sign-in start: the provider's latest sign-in is this one, from now on.
  const startSignIn = (id: string) => {
    const signIn: object = {};
    setMemory((previous) => ({
      ...previous,
      signIns: new Map(previous.signIns).set(id, signIn),
    }));
    return signIn;
  };
  return [
    shown
      ? {
          id: shown[0],
          action: shown[1],
          error: failures.get(actionKey(shown[0], shown[1])) ?? null,
        }
      : null,
    dismiss,
    reportSignIn,
    startSignIn,
  ];
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
  // The busy notice yields to this overlay (it waits for any other dialog), so
  // the overlay does not wait for it: otherwise the two would hide each other.
  if (useOtherDialogOpen([copy.title, systemBusyCopy.title])) {
    return null;
  }
  return (
    <SetupDialog
      // Only the message: the companion's next-action text still names a
      // "check again" the Control Center no longer offers.
      description={error ? error.message : copy.description}
      icon={AlertTriangle}
      onOpenChange={(open) => {
        if (!open) {
          onDismiss();
        }
      }}
      open
      primaryAction={{
        label: providerActionPrimary(action),
        // Settings opens over the overlay, so the overlay goes with the click.
        onSelect: () => {
          action.onAction();
          if (action.inSettings) {
            onDismiss();
          }
        },
      }}
      secondaryAction={{ label: "Not now", onSelect: onDismiss }}
      title={copy.title}
    />
  );
}
