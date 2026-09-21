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
  sources: { id: string; name: string; connection?: string; capabilityLevel?: string }[];
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

export function AgentSessions({ snapshot }: { snapshot: AgentSnapshot | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Match the observer's 15-second lease even if a status request hangs.
  const available = snapshot?.health === "ready" &&
    snapshot.generatedAt >= now - 15_000 && snapshot.generatedAt <= now + 5_000;
  const sessions = available ? snapshot.sessions : [];

  return (
    <section aria-labelledby="agent-sessions-title" className="w-full max-w-[880px] space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="agent-sessions-title" className="text-[13px] font-semibold tracking-widest text-muted-foreground uppercase">
          Sessions
        </h3>
        {available ? <span className="font-mono text-xs text-muted-foreground">updated {elapsed(now - snapshot.generatedAt)} ago</span> : null}
      </div>
      {sessions.length ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(164px,100%),1fr))] gap-3">
          {sessions.map((session) => {
            const waiting = agentThemeState(session.phase) === "needs_you";
            const name = snapshot!.sources.find((source) => source.id === session.source)?.name || "Agent";
            return (
              <li key={session.id} className={cn("min-w-0 space-y-0.5 rounded-xl bg-card p-3 ring-1 ring-border", session.phase === "idle" && "bg-muted opacity-65")}>
                <div className="flex min-w-0 items-center gap-2">
                  {waiting ? <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" /> : null}
                  <span className="truncate text-[13px] font-semibold" title={name}>{name}</span>
                </div>
                <p className={cn("text-xs text-muted-foreground", waiting && "text-foreground")}>{phaseLabels[session.phase] || "Status unavailable"}</p>
                <p className="font-mono text-[11px] text-muted-foreground" title="Time since the agent's last observed activity">
                  Last activity {elapsed(now - session.observedAt)} ago
                </p>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
          {available ? "Nothing running" : "Agent status unavailable"}
        </p>
      )}
    </section>
  );
}
