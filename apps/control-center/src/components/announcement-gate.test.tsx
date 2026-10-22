// @vitest-environment jsdom
//
// #632: an announcement (the busy computer notice, the AI usage notice, what
// is new) waits while a page's own dialog is open and shows after it closes.
// It never takes the focus of a page dialog that opens with it.
import { act, cleanup, render, screen } from "@testing-library/react";
import { Sparkles } from "lucide-react";
import { createElement } from "react";
import { afterEach, expect, it } from "vitest";

import { SetupDialog } from "./setup/setup-dialog";
import { SetupUsageDialog, setupUsageCauseCopy } from "./setup/setup-usage-dialog";
import { SystemBusyDialog, systemBusyCopy } from "./system-busy-dialog";
import { WhatsNewDialog } from "./whats-new-dialog";

afterEach(cleanup);

const usageTitle = setupUsageCauseCopy.unknown.title;
const usageDialog = () => screen.queryByRole("dialog", { name: usageTitle });
const pageTitle = "Firmware update failed";
const pageDialog = () => screen.queryByRole("dialog", { name: pageTitle });

// A page's own dialog, as Updates opens its firmware failure.
function firmwareFailure() {
  return createElement(SetupDialog, {
    description: "The firmware update failed.",
    onOpenChange: () => {},
    open: true,
    primaryAction: { label: "Try again", onSelect: () => {} },
    title: pageTitle,
  });
}

function usageNotice() {
  return createElement(SetupUsageDialog, {
    cause: "unknown",
    onCreateSupportReport: () => {},
    onOpenChange: () => {},
    onRepair: () => {},
    open: true,
  });
}

function page(pageOpen: boolean, notice: boolean) {
  return createElement(
    "div",
    null,
    pageOpen ? firmwareFailure() : null,
    notice ? usageNotice() : null,
  );
}

it("an AI usage notice waits while a page dialog is open, and shows after it closes", async () => {
  const { rerender } = render(page(true, true));
  // The observer answers once the page dialog is in the document.
  await act(async () => {});
  expect(pageDialog()).not.toBeNull();
  expect(usageDialog()).toBeNull();

  await act(async () => rerender(page(false, true)));
  expect(usageDialog()).not.toBeNull();
});

it("an AI usage notice that opens with a page dialog does not take its focus", async () => {
  const { rerender } = render(page(false, false));
  await act(async () => rerender(page(true, true)));

  expect(usageDialog()).toBeNull();
  expect(pageDialog()?.contains(document.activeElement)).toBe(true);
});

it("the busy computer notice and the AI usage notice do not wait for each other", async () => {
  render(
    createElement(
      "div",
      null,
      createElement(SystemBusyDialog, { onClose: () => {} }),
      usageNotice(),
    ),
  );
  await act(async () => {});
  expect(screen.queryByRole("dialog", { name: systemBusyCopy.title })).not.toBeNull();
  expect(usageDialog()).not.toBeNull();
});

function whatsNew(pageOpen: boolean) {
  return createElement(
    "div",
    null,
    pageOpen ? firmwareFailure() : null,
    createElement(WhatsNewDialog, {
      entries: [{ id: "new-theme", icon: Sparkles, title: "New theme", body: "A new theme is here." }],
      onClose: () => {},
      onShow: () => {},
      windowsHost: false,
    }),
  );
}

const whatsNewDialog = () => screen.queryByRole("dialog", { name: "What's new" });

it("what's new waits while a page dialog is open, and shows after it closes", async () => {
  const { rerender } = render(whatsNew(true));
  await act(async () => {});
  expect(whatsNewDialog()).toBeNull();

  await act(async () => rerender(whatsNew(false)));
  expect(whatsNewDialog()).not.toBeNull();
});

it("what's new that opens with a page dialog does not take its focus", async () => {
  const { rerender } = render(whatsNew(false));
  await act(async () => rerender(whatsNew(true)));

  expect(whatsNewDialog()).toBeNull();
  expect(pageDialog()?.contains(document.activeElement)).toBe(true);
});
