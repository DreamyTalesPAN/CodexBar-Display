"use client";

import type { LucideIcon } from "lucide-react";
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
  description: string;
  icon?: LucideIcon;
  /** Destructive tints the header icon; "neutral" is for progress dialogs. */
  tone?: "error" | "neutral";
  onOpenChange: (open: boolean) => void;
  open: boolean;
  /** The single signal action. Rendered last, on the right. */
  primaryAction?: SetupDialogAction;
  /** At most one secondary way out, rendered left of the primary action. */
  secondaryAction?: SetupDialogAction;
  showCloseButton?: boolean;
  title: string;
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
  icon: Icon,
  tone = "error",
  onOpenChange,
  open,
  primaryAction,
  secondaryAction,
  showCloseButton = true,
  title,
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
        )}
      />
      <DialogContent
        onInteractOutside={(event) => event.preventDefault()}
        showCloseButton={showCloseButton}
      >
        <DialogHeader className="gap-1.5">
          <DialogTitle className="flex items-center gap-2">
            {Icon ? (
              <Icon
                className={cn(
                  "size-[18px] shrink-0",
                  tone === "error"
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              />
            ) : null}
            <span>{title}</span>
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        {primaryAction || secondaryAction ? (
          <DialogFooter>
            {secondaryAction ? (
              <SetupDialogButton action={secondaryAction} variant="outline" />
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
  variant: "default" | "outline";
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
