// @vitest-environment jsdom
//
// The companion holds an exact check for five minutes, failed ones included.
// A customer sent off to sign in and coming back therefore met the same answer,
// with Continue closed and nothing asking again.
//
// DO NOT weaken this test to make it pass. Fix the component.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProviderItem } from "../provider-picker";
import { SetupProvidersScreen } from "./setup-providers-screen";

afterEach(cleanup);

const claude = {
  allowsDefault: false,
  availability: { state: "available" },
  effectiveValue: true,
  health: {
    message: "Sign in required.",
    service: "unknown",
    state: "auth_required",
  },
  id: "codexbar.providers.claude.enabled",
  label: "Claude",
  owner: "codexbar",
  providerId: "claude",
  value: true,
} as unknown as ProviderItem;

describe("SetupProvidersScreen after a sign-in", () => {
  it("asks for a fresh check once the sign-in wait is over", () => {
    vi.useFakeTimers();
    try {
      const onCheckAgain = vi.fn();
      render(
        <SetupProvidersScreen
          onCheckAgain={onCheckAgain}
          onContinue={vi.fn()}
          onRecover={vi.fn()}
          onToggle={vi.fn()}
          pendingCheckIds={new Set<string>()}
          pendingPreferenceIds={new Set<string>()}
          providers={[claude]}
        />,
      );

      act(() => {
        screen.getByRole("button", { name: "Sign in to Claude" }).click();
      });
      expect(onCheckAgain).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(120_000);
      });

      expect(onCheckAgain).toHaveBeenCalledWith(claude);
    } finally {
      vi.useRealTimers();
    }
  });

  // The check at the end of that wait is a real provider probe. Running one
  // against a provider the customer switched off in the meantime is work they
  // did not ask for -- and the switch is deliberately theirs to press at any
  // time, including while a recovery is waiting.
  it("calls off the wait when the provider is switched off", () => {
    vi.useFakeTimers();
    try {
      const onCheckAgain = vi.fn();
      render(
        <SetupProvidersScreen
          onCheckAgain={onCheckAgain}
          onContinue={vi.fn()}
          onRecover={vi.fn()}
          onToggle={vi.fn()}
          pendingCheckIds={new Set<string>()}
          pendingPreferenceIds={new Set<string>()}
          providers={[claude]}
        />,
      );

      act(() => {
        screen.getByRole("button", { name: "Sign in to Claude" }).click();
      });
      act(() => {
        screen.getByRole("switch", { name: "Claude" }).click();
      });
      act(() => {
        vi.advanceTimersByTime(120_000);
      });

      expect(onCheckAgain).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

});
