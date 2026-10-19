"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { ProcessSteps, type ProcessStep } from "../process-steps";

export type SetupLogLine = ProcessStep;

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
 * top edge fades. The lines themselves are ProcessSteps; the ones above the newest read as finished.
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
        "max-h-[120px] w-full overflow-y-auto text-left",
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
      <ProcessSteps
        steps={lines.map((line, index) =>
          line.tone !== "error" && index < lines.length - 1
            ? { ...line, tone: "done" as const }
            : line,
        )}
      />
    </div>
  );
}
