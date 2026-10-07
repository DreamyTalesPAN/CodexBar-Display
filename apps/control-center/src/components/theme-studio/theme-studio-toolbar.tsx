"use client";

import {
  Download,
  LoaderCircle,
  Redo2,
  Save,
  Send,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function ThemeStudioToolbar({
  canExport,
  canRedo,
  canSave,
  canUndo,
  onExport,
  onRedo,
  onSave,
  onSend,
  onUndo,
  saveLabel,
  saving,
  sendBlockedReason,
  sending,
  showSave,
}: {
  canExport: boolean;
  canRedo: boolean;
  canSave: boolean;
  canUndo: boolean;
  onExport: () => void;
  onRedo: () => void;
  onSave: () => void;
  onSend: () => void;
  onUndo: () => void;
  /** "Save theme", or "Save screensaver" in Screensaver Studio. */
  saveLabel: string;
  saving: boolean;
  /** Why Send to VibeTV is unavailable right now; empty when it is available. */
  sendBlockedReason: string;
  sending: boolean;
  showSave: boolean;
}) {
  return (
    <div className="grid gap-2">
      {sendBlockedReason ? (
        // w-0 min-w-full: a long reason wraps at the width of the buttons
        // instead of widening the header column they sit in.
        <p className="w-0 min-w-full text-right text-sm text-muted-foreground">
          {sendBlockedReason}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <ToolbarIconButton
          disabled={!canUndo}
          icon={Undo2}
          label="Undo"
          onClick={onUndo}
        />
        <ToolbarIconButton
          disabled={!canRedo}
          icon={Redo2}
          label="Redo"
          onClick={onRedo}
        />
        <Button
          disabled={!canExport}
          onClick={onExport}
          variant="secondary"
        >
          <Download data-icon="inline-start" /> Export ZIP
        </Button>
        <Button
          disabled={Boolean(sendBlockedReason)}
          onClick={onSend}
          variant="secondary"
        >
          {sending ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <Send data-icon="inline-start" />}
          {sending ? "Sending" : "Send to VibeTV"}
        </Button>
        {showSave ? (
          <Button disabled={!canSave} onClick={onSave}>
            {saving ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : (
              <Save data-icon="inline-start" />
            )}
            {saving ? "Saving" : saveLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ToolbarIconButton({
  disabled,
  icon: Icon,
  label,
  onClick,
}: {
  disabled: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} disabled={disabled} onClick={onClick} size="icon" type="button" variant="ghost">
          <Icon aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
