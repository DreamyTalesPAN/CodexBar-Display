import { describe, expect, it } from "vitest";

import { bindingDisplayLabel, clampCompanionSize, isAspectLockedPrimitive, primitiveTitle, textPrimitiveNaturalWidth } from "./editor-geometry";
import { themeFirmwareTextMetrics } from "../live-vibetv-preview";

describe("isAspectLockedPrimitive", () => {
  it("locks animated companions to uniform scaling only", () => {
    expect(isAspectLockedPrimitive({ type: "sprite", assetPath: "/themes/u/ai-pet-1.cba", x: 0, y: 0, width: 48, height: 48 })).toBe(true);
    expect(isAspectLockedPrimitive({ type: "sprite", assetPath: "/themes/u/ai-pet-2.cba", x: 0, y: 0 })).toBe(true);
    expect(isAspectLockedPrimitive({ type: "sprite", assetPath: "/themes/u/ai-scene.cba", x: 0, y: 0 })).toBe(false);
    expect(isAspectLockedPrimitive({ type: "rect", x: 0, y: 0, width: 10, height: 20 })).toBe(false);
  });
  it("keeps manual companion sizes inside the helper's 16..80 range", () => {
    expect(clampCompanionSize(100)).toBe(80);
    expect(clampCompanionSize(5)).toBe(16);
    expect(clampCompanionSize(48)).toBe(48);
  });
});

describe("text resize width", () => {
  it("reserves the full formatted reset text including minutes", () => {
    const p = { type: "text" as const, text: "Reset in {usageSlot1Reset}", fontSize: 2, x: 24, y: 24 };
    expect(textPrimitiveNaturalWidth(p)).toBe(themeFirmwareTextMetrics("Reset in 1h 0m", 1, 2)?.width);
  });
  it("uses the renderer's glyph widths so resized labels are not clipped", () => {
    const p = { type: "text" as const, text: "QA 08 Sep", fontSize: 3, x: 64, y: 64 };
    expect(textPrimitiveNaturalWidth(p)).toBe(themeFirmwareTextMetrics(p.text, 1, 3)?.width);
  });
});

describe("bindingDisplayLabel", () => {
  it("shows customer labels for stored usage-window bindings", () => {
    expect(bindingDisplayLabel("usageSlot1Label")).toBe(
      "Usage window 1 label",
    );
    expect(bindingDisplayLabel("usageSlot1Percent")).toBe("Usage window 1 %");
    expect(bindingDisplayLabel("usageSlot1Reset")).toBe(
      "Usage window 1 reset",
    );
    expect(bindingDisplayLabel("usageSlot2Label")).toBe(
      "Usage window 2 label",
    );
    expect(bindingDisplayLabel("usageSlot2Percent")).toBe("Usage window 2 %");
    expect(bindingDisplayLabel("usageSlot2Reset")).toBe(
      "Usage window 2 reset",
    );
  });

  it("shows customer labels for indexed usage-window bindings", () => {
    expect(bindingDisplayLabel("usage.0.label")).toBe("Usage window 1 label");
    expect(bindingDisplayLabel("usage.1.percent")).toBe("Usage window 2 %");
    expect(bindingDisplayLabel("usage.2.reset")).toBe("Usage window 3 reset");
  });

  it("keeps unrelated bindings unchanged", () => {
    expect(bindingDisplayLabel("session")).toBe("session");
    expect(bindingDisplayLabel("customBinding")).toBe("customBinding");
  });
});

describe("primitiveTitle", () => {
  it("uses display labels for bound layer titles", () => {
    expect(
      primitiveTitle({
        binding: "usageSlot1Percent",
        type: "text",
        x: 0,
        y: 0,
      }),
    ).toBe("Usage window 1 %");
    expect(
      primitiveTitle({
        binding: "usageSlot2Percent",
        height: 8,
        type: "progress",
        width: 32,
        x: 0,
        y: 0,
      }),
    ).toBe("Usage window 2 %");
  });
});
