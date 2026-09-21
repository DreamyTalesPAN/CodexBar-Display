// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSessions, type AgentSnapshot } from "./agent-sessions";

const now = 1_790_000_000_000;
function snapshot(): AgentSnapshot {
  return {
    health: "ready", generatedAt: now,
    sources: [{ id: "codex", name: "Codex CLI" }, { id: "claude", name: "Claude Code" }],
    sessions: [
      { id: "one", source: "codex", phase: "waiting_for_permission", observedAt: now - 252_000 },
      { id: "two", source: "codex", phase: "tool_use", observedAt: now - 46_000 },
      { id: "three", source: "claude", phase: "idle", observedAt: now - 720_000 },
    ],
  };
}
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("AgentSessions", () => {
  it("shows separate sessions, source names and observed activity rather than invented durations", () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    render(<AgentSessions snapshot={snapshot()} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getAllByText("Codex CLI")).toHaveLength(2);
    expect(screen.getByText("Waiting for approval")).toBeTruthy();
    expect(screen.getByText("Running a tool")).toBeTruthy();
    expect(screen.getByText("Last activity 4m 12s ago")).toBeTruthy();
    expect(screen.getByText("Idle")).toBeTruthy();
  });
  it("expires visible activity when no fresh status reaches the browser, and recovers", () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const view = render(<AgentSessions snapshot={snapshot()} />);
    act(() => vi.advanceTimersByTime(16_000));
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText("Agent status unavailable")).toBeTruthy();
    view.rerender(<AgentSessions snapshot={{ ...snapshot(), generatedAt: now + 16_000 }} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
  it("distinguishes no observed sessions from a missing or unhealthy observer", () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const view = render(<AgentSessions snapshot={{ ...snapshot(), sessions: [] }} />);
    expect(screen.getByText("Nothing running")).toBeTruthy();
    view.rerender(<AgentSessions snapshot={{ ...snapshot(), health: "stale" }} />);
    expect(screen.getByText("Agent status unavailable")).toBeTruthy();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    view.rerender(<AgentSessions snapshot={null} />);
    expect(screen.getByText("Agent status unavailable")).toBeTruthy();
  });
  it("does not expose internal source ids or guess an unknown phase", () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    render(<AgentSessions snapshot={{ ...snapshot(), sources: [], sessions: [{ id: "one", source: "unknown-source", phase: "future-state", observedAt: now }] }} />);
    expect(screen.getByText("Agent")).toBeTruthy();
    expect(screen.getByText("Status unavailable")).toBeTruthy();
    expect(screen.queryByText("unknown-source")).toBeNull();
  });
});
