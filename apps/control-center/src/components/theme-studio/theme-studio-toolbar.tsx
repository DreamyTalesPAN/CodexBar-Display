"use client";

import {
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
  canRedo,
  canSave,
  canSend,
  canUndo,
  onRedo,
  onSave,
  onSend,
  onUndo,
  saving,
  sending,
  showSave,
}: {
  canRedo: boolean;
  canSave: boolean;
  canSend: boolean;
  canUndo: boolean;
  onRedo: () => void;
  onSave: () => void;
  onSend: () => void;
  onUndo: () => void;
  saving: boolean;
  sending: boolean;
  showSave: boolean;
}) {
  return (
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
      {showSave ? (
        <Button disabled={!canSave} onClick={onSave}>
          {saving ? (
            <LoaderCircle className="animate-spin" data-icon="inline-start" />
          ) : (
            <Save data-icon="inline-start" />
          )}
          {saving ? "Saving" : "Save theme"}
        </Button>
      ) : null}
      <Button
        disabled={!canSend}
        onClick={onSend}
        variant="secondary"
      >
        {sending ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <Send data-icon="inline-start" />}
        {sending ? "Sending" : "Send to VibeTV"}
      </Button>
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
