"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SETUP_REVEAL } from "./setup/setup-reveal";

export type ProcessStep = {
  id: string;
  text: string;
  /** "done" dims a step that has already finished. The last step is the current one. */
  tone?: "normal" | "done" | "error";
};

type ProcessStepsProps = {
  className?: string;
  /** "list" shows every step, "single" only the current (last) one. */
  variant?: "list" | "single";
  steps: ProcessStep[];
  /**
   * Rendered after the current step's text. Only the Setup Wizard's log passes
   * something here (its caret), so nothing else draws a cursor block.
   */
  trailing?: ReactNode;
};

/**
 * The steps of a running process, in the Setup Wizard's status-log look: one
 * "> text" line each, in mono type, fading in when they arrive. Every screen
 * that shows process steps uses this, so they all read the same.
 *
 * Keyed by id, so only a step that is genuinely new animates.
 */
export function ProcessSteps({
  className,
  steps,
  variant = "list",
  trailing = null,
}: ProcessStepsProps) {
  const visible = variant === "single" ? steps.slice(-1) : steps;
  return (
    <div
      className={cn("text-left font-mono text-[13px] leading-6", className)}
      data-slot="process-steps"
      data-variant={variant}
    >
      {visible.map((step) => {
        const current = step === steps[steps.length - 1];
        return (
          <div
            className={cn(
              "flex items-center gap-2",
              SETUP_REVEAL,
              step.tone === "error" ? "text-destructive" : "text-muted-foreground",
              step.tone === "done" && "opacity-55",
            )}
            key={step.id}
          >
            <span>&gt; {step.text}</span>
            {current ? trailing : null}
          </div>
        );
      })}
    </div>
  );
}
