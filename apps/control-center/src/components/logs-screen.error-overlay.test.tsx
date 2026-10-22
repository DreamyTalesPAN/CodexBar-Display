// @vitest-environment jsdom
//
// Errors are dialogs over the page, never inline text. The Support page used
// to show its last error as an alert inside the Recent activity card; the same
// sentences now open the setup error dialog and close with OK. Whether an
// error is still shown is decided by ControlCenterApp, which owns the error.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LogsScreen } from "./logs-screen";

afterEach(() => {
  cleanup();
});

const failure = {
  code: "usage_failed",
  message: "Usage needs attention.",
  nextAction: "Try again in a moment.",
};

it("shows the last error in a dialog over the page, not as text on the page", () => {
  const { container } = render(<LogsScreen lastError={failure} />);

  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Usage needs attention.")).toBeTruthy();
  expect(within(dialog).getByText("Try again in a moment.")).toBeTruthy();
  expect(container.textContent).not.toContain("Usage needs attention.");
  expect(container.textContent).not.toContain("Try again in a moment.");
});

it("reports the dismissal to its owner when OK closes the dialog", () => {
  const onDismissError = vi.fn();
  render(<LogsScreen lastError={failure} onDismissError={onDismissError} />);

  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  expect(onDismissError).toHaveBeenCalledTimes(1);
});

it("shows no dialog when the owner has no error to show", () => {
  render(<LogsScreen lastError={null} />);
  expect(screen.queryByRole("dialog")).toBeNull();
});
