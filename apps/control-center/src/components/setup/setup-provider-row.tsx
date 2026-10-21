"use client";

import { ArrowUpRight } from "lucide-react";
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
  | "browser_sign_in"
  | "checking"
  | "no_usage"
  | "outage"
  | "permission"
  | "sign_in"
  | "stale"
  | "timed_out"
  | "toggle"
  | "unsupported";

/**
 * The health states the usage service reports, mapped onto the presentations
 * the design draws. Anything it does not name (unavailable, and whatever a
 * provider adds later) gets the re-check presentation: running the check again
 * is the one action left to a customer who cannot sign in or grant anything.
 *
 * Engine recovery is owned by the app-level recovery flow. A row never stops
 * the Companion; unknown, configuration and engine failures remain available
 * for a manual re-check.
 */
export function setupProviderRowVariant(
  health: PreferenceHealthState,
): SetupProviderRowVariant {
  switch (health) {
    case "checking":
      return "checking";
    // "stale" is still usable because it carries a bounded last-good reading,
    // but the row must say that the live collection failed.
    case "stale":
      return "stale";
    // "disabled" is simply off.
    case "disabled":
    case "healthy":
      return "toggle";
    case "auth_required":
    case "setup_required":
      return "sign_in";
    // Signed in to the tool, but the usage endpoint only answers a browser
    // session (Claude on Windows). The row offers to open that page.
    case "browser_sign_in_required":
      return "browser_sign_in";
    case "permission_required":
      return "permission";
    // The account lost access to this provider for good. It must not offer a
    // sign-in: the stored credential is still valid, so signing in again
    // changes nothing and only sends the customer around the same loop.
    case "unsupported":
      return "unsupported";
    case "no_usage_available":
      return "no_usage";
    case "service_outage":
      return "outage";
    // Everything else gets the re-check presentation and no repair prompt.
    // That includes "rate_limited": the sign-in works and the provider only
    // refused this check for being too frequent.
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
  onShowIssue: () => void;
  /**
   * Starts the provider's sign-in through the companion: the browser page
   * for "browser_sign_in_required", the tool's own login (or its install
   * page) for "auth_required" and "setup_required". Absent when the shell
   * has nothing to start.
   */
  onOpenSignIn?: () => void;
  onToggle: (enabled: boolean) => void;
  /**
   * This provider's own on/off write is in flight. The switch already shows
   * the new value optimistically, so this only stops a second write starting
   * beside the first: two racing writes leave both the row and what the
   * companion saved on whichever answer landed last rather than on the
   * customer's last press.
   */
  saving?: boolean;
};

/**
 * The row's looks (Paul, 16.10., states overview 644): the switch stays at the
 * right in every one. A red action where the customer must act; a muted
 * spinner while CodexBar works or retries by itself; nothing else.
 */
export function SetupProviderRow({
  checking = false,
  enabled,
  health,
  label,
  onShowIssue,
  onOpenSignIn,
  onToggle,
  saving = false,
}: SetupProviderRowProps) {
  const variant = enabled ? setupProviderRowVariant(health) : "toggle";
  const signInNeeded = variant === "sign_in" || variant === "browser_sign_in";
  const action = signInNeeded ? "Sign in needed" : variant === "permission" ? "Allow access" : null;
  // A sign-in the app can start; otherwise the provider's dialog says what to do.
  const onAction = (signInNeeded && onOpenSignIn) || onShowIssue;
  const noUsage = variant === "no_usage" || variant === "unsupported";
  // The look 2 (CodexBar is fetching) and look 5 (quiet error, retries by itself).
  const spinner =
    enabled && !action && !noUsage &&
    (checking || variant === "checking" || variant === "stale" || variant === "outage" || variant === "timed_out");

  return (
    <Item
      className="rounded-[var(--radius-card)] p-4"
      role="listitem"
      variant="outline"
    >
      <ItemContent>
        <ItemTitle className={cn("text-[13px] font-semibold", noUsage && "text-muted-foreground")}>{label}</ItemTitle>
      </ItemContent>
      <ItemActions>
        {action ? (
          <button
            aria-label={`${action} for ${label}`}
            className="inline-flex items-center gap-1 text-[13px] font-semibold text-destructive hover:underline"
            onClick={onAction}
            type="button"
          >
            {action}
            <ArrowUpRight aria-hidden className="size-3.5" />
          </button>
        ) : null}
        {noUsage ? (
          <span className="text-[13px] text-muted-foreground">No usage data</span>
        ) : null}
        {spinner ? (
          <>
            <span className="sr-only">Updating {label}</span>
            <Spinner className="text-muted-foreground" />
          </>
        ) : null}
        {/* Always there, also beside a sign-in: a provider switched on by
            mistake must be switchable off without signing in first (#647). */}
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
