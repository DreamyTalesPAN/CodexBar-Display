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
        disabled={!canSend}
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
          {saving ? "Saving" : "Save theme"}
        </Button>
      ) : null}
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
