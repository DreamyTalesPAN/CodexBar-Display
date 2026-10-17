// @vitest-environment jsdom
//
// The token history notice is a dialog over the Usage page, never a box at its
// top. OK (or the X) closes it; the owner keeps it closed until it has cleared.
// The usage tiles stay on the page under it.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { UsageSnapshot } from "./control-center-types";
import { UsageScreen } from "./usage-screen";

afterEach(cleanup);

// Codex has no token history, so the notice applies.
const usage: UsageSnapshot = {
  ok: true,
  tokenUsageReady: true,
  currentProvider: "codex",
  providers: [
    { id: "codex", label: "Codex", session: 12, weekly: 34, usageMode: "used" as const },
  ],
};

const notice = "No token history was found for Codex on this Mac. Your usage limits are shown below.";
const title = "Token history is unavailable";

it("shows the notice as a dialog over the page, not as text on the page", () => {
  const { container } = render(
    <UsageScreen companionStatus="online" onRefresh={vi.fn()} usage={usage} />,
  );

  const dialog = screen.getByRole("dialog", { name: title });
  expect(within(dialog).getByText(notice)).toBeTruthy();
  expect(container.textContent).not.toContain(title);
  expect(container.textContent).not.toContain(notice);
  // The tiles stay on the page under the dialog.
  expect(screen.getByLabelText("34% weekly used")).toBeTruthy();
});

// The page behind the notice is not held: no scrim over the tiles, so they can
// be pressed under it (the dialog default would swallow those clicks).
it("leaves the page behind the notice unscrimmed and usable", () => {
  const { container } = render(
    <UsageScreen companionStatus="online" onRefresh={vi.fn()} usage={usage} />,
  );

  const scrim = container.querySelector('div[aria-hidden][class*="fixed"]');
  expect(scrim).not.toBeNull();
  expect(scrim?.className).toContain("pointer-events-none");
});

it("reports the close to its owner when OK is pressed", () => {
  const onDismissTokenHistory = vi.fn();
  render(
    <UsageScreen
      companionStatus="online"
      onDismissTokenHistory={onDismissTokenHistory}
      usage={usage}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  expect(onDismissTokenHistory).toHaveBeenCalledTimes(1);
});

it("stays closed once its owner has dismissed it, and the tiles remain", () => {
  render(<UsageScreen companionStatus="online" tokenHistoryDismissed usage={usage} />);

  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByLabelText("34% weekly used")).toBeTruthy();
});

it("waits while another centred dialog is open", () => {
  render(<UsageScreen centredDialogOpen companionStatus="online" usage={usage} />);

  expect(screen.queryByRole("dialog")).toBeNull();
});

it("shows Refreshing and is closed while a refresh runs", () => {
  render(
    <UsageScreen busyAction="usage" companionStatus="online" onRefresh={vi.fn()} usage={usage} />,
  );

  const button = screen.getByRole("button", { name: "Refreshing" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
});

it("shows no notice when every shown provider has its token history", () => {
  render(
    <UsageScreen
      companionStatus="online"
      usage={{ ...usage, providers: [{ ...usage.providers[0], cost: { daily: [{ day: "2026-07-22", totalTokens: 9 }] } }] }}
    />,
  );

  expect(screen.queryByRole("dialog")).toBeNull();
});

// Issue #558: with one provider shown, "every selected provider" would read
// like an error about providers the customer does not have. Several providers
// and one without history say it that way.
it("says every selected provider only when several are shown", () => {
  render(
    <UsageScreen
      companionStatus="online"
      usage={{
        ...usage,
        providers: [
          ...usage.providers,
          { id: "claude", label: "Claude", session: 0, weekly: 10, usageMode: "used" as const, cost: { daily: [{ day: "2026-07-22", totalTokens: 9 }] } },
        ],
      }}
    />,
  );

  const dialog = screen.getByRole("dialog", { name: title });
  expect(within(dialog).getByText(/not available for every selected provider/)).toBeTruthy();
});

// Radix would wrap Tab from the last control of the notice back to its first.
// The page behind is usable, so Tab from the last control moves to the page.
it("lets Tab leave the notice for the page behind it", () => {
  const control = document.createElement("button");
  control.textContent = "Page control";
  document.body.prepend(control);
  render(<UsageScreen companionStatus="online" onRefresh={vi.fn()} usage={usage} />);

  const dialog = screen.getByRole("dialog", { name: title });
  const last = within(dialog).getByRole("button", { name: "Close" });
  last.focus();
  const notPrevented = fireEvent.keyDown(last, { key: "Tab" });

  expect(notPrevented).toBe(false);
  expect(document.activeElement).toBe(control);
  control.remove();
});

// Radix's invisible focus guards are tabbable too, but they are not page
// controls: Tab must land on the page control behind them.
it("does not stop Tab on Radix's focus guards", () => {
  const control = document.createElement("button");
  control.textContent = "Page control";
  document.body.prepend(control);
  const guard = document.createElement("span");
  guard.setAttribute("data-radix-focus-guard", "");
  guard.tabIndex = 0;
  document.body.prepend(guard);
  render(<UsageScreen companionStatus="online" onRefresh={vi.fn()} usage={usage} />);

  const dialog = screen.getByRole("dialog", { name: title });
  const last = within(dialog).getByRole("button", { name: "Close" });
  last.focus();
  fireEvent.keyDown(last, { key: "Tab" });

  expect(document.activeElement).toBe(control);
  guard.remove();
  control.remove();
});
