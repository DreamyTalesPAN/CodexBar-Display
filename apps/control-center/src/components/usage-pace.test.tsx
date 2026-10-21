// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UsageProviderInfo, UsageSnapshot } from "./control-center-types";
import { UsageScreen } from "./usage-screen";

// The pace bar draws only what CodexBar sent for a lane: stage, deltaPercent,
// expectedUsedPercent (and willLastToReset/etaSeconds for the run-out time).
// Nothing is computed here.

const base: UsageProviderInfo = {
  id: "claude",
  label: "Claude",
  session: 40,
  weekly: 40,
  usageMode: "used",
  windows: [],
};

function renderProvider(provider: Partial<UsageProviderInfo>) {
  const usage: UsageSnapshot = {
    ok: true,
    tokenUsageReady: true,
    providers: [{ ...base, ...provider }],
  };
  return render(
    <UsageScreen companionStatus="online" onRefresh={vi.fn()} usage={usage} />,
  );
}

function ticks(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-pace-tick]"));
}

function segment(container: HTMLElement, tone: string) {
  return container.querySelector<HTMLElement>(`[data-pace-segment="${tone}"]`);
}

describe("pace in the lane bar", () => {
  afterEach(cleanup);

  it("puts the tick at CodexBar's expected-used percent", () => {
    const { container } = renderProvider({
      windows: [
        {
          id: "session",
          label: "Session",
          usedPercent: 40,
          stage: "slightlyBehind",
          deltaPercent: -10,
          expectedUsedPercent: 50,
        },
      ],
    });
    expect(ticks(container)).toHaveLength(1);
    expect(ticks(container)[0].style.left).toBe("50%");
  });

  it("draws reserve as a green piece between the bar and the tick", () => {
    const { container, getByText } = renderProvider({
      windows: [
        {
          id: "session",
          label: "Session",
          usedPercent: 40,
          stage: "slightlyBehind",
          deltaPercent: -10,
          expectedUsedPercent: 50,
        },
      ],
    });
    const piece = segment(container, "reserve");
    expect(piece).not.toBeNull();
    expect(piece?.style.left).toBe("40%");
    expect(piece?.style.width).toBe("10%");
    expect(segment(container, "deficit")).toBeNull();
    expect(getByText("10% in reserve").className).toContain("text-success-foreground");
  });

  it("draws deficit as a red hatched piece", () => {
    const { container, getByText } = renderProvider({
      windows: [
        {
          id: "weekly",
          label: "Weekly",
          usedPercent: 62,
          stage: "ahead",
          deltaPercent: 12,
          expectedUsedPercent: 50,
        },
      ],
    });
    const piece = segment(container, "deficit");
    expect(piece).not.toBeNull();
    expect(piece?.style.left).toBe("50%");
    expect(piece?.style.width).toBe("12%");
    expect(piece?.style.backgroundImage).toContain("repeating-linear-gradient");
    expect(segment(container, "reserve")).toBeNull();
    expect(getByText("12% in deficit").className).toContain("text-destructive");
  });

  // The Companion already flips expectedUsedPercent with the mode, so the tick
  // and the bar share one scale: remaining here means 52% left, 64% expected left.
  it("follows the bar in remaining mode", () => {
    const { container, getByText } = renderProvider({
      usageMode: "remaining",
      windows: [
        {
          id: "weekly",
          label: "Weekly",
          usedPercent: 52,
          stage: "ahead",
          deltaPercent: 12,
          expectedUsedPercent: 64,
        },
        {
          id: "session",
          label: "Session",
          usedPercent: 91,
          stage: "behind",
          deltaPercent: -6,
          expectedUsedPercent: 85,
        },
      ],
    });
    const [deficitTick, reserveTick] = ticks(container);
    expect(deficitTick.style.left).toBe("64%");
    expect(reserveTick.style.left).toBe("85%");
    const deficit = segment(container, "deficit");
    expect([deficit?.style.left, deficit?.style.width]).toEqual(["52%", "12%"]);
    const reserve = segment(container, "reserve");
    expect([reserve?.style.left, reserve?.style.width]).toEqual(["85%", "6%"]);
    expect(getByText("12% in deficit")).toBeTruthy();
    expect(getByText("6% in reserve")).toBeTruthy();
  });

  it("says On pace only for onTrack, with the tick and no piece", () => {
    const { container, getByText } = renderProvider({
      windows: [
        {
          id: "session",
          label: "Session",
          usedPercent: 50,
          stage: "onTrack",
          deltaPercent: 0,
          expectedUsedPercent: 50,
        },
      ],
    });
    expect(getByText("On pace")).toBeTruthy();
    expect(ticks(container)).toHaveLength(1);
    expect(segment(container, "reserve")).toBeNull();
    expect(segment(container, "deficit")).toBeNull();
  });

  it("never prints CodexBar's ahead or behind", () => {
    const { container } = renderProvider({
      windows: [
        { id: "session", label: "Session", usedPercent: 70, stage: "farAhead", deltaPercent: 20, expectedUsedPercent: 50 },
        { id: "weekly", label: "Weekly", usedPercent: 10, stage: "farBehind", deltaPercent: -30, expectedUsedPercent: 40 },
      ],
    });
    expect(container.textContent).not.toMatch(/\bahead\b|\bbehind\b/i);
  });

  it("adds CodexBar's run-out time to the deficit line", () => {
    const { getByText } = renderProvider({
      windows: [
        {
          id: "weekly",
          label: "Weekly",
          usedPercent: 70,
          resetSecs: 500000,
          stage: "farAhead",
          deltaPercent: 54,
          expectedUsedPercent: 16,
          willLastToReset: false,
          etaSeconds: 230241,
        },
      ],
    });
    expect(getByText("54% in deficit · runs out in 2d 15h").className).toContain("text-destructive");
  });

  it("draws no pace for a lane CodexBar sent no pace for", () => {
    const { container } = renderProvider({
      windows: [{ id: "weekly", label: "Weekly", usedPercent: 54, willLastToReset: true }],
    });
    expect(ticks(container)).toHaveLength(0);
    expect(container.querySelector("[data-pace-segment]")).toBeNull();
    expect(container.textContent).not.toMatch(/in reserve|in deficit|On pace/);
  });

  it("draws no pace without an expected-used percent or a delta, or with a stage it does not know", () => {
    const { container } = renderProvider({
      windows: [
        { id: "session", label: "Session", usedPercent: 40, stage: "ahead", deltaPercent: 5 },
        { id: "extra", label: "Extra", usedPercent: 40, stage: "ahead", expectedUsedPercent: 35 },
        { id: "weekly", label: "Weekly", usedPercent: 40, stage: "somethingNew", deltaPercent: 5, expectedUsedPercent: 35 },
      ],
    });
    expect(ticks(container)).toHaveLength(0);
    expect(container.textContent).not.toMatch(/in reserve|in deficit|On pace/);
  });

  it("draws no pace on the Fable only lane", () => {
    const { container, queryByText } = renderProvider({
      windows: [
        { id: "session", label: "Session", usedPercent: 40, stage: "slightlyBehind", deltaPercent: -10, expectedUsedPercent: 50 },
        { id: "weekly", label: "Weekly", usedPercent: 30, stage: "slightlyBehind", deltaPercent: -5, expectedUsedPercent: 35 },
        { id: "fable", label: "Fable only", usedPercent: 100 },
      ],
    });
    expect(ticks(container)).toHaveLength(2);
    expect(queryByText("On pace")).toBeNull();
    const fableBar = container.querySelector('[aria-label="100% Fable only used"]');
    expect(fableBar).not.toBeNull();
    expect(fableBar?.parentElement?.querySelector("[data-pace-tick]")).toBeNull();
  });

  it("draws no pace on a stale tile", () => {
    const { container } = renderProvider({
      stale: true,
      windowsRetained: true,
      windows: [
        { id: "session", label: "Session", usedPercent: 40, stage: "slightlyBehind", deltaPercent: -10, expectedUsedPercent: 50 },
      ],
    });
    expect(ticks(container)).toHaveLength(0);
    expect(container.textContent).not.toMatch(/in reserve/);
  });

  it("draws no pace once the lane's reset has passed since the reading", () => {
    const lane = (resetSecs: number) => ({
      id: "session", label: "Session", usedPercent: 40, resetSecs,
      stage: "slightlyBehind", deltaPercent: -10, expectedUsedPercent: 50,
    });
    const collectedAt = new Date(Date.now() - 3_600_000).toISOString();
    const gone = renderProvider({ collectedAt, windows: [lane(60)] });
    expect(ticks(gone.container)).toHaveLength(0);
    cleanup();
    const running = renderProvider({ collectedAt, windows: [lane(7200)] });
    expect(ticks(running.container)).toHaveLength(1);
  });
});
