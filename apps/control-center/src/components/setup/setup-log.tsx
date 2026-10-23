"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { ProcessSteps, type ProcessStep } from "../process-steps";

export type SetupLogLine = ProcessStep;

type SetupLogProps = {
  className?: string;
  lines: SetupLogLine[];
};

/**
 * Terminal-style progress log for the setup wizard.
 *
 * Its height is reserved whether or not it has anything to say, so a step that
 * starts logging cannot move the controls the customer is already looking at.
 * New lines append at the bottom for the same reason: the box is a fixed size
 * and only the log inside it scrolls. The lines themselves are ProcessSteps.
 */
export function SetupLog({ className, lines }: SetupLogProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [lines]);

  return (
    <div
      aria-live="polite"
      role="status"
      className={cn(
        "h-[118px] w-full overflow-y-auto text-left",
        // The scrollbar is noise next to terminal type. Hiding it costs the
        // only hint that there is more, so the top edge fades instead — the
        // log always sits at its bottom, so anything out of view is above.
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        "[mask-image:linear-gradient(to_bottom,transparent,black_14px)]",
        className,
      )}
      ref={scrollRef}
    >
      <ProcessSteps steps={lines} />
    </div>
  );
}
