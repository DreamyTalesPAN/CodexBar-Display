"use client";

import { Copy, RefreshCw } from "lucide-react";
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
  /** The generic detail attached to this health result. */
  detail?: string;
  /**
   * What the usage service itself said about this provider, already redacted.
   * It is the only per-provider guidance that exists, so it replaces our own
   * wording wherever it says something the customer can act on.
   */
  reportedMessage?: string;
  onCheckAgain: () => void;
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
  detail,
  enabled,
  health,
  label,
  onCheckAgain,
  onToggle,
  reportedMessage,
  saving = false,
}: SetupProviderRowProps) {
  const variant = setupProviderRowVariant(health);
  const unusable = variant === "no_usage" || variant === "outage";
  const checkAgain = (
    <SetupProviderRowAction
      icon={RefreshCw}
      label={`Check ${label} again`}
      onClick={onCheckAgain}
    />
  );
  const copyReportedMessage = reportedMessage ? (
    <SetupProviderRowAction
      icon={Copy}
      label={`Copy provider message for ${label}`}
      onClick={() => void navigator.clipboard?.writeText(reportedMessage)}
    />
  ) : null;
  const fallbackMessage =
    variant === "sign_in"
      ? `Sign in to ${label}`
      : variant === "permission"
        ? "Allow access in macOS"
        : variant === "no_usage"
          ? "No usage data on this account"
          : variant === "outage"
            ? "Service outage — try again later"
            : variant === "stale"
              ? "Live usage is unavailable"
            : "Check timed out";
  const guidance = reportedMessage || detail || fallbackMessage;

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
            <SetupProviderRowMessage>{guidance}</SetupProviderRowMessage>
            {copyReportedMessage}
            {checking ? (
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
