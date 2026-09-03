// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { useCallback, useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PreferenceHealthState } from "./control-center-types";
import type { ProviderItem } from "./provider-picker";
import {
  providerPreferencesNeedPolling,
  PROVIDER_PREFERENCES_POLL_INTERVAL_MS,
  startProviderPreferencesPolling,
} from "./provider-preferences-polling";
import { SetupProvidersScreen } from "./setup/setup-providers-screen";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const PREFERENCES_PATH = "/v1/preferences?section=providers";

function provider(health: PreferenceHealthState, value = true): ProviderItem {
  return {
    allowsDefault: false,
    availability: { state: "available" },
    effectiveValue: value,
    health: {
      message: health === "healthy" ? "Ready." : "Checking provider status.",
      service: health === "healthy" ? "operational" : "unknown",
      state: health,
    },
    id: "codexbar.providers.claude.enabled",
    label: "Claude Code",
    owner: "codexbar",
    providerId: "claude",
    section: "providers",
    type: "boolean",
    value,
    writable: true,
    writeStrategy: "codexbar_command",
  };
}

describe("provider preference polling", () => {
  it("re-reads checking preferences until health arrives, without retrying the provider", async () => {
    vi.useFakeTimers();
    const requests: string[] = [];
    const retryProvider = vi.fn();

    function Harness() {
      const [providers, setProviders] = useState([provider("checking")]);
      const polling = providerPreferencesNeedPolling(true, providers);
      const refreshPreferences = useCallback(async () => {
        requests.push(PREFERENCES_PATH);
        setProviders([provider("healthy")]);
      }, []);

      useEffect(() => {
        if (!polling) {
          return;
        }
        return startProviderPreferencesPolling({
          refresh: refreshPreferences,
        });
      }, [polling, refreshPreferences]);

      return (
        <SetupProvidersScreen
          onCheckAgain={retryProvider}
          onContinue={vi.fn()}
          onToggle={vi.fn()}
          pendingCheckIds={new Set<string>()}
          pendingPreferenceIds={new Set<string>()}
          providers={providers}
        />
      );
    }

    render(<Harness />);
    expect(
      screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled"),
    ).toBe(true);

    await advance(PROVIDER_PREFERENCES_POLL_INTERVAL_MS);

    expect(requests).toEqual([PREFERENCES_PATH]);
    expect(requests).not.toContain("/v1/providers/retry");
    expect(retryProvider).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled"),
    ).toBe(false);

    await advance(PROVIDER_PREFERENCES_POLL_INTERVAL_MS);
    expect(requests).toEqual([PREFERENCES_PATH]);
    expect(retryProvider).not.toHaveBeenCalled();
  });

  it("uses the shared providerDisplayWanted path for setup and Settings", () => {
    expect(providerPreferencesNeedPolling(true, [provider("checking")])).toBe(
      true,
    );
    expect(providerPreferencesNeedPolling(false, [provider("checking")])).toBe(
      false,
    );
    expect(providerPreferencesNeedPolling(true, [provider("healthy")])).toBe(
      false,
    );
    expect(
      providerPreferencesNeedPolling(true, [provider("checking", false)]),
    ).toBe(false);
  });

  it("waits for an unresolved read before scheduling the next one", async () => {
    vi.useFakeTimers();
    const first = deferred();
    const refresh = vi.fn(() => first.promise);
    const stop = startProviderPreferencesPolling({ refresh });

    await advance(PROVIDER_PREFERENCES_POLL_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);

    await advance(PROVIDER_PREFERENCES_POLL_INTERVAL_MS * 3);
    expect(refresh).toHaveBeenCalledTimes(1);

    first.resolve();
    await flushPromises();
    await advance(PROVIDER_PREFERENCES_POLL_INTERVAL_MS - 1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(refresh).toHaveBeenCalledTimes(2);

    stop();
  });
});

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
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
