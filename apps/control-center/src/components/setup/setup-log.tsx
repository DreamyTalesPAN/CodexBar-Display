"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ProcessSteps, type ProcessStep } from "../process-steps";

export type SetupLogLine = ProcessStep;

type SetupLogProps = {
  className?: string;
  lines: SetupLogLine[];
  /**
   * Work is in flight. The log is not marked aria-busy: that would hold back
   * its announcements, and a step that advances by unmounting would never be
   * heard. It keeps the log scrolled to its newest line, and a step that runs
   * long gets a "Still …" line.
   */
  running?: boolean;
  /** Off where the screen already writes its own "still …" lines. */
  stillLines?: boolean;
};

/** A step that is still running after this long gets a "Still …" line. */
const STILL_INTERVAL_MS = 8000;

/**
 * Terminal-style progress log for the setup wizard.
 *
 * It is as tall as its lines (24px each), centred with the rest of the step,
 * and grows to five lines; beyond that the log scrolls inside the box and the
 * top edge fades.
 * The lines themselves are ProcessSteps (Theme Studio and Updates use the same).
 *
 * While the last step runs for longer than STILL_INTERVAL_MS, a "Still …" line
 * is added once, unless the step reports percentage progress. This is the only
 * display timer: a real failure arrives from the companion as its own line or error.
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
  const active =
    running && lastLine !== undefined && !isFinished(lastLine) && !hasPercentage(lastLine);
  // Each step gets at most one hint, keyed by stepKey.
  const [stillShown, setStillShown] = useState<Record<string, boolean>>({});
  // A retry reuses the step's id: a step that starts running again gets a fresh hint.
  const [prevRun, setPrevRun] = useState({ key: lastKey, active });
  if (prevRun.key !== lastKey || prevRun.active !== active) {
    setPrevRun({ key: lastKey, active });
    if (active && lastKey !== undefined) {
      setStillShown((shown) => ({ ...shown, [lastKey]: false }));
    }
  }

  useEffect(() => {
    if (!stillLines || !active || lastKey === undefined) {
      return;
    }
    const timer = window.setTimeout(() => {
      setStillShown((shown) => ({ ...shown, [lastKey]: true }));
    }, STILL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [stillLines, active, lastKey]);

  const rows: SetupLogLine[] = lines
    .flatMap((line) => [
      line,
      ...(stillShown[stepKey(line)] && !hasPercentage(line)
        ? [{ id: `${line.id}-still`, text: stillText(line.text) }]
        : []),
    ])
    // Keep the newest copy, including its current tone.
    .filter((line, index, all) => line.text !== all[index + 1]?.text);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [lines, running, stillShown]);

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
        rows.length > 5 &&
          "[mask-image:linear-gradient(to_bottom,transparent,black_14px)]",
        className,
      )}
      ref={scrollRef}
    >
      {/* No steps, no child: an empty log must match `empty:mt-0`, or its margin leaves a gap in the step. */}
      {rows.length ? (
        <ProcessSteps
          steps={rows.map((line, index) => ({
            ...line,
            // Everything above the newest line reads as finished.
            tone:
              line.tone !== "error" && index < rows.length - 1 ? "done" : line.tone,
          }))}
        />
      ) : null}
    </div>
  );
}

/** The step's words: its last sentence, without a ": …", " · " or " — " tail. */
function stepWording(text: string): string {
  const sentences = text.replace(/\.$/, "").split(/\. /);
  return sentences[sentences.length - 1].split(/: | · | — /)[0];
}

/** A percentage is already a sign of progress, including 100% before restart. */
function hasPercentage(line: SetupLogLine): boolean {
  return /\d+(?:[.,]\d+)?\s*%/.test(line.text);
}

/** Completion wording from setup-connect-log.ts: the step is over, not running. */
function isFinished(line: SetupLogLine): boolean {
  return /^(update complete|firmware is up to date)$/.test(stepWording(line.text));
}

/**
 * Identifies one step for its Still hint. The id alone is not
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
