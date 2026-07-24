import { describe, expect, it } from "vitest";

import {
  buildFrameData,
  primitiveUsageSlotVisible,
  themeSpecAriaLabel,
  type ThemePrimitive,
} from "./live-vibetv-preview";

const lane1: ThemePrimitive = { t: "r", x: 0, y: 0, w: 10, h: 10, sl: 1 };
const lane2: ThemePrimitive = { t: "r", x: 0, y: 0, w: 10, h: 10, sl: 2 };

describe("dynamic usage slot preview", () => {
  it.each([
    { count: 0, slots: [] },
    {
      count: 1,
      slots: [{ id: "weekly", label: "Weekly", percent: 42, resetSecs: 100 }],
    },
    {
      count: 2,
      slots: [
        { id: "weekly", label: "Weekly", percent: 42, resetSecs: 100 },
        { id: "spark", label: "Codex Spark Weekly", percent: 7, resetSecs: 200 },
      ],
    },
  ])("matches complete lane visibility for $count slots", ({ count, slots }) => {
    const frame = buildFrameData("2026-07-24T12:00:00Z", {
      v: 2,
      provider: "codex",
      label: "Codex",
      session: 42,
      weekly: 7,
      usageMode: "used",
      usageSlots: slots,
    });

    expect(primitiveUsageSlotVisible(lane1, frame)).toBe(count >= 1);
    expect(primitiveUsageSlotVisible(lane2, frame)).toBe(count >= 2);
    const ariaLabel = themeSpecAriaLabel("mini-classic", frame);
    expect(ariaLabel).toContain(
      count > 0
        ? `${slots[0]?.label} ${slots[0]?.percent}% used`
        : "no usage windows available",
    );
    if (count < 2) {
      expect(ariaLabel).not.toContain("Codex Spark Weekly");
    }
  });
});
