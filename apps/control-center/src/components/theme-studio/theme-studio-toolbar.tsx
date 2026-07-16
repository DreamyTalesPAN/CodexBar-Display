"use client";

import { Download, Redo2, Save, Send, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { ControlCenterButton } from "../control-center-button";

export function ThemeStudioToolbar({
  canExport,
  canRedo,
  canSave,
  canSend,
  canUndo,
  onExport,
  onRedo,
  onSave,
  onSend,
  onUndo,
  saving,
  sending,
  showSave,
}: {
  canExport: boolean;
  canRedo: boolean;
  canSave: boolean;
  canSend: boolean;
  canUndo: boolean;
  onExport: () => void;
  onRedo: () => void;
  onSave: () => void;
  onSend: () => void;
  onUndo: () => void;
  saving: boolean;
  sending: boolean;
  showSave: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[570px] lg:grid-cols-[44px_44px_repeat(3,minmax(0,1fr))]">
      <ToolbarIconButton
        disabled={!canUndo}
        icon={<Undo2 size={18} aria-hidden />}
        label="Undo"
        onClick={onUndo}
      />
      <ToolbarIconButton
        disabled={!canRedo}
        icon={<Redo2 size={18} aria-hidden />}
        label="Redo"
        onClick={onRedo}
      />
      <ControlCenterButton
        disabled={!canExport}
        fullWidth
        icon={<Download size={16} aria-hidden />}
        label="Export ZIP"
        onClick={onExport}
        variant="secondary"
      />
      {showSave ? (
        <ControlCenterButton
          busy={saving}
          busyLabel="Saving"
          disabled={!canSave}
          fullWidth
          icon={<Save size={16} aria-hidden />}
          label="Save theme"
          onClick={onSave}
          variant="primary"
        />
      ) : null}
      <ControlCenterButton
        busy={sending}
        busyLabel="Sending"
        disabled={!canSend}
        fullWidth
        icon={<Send size={16} aria-hidden />}
        label="Send to VibeTV"
        onClick={onSend}
        variant="secondary"
      />
    </div>
  );
}

function ToolbarIconButton({
  disabled,
  icon,
  label,
  onClick,
}: {
  disabled: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="inline-grid min-h-11 min-w-11 place-items-center border border-[#747A60] bg-[#F9F9F9] text-[#1B1B1B] outline-none transition hover:bg-[#EEEEEE] focus-visible:border-[#5E7200] disabled:cursor-not-allowed disabled:bg-[#EEEEEE] disabled:text-[#747A60] disabled:opacity-60"
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {icon}
    </button>
  );
}
