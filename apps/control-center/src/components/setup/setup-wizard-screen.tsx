"use client";

import type { SupportDiagnostics } from "../control-center-types";
import { ChevronLeft } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { SetupHelpMenu } from "./setup-help-menu";

type SetupWizardScreenProps = {
  children: ReactNode;
  /** Display-mode cards use all available content width. */
  contentWidth?: "default" | "wide";
  label: string;
  aiFixPrompt?: () => string;
  onBack?: () => void;
  /** Back was pressed and the running step is still finishing. */
  stopping?: boolean;
  onCreateSupportReport?: () => Promise<SupportDiagnostics | null>;
  /** The app runs on Windows, where "Mac App" reads "app". */
  windowsHost?: boolean;
};

/**
 * The frame every setup step sits in: one centred column, Help bottom right,
 * Back top left. Both corner controls stay above the dialog overlay so the
 * customer is never locked out of help by an error.
 */
export function SetupWizardScreen({
  children,
  contentWidth = "default",
  label,
  aiFixPrompt,
  onBack,
  stopping = false,
  onCreateSupportReport,
  windowsHost,
}: SetupWizardScreenProps) {
  return (
    <main
      aria-label={label}
      className="relative flex min-h-svh w-full flex-col items-center bg-background px-6 py-10 text-[13px] sm:px-14 sm:pt-14 sm:pb-[68px]"
    >
      {/*
        my-auto rather than justify-center: a centred flex child whose content
        outgrows the viewport has its top clipped and unreachable. The window
        has no minimum size, so that is a state the customer can reach by
        dragging a corner.
      */}
      <div
        className={cn(
          "my-auto flex w-full flex-col items-center text-center",
          contentWidth === "wide" ? "max-w-none" : "max-w-[460px]",
        )}
      >
        {children}
      </div>

      {onBack ? (
        <div className="fixed top-5 left-[22px] z-60">
          <Button
            className="h-9 gap-1.5 pr-2.5 pl-1.5 text-[13px] text-muted-foreground has-data-[icon=inline-start]:pl-1.5"
            disabled={stopping}
            onClick={onBack}
            size="sm"
            type="button"
            variant="ghost"
          >
            {stopping ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <ChevronLeft className="size-4" data-icon="inline-start" />
            )}
            <span>{stopping ? "Stopping…" : "Back"}</span>
          </Button>
        </div>
      ) : null}

      <SetupHelpMenu
        aiFixPrompt={aiFixPrompt}
        onCreateSupportReport={onCreateSupportReport}
        windowsHost={windowsHost}
      />
    </main>
  );
}

/** Calm title and subtitle for the steps that picked variant B; the shared title stays as it is. */
export const CALM_TITLE_CLASS =
  "mt-0 text-[28px] leading-[1.15] font-semibold tracking-[-0.01em]";
export const CALM_SUBTITLE_CLASS = "mt-2.5 text-[13px] empty:hidden";
/** Plain underlined text link (the master's links: 13px, regular weight). */
export const CALM_LINK_CLASS =
  "h-auto rounded-none p-0 text-[13px] font-normal text-foreground underline underline-offset-4";
/** The 44px full-width button every calm step ends in. */
export const CALM_BUTTON_CLASS = "h-11 w-full text-[13px]";

export function SetupWizardTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  // Going on removes the button that was pressed, and focus falls back to the
  // window. The new title takes it, so the keyboard and the screen reader
  // carry on from here instead of from the top.
  useEffect(() => {
    if (document.activeElement === document.body) {
      ref.current?.focus({ preventScroll: true });
    }
  }, [children]);
  return (
    <h1
      className={cn(
        "mt-2 text-[32px] leading-tight font-black tracking-[-0.04em] outline-none",
        className,
      )}
      ref={ref}
      tabIndex={-1}
    >
      {children}
    </h1>
  );
}

export function SetupWizardSubtitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("text-sm text-muted-foreground", className)}>{children}</p>
  );
}
