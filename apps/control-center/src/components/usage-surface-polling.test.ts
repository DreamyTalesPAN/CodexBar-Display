import { afterEach, describe, expect, it, vi } from "vitest";
import {
  startUsageSurfacePolling,
  USAGE_SURFACE_POLL_INTERVAL_MS,
} from "./usage-surface-polling";

describe("startUsageSurfacePolling", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes usage and provider health repeatedly on the usage cadence", async () => {
    vi.useFakeTimers();
    const refreshUsage = vi.fn(() => Promise.resolve());
    const refreshProviderHealth = vi.fn(() => Promise.resolve());

    const stop = startUsageSurfacePolling({
      refreshUsage,
      refreshProviderHealth,
    });

    await advance(0);
    expect(refreshUsage).toHaveBeenCalledTimes(1);
    expect(refreshProviderHealth).toHaveBeenCalledTimes(1);

    await advance(USAGE_SURFACE_POLL_INTERVAL_MS);
    expect(refreshUsage).toHaveBeenCalledTimes(2);
    expect(refreshProviderHealth).toHaveBeenCalledTimes(2);

    await advance(USAGE_SURFACE_POLL_INTERVAL_MS);
    expect(refreshUsage).toHaveBeenCalledTimes(3);
    expect(refreshProviderHealth).toHaveBeenCalledTimes(3);

    stop();
  });

  it("pauses polling while hidden or offline", async () => {
    vi.useFakeTimers();
    let visible = false;
    let online = true;
    const refreshUsage = vi.fn(() => Promise.resolve());
    const refreshProviderHealth = vi.fn(() => Promise.resolve());

    const stop = startUsageSurfacePolling({
      refreshUsage,
      refreshProviderHealth,
      isVisible: () => visible,
      isOnline: () => online,
    });

    await advance(0);
    await advance(USAGE_SURFACE_POLL_INTERVAL_MS);
    expect(refreshUsage).not.toHaveBeenCalled();
    expect(refreshProviderHealth).not.toHaveBeenCalled();

    visible = true;
    online = false;
    await advance(USAGE_SURFACE_POLL_INTERVAL_MS);
    expect(refreshUsage).not.toHaveBeenCalled();
    expect(refreshProviderHealth).not.toHaveBeenCalled();

    online = true;
    await advance(USAGE_SURFACE_POLL_INTERVAL_MS);
    expect(refreshUsage).toHaveBeenCalledTimes(1);
    expect(refreshProviderHealth).toHaveBeenCalledTimes(1);

    stop();
  });

  it("does not overlap usage or provider-health requests", async () => {
    vi.useFakeTimers();
    const usage = deferred();
    const providerHealth = deferred();
    const refreshUsage = vi.fn(() => usage.promise);
    const refreshProviderHealth = vi.fn(() => providerHealth.promise);

    const stop = startUsageSurfacePolling({
      refreshUsage,
      refreshProviderHealth,
    });

    await advance(0);
    expect(refreshUsage).toHaveBeenCalledTimes(1);
    expect(refreshProviderHealth).toHaveBeenCalledTimes(1);

    await advance(USAGE_SURFACE_POLL_INTERVAL_MS);
    expect(refreshUsage).toHaveBeenCalledTimes(1);
    expect(refreshProviderHealth).toHaveBeenCalledTimes(1);

    providerHealth.resolve();
    await flushPromises();
    await advance(USAGE_SURFACE_POLL_INTERVAL_MS);
    expect(refreshUsage).toHaveBeenCalledTimes(1);
    expect(refreshProviderHealth).toHaveBeenCalledTimes(2);

    usage.resolve();
    await flushPromises();
    await advance(USAGE_SURFACE_POLL_INTERVAL_MS);
    expect(refreshUsage).toHaveBeenCalledTimes(2);
    expect(refreshProviderHealth).toHaveBeenCalledTimes(3);

    stop();
  });

  it("cleans up timers and in-flight state when stopped", async () => {
    vi.useFakeTimers();
    const usage = deferred();
    const providerHealth = deferred();
    const refreshUsage = vi.fn(() => usage.promise);
    const refreshProviderHealth = vi.fn(() => providerHealth.promise);

    const stop = startUsageSurfacePolling({
      refreshUsage,
      refreshProviderHealth,
    });

    await advance(0);
    stop();
    await advance(USAGE_SURFACE_POLL_INTERVAL_MS * 2);
    expect(refreshUsage).toHaveBeenCalledTimes(1);
    expect(refreshProviderHealth).toHaveBeenCalledTimes(1);

    usage.resolve();
    providerHealth.resolve();
    await flushPromises();
    await advance(USAGE_SURFACE_POLL_INTERVAL_MS);
    expect(refreshUsage).toHaveBeenCalledTimes(1);
    expect(refreshProviderHealth).toHaveBeenCalledTimes(1);
  });
});

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  await flushPromises();
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
