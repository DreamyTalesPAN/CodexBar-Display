import { describe, expect, it } from "vitest";

import {
  bindingDisplayLabel,
  defaultPrimitive,
  primitiveBounds,
  primitiveTitle,
  setPrimitiveField,
} from "./editor-geometry";
import type { ThemeStudioPrimitive } from "@/lib/theme-studio";

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

describe("defaultPrimitive", () => {
  // It was "session", which the Binding list calls "Session (legacy)" (#548).
  it("binds a new Bar to the first usage window, like the built-in themes", () => {
    expect(defaultPrimitive("progress", 0).binding).toBe("usageSlot1Percent");
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

describe("primitiveBounds", () => {
  it("boxes text as wide as the preview draws it", () => {
    // Font 1 advances 6px per glyph and size; "Text" at size 2 is 48px wide.
    expect(
      primitiveBounds({ fontSize: 2, text: "Text", type: "text", x: 32, y: 32 })
        .width,
    ).toBe(48);
  });
});

describe("setPrimitiveField", () => {
  const bar = (): ThemeStudioPrimitive => ({
    type: "progress", x: 0, y: 0, width: 100, height: 20, binding: "session",
  });

  it("gives a bar that becomes an arc its ring in the same change", () => {
    const primitive = bar();
    setPrimitiveField(primitive, "progressStyle", "arc");
    expect(primitive).toMatchObject({ arcStart: 225, arcSweep: 270, arcThickness: 10 });
  });

  // An imported bar may carry part of an arc. Without a thickness the arc
  // cannot be saved; a sweep without a start angle starts at 12 o'clock.
  it("adds only what an arc is missing", () => {
    const primitive = { ...bar(), arcSweep: 180 };
    setPrimitiveField(primitive, "progressStyle", "arc");
    expect(primitive).toMatchObject({ arcSweep: 180, arcThickness: 10 });
    expect(primitive.arcStart).toBeUndefined();

    const noSweep = { ...bar(), arcStart: 90, arcThickness: 4 };
    setPrimitiveField(noSweep, "progressStyle", "arc");
    expect(noSweep).toMatchObject({ arcStart: 90, arcSweep: 270, arcThickness: 4 });
  });

  // The ring may be half as thick as the smaller side of the box. Dragging the
  // box smaller left an arc that could not be saved.
  it("makes an arc's ring thinner when its box gets smaller", () => {
    const primitive = bar();
    setPrimitiveField(primitive, "progressStyle", "arc");
    setPrimitiveField(primitive, "height", 12);
    expect(primitive).toMatchObject({ height: 12, arcThickness: 6 });
    setPrimitiveField(primitive, "width", 1);
    expect(primitive).toMatchObject({ width: 2, arcThickness: 1 });
    // A box that grows again leaves the ring as it is.
    setPrimitiveField(primitive, "width", 100);
    setPrimitiveField(primitive, "height", 100);
    expect(primitive.arcThickness).toBe(1);

    // A straight bar has no ring to fit.
    const straight = { ...bar(), arcThickness: 10 };
    setPrimitiveField(straight, "height", 4);
    expect(straight).toMatchObject({ height: 4, arcThickness: 10 });
  });
});
