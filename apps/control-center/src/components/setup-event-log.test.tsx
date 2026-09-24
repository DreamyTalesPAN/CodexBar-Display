// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SetupLog } from "./control-center-types";
import {
  SETUP_EVENTS_POLL_MS,
  SetupEventList,
  SetupEventLog,
  SetupEventsContext,
  type LoadSetupEvents,
} from "./setup-event-log";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const log: SetupLog = {
  sessionId: "s1",
  startedAt: "2026-09-24T10:00:00Z",
  truncated: false,
  dropped: 0,
  events: [
    { seq: 1, at: "2026-09-24T10:00:00Z", stage: "setup_reset", status: "started", message: "New setup session started." },
    { seq: 2, at: "2026-09-24T10:00:01Z", stage: "device_search", status: "retry", message: "Searching again.", count: 3 },
    { seq: 3, at: "2026-09-24T10:00:05Z", stage: "usage_engine", status: "failed", message: "CodexBar 0.17 is too old.", code: "engine_incompatible", nextAction: "Repair the usage engine, then check again." },
    { seq: 4, at: "2026-09-24T10:00:06Z", stage: "theme_install", status: "succeeded", message: "Theme installed." },
  ],
};

function rows() {
  return screen.getAllByRole("listitem").map((row) => row.textContent ?? "");
}

describe("SetupEventList", () => {
  it("lists events oldest first with stage, text status and message", () => {
    render(<SetupEventList log={log} />);
    const items = rows();
    expect(items).toHaveLength(4);
    expect(items[0]).toContain("New setup");
    expect(items[0]).toContain("Started");
    expect(items[1]).toContain("VibeTV search");
    expect(items[1]).toContain("Retrying");
    expect(items[2]).toContain("Usage engine");
    expect(items[2]).toContain("Failed");
    expect(items[2]).toContain("Repair the usage engine, then check again.");
    expect(items[3]).toContain("Done");
    expect(items[0]).toMatch(/\d\d:\d\d:\d\d/);
  });

  it("shows compacted repeats as a count", () => {
    render(<SetupEventList log={log} />);
    expect(rows()[1]).toContain("3 times");
    expect(rows()[1]).not.toContain("×");
    expect(screen.getByLabelText("Repeated 3 times")).toBeTruthy();
  });

  it("never shows the engine's product name", () => {
    render(<SetupEventList log={log} />);
    expect(document.body.textContent).not.toMatch(/codexbar/i);
    expect(rows()[2]).toContain("Usage engine 0.17 is too old.");
  });

  it("says when older entries were removed", () => {
    render(<SetupEventList log={{ ...log, truncated: true, dropped: 12 }} />);
    expect(rows()[0]).toBe("Older entries were removed.");
  });

  it("has an empty state", () => {
    render(<SetupEventList log={null} />);
    expect(document.body.textContent).toBe("No setup activity recorded yet.");
    cleanup();
    render(<SetupEventList log={{ ...log, events: [] }} />);
    expect(document.body.textContent).toBe("No setup activity recorded yet.");
  });
});

describe("SetupEventLog", () => {
  function mount(load: LoadSetupEvents) {
    return render(
      <SetupEventsContext.Provider value={load}>
        <SetupEventLog />
      </SetupEventsContext.Provider>,
    );
  }

  it("shows the empty state when an older Mac App has no setup log", async () => {
    const load = vi.fn().mockRejectedValue({ code: "HTTP_404", message: "Request failed." });
    mount(load);
    await act(async () => {});
    expect(load).toHaveBeenCalled();
    expect(document.body.textContent).toBe("No setup activity recorded yet.");
  });

  it("polls while mounted and stops when unmounted", async () => {
    vi.useFakeTimers();
    const load = vi.fn().mockResolvedValue(log);
    const view = mount(load);
    await act(async () => {});
    expect(rows()).toHaveLength(4);
    await act(async () => { await vi.advanceTimersByTimeAsync(SETUP_EVENTS_POLL_MS); });
    expect(load).toHaveBeenCalledTimes(2);
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(SETUP_EVENTS_POLL_MS * 3); });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps the last log when a later read fails", async () => {
    vi.useFakeTimers();
    const load = vi.fn().mockResolvedValueOnce(log).mockRejectedValue(new Error("offline"));
    mount(load);
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(SETUP_EVENTS_POLL_MS); });
    expect(rows()).toHaveLength(4);
  });
});
