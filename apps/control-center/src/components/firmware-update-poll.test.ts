// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { pollFirmwareUpdateJob } from "./control-center-app";

afterEach(() => vi.useRealTimers());

describe("firmware update polling", () => {
  it.each(["complete", "attention", "error"] as const)(
    "stops immediately on terminal %s and preserves the result",
    async (phase) => {
      vi.useFakeTimers();
      const job = { id: "update-1", phase, result: { firmware: "1.0.42" } };
      const runCompanion = vi.fn()
        .mockResolvedValueOnce({ job: { id: job.id, phase: "installing" } })
        .mockResolvedValue({ job });
      const applyUpdateJob = vi.fn();
      const settled = vi.fn();
      const promise = pollFirmwareUpdateJob({ jobId: job.id, runCompanion, applyUpdateJob }).then(settled);
      await vi.advanceTimersByTimeAsync(2000);
      expect(settled).toHaveBeenCalledWith(job);
      expect(runCompanion).toHaveBeenCalledTimes(2);
      expect(applyUpdateJob).toHaveBeenCalledWith(job);
      await promise;
    },
  );

  it("does not treat an unknown phase as success", async () => {
    vi.useFakeTimers();
    const runCompanion = vi.fn().mockResolvedValue({ job: { id: "update-1", phase: "unknown" } });
    const promise = pollFirmwareUpdateJob({ jobId: "update-1", runCompanion, applyUpdateJob: vi.fn() });
    const rejection = expect(promise).rejects.toMatchObject({ code: "firmware_update_status_invalid" });
    await vi.advanceTimersByTimeAsync(500);
    await rejection;
    expect(runCompanion).toHaveBeenCalledTimes(1);
  });
});
