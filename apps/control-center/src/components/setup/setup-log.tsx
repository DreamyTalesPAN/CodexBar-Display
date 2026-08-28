"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type SetupLogLine = {
  id: string;
  text: string;
  /** "done" dims a step the wizard has already finished. */
  tone?: "normal" | "done" | "error";
};

type SetupLogProps = {
  className?: string;
  lines: SetupLogLine[];
  /** Renders the blinking caret after the last line while work is in flight. */
  running?: boolean;
};

/**
 * Terminal-style progress log for the setup wizard.
 *
 * New lines append at the bottom without pushing the content above them up:
 * the container keeps a fixed height and only the log itself scrolls.
 */
export function SetupLog({ className, lines, running = false }: SetupLogProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [lines, running]);

  if (lines.length === 0) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      className={cn(
        "h-[118px] w-full overflow-y-auto text-left font-mono text-[13px] leading-6",
        className,
      )}
      ref={scrollRef}
    >
      {lines.map((line, index) => (
        <div
          className={cn(
            "flex items-center gap-2",
            line.tone === "error"
              ? "text-destructive"
              : "text-muted-foreground",
            line.tone === "done" && "opacity-55",
          )}
          key={line.id}
        >
          <span>&gt; {line.text}</span>
          {running && index === lines.length - 1 ? <SetupLogCaret /> : null}
        </div>
      ))}
    </div>
  );
}

function SetupLogCaret() {
  return (
    <span
      aria-hidden
      className="inline-block h-[14px] w-[8px] shrink-0 bg-foreground [animation:vibetv-caret-blink_1.1s_step-end_infinite]"
    />
  );
}
