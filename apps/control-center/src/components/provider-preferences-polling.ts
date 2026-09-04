import type { PreferenceDescriptor } from "./control-center-types";

export const PROVIDER_PREFERENCES_POLL_INTERVAL_MS = 5_000;

type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

type PollingClock = {
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
};

type ProviderPreferencesPollingOptions = {
  refresh: () => void | Promise<void>;
  isVisible?: () => boolean;
  intervalMs?: number;
  clock?: PollingClock;
};

export function providerPreferencesNeedPolling(
  providerDisplayWanted: boolean,
  preferences: PreferenceDescriptor[] | null,
): boolean {
  return Boolean(
    providerDisplayWanted &&
      preferences?.some(
        (preference) =>
          preference.section === "providers" &&
          preference.value === true,
      ),
  );
}

/**
 * Re-reads enabled providers while their screen is visible. That lets the
 * browser observe CodexBar's background health result and also notices a later
 * sign-out without reopening Settings. The next read is scheduled only after
 * the previous one settles, so a slow Companion cannot build up overlaps.
 */
export function startProviderPreferencesPolling({
  refresh,
  isVisible = defaultIsVisible,
  intervalMs = PROVIDER_PREFERENCES_POLL_INTERVAL_MS,
  clock = currentClock(),
}: ProviderPreferencesPollingOptions): () => void {
  let stopped = false;
  let timer: TimerHandle | null = null;

  const schedule = () => {
    if (stopped) {
      return;
    }
    timer = clock.setTimeout(() => void run(), intervalMs);
  };
  const run = async () => {
    timer = null;
    if (stopped) {
      return;
    }
    if (isVisible()) {
      try {
        await refresh();
      } catch {
        // The existing Preferences reader owns and exposes its request error.
      }
    }
    schedule();
  };

  schedule();
  return () => {
    stopped = true;
    if (timer !== null) {
      clock.clearTimeout(timer);
      timer = null;
    }
  };
}

function defaultIsVisible(): boolean {
  return (
    typeof document === "undefined" || document.visibilityState !== "hidden"
  );
}

function currentClock(): PollingClock {
  return {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  };
}
