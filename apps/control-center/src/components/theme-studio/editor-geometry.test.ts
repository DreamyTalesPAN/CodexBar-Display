import { describe, expect, it } from "vitest";

import { bindingDisplayLabel, primitiveTitle } from "./editor-geometry";

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
