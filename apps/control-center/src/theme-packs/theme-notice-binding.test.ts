import { describe, expect, it } from "vitest";
import { usesLabelBinding } from "../../../../scripts/theme-notice-binding.mjs";
import { boundValue, buildFrameData } from "@/components/live-vibetv-preview";

describe("theme build notice bindings", () => {
  const footers = [
    "usageSlot1PaceFooter", "usageSlot2PaceFooter",
    "us1PaceFooter", "us2PaceFooter",
    "usage.0.PaceFooter", "usage.1.PaceFooter", "usage.12.PaceFooter",
  ];
  const frame = { ...buildFrameData("2026-10-21T12:00:00Z", {}), updateNotice: "Update ready" };

  it.each(footers)("accepts the notice-bearing footer %s in bindings and placeholders", (key) => {
    expect(boundValue(key, frame)).toBe("Update ready");
    for (const primitive of [{ b: key }, { binding: key }, { v: `{${key}}` }, { text: `Status: {${key}}` }]) {
      expect(usesLabelBinding(JSON.stringify({ p: [primitive] }))).toBe(true);
    }
  });

  it.each(["label", "providerLabel", "l"])("keeps the label spelling %s", (key) => {
    expect(usesLabelBinding(JSON.stringify({ primitives: [{ binding: key }] }))).toBe(true);
    expect(usesLabelBinding(JSON.stringify({ primitives: [{ text: `{${key}}` }] }))).toBe(true);
  });

  it.each(["usageSlot1PaceText", "us2Pace", "usage.0.PaceLasts", "usage.-1.PaceFooter", "usageSlot3PaceFooter", "us0PaceFooter", "usage.0.PaceFooterExtra"])("rejects non-notice binding %s", (key) => {
    expect(usesLabelBinding(JSON.stringify({ p: [{ b: key }, { v: `{${key}}` }] }))).toBe(false);
  });
});
