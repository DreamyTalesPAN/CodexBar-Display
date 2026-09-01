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
  | "repair"
  | "sign_in"
  | "timed_out"
  | "toggle"
  | "waiting";

/**
 * The health states the usage service reports, mapped onto the presentations
 * the design draws. Anything it does not name (unavailable, and whatever a
 * provider adds later) gets the re-check presentation: running the check again
 * is the one action left to a customer who cannot sign in or grant anything.
 *
 * Except when the usage service itself is what is broken. Checking again then
 * meets the same broken service, so the row used to say "Check timed out" and
 * offer the one action that cannot work -- and a customer whose only provider
 * was in that state could not finish setup at all, because Continue asks for a
 * provider that is ready and switching it off leaves none.
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
    case "config_error":
    case "engine_error":
      return "repair";
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
  /**
   * This provider's own on/off write is in flight. The switch already shows
   * the new value optimistically, so this only stops a second write starting
   * beside the first: two racing writes leave both the row and what the
   * companion saved on whichever answer landed last rather than on the
   * customer's last press.
   */
  saving?: boolean;
  /**
   * Set once the customer pressed this row's recovery action. It replaces the
   * action while the attempt runs: pressing it again launched the recovery a
   * second time and queued another check behind it.
   */
  recovering?: boolean;
};

export function SetupProviderRow({
  checking = false,
  enabled,
  health,
  label,
  onCheckAgain,
  onRecover,
  onToggle,
  recovering = false,
  saving = false,
}: SetupProviderRowProps) {
  const reported = setupProviderRowVariant(health);
  const variant =
    recovering &&
    (reported === "sign_in" ||
      reported === "permission" ||
      reported === "repair")
      ? "waiting"
      : reported;
  const unusable = variant === "no_usage" || variant === "outage";
  // Every state whose way on is another check offers the same control, and
  // says so while one is running instead of offering a second: pressing again
  // only queues another probe of the same provider.
  const runningCheck = (
    <>
      <SetupProviderRowMessage>Checking…</SetupProviderRowMessage>
      <Spinner />
    </>
  );
  const checkAgain = (
    <SetupProviderRowAction
      icon={RefreshCw}
      label={`Check ${label} again`}
      onClick={onCheckAgain}
    />
  );

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
              {reported === "permission"
                ? "Waiting for access…"
                : reported === "repair"
                  ? "Repairing…"
                  : "Waiting for sign-in…"}
            </SetupProviderRowMessage>
            <Spinner />
          </>
        ) : variant === "repair" ? (
          <>
            <SetupProviderRowMessage>
              Repair the usage service
            </SetupProviderRowMessage>
            <SetupProviderRowAction
              icon={RefreshCw}
              label={`Repair the usage service for ${label}`}
              onClick={onRecover}
            />
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
            runningCheck
          ) : (
            <>
              <SetupProviderRowMessage>Check timed out</SetupProviderRowMessage>
              {checkAgain}
            </>
          )
        ) : variant === "no_usage" ? (
          // The account can gain usage -- the companion's own next action is
          // to use the provider once and check again -- and this row used to
          // discard that. A customer whose only provider said this had nothing
          // to press: Continue asks for a provider that is ready, and switching
          // it off leaves none.
          checking ? (
            runningCheck
          ) : (
            <>
              <SetupProviderRowMessage>
                No usage data on this account
              </SetupProviderRowMessage>
              {checkAgain}
            </>
          )
        ) : variant === "outage" ? (
          // "Try again later" with nothing to try again with. The same dead end
          // as above once this is the only provider.
          checking ? (
            runningCheck
          ) : (
            <>
              <SetupProviderRowMessage>
                Service outage — try again later
              </SetupProviderRowMessage>
              {checkAgain}
            </>
          )
        ) : null}
        {/*
          Outside the branches on purpose: the health decides what help to
          offer, never whether the customer may switch the provider off.
          Turning one off is always valid and always theirs, and a provider
          they cannot switch off is one they cannot keep off the display.
        */}
        <Switch
          aria-label={label}
          checked={enabled}
          disabled={saving}
          onCheckedChange={onToggle}
        />
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
