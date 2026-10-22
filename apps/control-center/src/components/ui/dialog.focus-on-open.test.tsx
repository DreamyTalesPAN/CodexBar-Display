// @vitest-environment jsdom
//
// A dialog that opens shows no focus ring until the user uses the keyboard.
// Radix focuses the first control on open, and its ring shows after a mouse
// click too. So the dialog itself takes focus, and one Tab lands on the first
// control.

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "./alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "./dialog";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// What the Tab key does here: jsdom does not move focus itself, so this walks
// the document the way a browser does, to the next control with a tab stop.
function nextTabStop(from: Element): Element | undefined {
  const stops = Array.from(
    document.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]"),
  ).filter((el) => el.tabIndex >= 0 && !el.matches(":disabled"));
  return stops.find(
    (el) => from.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

function TestDialog() {
  return (
    <Dialog open>
      <DialogContent>
        <DialogTitle>Restart Control Center</DialogTitle>
        <DialogDescription>It takes a moment.</DialogDescription>
        <DialogFooter>
          <button type="button">Restart</button>
          <button type="button">Cancel</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

describe("focus when a dialog opens", () => {
  it("leaves focus on the dialog, not on its first button", async () => {
    render(<TestDialog />);
    const dialog = screen.getByRole("dialog", { name: "Restart Control Center" });
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Restart" }));
    expect(dialog.className).toContain("outline-none");
  });

  it("sends one Tab to the first button", async () => {
    render(<TestDialog />);
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    expect(nextTabStop(dialog)).toBe(screen.getByRole("button", { name: "Restart" }));
  });

  it("keeps the dialog named and described for a screen reader", () => {
    render(<TestDialog />);
    const dialog = screen.getByRole("dialog", { name: "Restart Control Center" });
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("leaves a text field to take typing at once", async () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Enter IP address</DialogTitle>
          <DialogDescription>Type the address.</DialogDescription>
          <input aria-label="IP address" />
          <button type="button">Connect</button>
        </DialogContent>
      </Dialog>,
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("IP address")));
  });

  it("keeps the first control focused when the keyboard opened the dialog", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    // jsdom does not tell keyboard focus from mouse focus.
    vi.spyOn(opener, "matches").mockImplementation((selector: string) => selector === ":focus-visible");
    render(<TestDialog />);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Restart" })),
    );
    opener.remove();
  });
});

describe("focus when a confirmation dialog opens", () => {
  function Confirm() {
    return (
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>Delete theme?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  it("leaves focus on the dialog, and Tab goes to Keep", async () => {
    render(<Confirm />);
    const dialog = screen.getByRole("alertdialog");
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    expect(nextTabStop(dialog)).toBe(screen.getByRole("button", { name: "Keep" }));
  });
});
