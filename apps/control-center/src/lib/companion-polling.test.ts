// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollThemeInstallJob } from "./theme-install";
import { pollFirmwareUpdateJob, type RunCompanion } from "@/components/update-jobs";

type Job = { id: string; phase: string };
const jobId = "job /?&";
const cases = [
  {
    name: "theme", path: "/v1/themes/install/status", attempts: 900,
    terminal: ["complete", "error"],
    timeout: {
      code: "theme_install_timeout",
      message: "Screensaver install is taking longer than expected.",
      nextAction: "Keep VibeTV powered on, then check the screensaver again.",
    },
    start: (runCompanion: RunCompanion, applyJob: (job: Job) => void) =>
      pollThemeInstallJob({ jobId, runCompanion, applyInstallJob: applyJob, noun: "Screensaver" }),
  },
  {
    name: "firmware", path: "/v1/updates/install/status", attempts: 1200,
    terminal: ["complete", "attention", "error"],
    timeout: {
      code: "firmware_update_timeout",
      message: "VibeTV update is taking longer than expected.",
      nextAction: "Keep VibeTV powered on, then create a support report.",
    },
    start: (runCompanion: RunCompanion, applyJob: (job: Job) => void) =>
      pollFirmwareUpdateJob({ jobId, runCompanion, applyUpdateJob: applyJob }),
  },
];

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe.each(cases)("$name polling contract", ({ path, attempts, terminal, timeout, start }) => {
  it.each(terminal)("waits 500 ms before each sequential read and stops after applying %s", async (phase) => {
    const active = { id: jobId, phase: "installing" };
    const finished = { id: jobId, phase };
    let release!: (payload: { job: Job }) => void;
    const runCompanion = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }))
      .mockResolvedValue({ job: finished });
    const applied: Job[] = [];
    const result = start(runCompanion, (job) => applied.push(job));
    expect(runCompanion).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(499);
    expect(runCompanion).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(runCompanion).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(750);
    expect(runCompanion).toHaveBeenCalledTimes(1);
    expect(applied).toEqual([]);
    release({ job: active });
    await vi.advanceTimersByTimeAsync(0);
    expect(applied).toEqual([active]);
    await vi.advanceTimersByTimeAsync(499);
    expect(runCompanion).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe(finished);
    expect(applied).toEqual([active, finished]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(runCompanion.mock.calls).toEqual(Array(2).fill([
      `${path}?jobId=job%20%2F%3F%26`, undefined, { preserveLastError: true },
    ]));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("exhausts exactly its attempt budget with the same timeout text", async () => {
    const runCompanion = vi.fn().mockResolvedValue({ job: { id: jobId, phase: "installing" } });
    const applied = vi.fn();
    const result = start(runCompanion, applied);
    const rejected = expect(result).rejects.toEqual(timeout);
    await vi.advanceTimersByTimeAsync(attempts * 500 - 1);
    expect(runCompanion).toHaveBeenCalledTimes(attempts - 1);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(runCompanion).toHaveBeenCalledTimes(attempts);
    expect(applied).toHaveBeenCalledTimes(attempts);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("accepts a terminal result on the last allowed read", async () => {
    const finished = { id: jobId, phase: "complete" };
    let reads = 0;
    const runCompanion = vi.fn().mockImplementation(async () => ({
      job: ++reads === attempts ? finished : { id: jobId, phase: "installing" },
    }));
    const result = start(runCompanion, vi.fn());
    await vi.advanceTimersByTimeAsync(attempts * 500);
    expect(await result).toBe(finished);
    expect(runCompanion).toHaveBeenCalledTimes(attempts);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { code: "install_job_not_found", message: "Missing job." },
    new Error("Network failed."),
    new DOMException("Aborted", "AbortError"),
  ])("propagates request failures unchanged without retrying: %s", async (error) => {
    const runCompanion = vi.fn().mockRejectedValue(error);
    const applied = vi.fn();
    const rejected = expect(start(runCompanion, applied)).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(1500);
    await rejected;
    expect(runCompanion).toHaveBeenCalledTimes(1);
    expect(applied).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops if applying the job throws, even for a terminal result", async () => {
    const error = new Error("Apply failed.");
    const runCompanion = vi.fn().mockResolvedValue({ job: { id: jobId, phase: "complete" } });
    const rejected = expect(start(runCompanion, () => { throw error; })).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(1500);
    await rejected;
    expect(runCompanion).toHaveBeenCalledTimes(1);
  });
});

it("theme polling keeps reading unknown phases and uses the default Theme timeout wording", async () => {
  const runCompanion = vi.fn().mockResolvedValue({ job: { phase: "attention" } });
  const applied = vi.fn();
  const rejected = expect(pollThemeInstallJob({ jobId, runCompanion, applyInstallJob: applied })).rejects.toEqual({
    code: "theme_install_timeout",
    message: "Theme install is taking longer than expected.",
    nextAction: "Keep VibeTV powered on, then check the theme again.",
  });
  await vi.advanceTimersByTimeAsync(900 * 500);
  await rejected;
  expect(applied).toHaveBeenCalledTimes(900);
});

it("firmware polling applies an unknown phase before rejecting it with its exact error", async () => {
  const job = { id: jobId, phase: "unknown" };
  const applied = vi.fn();
  const runCompanion = vi.fn().mockResolvedValue({ job });
  const rejected = expect(pollFirmwareUpdateJob({ jobId, runCompanion, applyUpdateJob: applied })).rejects.toEqual({
    code: "firmware_update_status_invalid",
    message: "VibeTV returned an unknown update status.",
    nextAction: "Keep VibeTV powered on, then create a support report.",
  });
  await vi.advanceTimersByTimeAsync(1500);
  await rejected;
  expect(applied).toHaveBeenCalledExactlyOnceWith(job);
  expect(runCompanion).toHaveBeenCalledTimes(1);
});
