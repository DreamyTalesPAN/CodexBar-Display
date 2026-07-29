import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { GET, truncateUtf8Bytes } from "./route";

async function readDisplayFrame(frame: Record<string, unknown>) {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "display-frame-route-"));
  const previousStateDir = process.env.CONTROL_CENTER_DISPLAY_STATE_DIR;
  process.env.CONTROL_CENTER_DISPLAY_STATE_DIR = stateDir;

  try {
    await writeFile(
      path.join(stateDir, "last-good-frame.json"),
      JSON.stringify({
        savedAt: "2026-07-29T12:00:00Z",
        frame,
      }),
      "utf8",
    );
    const response = await GET();
    expect(response.status).toBe(200);
    return (await response.json()) as {
      ok: boolean;
      frame: Record<string, unknown>;
    };
  } finally {
    if (previousStateDir == null) {
      delete process.env.CONTROL_CENTER_DISPLAY_STATE_DIR;
    } else {
      process.env.CONTROL_CENTER_DISPLAY_STATE_DIR = previousStateDir;
    }
    await rm(stateDir, { recursive: true, force: true });
  }
}

describe("display frame UTF-8 limits", () => {
  it("truncates at complete code points within the byte budget", () => {
    const result = truncateUtf8Bytes("Wöchentliche Nutzung 🚀", 24);

    expect(new TextEncoder().encode(result).byteLength).toBeLessThanOrEqual(24);
    expect(result).not.toContain("\uFFFD");
    expect(result).toBe("Wöchentliche Nutzung");
  });
});

describe("display frame usage lanes", () => {
  it("preserves every ordered v2 usage window without emitting legacy slots", async () => {
    const response = await readDisplayFrame({
      v: 2,
      provider: "codex",
      label: "Codex",
      usageMode: "remaining",
      usageWindows: [
        { id: "weekly", label: "Weekly", percent: 83, resetSecs: 582000 },
        {
          id: "codex-spark-weekly",
          label: "Codex Spark Weekly",
          percent: 100,
          resetSecs: 604800,
        },
        {
          id: "limit-reset-credits",
          label: "Limit Reset Credits",
          percent: 25,
          resetSecs: 1188000,
        },
      ],
      usageSlots: [
        { id: "stale", label: "Stale legacy slot", percent: 1, resetSecs: 0 },
      ],
    });

    expect(response.ok).toBe(true);
    expect(response.frame).toMatchObject({
      v: 2,
      session: 83,
      weekly: 100,
      resetSecs: 582000,
      usageMode: "remaining",
      usageWindows: [
        { id: "weekly", label: "Weekly", percent: 83, resetSecs: 582000 },
        {
          id: "codex-spark-weekly",
          label: "Codex Spark Weekly",
          percent: 100,
          resetSecs: 604800,
        },
        {
          id: "limit-reset-credits",
          label: "Limit Reset Credits",
          percent: 25,
          resetSecs: 1188000,
        },
      ],
    });
    expect(response.frame).not.toHaveProperty("usageSlots");
  });

  it("keeps legacy slots and session-weekly remaining projection compatible", async () => {
    const response = await readDisplayFrame({
      provider: "claude",
      label: "Claude",
      session: 36,
      weekly: 72,
      resetSecs: 3600,
      usageSlots: [
        { id: "session", label: "Session", percent: 36, resetSecs: 3600 },
        { id: "weekly", label: "Weekly", percent: 72, resetSecs: 86400 },
      ],
    });

    expect(response.frame).toMatchObject({
      v: 1,
      session: 64,
      weekly: 28,
      resetSecs: 3600,
      usageMode: "remaining",
      usageSlots: [
        { id: "session", label: "Session", percent: 64, resetSecs: 3600 },
        { id: "weekly", label: "Weekly", percent: 28, resetSecs: 86400 },
      ],
    });
    expect(response.frame).not.toHaveProperty("usageWindows");
  });

  it("falls back to legacy slots when a v2 frame has no valid named windows", async () => {
    const response = await readDisplayFrame({
      v: 2,
      provider: "codex",
      usageMode: "remaining",
      usageWindows: [{ id: "", label: "", percent: 50 }],
      usageSlots: [
        { id: "session", label: "Session", percent: 44, resetSecs: 1200 },
        { id: "weekly", label: "Weekly", percent: 55, resetSecs: 2400 },
      ],
    });

    expect(response.frame).toMatchObject({
      v: 2,
      session: 44,
      weekly: 55,
      resetSecs: 1200,
      usageSlots: [
        { id: "session", label: "Session", percent: 44, resetSecs: 1200 },
        { id: "weekly", label: "Weekly", percent: 55, resetSecs: 2400 },
      ],
    });
    expect(response.frame).not.toHaveProperty("usageWindows");
  });
});
