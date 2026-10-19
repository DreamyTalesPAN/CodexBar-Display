// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SetupLog, type SetupLogLine } from "./setup-log";

const STILL = /> Still /;

function logText(container: HTMLElement) {
  return Array.from(container.querySelectorAll("[role=status] > div")).map(
    (row) => row.textContent,
  );
}

function stillRows(container: HTMLElement) {
  return logText(container).filter((text) => STILL.test(text ?? ""));
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

const running: SetupLogLine[] = [
  { id: "refresh", text: "Refreshing display stream." },
];

describe("SetupLog while a step runs long", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("adds no line before 8 seconds", () => {
    const { container } = render(<SetupLog lines={running} running />);

    advance(7999);

    expect(stillRows(container)).toEqual([]);
  });

  it("adds one line at 8 seconds and one more every 8 seconds", () => {
    const { container } = render(<SetupLog lines={running} running />);

    advance(8000);
    expect(stillRows(container)).toEqual([
      "> Still refreshing display stream – hang tight.",
    ]);

    advance(8000);
    expect(stillRows(container)).toHaveLength(2);
  });

  it("stops adding lines once the step finishes or fails", () => {
    const { container, rerender } = render(
      <SetupLog lines={running} running />,
    );
    advance(8000);
    expect(stillRows(container)).toHaveLength(1);

    rerender(<SetupLog lines={running} running={false} />);
    advance(60000);

    expect(stillRows(container)).toHaveLength(1);
  });

  it("caps the lines of one step at five and keeps the log short", () => {
    const { container } = render(<SetupLog lines={running} running />);

    advance(50000);
    expect(stillRows(container)).toHaveLength(5);

    advance(200000);
    expect(stillRows(container)).toHaveLength(5);
  });

  it("starts the count again for a new step and keeps the old step's lines", () => {
    const { container, rerender } = render(
      <SetupLog lines={running} running />,
    );
    advance(16000);

    rerender(
      <SetupLog
        lines={[...running, { id: "done", text: "Display stream refreshed." }]}
        running
      />,
    );
    expect(logText(container)).toEqual([
      "> Refreshing display stream.",
      "> Still refreshing display stream – hang tight.",
      "> Still refreshing display stream – hang tight.",
      "> Display stream refreshed.",
    ]);

    advance(7999);
    expect(stillRows(container)).toHaveLength(2);
    advance(1);
    expect(stillRows(container)).toHaveLength(3);
  });

  it("drops a changing number from the Still line", () => {
    const { container } = render(
      <SetupLog
        lines={[
          { id: "fw", text: "updating firmware · 40% — keep VibeTV powered on" },
        ]}
        running
      />,
    );

    advance(8000);

    expect(stillRows(container)).toEqual([
      "> Still updating firmware – hang tight.",
    ]);
  });

  it("keeps the last sentence, and a dot inside a number", () => {
    const { container, rerender } = render(
      <SetupLog
        lines={[{ id: "retry", text: "Upload interrupted. Retrying." }]}
        running
      />,
    );
    advance(8000);
    expect(stillRows(container)).toEqual([
      "> Still retrying – hang tight.",
    ]);

    rerender(
      <SetupLog
        lines={[{ id: "ip", text: "connecting to 192.168.178.153" }]}
        running
      />,
    );
    advance(8000);
    expect(stillRows(container)).toContain(
      "> Still connecting to 192.168.178.153 – hang tight.",
    );
  });

  it("gives a past-tense text the generic line", () => {
    const { container, rerender } = render(
      <SetupLog
        lines={[{ id: "layout", text: "Uploaded theme layout." }]}
        running
      />,
    );
    advance(8000);
    expect(stillRows(container)).toEqual([
      "> Still working on it – hang tight.",
    ]);

    rerender(
      <SetupLog
        lines={[{ id: "shown", text: "Display stream refreshed." }]}
        running
      />,
    );
    advance(8000);
    expect(stillRows(container)).toContain(
      "> Still working on it – hang tight.",
    );
  });

  it("keeps a product name capitalised at the start", () => {
    const { container } = render(
      <SetupLog
        lines={[{ id: "wait", text: "VibeTV shows it once AI usage is ready." }]}
        running
      />,
    );
    advance(8000);
    expect(stillRows(container)).toEqual([
      "> Still VibeTV shows it once AI usage is ready – hang tight.",
    ]);
  });

  it("adds nothing when the screen writes its own lines", () => {
    const { container } = render(
      <SetupLog lines={running} running stillLines={false} />,
    );

    advance(60000);

    expect(stillRows(container)).toEqual([]);
  });

  it("moves the caret to the newest line, Still lines included", () => {
    const { container } = render(<SetupLog lines={running} running />);
    advance(8000);

    const rows = container.querySelectorAll("[role=status] > div");
    expect(rows[0].querySelector("[aria-hidden]")).toBeNull();
    expect(rows[1].querySelector("[aria-hidden]")).not.toBeNull();
  });
});
