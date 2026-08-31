"use client";

import { ChevronRight, RefreshCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemTitle,
} from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { PreferenceHealthState } from "../control-center-types";

export type SetupProviderRowVariant =
  | "checking"
  | "no_usage"
  | "outage"
  | "permission"
  | "sign_in"
  | "timed_out"
  | "toggle"
  | "waiting";

/**
 * The health states the usage service reports, mapped onto the presentations
 * the design draws. Anything it does not name (unavailable, config_error,
 * engine_error, and whatever a provider adds later) gets the re-check
 * presentation: running the check again is the one action left to a customer
 * who cannot sign in or grant anything.
 */
export function setupProviderRowVariant(
  health: PreferenceHealthState,
): SetupProviderRowVariant {
  switch (health) {
    case "checking":
      return "checking";
    // "stale" is a provider that already produced a real reading, so it stays
    // usable; "disabled" is simply off.
    case "disabled":
    case "healthy":
    case "stale":
      return "toggle";
    case "auth_required":
    case "setup_required":
      return "sign_in";
    case "permission_required":
      return "permission";
    case "no_usage_available":
      return "no_usage";
    case "service_outage":
      return "outage";
    default:
      return "timed_out";
  }
}

type SetupProviderRowProps = {
  /**
   * This provider's exact check is queued or running. It replaces the check
   * action rather than the row: pressing it again only enqueues a second probe
   * of the same provider, and the first one to answer clears the pending mark
   * while the rest are still on their way -- reopening Continue on a gate that
   * has not been satisfied, and repeating the sign-in work behind the check.
   */
  checking?: boolean;
  enabled: boolean;
  health: PreferenceHealthState;
  label: string;
  onCheckAgain: () => void;
  onRecover: () => void;
  onToggle: (enabled: boolean) => void;
  /** Set once the customer pressed the sign-in button on this row. */
  signingIn?: boolean;
};

export function SetupProviderRow({
  checking = false,
  enabled,
  health,
  label,
  onCheckAgain,
  onRecover,
  onToggle,
  signingIn = false,
}: SetupProviderRowProps) {
  const reported = setupProviderRowVariant(health);
  const variant = reported === "sign_in" && signingIn ? "waiting" : reported;
  const unusable = variant === "no_usage" || variant === "outage";

  return (
    <Item
      className="rounded-[var(--radius-card)] p-4"
      role="listitem"
      variant="outline"
    >
      <ItemContent>
        <ItemTitle className={cn(unusable && "opacity-50")}>{label}</ItemTitle>
      </ItemContent>
      <ItemActions>
        {variant === "checking" ? (
          <Spinner />
        ) : variant === "sign_in" ? (
          <>
            <SetupProviderRowMessage>Sign in to {label}</SetupProviderRowMessage>
            <SetupProviderRowAction
              icon={ChevronRight}
              label={`Sign in to ${label}`}
              onClick={onRecover}
            />
          </>
        ) : variant === "waiting" ? (
          <>
            <SetupProviderRowMessage>
              Waiting for sign-in…
            </SetupProviderRowMessage>
            <Spinner />
          </>
        ) : variant === "permission" ? (
          <>
            <SetupProviderRowMessage>
              Allow access in macOS
            </SetupProviderRowMessage>
            <SetupProviderRowAction
              icon={ChevronRight}
              label={`Allow access for ${label} in macOS`}
              onClick={onRecover}
            />
          </>
        ) : variant === "timed_out" ? (
          checking ? (
            <>
              <SetupProviderRowMessage>Checking…</SetupProviderRowMessage>
              <Spinner />
            </>
          ) : (
            <>
              <SetupProviderRowMessage>Check timed out</SetupProviderRowMessage>
              <SetupProviderRowAction
                icon={RefreshCw}
                label={`Check ${label} again`}
                onClick={onCheckAgain}
              />
            </>
          )
        ) : variant === "no_usage" ? (
          <SetupProviderRowMessage>
            No usage data on this account
          </SetupProviderRowMessage>
        ) : variant === "outage" ? (
          <SetupProviderRowMessage>
            Service outage — try again later
          </SetupProviderRowMessage>
        ) : null}
        {/*
          Outside the branches on purpose: the health decides what help to
          offer, never whether the customer may switch the provider off.
          Turning one off is always valid and always theirs, and a provider
          they cannot switch off is one they cannot keep off the display.
        */}
        <Switch aria-label={label} checked={enabled} onCheckedChange={onToggle} />
      </ItemActions>
    </Item>
  );
}

function SetupProviderRowMessage({ children }: { children: ReactNode }) {
  return <span className="text-sm text-muted-foreground">{children}</span>;
}

function SetupProviderRowAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-label={label}
      className="rounded-full"
      onClick={onClick}
      size="icon-sm"
      type="button"
      variant="outline"
    >
      <Icon aria-hidden />
    </Button>
  );
}
