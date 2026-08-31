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
});
