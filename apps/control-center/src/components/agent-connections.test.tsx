// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AgentConnections } from "./agent-connections";
import type { AgentSnapshot } from "./agent-sessions";
import type { AgentSettingsRequest } from "./agent-activity-settings";
const snapshot: AgentSnapshot = {
  generatedAt: Date.now(), health: "ready", sessions: [], sources: [
    { id: "codex", name: "Codex CLI", connection: "automatic", capabilityLevel: "log-observed" },
    { id: "claude-code", name: "Claude Code", connection: "disconnected", capabilityLevel: "hook-adapter" },
    { id: "gemini-cli", name: "Gemini CLI", connection: "blocked", capabilityLevel: "hook-adapter" },
    { id: "future", name: "Future Agent", connection: "unsupported", capabilityLevel: "declared" },
  ],
};
afterEach(cleanup);
it("offers only engine-supported connections and forwards explicit enable/disable choices", async () => {
  const connected = { ...snapshot, sources: snapshot.sources.map(s => s.id === "claude-code" ? { ...s, connection: "connected" } : s) };
  const onChange = vi.fn();
  const request = vi.fn().mockResolvedValue({ agents: connected });
  const view = render(<AgentConnections snapshot={snapshot} request={request as AgentSettingsRequest} onChange={onChange} />);
  expect(request).not.toHaveBeenCalled();
  expect(screen.getByText("Detected automatically")).toBeTruthy();
  expect(screen.queryByRole("switch", { name: "Connect Codex CLI" })).toBeNull();
  expect(screen.queryByText("Future Agent")).toBeNull();
  expect(screen.getByRole("switch", { name: "Connect Gemini CLI" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("switch", { name: "Connect Claude Code" }));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(connected));
  expect(request).toHaveBeenLastCalledWith("/v1/agents/integrations", { method: "POST", body: '{"source":"claude-code","enabled":true}' });
  view.rerender(<AgentConnections snapshot={connected} request={request as AgentSettingsRequest} onChange={onChange} />);
  fireEvent.click(screen.getByRole("switch", { name: "Connect Claude Code" }));
  await waitFor(() => expect(request).toHaveBeenLastCalledWith("/v1/agents/integrations", { method: "POST", body: '{"source":"claude-code","enabled":false}' }));
});
it("does not claim connection success when saving fails", async () => {
  const onChange = vi.fn();
  const request = vi.fn().mockRejectedValue(new Error("offline"));
  render(<AgentConnections snapshot={snapshot} request={request as AgentSettingsRequest} onChange={onChange} />);
  fireEvent.click(screen.getByRole("switch", { name: "Connect Claude Code" }));
  await screen.findByRole("dialog");
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole("switch", { name: "Connect Claude Code" }).getAttribute("aria-checked")).toBe("false");
});
it("hides stale connection controls", () => {
  render(<AgentConnections snapshot={{ ...snapshot, health: "stale" }} request={vi.fn() as AgentSettingsRequest} onChange={vi.fn()} />);
  expect(screen.queryAllByRole("switch")).toHaveLength(0);
  expect(screen.getByText("Agent connections unavailable")).toBeTruthy();
});
