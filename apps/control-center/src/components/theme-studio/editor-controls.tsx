"use client";

import type { ReactNode } from "react";
import type { ThemeStudioAsset } from "@/lib/theme-studio";
import {
  assetFileName,
  assetKindLabel,
  formatBytes,
  themeAssetByteLength,
} from "@/lib/theme-studio-assets";
import { ControlCenterButton } from "../control-center-button";

export function DarkButton({
  busy = false,
  className = "",
  disabled = false,
  fullWidth = true,
  icon,
  label,
  onClick,
  variant = "default",
}: {
  busy?: boolean;
  className?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  variant?: "accent" | "default";
}) {
  return (
    <ControlCenterButton
      busy={busy}
      className={className}
      disabled={disabled}
      fullWidth={fullWidth}
      icon={icon}
      label={label}
      onClick={onClick}
      size="default"
      variant={variant === "accent" ? "primary" : "secondary"}
    />
  );
}

export function AddButton({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="grid min-h-14 min-w-0 place-items-center gap-1 border border-[#747A60] bg-[#F9F9F9] p-1.5 text-center text-[10px] font-black text-[#1B1B1B] outline-none hover:bg-[#EEEEEE] focus-visible:border-[#5E7200]"
      onClick={onClick}
      type="button"
    >
      <span className="grid size-7 place-items-center border border-[#747A60] text-[#5E7200]">
        {icon}
      </span>
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}

export function AssetRow({
  asset,
  onRemove,
  onUse,
  path,
  referenced,
}: {
  asset: ThemeStudioAsset;
  onRemove: () => void;
  onUse: () => void;
  path: string;
  referenced: boolean;
}) {
  return (
    <div className="grid gap-2 border border-[#747A60] bg-[#F9F9F9] p-2">
      <div className="min-w-0">
        <div className="truncate text-xs font-black text-[#1B1B1B]">
          {assetFileName(path)}
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap gap-2 text-[11px] text-[#444933]">
          <span>{assetKindLabel(path)}</span>
          <span>{formatBytes(themeAssetByteLength(asset))}</span>
          <span className={referenced ? "text-[#5E7200]" : "text-[#8A6D00]"}>
            {referenced ? "Used" : "Unused"}
          </span>
        </div>
        <code className="mt-1 block truncate text-[11px] text-[#5E7200]">
          {path}
        </code>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          className="min-h-10 border border-[#5E7200] bg-[#F1FFD0] px-2 text-xs font-black text-[#3B5200] outline-none hover:bg-[#E3FFA6] focus-visible:border-[#5E7200]"
          onClick={onUse}
          type="button"
        >
          Use
        </button>
        <button
          className="min-h-10 border border-[#7D2633] bg-[#FFE3E8] px-2 text-xs font-black text-[#7D2633] outline-none hover:bg-[#FFD1DA] focus-visible:border-[#7D2633]"
          onClick={onRemove}
          type="button"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

export function PanelTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-normal text-[#1B1B1B]">
      <span className="text-[#5E7200]">{icon}</span>
      <span>{title}</span>
    </div>
  );
}
