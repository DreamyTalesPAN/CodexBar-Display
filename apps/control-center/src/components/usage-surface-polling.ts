export const USAGE_SURFACE_POLL_INTERVAL_MS = 30_000;

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
  clock?: PollingClock;
};

export function startUsageSurfacePolling({
  refreshUsage,
  refreshProviderHealth,
  isVisible = defaultIsVisible,
  isOnline = defaultIsOnline,
  intervalMs = USAGE_SURFACE_POLL_INTERVAL_MS,
  clock = currentClock(),
}: UsageSurfacePollingOptions): () => void {
  let stopped = false;
  let usageInFlight = false;
  let providerHealthInFlight = false;

  const run = () => {
    if (stopped || !isVisible() || !isOnline()) {
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

  const initialTimer: TimeoutHandle = clock.setTimeout(run, 0);
  const intervalTimer: IntervalHandle = clock.setInterval(run, intervalMs);

  return () => {
    stopped = true;
    usageInFlight = false;
    providerHealthInFlight = false;
    clock.clearTimeout(initialTimer);
    clock.clearInterval(intervalTimer);
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
