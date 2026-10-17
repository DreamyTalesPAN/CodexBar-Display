// @vitest-environment jsdom
//
// #606: the busy computer notice waits for any other dialog of the page,
// confirmations (alertdialog) included, and returns after it.
// #632: a page dialog that opens in the same render as the notice keeps the
// focus, and the notice never shows over it.
import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it } from "vitest";

import { SetupDialog } from "./setup/setup-dialog";
import { SystemBusyDialog, systemBusyCopy } from "./system-busy-dialog";

afterEach(cleanup);

function page(other: string | null) {
  return createElement(
    "div",
    null,
    other ? createElement("div", { role: other }, "Delete this theme?") : null,
    createElement(SystemBusyDialog, { onClose: () => {} }),
  );
}

const busy = () => screen.queryByRole("dialog", { name: systemBusyCopy.title });

for (const role of ["dialog", "alertdialog"]) {
  it(`waits while a ${role} is open`, async () => {
    const { rerender } = render(page(null));
    expect(busy()).not.toBeNull();

    await act(async () => rerender(page(role)));
    expect(busy()).toBeNull();

    await act(async () => rerender(page(null)));
    expect(busy()).not.toBeNull();
  });
}

// The status reply that starts the notice also opens the firmware failure on
// Updates: both mount in one render.
function sameRender(open: boolean) {
  return createElement(
    "div",
    null,
    open
      ? createElement(SetupDialog, {
          description: "The firmware update failed.",
          onOpenChange: () => {},
          open: true,
          primaryAction: { label: "Try again", onSelect: () => {} },
          title: "Firmware update failed",
        })
      : null,
    open ? createElement(SystemBusyDialog, { onClose: () => {} }) : null,
  );
}

it("a page dialog that opens in the same render keeps the focus", async () => {
  const focusedIn: string[] = [];
  const record = (event: FocusEvent) => {
    focusedIn.push((event.target as Element).closest('[role="dialog"]')?.textContent ?? "");
  };
  document.addEventListener("focusin", record);
  const { rerender } = render(sameRender(false));
  await act(async () => rerender(sameRender(true)));
  await act(async () => new Promise((done) => setTimeout(done, 0)));
  document.removeEventListener("focusin", record);

  expect(busy()).toBeNull();
  expect(focusedIn.some((text) => text.includes(systemBusyCopy.title))).toBe(false);
  expect(
    screen
      .getByRole("dialog", { name: "Firmware update failed" })
      .contains(document.activeElement),
  ).toBe(true);
});
