// @vitest-environment jsdom
//
// The reconcile finishes an enable this picker started, where the display
// write failed or raced. It must not touch a provider that is simply absent
// from a saved pool: that is what "Include … in Automatic" writes when the
// customer leaves one out, and the two are indistinguishable once loaded —
// so only an enable made here counts.
//
// DO NOT weaken these tests to make them pass. Fix the component.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  PreferenceDescriptor,
  ProviderDisplaySelection,
} from "./control-center-types";
import { ProviderPicker } from "./provider-picker";

afterEach(cleanup);

function provider(providerId: string, label: string): PreferenceDescriptor {
  return {
    id: `codexbar.providers.${providerId}.enabled`,
    section: "providers",
    owner: "codexbar",
    type: "boolean",
    label,
    providerId,
    description: `Usage from ${label}.`,
    value: true,
    effectiveValue: true,
    allowsDefault: false,
    availability: { state: "available" },
    writeStrategy: "codexbar_command",
    writable: true,
    health: {
      state: "healthy",
      service: "operational",
      message: "Provider is working.",
    },
  } as PreferenceDescriptor;
}

const codex = provider("codex", "Codex");
const claude = provider("claude", "Claude");
const claudeOff: PreferenceDescriptor = {
  ...claude,
  value: false,
  effectiveValue: false,
};

function pool(providerIds: string[]): ProviderDisplaySelection {
  return { mode: "automatic", providerIds, configured: true, valid: true };
}

function picker(
  display: ProviderDisplaySelection,
  onDisplayChange: (
    selection: Pick<ProviderDisplaySelection, "mode" | "providerIds">,
    providerId: string,
  ) => void,
  items: PreferenceDescriptor[] = [codex, claude],
) {
  return (
    <ProviderPicker
      display={display}
      items={items}
      onCheck={vi.fn()}
      onDisplayChange={onDisplayChange}
      onPreferenceChange={vi.fn()}
      pendingCheckIds={new Set()}
      pendingPreferenceIds={new Set()}
    />
  );
}

describe("ProviderPicker reconcile", () => {
  it("leaves a provider out once the customer excludes it", async () => {
    const onDisplayChange = vi.fn();
    const { rerender } = render(
      picker(pool(["codex", "claude"]), onDisplayChange),
    );

    await act(async () => {
      screen
        .getByRole("checkbox", { name: "Include Claude in Automatic" })
        .click();
    });

    expect(onDisplayChange).toHaveBeenCalledWith(
      { mode: "automatic", providerIds: ["codex"] },
      "claude",
    );

    // The save lands: Claude is enabled but deliberately not in the pool.
    onDisplayChange.mockClear();
    await act(async () => {
      rerender(picker(pool(["codex"]), onDisplayChange));
    });

    expect(onDisplayChange).not.toHaveBeenCalled();
  });

  // The exclusion is saved, so the customer meets it again on a fresh mount --
  // reopening Settings, or restarting the app. A mount-scoped memory of the
  // click cannot survive that, and the loaded state alone cannot tell the
  // exclusion from a half-finished enable.
  it("leaves it out again after Settings is reopened", async () => {
    const onDisplayChange = vi.fn();
    const first = render(picker(pool(["codex", "claude"]), onDisplayChange));
    await act(async () => {
      screen
        .getByRole("checkbox", { name: "Include Claude in Automatic" })
        .click();
    });
    first.unmount();
    onDisplayChange.mockClear();

    await act(async () => {
      render(picker(pool(["codex"]), onDisplayChange));
    });

    expect(onDisplayChange).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole("checkbox", { name: "Include Claude in Automatic" })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("does not touch a saved pool it never wrote to", async () => {
    const onDisplayChange = vi.fn();
    // Claude is enabled and absent from the saved pool, with no enable made
    // here behind it. Nothing to finish, so nothing to write.
    await act(async () => {
      render(picker(pool(["codex"]), onDisplayChange));
    });

    expect(onDisplayChange).not.toHaveBeenCalled();
  });

  it("finishes an enable whose display write never landed", async () => {
    const onDisplayChange = vi.fn();
    const { rerender } = render(
      picker(pool(["codex"]), onDisplayChange, [codex, claudeOff]),
    );

    // The customer switches Claude on here; the enable lands, the pool write
    // does not.
    await act(async () => {
      screen.getByRole("switch", { name: "Enable Claude" }).click();
    });
    await act(async () => {
      rerender(picker(pool(["codex"]), onDisplayChange, [codex, claude]));
    });

    expect(onDisplayChange).toHaveBeenCalledWith(
      { mode: "automatic", providerIds: ["codex", "claude"] },
      "claude",
    );
  });
});
