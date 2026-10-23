// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SetupLog, type SetupLogLine } from "./setup-log";
import { connectLogLines } from "./setup-connect-log";
import { SetupWelcomeScreen } from "./setup-welcome-screen";

const STILL = /> Still /;

function logText(container: HTMLElement) {
  return Array.from(container.querySelectorAll("[role=status] [data-slot=process-steps] > div")).map(
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

  it("adds one hint at 8 seconds without repeating it", () => {
    const { container } = render(<SetupLog lines={running} running />);

    advance(8000);
    expect(stillRows(container)).toEqual([
      "> Still refreshing display stream – hang tight.",
    ]);

    advance(8000);
    expect(stillRows(container)).toHaveLength(1);
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

  it("keeps only one hint even after a long wait", () => {
    const { container } = render(<SetupLog lines={running} running />);

    advance(50000);
    expect(stillRows(container)).toHaveLength(1);

    advance(200000);
    expect(stillRows(container)).toHaveLength(1);
  });

  it("gives a new step its own hint and keeps the old step's hint", () => {
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
      "> Display stream refreshed.",
    ]);

    advance(7999);
    expect(stillRows(container)).toHaveLength(1);
    advance(1);
    expect(stillRows(container)).toHaveLength(2);
  });

  it("never hints for a step with percentage progress", () => {
    const { container } = render(
      <SetupLog
        lines={[
          { id: "fw", text: "updating firmware · 40% — keep VibeTV powered on" },
        ]}
        running
      />,
    );

    advance(8000);

    expect(stillRows(container)).toEqual([]);
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
  it("starts a retried step without the failed attempt's hint", () => {
    const { container, rerender } = render(
      <SetupLog lines={running} running />,
    );
    advance(16000);
    expect(stillRows(container)).toHaveLength(1);

    rerender(<SetupLog lines={running} running={false} />);
    rerender(<SetupLog lines={running} running />);
    expect(stillRows(container)).toEqual([]);

    advance(8000);
    expect(stillRows(container)).toHaveLength(1);
  });

  it("never hints for colon-style percentage progress", () => {
    const { container } = render(
      <SetupLog
        lines={[{ id: "fw", text: "Updating VibeTV: 40%." }]}
        running
      />,
    );

    advance(8000);

    expect(stillRows(container)).toEqual([]);
  });
  it("does not take a past-participle word inside the step for a finished step", () => {
    const { container } = render(
      <SetupLog
        lines={[{ id: "check", text: "Checking installed firmware." }]}
        running
      />,
    );
    advance(8000);
    expect(stillRows(container)).toEqual([
      "> Still checking installed firmware – hang tight.",
    ]);
  });

  it("gives a restored log a fresh hint when a new step reuses the id", () => {
    const { container, rerender } = render(
      <SetupLog
        lines={[{ id: "11", text: "Uploading theme files." }]}
        running
      />,
    );
    advance(16000);
    expect(stillRows(container)).toHaveLength(1);

    rerender(
      <SetupLog
        lines={[{ id: "11", text: "Refreshing display stream." }]}
        running
      />,
    );
    expect(stillRows(container)).toEqual([]);

    advance(8000);
    expect(stillRows(container)).toEqual([
      "> Still refreshing display stream – hang tight.",
    ]);
  });

  it("never hints as percentage progress advances", () => {
    const { container, rerender } = render(
      <SetupLog
        lines={[{ id: "fw", text: "updating firmware · 40% — keep VibeTV powered on" }]}
        running
      />,
    );
    advance(16000);

    rerender(
      <SetupLog
        lines={[{ id: "fw", text: "updating firmware · 41% — keep VibeTV powered on" }]}
        running
      />,
    );
    advance(8000);

    expect(stillRows(container)).toHaveLength(0);
  });

  it("has no hint at 100% while waiting for the restart", () => {
    const updating = [{ id: "fw", text: "Updating VibeTV: 100%." }];
    const { container, rerender } = render(<SetupLog lines={updating} running />);
    advance(24000);
    expect(logText(container)).toEqual(["> Updating VibeTV: 100%."]);
    rerender(<SetupLog lines={[...updating, { id: "restart", text: "Restarting VibeTV." }]} running />);
    expect(logText(container)).toEqual(["> Updating VibeTV: 100%.", "> Restarting VibeTV."]);
    advance(8000);
    expect(stillRows(container)).toEqual(["> Still restarting VibeTV – hang tight."]);
  });

  it("removes an earlier hint when the same step starts reporting a percentage", () => {
    const { container, rerender } = render(<SetupLog lines={[{ id: "fw", text: "Updating VibeTV." }]} running />);
    advance(8000);
    expect(stillRows(container)).toHaveLength(1);
    rerender(<SetupLog lines={[{ id: "fw", text: "Updating VibeTV: 1%." }]} running />);
    advance(24000);
    expect(logText(container)).toEqual(["> Updating VibeTV: 1%."]);
  });

  it("collapses identical consecutive input lines and retains the latest error tone", () => {
    const { container } = render(<SetupLog lines={[
      { id: "a", text: "Waiting." },
      { id: "b", text: "Waiting." },
      { id: "c", text: "Waiting.", tone: "error" },
      { id: "d", text: "Retrying." },
      { id: "e", text: "Waiting." },
    ]} />);
    expect(logText(container)).toEqual(["> Waiting.", "> Retrying.", "> Waiting."]);
    expect(container.querySelectorAll(".text-destructive")).toHaveLength(1);
  });

  it("stops touching the log after the hint, so a scrolled-up customer is not pulled down", () => {
    const scrollSet = vi.spyOn(Element.prototype, "scrollTop", "set");
    render(<SetupLog lines={running} running />);
    advance(8000);

    scrollSet.mockClear();
    advance(8000 * 3);

    expect(scrollSet).not.toHaveBeenCalled();
    scrollSet.mockRestore();
  });

  it("gives a completed connection no Still line while the snapshot is awaited", () => {
    const { container } = render(
      <SetupLog
        lines={connectLogLines({ address: "192.168.178.153", phase: "done" })}
        running
      />,
    );
    advance(60000);
    expect(stillRows(container)).toEqual([]);
  });

  it("gives a completed firmware update no Still line while the snapshot is awaited", () => {
    const { container } = render(
      <SetupLog
        lines={connectLogLines({
          address: "192.168.178.153",
          phase: "done",
          firmwareFrom: "1.0.55",
          firmwareTo: "1.0.56",
        })}
        running
      />,
    );
    advance(60000);
    expect(stillRows(container)).toEqual([]);
  });

  it("gives the welcome log a Still line only while the device search runs", () => {
    const lines: SetupLogLine[] = [
      { id: "device", text: "looking for your VibeTV" },
    ];
    const { container, rerender } = render(
      <SetupWelcomeScreen lines={lines} searching />,
    );
    advance(8000);
    expect(stillRows(container)).toEqual([
      "> Still looking for your VibeTV – hang tight.",
    ]);

    rerender(<SetupWelcomeScreen lines={lines} searching={false} />);
    advance(60000);
    expect(stillRows(container)).toHaveLength(1);
  });
});
