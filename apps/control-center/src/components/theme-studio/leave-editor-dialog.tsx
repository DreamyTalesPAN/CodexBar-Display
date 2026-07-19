"use client";

import { useEffect, useRef } from "react";
import { ControlCenterButton } from "../control-center-button";

export function LeaveEditorDialog({
  onDiscard,
  onKeepEditing,
  onSaveAndReturn,
  saving,
}: {
  onDiscard: () => void;
  onKeepEditing: () => void;
  onSaveAndReturn: () => Promise<void>;
  saving: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    keepEditingRef.current?.focus();
    return () => previousFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onKeepEditing();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled)",
        ) || [],
      );
      if (focusable.length === 0) {
        return;
      }
      const current = focusable.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.shiftKey
        ? current <= 0
          ? focusable.length - 1
          : current - 1
        : current === focusable.length - 1
          ? 0
          : current + 1;
      event.preventDefault();
      focusable[next]?.focus();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onKeepEditing]);

  return (
    <div
      aria-labelledby="leave-theme-studio-title"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-[#1B1B1B]/80 p-4"
      role="dialog"
    >
      <div
        className="grid w-full max-w-md gap-5 border border-[#747A60] bg-[#F9F9F9] p-5 shadow-2xl sm:p-6"
        ref={dialogRef}
      >
        <div>
          <h3
            className="text-xl font-black text-[#1B1B1B]"
            id="leave-theme-studio-title"
          >
            Save your changes?
          </h3>
          <p className="mt-2 text-sm leading-6 text-[#444933]">
            Your latest changes are not in the Theme Library yet.
          </p>
        </div>
        <div className="grid gap-3">
          <ControlCenterButton
            busy={saving}
            busyLabel="Saving"
            fullWidth
            label="Save & return"
            onClick={() => void onSaveAndReturn()}
            variant="primary"
          />
          <button
            className="vibetv-button vibetv-button--default vibetv-button--full vibetv-button--secondary"
            onClick={onKeepEditing}
            ref={keepEditingRef}
            type="button"
          >
            Keep editing
          </button>
          <button
            className="min-h-12 w-full border border-[#7D2633] bg-[#FFE3E8] px-3 text-base font-black text-[#7D2633] outline-none hover:bg-[#FFD1DA] focus-visible:border-[#7D2633]"
            disabled={saving}
            onClick={onDiscard}
            type="button"
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
