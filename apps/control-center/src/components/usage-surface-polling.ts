export const USAGE_SURFACE_POLL_INTERVAL_MS = 30_000;
export const USAGE_REFRESH_POLL_INTERVAL_MS = 3_000;

type IntervalHandle = ReturnType<typeof globalThis.setInterval>;
type TimeoutHandle = ReturnType<typeof globalThis.setTimeout>;

type PollingClock = {
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
  setInterval: typeof globalThis.setInterval;
  clearInterval: typeof globalThis.clearInterval;
};

type UsageSurfacePollingOptions = {
  refreshUsage: () => Promise<void>;
  refreshProviderHealth: () => Promise<void>;
  isVisible?: () => boolean;
  isOnline?: () => boolean;
  intervalMs?: number;
  refreshPending?: boolean;
  clock?: PollingClock;
};

export function startUsageSurfacePolling({
  refreshUsage,
  refreshProviderHealth,
  isVisible = defaultIsVisible,
  isOnline = defaultIsOnline,
  intervalMs = USAGE_SURFACE_POLL_INTERVAL_MS,
  refreshPending = false,
  clock = currentClock(),
}: UsageSurfacePollingOptions): () => void {
  let stopped = false;
  let usageInFlight = false;
  let providerHealthInFlight = false;

  const canPoll = () => !stopped && isVisible() && isOnline();
  const runUsage = () => {
    if (!canPoll()) {
      return;
    }
    if (!usageInFlight) {
      usageInFlight = true;
      void Promise.resolve()
        .then(refreshUsage)
        .catch(() => undefined)
        .finally(() => {
          usageInFlight = false;
        });
    }
  };

  const run = () => {
    if (!canPoll()) {
      return;
    }
    runUsage();

    if (!providerHealthInFlight) {
      providerHealthInFlight = true;
      void Promise.resolve()
        .then(refreshProviderHealth)
        .catch(() => undefined)
        .finally(() => {
          providerHealthInFlight = false;
        });
    }
  };

  // A background Mac window can miss every timer tick. Refresh when it
  // becomes visible so setup and Settings never wait on the next interval.
  const visibilityTarget = typeof document === "undefined" ? null : document;
  visibilityTarget?.addEventListener("visibilitychange", run);

  const initialTimer: TimeoutHandle = clock.setTimeout(run, 0);
  const intervalTimer: IntervalHandle = clock.setInterval(run, intervalMs);
  const refreshTimer: IntervalHandle | null = refreshPending
    ? clock.setInterval(runUsage, USAGE_REFRESH_POLL_INTERVAL_MS)
    : null;

  return () => {
    stopped = true;
    visibilityTarget?.removeEventListener("visibilitychange", run);
    usageInFlight = false;
    providerHealthInFlight = false;
    clock.clearTimeout(initialTimer);
    clock.clearInterval(intervalTimer);
    if (refreshTimer !== null) clock.clearInterval(refreshTimer);
  };
}

function defaultIsVisible(): boolean {
  return (
    typeof document === "undefined" || document.visibilityState !== "hidden"
  );
}

function defaultIsOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

function currentClock(): PollingClock {
  return {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
  };
}
