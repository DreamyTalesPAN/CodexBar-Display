// @vitest-environment jsdom
//
// #632: one dialog stack. An announcement (the busy computer notice, the AI
// usage notice, what is new) waits while a page's own dialog or notice is
// open and shows after it closes. It never takes the focus of a dialog that
// opens with it. A page notice waits for the dialogs the customer asked for,
// and goes before an announcement.
import { act, cleanup, render, screen } from "@testing-library/react";
import { Sparkles } from "lucide-react";
import { createElement } from "react";
import { afterEach, expect, it } from "vitest";

import { useWaitsForDialog } from "./dialog-stack";
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

// Not only the focus: the announcement is never in the document while a page
// dialog opens with it, not even for the moment before it is taken out again.
const announcements: [string, () => ReturnType<typeof createElement>, string][] = [
  ["busy computer notice", () => createElement(SystemBusyDialog, { onClose: () => {} }), systemBusyCopy.title],
  ["AI usage notice", usageNotice, usageTitle],
  [
    "what's new",
    () =>
      createElement(WhatsNewDialog, {
        entries: [{ id: "new-theme", icon: Sparkles, title: "New theme", body: "A new theme is here." }],
        onClose: () => {},
        onShow: () => {},
        windowsHost: false,
      }),
    "What's new",
  ],
];

it.each(announcements)(
  "the %s never mounts when it opens in the same render as a page dialog",
  async (_name, announcement, title) => {
    const { rerender } = render(createElement("div"));
    const seen: string[] = [];
    const watch = new MutationObserver((records) => {
      for (const node of records.flatMap((record) => [...record.addedNodes])) {
        if (node.textContent?.includes(title)) {
          seen.push(title);
        }
      }
    });
    watch.observe(document.body, { childList: true, subtree: true });
    const focused: Element[] = [];
    const onFocus = (event: FocusEvent) => event.target instanceof Element && focused.push(event.target);
    document.addEventListener("focusin", onFocus);

    await act(async () =>
      rerender(createElement("div", null, firmwareFailure(), announcement())),
    );
    await act(async () => {});
    watch.disconnect();
    document.removeEventListener("focusin", onFocus);

    expect(seen).toEqual([]);
    expect(pageDialog()?.contains(document.activeElement)).toBe(true);
    expect(focused.every((el) => pageDialog()?.contains(el))).toBe(true);
  },
);

// A notice of the page, as the Overview or the Themes page shows it.
function PageNotice() {
  const waits = useWaitsForDialog("notice");
  return createElement(SetupDialog, {
    description: "Theme not shown",
    onOpenChange: () => {},
    open: !waits,
    rank: "notice",
    title: "Theme notice",
  });
}

const noticeDialog = () => screen.queryByRole("dialog", { name: "Theme notice" });

function ranked(asked: boolean, notice: boolean) {
  return createElement("div", null, asked ? firmwareFailure() : null, notice ? createElement(PageNotice) : null, usageNotice());
}

it("a page notice waits for a question, and an announcement waits for both", async () => {
  const { rerender } = render(ranked(true, true));
  await act(async () => {});
  expect(pageDialog()).not.toBeNull();
  expect(noticeDialog()).toBeNull();
  expect(usageDialog()).toBeNull();

  await act(async () => rerender(ranked(false, true)));
  expect(noticeDialog()).not.toBeNull();
  expect(usageDialog()).toBeNull();

  await act(async () => rerender(ranked(false, false)));
  expect(usageDialog()).not.toBeNull();
});

it("a page notice that appears over an open announcement goes first, and the announcement returns", async () => {
  const { rerender } = render(ranked(false, false));
  expect(usageDialog()).not.toBeNull();

  await act(async () => rerender(ranked(false, true)));
  expect(noticeDialog()).not.toBeNull();
  expect(usageDialog()).toBeNull();

  await act(async () => rerender(ranked(false, false)));
  expect(usageDialog()).not.toBeNull();
});
