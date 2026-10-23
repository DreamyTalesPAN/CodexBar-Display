// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DisplayModeChoice,
  ROTATION_HOLD_MS,
  type SetupDisplayModePreview,
} from "./setup-display-mode-screen";

const frame = (providerLabel: string, percent: number): SetupDisplayModePreview => ({
  providerLabel,
  resetLabel: null,
  windows: [{ label: "Session", percent }, { label: "Weekly", percent }],
});

function automaticTile(): string {
  return document.querySelectorAll('[data-slot="display-mode-preview"]')[0]
    ?.textContent ?? "";
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: hidden ? "hidden" : "visible",
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function show(previews: SetupDisplayModePreview[]) {
  render(
    <DisplayModeChoice
      automaticPreview={previews[0] ?? null}
      automaticPreviews={previews}
      manualPreview={previews[0] ?? null}
      mode="automatic"
      onSelectMode={vi.fn()}
      onSelectProvider={vi.fn()}
      providers={previews.map((preview) => ({
        id: preview.providerLabel.toLowerCase(),
        label: preview.providerLabel,
      }))}
      selectedProviderId={null}
    />,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  setHidden(false);
  vi.useRealTimers();
});

describe("Automatic preview rotation (#631)", () => {
  it("shows each switched-on provider in turn, 2 s each, with its own readings", () => {
    show([frame("Codex", 87), frame("Claude", 35)]);
    expect(ROTATION_HOLD_MS).toBe(2000);
    expect(automaticTile()).toContain("Codex");
    expect(automaticTile()).toContain("87");

    act(() => { vi.advanceTimersByTime(ROTATION_HOLD_MS - 1); });
    expect(automaticTile()).toContain("Codex");

    act(() => { vi.advanceTimersByTime(1); });
    expect(automaticTile()).toContain("Claude");
    expect(automaticTile()).toContain("35");
    expect(automaticTile()).not.toContain("87");

    act(() => { vi.advanceTimersByTime(ROTATION_HOLD_MS); });
    expect(automaticTile()).toContain("Codex");
  });

  it("stays on the only provider", () => {
    show([frame("Codex", 87)]);
    act(() => { vi.advanceTimersByTime(ROTATION_HOLD_MS * 3); });
    expect(automaticTile()).toContain("Codex");
  });

  it("holds while the page is hidden and moves on once it is visible again", () => {
    show([frame("Codex", 87), frame("Claude", 35)]);
    act(() => { setHidden(true); });
    act(() => { vi.advanceTimersByTime(ROTATION_HOLD_MS * 3); });
    expect(automaticTile()).toContain("Codex");

    act(() => { setHidden(false); });
    act(() => { vi.advanceTimersByTime(ROTATION_HOLD_MS); });
    expect(automaticTile()).toContain("Claude");
    // One provider stays on its own provider while Automatic moves.
    expect(screen.getByRole("button", { name: /One provider/ }).textContent).toContain("Codex");
  });
});
