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
      role="status"
      className={cn(
        "h-[118px] w-full overflow-y-auto text-left font-mono text-[13px] leading-6",
        // The scrollbar is noise next to terminal type. Hiding it costs the
        // only hint that there is more, so the top edge fades instead — the
        // log always sits at its bottom, so anything out of view is above.
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        "[mask-image:linear-gradient(to_bottom,transparent,black_14px)]",
        className,
      )}
      ref={scrollRef}
    >
      {lines.map((line, index) => (
        <div
          className={cn(
            // Keyed by id, so only a line that is genuinely new animates; the
            // ones already on screen keep their node and stay still.
            "flex animate-in items-center gap-2 fade-in duration-500",
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
