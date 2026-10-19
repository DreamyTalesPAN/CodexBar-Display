// @vitest-environment jsdom
//
// #606: the busy computer notice waits for any other dialog of the page,
// confirmations (alertdialog) included, and returns after it.
import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it } from "vitest";

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

// Build-2 decision (19.10.2026, frame 49): the grey backdrop like every other dialog.
it("dims the screen behind the dialog", () => {
  const { container } = render(page(null));
  const scrim = container.querySelector('div[aria-hidden][class*="fixed"]');
  expect(scrim?.className).toContain("bg-black/10");
  expect(scrim?.className).toContain("opacity-100");
  expect(scrim?.className).not.toContain("pointer-events-none");
});
