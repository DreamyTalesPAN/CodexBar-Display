"use client";

import { useState } from "react";
import { SetupStepFailedDialog } from "./setup/setup-provider-dialogs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AgentSnapshot } from "./control-center-types";

const labels: Record<string, string> = {
  idle: "Idle",
  working: "Working",
  thinking: "Thinking",
  tool_use: "Using a tool",
  compacting: "Compacting context",
  waiting_for_permission: "Needs permission",
  waiting_for_answer: "Needs your answer",
  waiting_for_review: "Needs your review",
  done: "Done",
  error: "Error",
  stale: "Status out of date",
  unavailable: "Status unavailable",
};

/** Presentation only: the engine owns states, completion and freshness. */
export function AgentActivity({ snapshot, onConfigure }: {
  snapshot: AgentSnapshot | null;
  onConfigure?: (source: string, enabled: boolean) => Promise<void>;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function configure(source: string, enabled: boolean) {
    if (!onConfigure || pending) return;
    setPending(source); setError(null);
    try { await onConfigure(source, enabled); }
    catch { setError("The agent connection could not be saved. Check that its settings are valid and hooks are enabled, then try again."); }
    finally { setPending(null); }
  }
  const ready = snapshot?.health === "ready";
  const sessions = ready ? snapshot.sessions : [];
  return (
    <Card className="mx-auto my-6 max-w-[1040px]">
      <CardHeader>
        <CardTitle>Agent activity</CardTitle>
        <CardDescription>
          {ready
            ? "Live sessions on this computer. Respond in the app where you started the task."
            : "Agent activity is unavailable. Usage limits are collected separately."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sessions.length ? (
          <ul className="divide-y divide-border" aria-label="Agent sessions">
            {sessions.map((session) => (
              <li className="flex items-center justify-between gap-4 py-3" key={session.id}>
                <span>
                  {snapshot?.sources.find((source) => source.id === session.source)?.name || session.source}
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{session.id.slice(0, 8)}{session.parentId ? ` · Subagent of ${session.parentId.slice(0, 8)}` : ""}</span>
                </span>
                <Badge variant="secondary">
                  {session.phase === "error" && session.errorKind === "tool" ? "Tool failed" : labels[session.phase] || labels.unavailable}
                </Badge>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted-foreground">{ready ? "No sessions observed yet. Start a connected agent to see its activity." : "Status unavailable"}</p>}
        {ready && onConfigure ? (
          <details className="mt-5 border-t pt-4">
            <summary className="cursor-pointer text-sm font-medium">Connected agents</summary>
            <p className="my-3 text-sm text-muted-foreground">Connect to observe activity. Restart open sessions afterwards. Questions and permissions stay in the original app.</p>
            <ul className="divide-y divide-border" aria-label="Agent connections">
              {snapshot.sources.filter((source) => source.connection !== "unsupported" && source.connection).map((source) => (
                <li key={source.id} className="flex items-center justify-between gap-4 py-2">
                  <span className="text-sm">{source.name}</span>
                  {source.connection === "automatic" ? <span className="text-xs text-muted-foreground">Automatic</span> :
                    source.connection === "blocked" ? <span className="text-xs text-muted-foreground">Check agent settings</span> :
                    <Button variant="outline" size="sm" disabled={pending !== null}
                      aria-label={`${source.connection === "connected" ? "Disconnect" : "Connect"} ${source.name}`}
                      onClick={() => void configure(source.id, source.connection !== "connected")}>
                      {pending === source.id ? "Saving…" : source.connection === "connected" ? "Disconnect" : "Connect"}
                    </Button>}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">Available states vary by app.</p>
          </details>
        ) : null}
        {error ? <SetupStepFailedDialog error={{ code: "AGENT_CONNECTION_FAILED", message: "Connection could not be saved", nextAction: error }} onOpenChange={() => setError(null)} /> : null}
      </CardContent>
    </Card>
  );
}
