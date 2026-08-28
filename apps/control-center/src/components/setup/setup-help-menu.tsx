"use client";

import { Check, CircleHelp, FileText, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

const COPIED_CONFIRMATION_MS = 4000;

type SetupHelpMenuProps = {
  /** Omitted until the prompt builder exists; the entry is then hidden. */
  onAskAiToFix?: () => boolean | Promise<boolean>;
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
  onAskAiToFix,
  onCreateSupportReport,
}: SetupHelpMenuProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
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
    if (!onAskAiToFix) {
      return;
    }
    const ok = await onAskAiToFix();
    if (!ok) {
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
    <div className="absolute right-5 bottom-5 z-60" ref={containerRef}>
      {open ? (
        <div className="absolute right-0 bottom-11 flex w-58 flex-col gap-0.5 rounded-xl bg-card p-1.5 shadow-lg ring-1 ring-foreground/10">
          {onAskAiToFix && !copied ? (
            <button
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium hover:bg-muted"
              onClick={() => void askAiToFix()}
              type="button"
            >
              <Sparkles className="size-4 shrink-0 text-[var(--vibetv-support)]" />
              <span>Ask AI to fix</span>
            </button>
          ) : null}
          {copied ? (
            <div className="flex items-start gap-2 rounded-lg bg-success p-2.5 text-left text-success-foreground">
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
          <button
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium hover:bg-muted"
            onClick={() => {
              setOpen(false);
              onCreateSupportReport?.();
            }}
            type="button"
          >
            <FileText className="size-4 shrink-0" />
            <span>Create support report</span>
          </button>
        </div>
      ) : null}
      <Button
        aria-expanded={open}
        className="text-muted-foreground"
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
