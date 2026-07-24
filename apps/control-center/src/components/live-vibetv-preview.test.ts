import { describe, expect, it } from "vitest";
import {
  boundValue,
  buildFrameData,
  progressPercent,
} from "./live-vibetv-preview";

describe("live VibeTV partial usage", () => {
  it("renders only the unknown lane as unavailable", () => {
    const frame = buildFrameData("2026-07-24T10:30:00Z", {
      v: 1,
      provider: "codex",
      label: "Codex",
      weekly: 60,
      sessionUnavailable: true,
    });

    expect(boundValue("session", frame)).toBe("??");
    expect(boundValue("weekly", frame)).toBe("60");
    expect(progressPercent({ binding: "session" }, frame)).toBe(0);
    expect(progressPercent({ binding: "weekly" }, frame)).toBe(60);
  });
});
