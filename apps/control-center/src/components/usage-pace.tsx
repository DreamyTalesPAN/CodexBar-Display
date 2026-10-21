import { cn } from "@/lib/utils";
import type { UsageWindowInfo } from "./control-center-types";

// CodexBar's pace for one lane, drawn as it sent it. Its "ahead" stages mean
// consumption ahead of plan, which is a deficit; its "behind" stages are a
// reserve. Nothing here is computed.
export type LanePace = {
  tone: "reserve" | "deficit" | "onTrack";
  /** Whole percent CodexBar says is the gap; the sign is the tone. */
  delta: number;
  /** Where the tick sits, on the bar's own scale. */
  expected: number;
};

const toneByStage: Record<string, LanePace["tone"]> = {
  onTrack: "onTrack",
  slightlyAhead: "deficit",
  ahead: "deficit",
  farAhead: "deficit",
  slightlyBehind: "reserve",
  behind: "reserve",
  farBehind: "reserve",
};

// A lane without CodexBar pace, or with pace this build does not know, has none.
export function lanePace(window: UsageWindowInfo): LanePace | null {
  const tone = window.stage ? toneByStage[window.stage] : undefined;
  const { deltaPercent, expectedUsedPercent } = window;
  if (!tone || typeof expectedUsedPercent !== "number" || !Number.isFinite(expectedUsedPercent)) {
    return null;
  }
  // Every tone needs a real delta within the device protocol's bounds.
  if (typeof deltaPercent !== "number" || !Number.isFinite(deltaPercent) || deltaPercent < -100 || deltaPercent > 100) {
    return null;
  }
  return {
    tone,
    delta: Math.abs(Math.round(deltaPercent)),
    expected: Math.max(0, Math.min(100, expectedUsedPercent)),
  };
}

// The tick at CodexBar's expected use, and between it and the bar the gap in
// colour: green for reserve, red hatched for deficit.
export function PaceMarks({ pace, percent }: { pace: LanePace; percent: number }) {
  const from = Math.min(percent, pace.expected);
  const width = Math.abs(percent - pace.expected);
  return (
    <>
      {pace.tone !== "onTrack" && width > 0 ? (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[4px]">
          <div
            className={cn("absolute inset-y-0", pace.tone === "reserve" && "bg-[var(--pace-reserve)]")}
            data-pace-segment={pace.tone}
            style={{
              left: `${from}%`,
              width: `${width}%`,
              ...(pace.tone === "deficit"
                ? {
                    backgroundColor: "var(--muted)",
                    backgroundImage:
                      "repeating-linear-gradient(135deg, var(--pace-deficit) 0 3px, transparent 3px 6px)",
                    boxShadow: "inset 0 0 0 1px var(--pace-deficit)",
                  }
                : null),
            }}
          />
        </div>
      ) : null}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-[1px] bg-foreground"
        data-pace-tick
        style={{ left: `${pace.expected}%` }}
      />
    </>
  );
}

// The one quiet line under the bar: CodexBar's gap in words, then its run-out
// time when it gave one. A run-out time alone keeps today's red line.
export function PaceLine({ pace, runsOut }: { pace: LanePace | null; runsOut: string | null }) {
  if (!pace && !runsOut) {
    return null;
  }
  const words = pace ? paceWords(pace) : null;
  const text = words && runsOut ? `${words} · ${runsOut.charAt(0).toLowerCase()}${runsOut.slice(1)}` : (words ?? runsOut);
  const tone = runsOut ? "deficit" : (pace?.tone ?? "deficit");
  return (
    <p
      className={cn(
        "text-[13px]",
        tone === "deficit" && "font-semibold text-destructive",
        tone === "reserve" && "font-semibold text-success-foreground",
        tone === "onTrack" && "text-muted-foreground",
      )}
    >
      {text}
    </p>
  );
}

function paceWords(pace: LanePace): string {
  if (pace.tone === "onTrack") {
    return "On pace";
  }
  return `${pace.delta}% in ${pace.tone === "reserve" ? "reserve" : "deficit"}`;
}
