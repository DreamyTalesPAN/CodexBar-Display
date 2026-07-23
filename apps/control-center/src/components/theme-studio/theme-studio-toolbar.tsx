"use client";

import {
  Download,
  Info,
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
  sendBlockedReason,
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
  sendBlockedReason?: string;
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
      <div className="flex items-center gap-1">
        <Button
          disabled={!canSend}
          onClick={onSend}
          variant="secondary"
        >
          {sending ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <Send data-icon="inline-start" />}
          {sending ? "Sending" : "Send to VibeTV"}
        </Button>
        {!canSend && sendBlockedReason ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={`Why sending is unavailable: ${sendBlockedReason}`}
                size="icon-sm"
                title={sendBlockedReason}
                type="button"
                variant="ghost"
              >
                <Info aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">
              {sendBlockedReason}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
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
