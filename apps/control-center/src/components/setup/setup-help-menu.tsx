"use client";

import { Check, CircleAlert, CircleHelp, FileText, ScrollText, Sparkles } from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { copyForHost } from "@/lib/customer-platform";
import { SETUP_REVEAL } from "./setup-reveal";
import type { SupportDiagnostics } from "../control-center-types";
import { SetupEventLog, SetupEventsContext } from "../setup-event-log";
import { isNativeControlCenterApp, onNativeDownloadFinished } from "../control-center-runtime";
import { downloadSupportReport, supportReportFilename } from "../support-report";

const OUTCOME_MS = 5000;

export type Outcome =
  | "prompt-copied"
  | "report-created"
  | "report-saved"
  | "report-saved-as-chosen"
  | "report-partial"
  | "failed";

/** An outcome replaces the entry that produced it, never the other one. */
export function belongsToReport(outcome: Outcome | null): boolean {
  return outcome !== null && outcome !== "prompt-copied";
}

export const HELP_OUTCOME_COPY: Record<Outcome, { detail: string; title: string }> = {
  "prompt-copied": {
    detail:
      "Paste it into any AI. It includes your support log and current screen.",
    title: "Prompt copied!",
  },
  // The Mac app asks where to save, and the customer can cancel (issue #588):
  // until its save dialog has ended, nothing says the report was saved.
  "report-created": {
    detail: "Choose where to save the report.",
    title: "Report created",
  },
  "report-saved": {
    detail: "It is in your Downloads folder. Attach it when you ask for help.",
    title: "Report saved",
  },
  // Saved through the Mac app's dialog: the customer chose the folder.
  "report-saved-as-chosen": {
    detail: "Attach it when you ask for help.",
    title: "Report saved",
  },
  // A report the Mac App could not contribute to is still worth having, but
  // saying so is the difference between a useful report and a misleading one.
  "report-partial": {
    detail:
      "The Mac App did not answer, so some details are missing. What could be collected was saved.",
    title: "Report saved with gaps",
  },
  failed: {
    detail: "Nothing was saved. Try again in a moment.",
    title: "Report could not be created",
  },
};

type SetupHelpMenuProps = {
  /**
   * Builds the prompt lazily, so it captures the moment the customer asked
   * rather than every render. Omitted where there is nothing to describe, and
   * the entry is then hidden.
   */
  aiFixPrompt?: () => string;
  /** Resolves with the collected report, or null when nothing could be read. */
  onCreateSupportReport?: () => Promise<SupportDiagnostics | null>;
  /** The app runs on Windows, where "Mac App" reads "app". */
  windowsHost?: boolean;
};

/**
 * Help entry point, present on every setup screen.
 *
 * Deliberately not a Popover: the menu has to render above the dialog overlay,
 * and a plain absolutely positioned panel inside the wizard's own top layer
 * keeps that guarantee without fighting portal stacking contexts.
 */
export function SetupHelpMenu({
  aiFixPrompt,
  onCreateSupportReport,
  windowsHost = false,
}: SetupHelpMenuProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // The report the Mac app's save dialog is open for, and what to say once
  // it was saved.
  const [awaitingSave, setAwaitingSave] = useState<{
    fileName: string;
    saved: Outcome;
  } | null>(null);
  const [showLog, setShowLog] = useState(false);
  const setupLogAvailable = useContext(SetupEventsContext) !== null;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const outcomeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (outcomeTimerRef.current) {
        clearTimeout(outcomeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function reportOutcome(next: Outcome) {
    setOutcome(next);
    if (outcomeTimerRef.current) {
      clearTimeout(outcomeTimerRef.current);
    }
    outcomeTimerRef.current = setTimeout(() => setOutcome(null), OUTCOME_MS);
  }

  // The Mac app says how its save dialog ended: a saved report is confirmed,
  // and after Cancel nothing is shown. An older Mac app says nothing.
  useEffect(() => {
    if (!awaitingSave) {
      return;
    }
    return onNativeDownloadFinished(awaitingSave.fileName, (saved) => {
      setAwaitingSave(null);
      if (saved) {
        reportOutcome(awaitingSave.saved);
      } else {
        setOutcome((current) => (current === "report-created" ? null : current));
      }
    });
  }, [awaitingSave]);

  async function askAiToFix() {
    if (!aiFixPrompt) {
      return;
    }
    try {
      await navigator.clipboard.writeText(aiFixPrompt());
    } catch {
      // Nothing reached the clipboard, so nothing is confirmed.
      return;
    }
    reportOutcome("prompt-copied");
  }

  async function createSupportReport() {
    if (!onCreateSupportReport || creating) {
      return;
    }
    setOutcome(null);
    setCreating(true);
    try {
      const report = await onCreateSupportReport();
      if (!report) {
        reportOutcome("failed");
        return;
      }
      downloadSupportReport(report);
      const partial = Boolean(report.collectionErrors?.length);
      if (!windowsHost && isNativeControlCenterApp()) {
        setAwaitingSave({
          fileName: supportReportFilename(report.generatedAt),
          saved: partial ? "report-partial" : "report-saved-as-chosen",
        });
        reportOutcome("report-created");
        return;
      }
      reportOutcome(partial ? "report-partial" : "report-saved");
    } catch {
      reportOutcome("failed");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed right-5 bottom-5 z-60" ref={containerRef}>
      {open ? (
        <div
          className={cn(
            "absolute right-0 bottom-11 flex w-58 flex-col gap-0.5 rounded-xl bg-card p-1.5 shadow-lg ring-1 ring-foreground/10",
            showLog && "w-[min(420px,calc(100vw-2.5rem))]",
            SETUP_REVEAL,
          )}
          id="setup-help-menu"
          role="menu"
        >
          {aiFixPrompt && outcome !== "prompt-copied" ? (
            <Button
              className="w-full justify-start font-medium"
              onClick={() => void askAiToFix()}
              role="menuitem"
              size="sm"
              type="button"
              variant="ghost"
            >
              <Sparkles
                aria-hidden
                className="text-[var(--vibetv-support)]"
                data-icon="inline-start"
              />
              <span>Ask AI to fix</span>
            </Button>
          ) : null}
          {outcome ? (
            <HelpOutcome outcome={outcome} windowsHost={windowsHost} />
          ) : null}
          {onCreateSupportReport && !belongsToReport(outcome) ? (
            <Button
              className="w-full justify-start font-medium"
              disabled={creating}
              onClick={() => void createSupportReport()}
              role="menuitem"
              size="sm"
              type="button"
              variant="ghost"
            >
              {creating ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <FileText aria-hidden data-icon="inline-start" />
              )}
              <span>
                {creating ? "Creating report" : "Create support report"}
              </span>
            </Button>
          ) : null}
          {setupLogAvailable ? (
            <Button
              aria-checked={showLog}
              className="w-full justify-start font-medium"
              onClick={() => setShowLog((previous) => !previous)}
              role="menuitemcheckbox"
              size="sm"
              type="button"
              variant="ghost"
            >
              <ScrollText aria-hidden data-icon="inline-start" />
              <span>{showLog ? "Hide setup log" : "Show setup log"}</span>
            </Button>
          ) : null}
          {showLog ? <SetupEventLog className="p-1 text-left" windowsHost={windowsHost} /> : null}
        </div>
      ) : null}
      <Button
        aria-controls="setup-help-menu"
        aria-expanded={open}
        aria-haspopup="menu"
        className="text-muted-foreground"
        onClick={() => {
          setOpen((previous) => !previous);
          setOutcome(null);
        }}
        ref={triggerRef}
        size="sm"
        type="button"
        variant="ghost"
      >
        <CircleHelp data-icon="inline-start" />
        <span>Help</span>
      </Button>
    </div>
  );
}

function HelpOutcome({
  outcome,
  windowsHost,
}: {
  outcome: Outcome;
  windowsHost: boolean;
}) {
  const failed = outcome === "failed";
  const copy = HELP_OUTCOME_COPY[outcome];
  return (
    <div
      aria-live="polite"
      className={cn(
        "flex items-start gap-2 rounded-lg p-2.5 text-left",
        SETUP_REVEAL,
        failed
          ? "bg-destructive/10 text-destructive"
          : "bg-success text-success-foreground",
      )}
      role="status"
    >
      {failed ? (
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      ) : (
        <Check aria-hidden className="mt-0.5 size-4 shrink-0" />
      )}
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{copy.title}</span>
        <span className="text-xs leading-snug">
          {copyForHost(copy.detail, windowsHost)}
        </span>
      </div>
    </div>
  );
}
