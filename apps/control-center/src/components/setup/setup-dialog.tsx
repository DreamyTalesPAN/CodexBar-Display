"use client";

import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export type SetupDialogAction = {
  busy?: boolean;
  disabled?: boolean;
  label: string;
  onSelect: () => void;
};

type SetupDialogProps = {
  children?: ReactNode;
  description?: string;
  /** Stable identity for notices that yield to other dialogs. */
  noticeKind?: "system-busy" | "theme-library";
  onOpenChange: (open: boolean) => void;
  open: boolean;
  /** The single signal action. Rendered last, on the right. */
  primaryAction?: SetupDialogAction;
  /** At most one secondary way out, rendered left of the primary action. */
  secondaryAction?: SetupDialogAction;
  /**
   * Whether the screen behind is held. A step's own error freezes it; an
   * announcement about the background service must not, or it takes away the
   * app it is reporting on. Without it the grey backdrop still shows, but it
   * takes no clicks.
   */
  scrim?: boolean;
  /**
   * There is no close X. When true and there is no secondary action, a
   * visible "Close" (ghost) is the footer's secondary button. Otherwise the
   * secondary action is the way out.
   */
  showCloseButton?: boolean;
  title: string;
  /** 480 px instead of 440, for the dialogs that carry a list. */
  wide?: boolean;
};

/**
 * Every setup error is a dialog over the frozen screen behind it, never its own
 * screen and never an inline banner.
 *
 * `modal={false}` is deliberate: a modal dialog makes everything outside it
 * inert, which would take away the Help control the design keeps reachable on
 * every screen. Radix only renders its own overlay in modal mode, so the scrim
 * below is ours — it still dims the frozen screen and swallows clicks on it.
 */
export function SetupDialog({
  children,
  description,
  noticeKind,
  onOpenChange,
  open,
  primaryAction,
  scrim = true,
  secondaryAction,
  showCloseButton = true,
  title,
  wide = false,
}: SetupDialogProps) {
  return (
    <Dialog modal={false} onOpenChange={onOpenChange} open={open}>
      {/*
        Radix renders Dialog.Overlay only in modal mode, so this scrim is ours.
        It stays mounted and fades both ways, which a conditionally rendered one
        could not do — it would have no element left to animate on close.
      */}
      <div
        aria-hidden
        className={cn(
          "fixed inset-0 z-40 bg-black/10 transition-opacity duration-100 supports-backdrop-filter:backdrop-blur-xs",
          open ? "opacity-100" : "pointer-events-none opacity-0",
          // Without scrim the grey backdrop is only a look: it never takes clicks,
          // so the page behind stays usable (the outage and busy announcements).
          !scrim && "pointer-events-none",
        )}
      />
      <DialogContent
        data-notice-kind={noticeKind}
        className={wide ? "sm:max-w-[480px]" : undefined}
        style={{ animation: "none" }}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        {primaryAction || secondaryAction || showCloseButton ? (
          // Two long labels, e.g. "Copy provider message for Claude" and
          // "Sign in to Claude", are wider than the popup: the main action
          // moves to its own line instead of sticking out on the right.
          <DialogFooter className="sm:flex-wrap">
            {showCloseButton && !secondaryAction ? (
              <Button onClick={() => onOpenChange(false)} type="button" variant="ghost">
                Close
              </Button>
            ) : null}
            {secondaryAction ? (
              <SetupDialogButton action={secondaryAction} variant="ghost" />
            ) : null}
            {primaryAction ? (
              <SetupDialogButton action={primaryAction} variant="default" />
            ) : null}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SetupDialogButton({
  action,
  variant,
}: {
  action: SetupDialogAction;
  variant: "default" | "ghost";
}) {
  return (
    <Button
      disabled={action.disabled || action.busy}
      onClick={action.onSelect}
      type="button"
      variant={variant}
    >
      {action.busy ? <Spinner data-icon="inline-start" /> : null}
      <span>{action.label}</span>
    </Button>
  );
}
