// @vitest-environment jsdom
//
// The token history notice is a dialog over the Usage page, never a box at its
// top. OK (or the X) closes it; the owner keeps it closed until it has cleared.
// The usage tiles stay on the page, under the dialog's darkening.

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

// The notice uses the standard dialog backdrop, like every other dialog: the
// screen behind is darkened and held, so nothing is pressed under the notice.
it("darkens and holds the page behind the notice like every other dialog", () => {
  const { container } = render(
    <UsageScreen companionStatus="online" onRefresh={vi.fn()} usage={usage} />,
  );

  const scrim = container.querySelector('div[aria-hidden][class*="fixed"]');
  expect(scrim).not.toBeNull();
  expect(scrim?.className).toContain("bg-black/10");
  expect(scrim?.className).toContain("opacity-100");
  expect(scrim?.className).not.toContain("pointer-events-none");
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

it("keeps the chart Refresh action working after OK with no token history", () => {
  const onRefresh = vi.fn();
  const onDismissTokenHistory = vi.fn();
  const props = { companionStatus: "online" as const, onRefresh, onDismissTokenHistory, usage };
  const view = render(<UsageScreen {...props} />);
  fireEvent.click(within(screen.getByRole("dialog", { name: title })).getByRole("button", { name: "OK" }));
  expect(onDismissTokenHistory).toHaveBeenCalledOnce();
  view.rerender(<UsageScreen {...props} tokenHistoryDismissed />);

  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("Last 30 days")).toBeNull();
  const refresh = screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement;
  expect(refresh.disabled).toBe(false);
  fireEvent.click(refresh);
  expect(onRefresh).toHaveBeenCalledOnce();

  view.rerender(<UsageScreen {...props} tokenHistoryDismissed busyAction="usage" />);
  expect((screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<UsageScreen {...props} tokenHistoryDismissed usage={{ ...usage, refresh: { state: "refreshing" } }} />);
  const pending = screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement;
  expect(pending.disabled).toBe(true);
  fireEvent.click(pending);
  expect(onRefresh).toHaveBeenCalledOnce();
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
