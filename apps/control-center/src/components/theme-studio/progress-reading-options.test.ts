import { describe, expect, it } from "vitest";
import { progressReadingOptions } from "./ai-theme-studio-screen";

describe("Theme Studio progress reading options", () => {
  // Codex review of #784: an unbound progress bar produced an option with the
  // empty value "", which Radix Select rejects and which crashed the panel.
  it("never offers an empty value, also for a progress bar without a binding", () => {
    for (const binding of [undefined, ""]) {
      const values = progressReadingOptions(binding).map(([value]) => value);
      expect(values).not.toContain("");
      expect(values).toEqual(["usageSlot1Percent", "usageSlot2Percent", "session", "weekly"]);
    }
  });

  it("keeps a Current reading entry for a binding this list does not name", () => {
    expect(progressReadingOptions("customReading")).toContainEqual(["customReading", "Current reading"]);
    expect(progressReadingOptions("weekly")).toHaveLength(4);
  });
});
