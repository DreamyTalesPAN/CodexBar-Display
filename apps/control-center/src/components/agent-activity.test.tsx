// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentActivity } from "./agent-activity";
import type { AgentSnapshot } from "./control-center-types";

const snapshot: AgentSnapshot = {
  schemaVersion: 1, health: "ready", phase: "waiting_for_answer",
  sources: [{ id: "codex", name: "Codex", capabilityLevel: "declared", explicitThinking: false }],
  sessions: [
    { id: "12345678aaaaaaaaaaaaaaaaaaaaaaaa", source: "codex", phase: "waiting_for_answer", reason: "explicit-interaction", observedAt: 1 },
    { id: "87654321aaaaaaaaaaaaaaaaaaaaaaaa", source: "codex", phase: "tool_use", reason: "accepted-event", observedAt: 1 },
  ],
};

describe("AgentActivity", () => {
  afterEach(cleanup);
  it("keeps simultaneous sessions and native interaction separate", () => {
    const html = renderToStaticMarkup(<AgentActivity snapshot={snapshot} />);
    expect(html).toContain("12345678");
    expect(html).toContain("87654321");
    expect(html).toContain("Needs your answer");
    expect(html).toContain("Using a tool");
    expect(html).not.toContain("<button");
  });
  it("cannot display saved working sessions when the collector is unavailable", () => {
    const html = renderToStaticMarkup(<AgentActivity snapshot={{ ...snapshot, health: "stale" }} />);
    expect(html).toContain("Status unavailable");
    expect(html).not.toContain("Using a tool");
    expect(html).not.toContain("12345678");
  });
  it("does not invent idle when no session has been observed", () => {
    const html = renderToStaticMarkup(<AgentActivity snapshot={{ ...snapshot, sessions: [] }} />);
    expect(html).toContain("No sessions observed yet");
    expect(html).not.toContain(">Idle<");
  });
});

it("connects through an explicit action and leaves approval actions in the agent", async () => {
 const onConfigure = vi.fn().mockResolvedValue(undefined);
 render(<AgentActivity snapshot={{...snapshot,sources:[{id:"claude-code", name:"Claude Code", capabilityLevel:"hook-adapter", connection:"disconnected", explicitThinking:false}]}} onConfigure={onConfigure} />);
 fireEvent.click(screen.getByRole("button",{name:"Connect Claude Code"}));
 await waitFor(()=>expect(onConfigure).toHaveBeenCalledWith("claude-code",true));
 expect(screen.queryByRole("button",{name:/approve/i})).toBeNull();
 cleanup();
});
it("reports a failed connection without claiming it was installed", async () => {
 render(<AgentActivity snapshot={{...snapshot,sources:[{id:"claude-code", name:"Claude Code", capabilityLevel:"hook-adapter", connection:"disconnected", explicitThinking:false}]}} onConfigure={async()=>{throw Error("fixture");}} />);
 fireEvent.click(screen.getByRole("button",{name:"Connect Claude Code"}));
 await waitFor(()=>expect(screen.getByRole("dialog").textContent).toContain("could not be saved"));
 expect(screen.getByRole("button",{name:"Connect Claude Code"})).toBeTruthy();
 cleanup();
});
