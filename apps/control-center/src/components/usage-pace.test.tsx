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

  it("shows 96% used with exactly 40% deficit from 56 to 96", () => {
    const { container, getByText } = renderProvider({ windows: [{
      id: "weekly", label: "Weekly", usedPercent: 96, stage: "farAhead",
      deltaPercent: 40, expectedUsedPercent: 56,
    }] });
    expect(segment(container, "deficit")?.style.left).toBe("56%");
    expect(segment(container, "deficit")?.style.width).toBe("40%");
    expect(getByText("40% deficit")).toBeTruthy();
  });

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
    expect(getByText("10% reserve").className).toContain("text-success-foreground");
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
    expect(getByText("12% deficit").className).toContain("text-destructive");
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
    expect(getByText("12% deficit")).toBeTruthy();
    expect(getByText("6% reserve")).toBeTruthy();
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

  it.each([undefined, null, "0", NaN, Infinity, -Infinity])("draws no on-track pace for invalid delta %s", (deltaPercent) => {
    const { container } = renderProvider({
      windows: [{
        id: "session", label: "Session", usedPercent: 50, stage: "onTrack",
        expectedUsedPercent: 50, deltaPercent: deltaPercent as number,
      }],
    });
    expect(ticks(container)).toHaveLength(0);
    expect(container.textContent).not.toContain("On pace");
  });

  it.each([-101, 101, -100.1, 100.1])("draws no pace for out-of-range delta %s", (deltaPercent) => {
    const { container } = renderProvider({
      windows: ["ahead", "behind", "onTrack"].map((stage, index) => ({
        id: String(index), label: stage, usedPercent: 50, stage,
        expectedUsedPercent: 50, deltaPercent,
      })),
    });
    expect(ticks(container)).toHaveLength(0);
    expect(container.textContent).not.toMatch(/reserve|deficit|On pace/);
  });

  it.each([-100, 100])("keeps the inclusive delta boundary %s", (deltaPercent) => {
    const { container } = renderProvider({
      windows: [{
        id: "session", label: "Session", usedPercent: 50,
        stage: deltaPercent < 0 ? "behind" : "ahead", expectedUsedPercent: 50, deltaPercent,
      }],
    });
    expect(ticks(container)).toHaveLength(1);
    expect(container.textContent).toContain(`100% ${deltaPercent < 0 ? "reserve" : "deficit"}`);
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
    expect(getByText("54% deficit · runs out in 2d 15h").className).toContain("text-destructive");
  });

  // The real Codex weekly read of build 7215 (logs/abnahme-7215-usage.jsonl,
  // 03:04:40): CodexBar's stage says onTrack (delta 0) while the same pace still
  // carries a run-out time. "On pace" is the verdict, as on the device.
  it("says only 'On pace', quietly, for CodexBar's onTrack stage even with a run-out time", () => {
    const { container, getByText } = renderProvider({
      usageMode: "remaining",
      windows: [
        {
          id: "weekly",
          label: "Weekly",
          usedPercent: 95,
          resetSecs: 576368,
          willLastToReset: false,
          etaSeconds: 540791,
          stage: "onTrack",
          deltaPercent: 0,
          expectedUsedPercent: 95,
        },
      ],
    });
    const line = getByText("On pace");
    expect(line.className).toContain("text-muted-foreground");
    expect(line.className).not.toContain("text-destructive");
    expect(container.textContent).not.toMatch(/runs out/i);
    expect(ticks(container)).toHaveLength(1);
  });

  it("draws no pace for a lane CodexBar sent no pace for", () => {
    const { container } = renderProvider({
      windows: [{ id: "weekly", label: "Weekly", usedPercent: 54, willLastToReset: true }],
    });
    expect(ticks(container)).toHaveLength(0);
    expect(container.querySelector("[data-pace-segment]")).toBeNull();
    expect(container.textContent).not.toMatch(/reserve|deficit|On pace/);
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
    expect(container.textContent).not.toMatch(/reserve|deficit|On pace/);
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
    expect(container.textContent).not.toMatch(/reserve/);
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
