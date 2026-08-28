"use client";

import { Check, CircleHelp, FileText, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

const COPIED_CONFIRMATION_MS = 4000;

type SetupHelpMenuProps = {
  /**
   * Builds the prompt lazily, so it captures the moment the customer asked
   * rather than every render. Omitted where there is nothing to describe, and
   * the entry is then hidden.
   */
  aiFixPrompt?: () => string;
  onCreateSupportReport?: () => void;
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
}: SetupHelpMenuProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
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
    setCopied(true);
    if (copiedTimerRef.current) {
      clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = setTimeout(
      () => setCopied(false),
      COPIED_CONFIRMATION_MS,
    );
  }

  return (
    <div className="fixed right-5 bottom-5 z-60" ref={containerRef}>
      {open ? (
        <div
          className="absolute right-0 bottom-11 flex w-58 flex-col gap-0.5 rounded-xl bg-card p-1.5 shadow-lg ring-1 ring-foreground/10"
          id="setup-help-menu"
          role="menu"
        >
          {aiFixPrompt && !copied ? (
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
          {copied ? (
            <div
              aria-live="polite"
              className="flex items-start gap-2 rounded-lg bg-success p-2.5 text-left text-success-foreground"
              role="status"
            >
              <Check className="mt-0.5 size-4 shrink-0" />
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">Prompt copied!</span>
                <span className="text-xs leading-snug">
                  Paste it into any AI. It includes your support log and current
                  screen.
                </span>
              </div>
            </div>
          ) : null}
          <Button
            className="w-full justify-start font-medium"
            onClick={() => {
              setOpen(false);
              onCreateSupportReport?.();
            }}
            role="menuitem"
            size="sm"
            type="button"
            variant="ghost"
          >
            <FileText aria-hidden data-icon="inline-start" />
            <span>Create support report</span>
          </Button>
        </div>
      ) : null}
      <Button
        aria-controls="setup-help-menu"
        aria-expanded={open}
        aria-haspopup="menu"
        className="text-muted-foreground"
        ref={triggerRef}
        onClick={() => {
          setOpen((previous) => !previous);
          setCopied(false);
        }}
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
