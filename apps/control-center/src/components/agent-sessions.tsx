"use client";

import { useEffect, useState } from "react";
import { agentThemeState } from "@/lib/agent-theme-state";
import { cn } from "@/lib/utils";

export type AgentSnapshot = {
  generatedAt: number;
  health: string;
  sessions: {
    id: string;
    source: string;
    phase: string;
    observedAt: number;
  }[];
  sources: { id: string; name: string }[];
};

const phaseLabels: Record<string, string> = {
  working: "Working",
  thinking: "Thinking",
  tool_use: "Running a tool",
  compacting: "Tidying up",
  waiting_for_permission: "Waiting for approval",
  waiting_for_answer: "Waiting for you",
  waiting_for_review: "Waiting for review",
  done: "Finished",
  error: "Hit an error",
  idle: "Idle",
  stale: "Status unavailable",
  unavailable: "Status unavailable",
};

function elapsed(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function needsYou(phase: string) {
  return agentThemeState(phase) === "needs_you";
}

export function AgentSessions({ snapshot }: { snapshot: AgentSnapshot | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Match the observer's 15-second lease even if a status request hangs.
  const available = snapshot?.health === "ready" &&
    snapshot.generatedAt >= now - 15_000 && snapshot.generatedAt <= now + 5_000;
  const sessions = available
    ? [...snapshot.sessions].sort((a, b) => Number(needsYou(b.phase)) - Number(needsYou(a.phase)))
    : [];

  return (
    <section aria-labelledby="agent-sessions-title" className="w-full max-w-[880px] space-y-3">
      <h2 id="agent-sessions-title" className="text-[13px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
        Sessions
      </h2>
      {sessions.length ? (
        <ul className="overflow-hidden rounded-xl ring-1 ring-border">
          {sessions.map((session, index) => {
            const waiting = needsYou(session.phase);
            const name = snapshot!.sources.find((source) => source.id === session.source)?.name || "Agent";
            const activityAge = Number.isFinite(session.observedAt) && session.observedAt > 0 && session.observedAt <= now + 5_000
              ? elapsed(now - session.observedAt)
              : null;
            return (
              <li
                key={session.id}
                className={cn(
                  "grid min-h-[52px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-0.5 px-4 py-2 sm:grid-cols-[150px_minmax(0,1fr)_72px]",
                  index > 0 && "border-t border-border",
                  waiting && "bg-success text-success-foreground",
                )}
              >
                <span className={cn("min-w-0 truncate text-sm font-medium", waiting && "font-semibold", session.phase === "idle" && "text-muted-foreground")} title={name}>
                  {name}
                </span>
                <span className={cn("col-span-2 row-start-2 flex min-w-0 flex-wrap items-center gap-2 text-[13px] text-muted-foreground sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:flex-nowrap", waiting && "text-success-foreground")}>
                  <span className="min-w-0 sm:truncate">{phaseLabels[session.phase] || "Status unavailable"}</span>
                  {waiting ? <span className="inline-flex h-5 shrink-0 items-center rounded-[6px] bg-primary px-[7px] text-[11px] font-semibold text-primary-foreground">Needs you</span> : null}
                </span>
                <span
                  aria-label={activityAge ? `Last activity ${activityAge} ago` : "Last activity unavailable"}
                  className={cn("col-start-2 row-start-1 justify-self-end whitespace-nowrap font-mono text-xs text-muted-foreground sm:col-start-3", waiting && "text-success-foreground")}
                  title={activityAge ? `Last activity ${activityAge} ago` : "Last activity unavailable"}
                >
                  {activityAge || "—"}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-xl px-4 py-3 text-sm text-muted-foreground ring-1 ring-border">
          {available ? "Nothing running" : "Agent status unavailable"}
        </p>
      )}
    </section>
  );
}
