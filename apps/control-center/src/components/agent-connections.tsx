"use client";

import { useRef, useState } from "react";
import { Item, ItemSeparator } from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import type { AgentSnapshot } from "./agent-sessions";
import type { AgentSettingsRequest } from "./agent-activity-settings";
import { SetupStepFailedDialog } from "./setup/setup-provider-dialogs";

export function AgentConnections({ snapshot, request, onChange }: {
  snapshot: AgentSnapshot | null;
  request: AgentSettingsRequest;
  onChange: (snapshot: AgentSnapshot) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const writing = useRef(false);
  const sources = snapshot?.health === "ready"
    ? snapshot.sources.filter((source) => source.connection === "automatic" || source.capabilityLevel === "hook-adapter")
    : [];
  async function configure(source: string, enabled: boolean) {
    if (writing.current) return;
    writing.current = true;
    setPending(true);
    setError(false);
    try {
      const result = await request<{ agents: AgentSnapshot }>("/v1/agents/integrations", {
        method: "POST", body: JSON.stringify({ source, enabled }),
      });
      onChange(result.agents);
    } catch {
      setError(true);
    } finally {
      writing.current = false;
      setPending(false);
    }
  }
  return (
    <div className="flex max-w-[520px] flex-col gap-3" aria-busy={pending}>
      <SetupStepFailedDialog
        error={error ? { code: "AGENT_CONNECTION_FAILED", message: "The agent connection could not be confirmed", nextAction: "Check the connection shown here. Make sure hooks are allowed in the agent's settings, then try again." } : null}
        onOpenChange={(open) => !open && setError(false)}
      />
      <p className="text-xs leading-relaxed text-muted-foreground">
        Connect agents to show their sessions. This adds local activity hooks to their settings. Start a new session after connecting.
      </p>
      {sources.length ? <div className="overflow-hidden rounded-xl border bg-card">
        {sources.map((source, index) => <div key={source.id}>
          {index > 0 ? <ItemSeparator className="mx-0" /> : null}
          <Item className="flex-nowrap gap-4 rounded-none px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{source.name}</p>
              <p className="text-xs text-muted-foreground">
                {source.connection === "automatic" ? "Detected automatically" : source.connection === "connected" ? "Connected" : source.connection === "blocked" ? "Check this agent's hook settings" : "Not connected"}
              </p>
            </div>
            {source.connection !== "automatic" ? <Switch
              aria-label={`Connect ${source.name}`}
              checked={source.connection === "connected"}
              disabled={pending || !["connected", "disconnected"].includes(source.connection || "")}
              onCheckedChange={(enabled) => void configure(source.id, enabled)}
            /> : null}
          </Item>
        </div>)}
      </div> : <p className="text-sm text-muted-foreground">Agent connections unavailable</p>}
    </div>
  );
}
