// @vitest-environment jsdom
//
// Returning to Automatic after pinning one provider has to bring back the pool
// the customer had, which is what docs/control-center-customer-ui-approval.md
// approved on 2026-08-03. The saved selection cannot supply it -- by then it
// only holds the pinned provider -- so the picker remembers the last Automatic
// pool itself. It was remembered and never read, and the write that followed
// named the pinned provider alone: the rest of the rotation was dropped with
// nothing on screen saying so.
//
// DO NOT weaken this test to make it pass. Fix the component.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  PreferenceDescriptor,
  ProviderDisplaySelection,
} from "./control-center-types";
import { ProviderPicker } from "./provider-picker";

afterEach(cleanup);

function provider(
  overrides: Partial<PreferenceDescriptor> &
    Pick<PreferenceDescriptor, "id" | "label" | "providerId">,
): PreferenceDescriptor {
  return {
    section: "providers",
    owner: "codexbar",
    type: "boolean",
    value: true,
    effectiveValue: true,
    allowsDefault: false,
    availability: { state: "available" },
    writeStrategy: "codexbar_command",
    writable: true,
    health: {
      state: "healthy",
      service: "operational",
      message: "Provider is ready.",
    },
    ...overrides,
  };
}

const codex = provider({
  id: "codexbar.providers.codex.enabled",
  label: "Codex",
  providerId: "codex",
});
const claude = provider({
  id: "codexbar.providers.claude.enabled",
  label: "Claude",
  providerId: "claude",
});
const cursor = provider({
  id: "codexbar.providers.cursor.enabled",
  label: "Cursor",
  providerId: "cursor",
});

const automatic: ProviderDisplaySelection = {
  mode: "automatic",
  providerIds: ["codex", "claude"],
  configured: true,
  valid: true,
};
const pinnedToClaude: ProviderDisplaySelection = {
  mode: "fixed",
  providerIds: ["claude"],
  configured: true,
  valid: true,
};

describe("ProviderPicker: leaving Always show one", () => {
  it("brings back the Automatic pool the customer had", () => {
    const onDisplayChange = vi.fn();
    const picker = (display: ProviderDisplaySelection) => (
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

    const { rerender } = render(picker(automatic));
    fireEvent.click(screen.getByRole("button", { name: "Always show one" }));
    fireEvent.click(screen.getByRole("radio", { name: "Always show Claude" }));
    expect(onDisplayChange).toHaveBeenCalledWith(
      { mode: "fixed", providerIds: ["claude"] },
      "claude",
    );

    // The save landed, so the selection now names Claude alone.
    onDisplayChange.mockClear();
    rerender(picker(pinnedToClaude));
    fireEvent.click(screen.getByRole("button", { name: "Automatic" }));

    expect(onDisplayChange).toHaveBeenCalledWith(
      { mode: "automatic", providerIds: ["codex", "claude"] },
      "claude",
    );
  });

  // The companion refuses a selection naming a provider that is off, so a
  // remembered pool has to be measured against what is on right now.
  it("leaves out a remembered provider that has since been switched off", () => {
    const onDisplayChange = vi.fn();
    const picker = (
      display: ProviderDisplaySelection,
      items: PreferenceDescriptor[],
    ) => (
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

    const { rerender } = render(
      picker(
        { ...automatic, providerIds: ["codex", "claude", "cursor"] },
        [codex, claude, cursor],
      ),
    );
    rerender(
      picker(pinnedToClaude, [
        codex,
        claude,
        { ...cursor, value: false, effectiveValue: false },
      ]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Automatic" }));

    expect(onDisplayChange).toHaveBeenCalledWith(
      { mode: "automatic", providerIds: ["codex", "claude"] },
      "claude",
    );
  });

  // The repair exists to finish an enable this picker started, and only an
  // Automatic enable is two writes. Recording one made under "Always show one"
  // meant the switch back restored the pool and then quietly added a provider
  // the customer had kept out of it.
  it("does not add a provider enabled under Always show one to the restored pool", () => {
    const onDisplayChange = vi.fn();
    const onPreferenceChange = vi.fn();
    const excluded = { ...cursor, value: false, effectiveValue: false };
    const picker = (
      display: ProviderDisplaySelection,
      items: PreferenceDescriptor[],
    ) => (
      <ProviderPicker
        display={display}
        items={items}
        onCheck={vi.fn()}
        onDisplayChange={onDisplayChange}
        onPreferenceChange={onPreferenceChange}
        pendingCheckIds={new Set()}
        pendingPreferenceIds={new Set()}
      />
    );

    // Cursor is off and kept out of the Automatic pool, then the customer pins
    // Claude and switches Cursor back on from the pinned screen.
    const { rerender } = render(picker(automatic, [codex, claude, excluded]));
    rerender(picker(pinnedToClaude, [codex, claude, excluded]));
    fireEvent.click(screen.getByRole("switch", { name: "Enable Cursor" }));
    expect(onPreferenceChange).toHaveBeenCalled();

    rerender(picker(pinnedToClaude, [codex, claude, cursor]));
    fireEvent.click(screen.getByRole("button", { name: "Automatic" }));

    expect(onDisplayChange).toHaveBeenCalledWith(
      { mode: "automatic", providerIds: ["codex", "claude"] },
      "claude",
    );

    // The restore lands, which is when the repair effect gets to look at it.
    rerender(picker(automatic, [codex, claude, cursor]));
    expect(onDisplayChange).toHaveBeenCalledTimes(1);
  });

});
