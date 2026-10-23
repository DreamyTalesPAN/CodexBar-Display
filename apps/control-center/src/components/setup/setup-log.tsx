"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { SETUP_REVEAL } from "./setup-reveal";

export type SetupLogLine = {
  id: string;
  text: string;
  /** "done" dims a step the wizard has already finished. */
  tone?: "normal" | "done" | "error";
};

type SetupLogProps = {
  className?: string;
  lines: SetupLogLine[];
  /**
   * Work is in flight. The log is not marked aria-busy: that would hold back
   * its announcements, and a step that advances by unmounting would never be
   * heard. It only keeps the log scrolled to its newest line.
   */
  running?: boolean;
};

/**
 * Terminal-style progress log for the setup wizard.
 *
 * It is as tall as its lines (24px each), centred with the rest of the step,
 * and grows to five lines; beyond that the log scrolls inside the box and the
 * top edge fades.
 */
export function SetupLog({ className, lines, running = false }: SetupLogProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [lines, running]);

  return (
    <div
      aria-live="polite"
      role="status"
      className={cn(
        "max-h-[120px] w-full overflow-y-auto text-left font-mono text-[13px] leading-6",
        // The scrollbar is noise next to terminal type. Hiding it costs the
        // only hint that there is more, so the top edge fades instead — the
        // log always sits at its bottom, so anything out of view is above.
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        lines.length > 5 &&
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
            "flex items-center gap-2",
            SETUP_REVEAL,
            line.tone === "error"
              ? "text-destructive"
              : "text-muted-foreground",
            // Everything above the newest line reads as finished.
            (line.tone === "done" ||
              (line.tone !== "error" && index < lines.length - 1)) &&
              "opacity-55",
          )}
          key={line.id}
        >
          <span>&gt; {line.text}</span>
        </div>
      ))}
    </div>
  );
}
