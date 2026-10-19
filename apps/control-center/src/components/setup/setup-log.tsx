"use client";

import { useEffect, useRef, useState } from "react";
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
  /** Renders the blinking caret after the last line while work is in flight. */
  running?: boolean;
  /** Off where the screen already writes its own "still …" lines. */
  stillLines?: boolean;
};

/** A step still running after this long gets a "Still …" line, rewritten each time. */
const STILL_INTERVAL_MS = 8000;

/**
 * Terminal-style progress log for the setup wizard.
 *
 * Its height is reserved whether or not it has anything to say, so a step that
 * starts logging cannot move the controls the customer is already looking at.
 * New lines append at the bottom for the same reason: the box is a fixed size
 * and only the log inside it scrolls.
 *
 * While the last step runs for longer than STILL_INTERVAL_MS, one "Still …"
 * line under it shows how long the wait has lasted, and is replaced every
 * interval. This is the only display timer: a real failure arrives from the
 * companion as its own line or error.
 */
export function SetupLog({
  className,
  lines,
  running = false,
  stillLines = true,
}: SetupLogProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastId = lines[lines.length - 1]?.id;
  // Intervals each step has waited, keyed by the step's line id.
  const [stillTicks, setStillTicks] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!stillLines || !running || lastId === undefined) {
      return;
    }
    const timer = window.setInterval(() => {
      setStillTicks((ticks) => ({ ...ticks, [lastId]: (ticks[lastId] ?? 0) + 1 }));
    }, STILL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [stillLines, running, lastId]);

  // A new key per interval makes the Still line a new node, so it fades in again.
  const rows: SetupLogLine[] = lines.flatMap((line) => {
    const ticks = stillTicks[line.id] ?? 0;
    return ticks
      ? [line, { id: `${line.id}-still-${ticks}`, text: stillText(line.text, ticks * STILL_INTERVAL_MS) }]
      : [line];
  });

  useEffect(() => {
    const node = scrollRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [lines, running, stillTicks]);

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
      {rows.map((line, index) => (
        <div
          className={cn(
            // Keyed by id, so only a line that is genuinely new animates; the
            // ones already on screen keep their node and stay still.
            "flex items-center gap-2",
            SETUP_REVEAL,
            line.tone === "error"
              ? "text-destructive"
              : "text-muted-foreground",
            line.tone === "done" && "opacity-55",
          )}
          key={line.id}
        >
          <span>&gt; {line.text}</span>
          {running && index === rows.length - 1 ? <SetupLogCaret /> : null}
        </div>
      ))}
    </div>
  );
}

/**
 * "Refreshing display stream." becomes "Still refreshing display stream – hang
 * tight. 24 s". Only the last sentence counts ("Upload interrupted. Retrying."
 * reads "retrying"), and a " · " or " — " tail (a percentage, a version) is left
 * out, so the line does not go stale as that number changes. A dot inside a
 * number ("192.168") is kept. A past-tense text ("Uploaded theme layout.") says
 * nothing about what is running, so it gets the generic line.
 */
function stillText(text: string, waitedMs: number): string {
  const sentences = text.replace(/\.$/, "").split(/\. /);
  const step = sentences[sentences.length - 1].split(/ · | — /)[0];
  const doing =
    !step || /\b\w+ed\b/i.test(step)
      ? "working on it"
      // Lower-case a capitalised first word, but not a name such as VibeTV.
      : step.replace(/^[A-Z][a-z]+\b/, (word) => word.toLowerCase());
  return `Still ${doing} – hang tight. ${waitedText(waitedMs)}`;
}

/** "24 s", "1 min 12 s", "2 min": the wait so far, in whole seconds. */
function waitedText(waitedMs: number): string {
  const seconds = Math.round(waitedMs / 1000);
  if (seconds < 60) {
    return `${seconds} s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

function SetupLogCaret() {
  return (
    <span
      aria-hidden
      className="inline-block h-[14px] w-[8px] shrink-0 bg-foreground [animation:vibetv-caret-blink_1.1s_step-end_infinite]"
    />
  );
}
