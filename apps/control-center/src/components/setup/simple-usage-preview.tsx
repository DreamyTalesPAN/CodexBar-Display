"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { SetupDisplayModePreview } from "./setup-display-mode-screen";
import type { UsageDisplayMode } from "./setup-display-previews";

export function SimpleUsagePreview({
  preview,
  usageMode,
}: {
  preview: SetupDisplayModePreview | null | undefined;
  usageMode?: UsageDisplayMode;
}) {
  const index = preview?.providerLabel ?? "";
  const frame = preview && {
    ...preview,
    windows: preview.windows.map((window) => ({
      ...window,
      percent: window.percent === null || !usageMode || usageMode === (preview.frame?.usageMode ?? "used")
        ? window.percent
        : 100 - Math.max(0, Math.min(100, window.percent)),
    })),
  };

  if (!frame) {
    return (
      <span
        className="flex min-h-[140px] w-full items-center justify-center bg-muted/50 p-4 text-center font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
        data-slot="display-mode-preview"
      >
        No usage yet
      </span>
    );
  }

  return (
    <span
      className="flex min-h-[140px] w-full flex-col justify-center gap-3 bg-muted/50 p-4 font-mono"
      data-slot="display-mode-preview"
    >
      <CycledText
        className="truncate text-center text-[11px] font-bold tracking-[0.12em] uppercase"
        cycleKey={index}
      >
        {frame.providerLabel}
      </CycledText>

      <span className="flex gap-3">
        {frame.windows.length ? frame.windows.slice(0, 2).map((window, position) => (
          <PreviewReading
            key={window.label}
            align={position === 0 ? "left" : "right"}
            cycleKey={index}
            label={window.label}
            percent={window.percent}
          />
        )) : <span className="w-full text-center text-[10px]">Usage unavailable</span>}
      </span>

      <CycledText
        className="truncate text-center text-[8px] tracking-[0.12em] text-muted-foreground uppercase"
        cycleKey={index}
      >
        {frame.resetLabel || "Reset unavailable"}
      </CycledText>

    </span>
  );
}

/** One half of the panel: a named reading and how full it is. */
function PreviewReading({
  align = "left",
  cycleKey,
  label,
  percent,
}: {
  align?: "left" | "right";
  cycleKey: string;
  label: string;
  percent: number | null;
}) {
  return (
    <span
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-1.5",
        align === "right" && "items-end",
      )}
    >
      <span className="text-[8px] tracking-[0.12em] text-muted-foreground uppercase">
        {label}
      </span>
      <CycledText
        className={cn(
          "text-[26px] leading-none font-bold",
          percent === null && "text-muted-foreground/60",
        )}
        cycleKey={cycleKey}
      >
        {percent === null ? (
          "--"
        ) : (
          <>
            {percent}
            <span className="text-[12px]">%</span>
          </>
        )}
      </CycledText>
      <PreviewBar percent={percent} />
    </span>
  );
}

/**
 * Text that belongs to one provider. Remounting it on every step is what
 * replays the fade, so the reading crosses over while nothing around it moves.
 */
function CycledText({
  children,
  className,
  cycleKey,
}: {
  children: ReactNode;
  className?: string;
  cycleKey: string;
}) {
  return (
    <span
      className={cn("block", className)}
      key={cycleKey}
      style={{
        animation: "vibetv-preview-frame-in 180ms cubic-bezier(0.2, 0, 0, 1) both",
      }}
    >
      {children}
    </span>
  );
}

/** A usage bar that glides to the next provider's reading instead of jumping. */
function PreviewBar({ percent }: { percent: number | null }) {
  return (
    <span className="block h-[3px] w-full rounded-full bg-foreground/10">
      <span
        className="block h-full rounded-full bg-[var(--vibetv-support)]"
        style={{
          transitionDuration: "320ms",
          transitionProperty: "width",
          transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
          width: `${percent ?? 0}%`,
        }}
      />
    </span>
  );
}

