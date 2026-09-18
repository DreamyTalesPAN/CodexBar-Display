"use client";

import { ExternalLink, LogIn, RefreshCw, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
  | "browser_sign_in"
  | "checking"
  | "no_usage"
  | "outage"
  | "permission"
  | "sign_in"
  | "stale"
  | "timed_out"
  | "toggle";

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
  onShowIssue: () => void;
  onCheckAgain: () => void;
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

export function SetupProviderRow({
  checking = false,
  enabled,
  health,
  label,
  onCheckAgain,
  onShowIssue,
  onOpenSignIn,
  onToggle,
  saving = false,
}: SetupProviderRowProps) {
  const variant = enabled ? setupProviderRowVariant(health) : "toggle";
  const unusable = variant === "no_usage" || variant === "outage";
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
        ) : variant === "toggle" ? null : (
          <>
            <SetupProviderRowAction
              icon={TriangleAlert}
              label={`Show provider message for ${label}`}
              onClick={onShowIssue}
            />
            {variant === "browser_sign_in" && onOpenSignIn ? (
              <SetupProviderRowAction
                icon={ExternalLink}
                label={`Open ${label} sign-in in your browser`}
                onClick={onOpenSignIn}
              />
            ) : null}
            {variant === "sign_in" && onOpenSignIn ? (
              <Button
                className="rounded-full"
                onClick={onOpenSignIn}
                size="sm"
                type="button"
                variant="default"
              >
                <LogIn aria-hidden />
                <span>{`Sign in to ${label}`}</span>
              </Button>
            ) : null}
            {variant === "stale" ? null : checking ? (
              <>
                <span className="sr-only">Checking {label}…</span>
                <Spinner />
              </>
            ) : (
              checkAgain
            )}
          </>
        )}
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

/** Keep CodexBar's exact guidance in the shared popup, without provider rules. */
export function setupProviderIssueMessage({
  health, label, detail, reportedMessage,
}: {
  health: PreferenceHealthState;
  label: string;
  detail?: string;
  reportedMessage?: string;
}): string | null {
  const variant = setupProviderRowVariant(health);
  if (variant === "toggle" || variant === "checking") return null;
  const fallbackMessage =
    variant === "sign_in"
      ? `Sign in to ${label}`
      : variant === "browser_sign_in"
        ? `Sign in to ${label} in your browser, close the browser, then check again`
      : variant === "permission"
        ? "Allow access in macOS"
        : variant === "no_usage"
          ? "No usage data on this account"
          : variant === "outage"
            ? "Service outage — try again later"
            : variant === "stale"
              ? "Live usage is unavailable"
            : "Check timed out";
  return reportedMessage || detail || fallbackMessage;
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
