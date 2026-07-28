import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PreferenceDescriptor,
  UsageSnapshot,
} from "./control-center-types";
import {
  PROVIDER_RECONCILE_POLL_MS,
  PROVIDER_RECONCILE_WINDOW_MS,
  providerUsageNeedsReconcile,
  scheduleProviderUsageReconcile,
} from "./provider-usage-reconcile";

function providerPreference(
  state: NonNullable<PreferenceDescriptor["health"]>["state"],
): PreferenceDescriptor {
  return {
    id: "codexbar.providers.future-provider.enabled",
    section: "providers",
    owner: "codexbar",
    type: "boolean",
    label: "Future Provider",
    value: true,
    effectiveValue: true,
    allowsDefault: false,
    availability: { state: "available" },
    writeStrategy: "codexbar_command",
    writable: true,
    health: { state, service: "unknown", message: "" },
  };
}

function providerUsage(
  overrides: Partial<UsageSnapshot["providers"][number]> = {},
): UsageSnapshot {
  return {
    providers: [
      {
        id: "future-provider",
        label: "Future Provider",
        session: 12,
        weekly: 34,
        usageMode: "used",
        ...overrides,
      },
    ],
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("provider usage reconciliation", () => {
  it("continues only while enabled provider usage is still pending", () => {
    expect(
      providerUsageNeedsReconcile(
        [providerPreference("checking")],
        providerUsage(),
      ),
    ).toBe(true);
    expect(
      providerUsageNeedsReconcile(
        [providerPreference("healthy")],
        providerUsage({ usageUnavailable: true }),
      ),
    ).toBe(true);
    expect(
      providerUsageNeedsReconcile(
        [providerPreference("healthy")],
        providerUsage(),
      ),
    ).toBe(false);
    expect(
      providerUsageNeedsReconcile(
        [providerPreference("auth_required")],
        null,
      ),
    ).toBe(false);
  });

  it("polls at the bounded interval and stops at the 30 second deadline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T08:00:00Z"));
    const refresh = vi.fn();
    const startedAt = Date.now();
    const deadline = startedAt + PROVIDER_RECONCILE_WINDOW_MS;

    scheduleProviderUsageReconcile({
      deadline,
      preferences: [providerPreference("checking")],
      refresh,
      usage: null,
    });
    vi.advanceTimersByTime(PROVIDER_RECONCILE_POLL_MS);
    expect(refresh).toHaveBeenCalledOnce();

    vi.setSystemTime(deadline - PROVIDER_RECONCILE_POLL_MS + 1);
    scheduleProviderUsageReconcile({
      deadline,
      preferences: [providerPreference("checking")],
      refresh,
      usage: null,
    });
    vi.advanceTimersByTime(PROVIDER_RECONCILE_POLL_MS);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does not schedule another poll after fresh usage arrives", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T08:00:00Z"));
    const refresh = vi.fn();

    scheduleProviderUsageReconcile({
      deadline: Date.now() + PROVIDER_RECONCILE_WINDOW_MS,
      preferences: [providerPreference("healthy")],
      refresh,
      usage: providerUsage(),
    });
    vi.runAllTimers();

    expect(refresh).not.toHaveBeenCalled();
  });
});
