// @vitest-environment jsdom
//
// The reconcile effect puts an enabled provider back into the Automatic pool
// when it is missing from it — that is the remains of a half-finished enable.
// It must not do that to a provider the customer just took out by hand, or the
// "Include … in Automatic" control cannot exclude anything.
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

function pool(providerIds: string[]): ProviderDisplaySelection {
  return { mode: "automatic", providerIds, configured: true, valid: true };
}

function picker(
  display: ProviderDisplaySelection,
  onDisplayChange: (
    selection: Pick<ProviderDisplaySelection, "mode" | "providerIds">,
    providerId: string,
  ) => void,
) {
  return (
    <ProviderPicker
      display={display}
      items={[codex, claude]}
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
    const { rerender } = render(picker(pool(["codex", "claude"]), onDisplayChange));

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

  it("still repairs a provider that was never excluded on purpose", async () => {
    const onDisplayChange = vi.fn();
    // Claude is enabled but absent from the saved pool, with no customer action
    // behind it — the half-finished enable the reconcile exists for.
    await act(async () => {
      render(picker(pool(["codex"]), onDisplayChange));
    });

    expect(onDisplayChange).toHaveBeenCalledWith(
      { mode: "automatic", providerIds: ["codex", "claude"] },
      "claude",
    );
  });

  it("looks after it again once the customer puts it back", async () => {
    const onDisplayChange = vi.fn();
    const { rerender } = render(picker(pool(["codex", "claude"]), onDisplayChange));

    await act(async () => {
      screen
        .getByRole("checkbox", { name: "Include Claude in Automatic" })
        .click();
    });
    await act(async () => {
      rerender(picker(pool(["codex"]), onDisplayChange));
    });
    onDisplayChange.mockClear();

    await act(async () => {
      screen
        .getByRole("checkbox", { name: "Include Claude in Automatic" })
        .click();
    });

    expect(onDisplayChange).toHaveBeenCalledWith(
      { mode: "automatic", providerIds: ["codex", "claude"] },
      "claude",
    );
  });
});
