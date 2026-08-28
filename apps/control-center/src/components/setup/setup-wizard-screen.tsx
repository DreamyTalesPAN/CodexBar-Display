"use client";

import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SetupHelpMenu } from "./setup-help-menu";

type SetupWizardScreenProps = {
  children: ReactNode;
  /** Widened for the two-card display-mode step. */
  contentWidth?: "default" | "wide";
  label: string;
  onAskAiToFix?: () => boolean | Promise<boolean>;
  onBack?: () => void;
  onCreateSupportReport?: () => void;
};

/**
 * The frame every setup step sits in: one centred column, Help bottom right,
 * Back bottom left. Both corner controls stay above the dialog overlay so the
 * customer is never locked out of help by an error.
 */
export function SetupWizardScreen({
  children,
  contentWidth = "default",
  label,
  onAskAiToFix,
  onBack,
  onCreateSupportReport,
}: SetupWizardScreenProps) {
  return (
    <section
      aria-label={label}
      className="relative flex min-h-svh w-full flex-col items-center bg-background px-6 py-10 sm:px-14 sm:py-14"
    >
      {/*
        my-auto rather than justify-center: a centred flex child whose content
        outgrows the viewport has its top clipped and unreachable. The window
        has no minimum size, so that is a state the customer can reach by
        dragging a corner.
      */}
      <div
        className={cn(
          "my-auto flex w-full flex-col items-center gap-2 text-center",
          contentWidth === "wide" ? "max-w-[464px]" : "max-w-[460px]",
        )}
      >
        {children}
      </div>

      {onBack ? (
        <div className="fixed bottom-5 left-5 z-60">
          <Button
            className="text-muted-foreground"
            onClick={onBack}
            size="sm"
            type="button"
            variant="ghost"
          >
            <ChevronLeft data-icon="inline-start" />
            <span>Back</span>
          </Button>
        </div>
      ) : null}

      <SetupHelpMenu
        onAskAiToFix={onAskAiToFix}
        onCreateSupportReport={onCreateSupportReport}
      />
    </section>
  );
}

export function SetupWizardTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="mt-2 text-[32px] leading-tight font-black tracking-[-0.04em]">
      {children}
    </h1>
  );
}

export function SetupWizardSubtitle({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
