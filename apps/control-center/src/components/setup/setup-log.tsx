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
  /** While work is in flight, a step that runs long gets a "Still …" line. */
  running?: boolean;
  /** Off where the screen already writes its own "still …" lines. */
  stillLines?: boolean;
};

/** A step that is still running after this long gets a "Still …" line. */
const STILL_INTERVAL_MS = 8000;
/** Most "Still …" lines one step gets; after that the log stops growing. */
const STILL_MAX_LINES = 5;

/**
 * Terminal-style progress log for the setup wizard.
 *
 * Its height is reserved whether or not it has anything to say, so a step that
 * starts logging cannot move the controls the customer is already looking at.
 * New lines append at the bottom for the same reason: the box is a fixed size
 * and only the log inside it scrolls.
 *
 * While the last step runs for longer than STILL_INTERVAL_MS, a "Still …" line
 * is added under it every interval. This is the only display timer: a real
 * failure arrives from the companion as its own line or error.
 */
export function SetupLog({
  className,
  lines,
  running = false,
  stillLines = true,
}: SetupLogProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastLine = lines.length ? lines[lines.length - 1] : undefined;
  const lastKey = lastLine ? stepKey(lastLine) : undefined;
  // A step that already says it is finished is not running, whatever the screen says.
  const active = running && lastLine !== undefined && !isFinished(lastLine);
  // How many "Still …" lines each step has got, keyed by stepKey.
  const [stillCounts, setStillCounts] = useState<Record<string, number>>({});
  // A retry reuses the step's id: a step that starts running again counts from zero.
  const [prevRun, setPrevRun] = useState({ key: lastKey, active });
  if (prevRun.key !== lastKey || prevRun.active !== active) {
    setPrevRun({ key: lastKey, active });
    if (active && lastKey !== undefined) {
      setStillCounts((counts) => ({ ...counts, [lastKey]: 0 }));
    }
  }

  useEffect(() => {
    if (!stillLines || !active || lastKey === undefined) {
      return;
    }
    const timer = window.setInterval(() => {
      // At the cap the same object comes back, so nothing re-renders or scrolls.
      setStillCounts((counts) =>
        (counts[lastKey] ?? 0) >= STILL_MAX_LINES
          ? counts
          : { ...counts, [lastKey]: (counts[lastKey] ?? 0) + 1 },
      );
    }, STILL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [stillLines, active, lastKey]);

  const rows: SetupLogLine[] = lines.flatMap((line) => [
    line,
    ...Array.from({ length: stillCounts[stepKey(line)] ?? 0 }, (_, index) => ({
      id: `${line.id}-still-${index + 1}`,
      text: stillText(line.text),
    })),
  ]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [lines, running, stillCounts]);

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
      {rows.map((line) => (
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
        </div>
      ))}
    </div>
  );
}

/** The step's words: its last sentence, without a ": …", " · " or " — " tail. */
function stepWording(text: string): string {
  const sentences = text.replace(/\.$/, "").split(/\. /);
  return sentences[sentences.length - 1].split(/: | · | — /)[0];
}

/** Completion wording from setup-connect-log.ts: the step is over, not running. */
function isFinished(line: SetupLogLine): boolean {
  return /^(update complete|firmware is up to date)$/.test(stepWording(line.text));
}

/**
 * Identifies one step for counting its Still lines. The id alone is not
 * enough: a restored log numbers its lines by position, so a new step can
 * take an old id. The wording stays put while a percentage changes.
 */
function stepKey(line: SetupLogLine): string {
  return `${line.id}\u0000${stepWording(line.text)}`;
}

/**
 * "Refreshing display stream." becomes "Still refreshing display stream – hang
 * tight." Only the last sentence counts ("Upload interrupted. Retrying." reads
 * "retrying"), a tail after ": ", " · " or " — " (a percentage, a version) is left out,
 * so the line does not go stale as that number changes. A dot inside a number
 * ("192.168") is kept. A past-tense text ("Uploaded theme layout.") says
 * nothing about what is running, so it gets the generic line.
 */
function stillText(text: string): string {
  const step = stepWording(text);
  // Past tense at the start or the end ("Uploaded theme layout.",
  // "Display stream refreshed.") is not what runs now; "installed" inside
  // "Checking installed firmware." is.
  if (!step || /^\w+ed\b|\b\w+ed$/i.test(step)) {
    return "Still working on it – hang tight.";
  }
  // Lower-case a capitalised first word, but not a name such as VibeTV.
  const doing = step.replace(/^[A-Z][a-z]+\b/, (word) => word.toLowerCase());
  return `Still ${doing} – hang tight.`;
}
