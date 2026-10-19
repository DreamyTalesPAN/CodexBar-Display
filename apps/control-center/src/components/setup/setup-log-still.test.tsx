// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SetupLog, type SetupLogLine } from "./setup-log";

function logText(container: HTMLElement) {
  return Array.from(container.querySelectorAll("[role=status] > div")).map(
    (row) => row.textContent,
  );
}

function stillRows(container: HTMLElement) {
  return logText(container).filter((text) => /> Still /.test(text ?? ""));
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

  it("shows one line at 8 seconds and rewrites it, never adds a second", () => {
    const { container } = render(<SetupLog lines={running} running />);

    advance(8000);
    expect(stillRows(container)).toEqual([
      "> Still refreshing display stream – hang tight. 8 s",
    ]);

    advance(8000);
    expect(stillRows(container)).toEqual([
      "> Still refreshing display stream – hang tight. 16 s",
    ]);
    expect(logText(container)).toHaveLength(2);
  });

  it("keeps the real steps above the one Still line", () => {
    const { container } = render(
      <SetupLog
        lines={[
          { id: "start", text: "Preparing theme install." },
          ...running,
        ]}
        running
      />,
    );

    advance(16000);

    expect(logText(container)).toEqual([
      "> Preparing theme install.",
      "> Refreshing display stream.",
      "> Still refreshing display stream – hang tight. 16 s",
    ]);
  });

  it("shows minutes from one minute on", () => {
    const { container } = render(<SetupLog lines={running} running />);

    advance(72000);
    expect(stillRows(container)).toEqual([
      "> Still refreshing display stream – hang tight. 1 min 12 s",
    ]);

    advance(48000);
    expect(stillRows(container)).toEqual([
      "> Still refreshing display stream – hang tight. 2 min",
    ]);
  });

  it("stops updating once the step finishes or fails", () => {
    const { container, rerender } = render(
      <SetupLog lines={running} running />,
    );
    advance(16000);

    rerender(<SetupLog lines={running} running={false} />);
    advance(60000);

    expect(stillRows(container)).toEqual([
      "> Still refreshing display stream – hang tight. 16 s",
    ]);
  });

  it("starts the wait again for a new step and keeps the old step's line", () => {
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
      "> Still refreshing display stream – hang tight. 16 s",
      "> Display stream refreshed.",
    ]);

    advance(8000);
    expect(logText(container)).toEqual([
      "> Refreshing display stream.",
      "> Still refreshing display stream – hang tight. 16 s",
      "> Display stream refreshed.",
      "> Still working on it – hang tight. 8 s",
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
      "> Still retrying – hang tight. 8 s",
    ]);

    rerender(
      <SetupLog
        lines={[{ id: "ip", text: "connecting to 192.168.178.153" }]}
        running
      />,
    );
    advance(8000);
    expect(stillRows(container)).toEqual([
      "> Still connecting to 192.168.178.153 – hang tight. 8 s",
    ]);
  });

  it("gives a past-tense text the generic line", () => {
    const { container } = render(
      <SetupLog
        lines={[{ id: "layout", text: "Uploaded theme layout." }]}
        running
      />,
    );
    advance(8000);
    expect(stillRows(container)).toEqual([
      "> Still working on it – hang tight. 8 s",
    ]);
  });

  it("keeps a product name capitalised at the start", () => {
    const { container } = render(
      <SetupLog
        lines={[{ id: "wait", text: "VibeTV is waiting for AI usage." }]}
        running
      />,
    );
    advance(8000);
    expect(stillRows(container)).toEqual([
      "> Still VibeTV is waiting for AI usage – hang tight. 8 s",
    ]);
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
      "> Still updating firmware – hang tight. 8 s",
    ]);
  });

  it("adds nothing when the screen writes its own lines", () => {
    const { container } = render(
      <SetupLog lines={running} running stillLines={false} />,
    );

    advance(60000);

    expect(stillRows(container)).toEqual([]);
  });

  it("moves the caret to the newest line, Still line included", () => {
    const { container } = render(<SetupLog lines={running} running />);
    advance(8000);

    const rows = container.querySelectorAll("[role=status] > div");
    expect(rows[0].querySelector("[aria-hidden]")).toBeNull();
    expect(rows[1].querySelector("[aria-hidden]")).not.toBeNull();
  });
});
