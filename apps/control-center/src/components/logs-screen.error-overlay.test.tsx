// @vitest-environment jsdom
//
// Errors are dialogs over the page, never inline text. The Support page used
// to show its last error as an alert inside the Recent activity card; the same
// sentences now open the setup error dialog and close with OK.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { LogsScreen } from "./logs-screen";

afterEach(() => {
  cleanup();
});

const device = { active: true, connected: true, paired: true, ready: true };
const failure = {
  code: "usage_failed",
  message: "Usage needs attention.",
  nextAction: "Try again in a moment.",
};

it("shows the last error in a dialog over the page, not as text on the page", () => {
  const { container } = render(<LogsScreen device={device} lastError={failure} />);

  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Usage needs attention.")).toBeTruthy();
  expect(within(dialog).getByText("Try again in a moment.")).toBeTruthy();
  expect(container.textContent).not.toContain("Usage needs attention.");
  expect(container.textContent).not.toContain("Try again in a moment.");
});

it("closes the error dialog with OK and does not reopen it for the same error", () => {
  const { rerender } = render(<LogsScreen device={device} lastError={failure} />);

  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  expect(screen.queryByRole("dialog")).toBeNull();

  // The page re-renders with the same error object or a copy of it.
  rerender(<LogsScreen device={device} lastError={{ ...failure }} />);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("shows the dialog again when the error clears and comes back", () => {
  const { rerender } = render(<LogsScreen device={device} lastError={failure} />);
  fireEvent.click(screen.getByRole("button", { name: "OK" }));

  rerender(<LogsScreen device={device} lastError={null} />);
  rerender(<LogsScreen device={device} lastError={failure} />);
  expect(screen.getByRole("dialog")).toBeTruthy();
});
