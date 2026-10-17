// @vitest-environment jsdom
//
// Errors are dialogs over the page, never inline text. The Support page used
// to show its last error as an alert inside the Recent activity card; the same
// sentences now open the setup error dialog and close with OK. The dismissal
// lives with the owner of the error (as in ControlCenterApp), so it survives
// leaving and returning to Support, and a new failure opens the dialog again.

import { useState } from "react";
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

// Stands in for ControlCenterApp: it owns the error and the dismissal, and
// `shown` stands for leaving the Support tab (LogsScreen unmounts).
function Support({ error, shown = true }: { error: typeof failure | null; shown?: boolean }) {
  const [dismissed, setDismissed] = useState<typeof failure | null>(null);
  if (!shown) return <p>Another tab</p>;
  return (
    <LogsScreen
      device={device}
      dismissedError={dismissed}
      lastError={error}
      onDismissError={() => setDismissed(error)}
    />
  );
}

it("shows the last error in a dialog over the page, not as text on the page", () => {
  const { container } = render(<Support error={failure} />);

  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Usage needs attention.")).toBeTruthy();
  expect(within(dialog).getByText("Try again in a moment.")).toBeTruthy();
  expect(container.textContent).not.toContain("Usage needs attention.");
  expect(container.textContent).not.toContain("Try again in a moment.");
});

it("closes the error dialog with OK and keeps it closed for the same error", () => {
  const { rerender } = render(<Support error={failure} />);

  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  expect(screen.queryByRole("dialog")).toBeNull();

  rerender(<Support error={failure} />);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("keeps a dismissed error closed when Support is left and opened again", () => {
  const { rerender } = render(<Support error={failure} />);
  fireEvent.click(screen.getByRole("button", { name: "OK" }));

  rerender(<Support error={failure} shown={false} />);
  rerender(<Support error={failure} />);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("opens the dialog again for a new failure with the same words", () => {
  const { rerender } = render(<Support error={failure} />);
  fireEvent.click(screen.getByRole("button", { name: "OK" }));

  // A retry that fails again is a new error object.
  rerender(<Support error={{ ...failure }} />);
  expect(screen.getByRole("dialog")).toBeTruthy();
});
