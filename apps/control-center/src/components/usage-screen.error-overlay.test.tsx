// @vitest-environment jsdom
//
// A usage error is a dialog over the Usage page, never a box at its top. Try
// again and OK are its buttons; the page behind it is darkened. The owner keeps
// it closed until the error has cleared.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { UsageSnapshot } from "./control-center-types";
import { UsageScreen } from "./usage-screen";

afterEach(cleanup);

const usage: UsageSnapshot = {
  ok: true,
  tokenUsageReady: true,
  currentProvider: "codex",
  providers: [
    {
      id: "codex",
      label: "Codex",
      session: 12,
      weekly: 34,
      usageMode: "used" as const,
      cost: { daily: [{ day: "2026-07-22", totalTokens: 9 }] },
    },
  ],
};

const usageError = {
  code: "COMPANION_TIMEOUT",
  message: "Usage needs attention.",
  nextAction: "Check the Mac App, then try again.",
};

it("shows the error as a dialog over the page, not as text on the page", () => {
  const { container } = render(
    <UsageScreen
      companionStatus="online"
      onRefresh={vi.fn()}
      usage={usage}
      usageError={usageError}
    />,
  );

  const dialog = screen.getByRole("dialog", { name: usageError.message });
  expect(within(dialog).getByText(usageError.nextAction)).toBeTruthy();
  expect(container.textContent).not.toContain(usageError.message);
  expect(container.textContent).not.toContain(usageError.nextAction);
  // The tiles stay on the page under the dialog.
  expect(screen.getByLabelText("34% weekly used")).toBeTruthy();
});

// The error uses the standard dialog backdrop, like every other dialog: the
// screen behind is darkened and held, so nothing is pressed under the error.
it("darkens and holds the page behind the error like every other dialog", () => {
  const { container } = render(
    <UsageScreen
      companionStatus="online"
      onRefresh={vi.fn()}
      usage={usage}
      usageError={usageError}
    />,
  );

  const scrim = container.querySelector('div[aria-hidden][class*="fixed"]');
  expect(scrim).not.toBeNull();
  expect(scrim?.className).toContain("bg-black/10");
  expect(scrim?.className).toContain("opacity-100");
  expect(scrim?.className).not.toContain("pointer-events-none");
});

it("offers Try again, which runs the refresh", () => {
  const onRefresh = vi.fn();
  render(
    <UsageScreen
      companionStatus="online"
      onRefresh={onRefresh}
      usage={usage}
      usageError={usageError}
    />,
  );

  const dialog = screen.getByRole("dialog", { name: usageError.message });
  fireEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
  expect(onRefresh).toHaveBeenCalledTimes(1);
});

it("reports the close to its owner when OK is pressed", () => {
  const onDismissUsageError = vi.fn();
  render(
    <UsageScreen
      companionStatus="online"
      onDismissUsageError={onDismissUsageError}
      onRefresh={vi.fn()}
      usage={usage}
      usageError={usageError}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  expect(onDismissUsageError).toHaveBeenCalledTimes(1);
});

it("stays closed once its owner has dismissed it", () => {
  render(
    <UsageScreen
      companionStatus="online"
      onRefresh={vi.fn()}
      usage={usage}
      usageError={usageError}
      usageErrorDismissed
    />,
  );

  expect(screen.queryByRole("dialog")).toBeNull();
});

it("waits while another centred dialog is open", () => {
  render(
    <UsageScreen
      centredDialogOpen
      companionStatus="online"
      onRefresh={vi.fn()}
      usage={usage}
      usageError={usageError}
    />,
  );

  expect(screen.queryByRole("dialog")).toBeNull();
});

it("shows Trying again and is closed while a refresh runs", () => {
  render(
    <UsageScreen
      busyAction="usage"
      companionStatus="online"
      onRefresh={vi.fn()}
      usage={usage}
      usageError={usageError}
    />,
  );

  const dialog = screen.getByRole("dialog", { name: usageError.message });
  const button = within(dialog).getByRole("button", { name: "Trying again" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
});

// The error comes first: the token history notice does not stand on top of it.
it("shows the error alone when the token history notice also applies", () => {
  render(
    <UsageScreen
      companionStatus="online"
      onRefresh={vi.fn()}
      usage={{
        ...usage,
        providers: [{ ...usage.providers[0], cost: undefined }],
      }}
      usageError={usageError}
    />,
  );

  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(screen.getByRole("dialog", { name: usageError.message })).toBeTruthy();
});

// Without a snapshot there are no tiles. Once OK has closed the error, the page
// says it has no usage yet instead of going blank with no way to retry.
it("keeps an unavailable state on the page after OK closes the error", () => {
  render(
    <UsageScreen
      companionStatus="online"
      onRefresh={vi.fn()}
      usage={null}
      usageError={usageError}
      usageErrorDismissed
    />,
  );

  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText("No provider usage is available yet.")).toBeTruthy();
});
