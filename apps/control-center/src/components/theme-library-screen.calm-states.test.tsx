// @vitest-environment jsdom
//
// Calm rules on the Themes and Screensavers page: an error or a storage notice
// is an overlay dialog over the page, never an inline alert box; a page state
// with nothing to show (no screensavers, no catalog) is text, not a framed card.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createBlankThemeSpec } from "@/lib/theme-studio";
import type { ThemeProduct } from "@/lib/themes";
import { ThemeLibraryScreen, type ThemeLibraryScreenProps } from "./theme-library-screen";
import { SetupDialog } from "./setup/setup-dialog";
import { SystemBusyDialog, systemBusyCopy } from "./system-busy-dialog";

const stored = vi.hoisted(() => ({
  storageError: null as null | string,
  ownThemes: [] as unknown[],
  writeError: null as null | string,
}));

vi.mock("@/lib/theme-studio-storage", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadUserThemes: () =>
    stored.storageError
      ? {
          ok: false,
          data: { themes: [] },
          error: { message: stored.storageError },
        }
      : { ok: true, value: { themes: stored.ownThemes } },
  writeUserThemes: () =>
    stored.writeError
      ? { ok: false, error: { message: stored.writeError } }
      : { ok: true, value: { themes: [] } },
  loadThemeStudioRecovery: () => ({ ok: true, value: null }),
  clearThemeStudioRecovery: () => ({ ok: true, value: null }),
}));

afterEach(() => {
  cleanup();
  stored.storageError = null;
  stored.ownThemes = [];
  stored.writeError = null;
  vi.unstubAllGlobals();
});

const drift: ThemeProduct = {
  id: "drift",
  isFree: true,
  packSha256: "a".repeat(64),
  packSizeBytes: 100,
  packUrl: "https://example.com/drift.vibetv-theme",
  priceLabel: "Free",
  source: "github-catalog",
  themeId: "drift",
  title: "Drift",
  usage: "live",
};

function renderLibrary(props: Partial<ThemeLibraryScreenProps> = {}) {
  return render(
    <ThemeLibraryScreen
      busyAction={null}
      companionStatus="online"
      device={null}
      onInstallCustomTheme={async () => false}
      onInstallTheme={vi.fn()}
      onSelectTheme={vi.fn()}
      selectedThemeId=""
      storefrontConfigured={false}
      themeInstallEnabled={false}
      themes={[]}
      {...props}
    />,
  );
}

// Requests wait until the test releases them: the Edit request that fails, and
// the preview, which also fetches.
function deferFetches() {
  const release: Array<() => void> = [];
  vi.stubGlobal(
    "fetch",
    () =>
      new Promise((resolve) => {
        release.push(() => resolve({ ok: false }));
      }),
  );
  return async () => {
    await act(async () => {
      release.forEach((step) => step());
    });
  };
}

const driftRow = () =>
  screen.getAllByRole("listitem").find((row) => within(row).queryByText("Drift"))!;

it("waits for a dialog the customer asked for, and shows once it has closed", async () => {
  stored.storageError = "Saved themes contain invalid data.";
  const page = (asked: boolean) => (
    <>
      {asked ? (
        <SetupDialog description="Sure?" onOpenChange={() => {}} open title="Run setup again?" />
      ) : null}
      <ThemeLibraryScreen
        busyAction={null}
        companionStatus="online"
        device={null}
        onInstallCustomTheme={async () => false}
        onInstallTheme={vi.fn()}
        onSelectTheme={vi.fn()}
        selectedThemeId=""
        storefrontConfigured={false}
        themeInstallEnabled={false}
        themes={[]}
      />
    </>
  );
  const { rerender } = render(page(true));
  await act(async () => {});
  expect(screen.queryByRole("dialog", { name: "Run setup again?" })).not.toBeNull();
  expect(screen.queryByRole("dialog", { name: "Theme storage needs attention" })).toBeNull();

  await act(async () => rerender(page(false)));
  expect(screen.queryByRole("dialog", { name: "Theme storage needs attention" })).not.toBeNull();
});

it("a failed theme action opens as an overlay dialog, not as an inline alert", async () => {
  vi.stubGlobal("fetch", async () => ({ ok: false }));
  renderLibrary({ themes: [drift] });

  fireEvent.click(screen.getByRole("button", { name: "Edit" }));

  const dialog = await screen.findByRole("dialog", { name: "Theme action failed" });
  expect(within(dialog).getByText("Theme could not be opened.")).toBeTruthy();
  // No inline alert box on the page carries the error.
  expect(screen.queryAllByRole("alert")).toEqual([]);

  fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
  expect(screen.queryByRole("dialog", { name: "Theme action failed" })).toBeNull();
});

it("a storage problem opens as an overlay dialog, and OK closes it", async () => {
  stored.storageError = "Saved themes contain invalid data.";
  renderLibrary({ themes: [drift] });

  const dialog = await screen.findByRole("dialog", {
    name: "Theme storage needs attention",
  });
  expect(within(dialog).getByText("Saved themes contain invalid data.")).toBeTruthy();
  expect(screen.queryAllByRole("alert")).toEqual([]);

  fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
  expect(screen.queryByRole("dialog", { name: "Theme storage needs attention" })).toBeNull();
  // Closing the notice does not change what storage can do: the list stays.
  expect(screen.getByText("Drift")).toBeTruthy();
});

it("the no-screensavers state is centred text without a card frame", () => {
  renderLibrary({ usage: "screensaver", themes: [] });

  const title = screen.getByText("No screensavers yet");
  const block = title.parentElement!;
  expect(block.className).toContain("text-[13px]");
  expect(block.className).toContain("text-center");
  expect(block.className).toContain("text-muted-foreground");
  // No frame, no card background around the text.
  expect(title.closest(".border")).toBeNull();
  expect(title.closest(".bg-card")).toBeNull();
  expect(screen.getByText("Create a screensaver to add it to this list.")).toBeTruthy();
});

it("the themes-unavailable state is text without a frame and keeps Reload catalog", () => {
  renderLibrary({ usage: "live", themes: [] });

  const title = screen.getByText("Themes unavailable");
  expect(title.closest(".border")).toBeNull();
  expect(title.closest(".bg-card")).toBeNull();
  expect(screen.getByRole("button", { name: "Reload catalog" })).toBeTruthy();
});

// A save that fails while a theme is deleted reports in the delete dialog; the
// page does not open a second overlay for it.
it("a failed delete shows its error in the delete dialog only", async () => {
  stored.ownThemes = [
    {
      id: "mine",
      updatedAt: "2026-10-18T00:00:00Z",
      document: {
        assets: {},
        packName: "Mine",
        spec: createBlankThemeSpec(),
      },
    },
  ];
  stored.writeError = "Saved themes could not be written.";
  renderLibrary({ themes: [] });

  fireEvent.click(await screen.findByRole("button", { name: "Delete Mine" }));
  const deleteDialog = screen.getByRole("alertdialog", { name: "Delete Mine?" });
  fireEvent.click(within(deleteDialog).getByRole("button", { name: "Delete local copy" }));

  expect(await within(deleteDialog).findByText("Saved themes could not be written.")).toBeTruthy();
  expect(screen.queryByRole("dialog", { name: "Theme action failed" })).toBeNull();
  expect(screen.queryAllByRole("dialog")).toEqual([]);
});

// Rule 1: a page notice is shown only while no other dialog is open.
it("rule 1: a page notice does not open over another dialog", async () => {
  const releaseFetches = deferFetches();
  renderLibrary({ themes: [drift] });

  fireEvent.click(within(driftRow()).getByRole("button", { name: "Edit" }));
  fireEvent.click(screen.getByRole("button", { name: "Preview Drift" }));
  const preview = screen.getByRole("dialog", { name: "Drift" });

  await releaseFetches();
  expect(screen.queryByRole("dialog", { name: "Theme action failed" })).toBeNull();
  expect(screen.queryAllByRole("dialog")).toEqual([preview]);
});

// Rule 2: an error wins over the storage notice; the storage notice shows
// after the error is closed.
it("rule 2: a library error replaces the storage notice, which shows after it is closed", async () => {
  stored.storageError = "Saved themes contain invalid data.";
  const releaseFetches = deferFetches();
  renderLibrary({ themes: [drift] });
  await screen.findByRole("dialog", { name: "Theme storage needs attention" });

  fireEvent.click(within(driftRow()).getByRole("button", { name: "Edit" }));
  await releaseFetches();

  expect(await screen.findByRole("dialog", { name: "Theme action failed" })).toBeTruthy();
  expect(screen.queryByRole("dialog", { name: "Theme storage needs attention" })).toBeNull();

  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Theme action failed" })).getByRole("button", {
      name: "OK",
    }),
  );
  expect(
    await screen.findByRole("dialog", { name: "Theme storage needs attention" }),
  ).toBeTruthy();
});

// Rule 3: an error that arrives while another dialog is open is kept, and
// shows when that dialog closes.
it("rule 3: an error waits for the open dialog and shows once it closes", async () => {
  const releaseFetches = deferFetches();
  renderLibrary({ themes: [drift] });

  fireEvent.click(within(driftRow()).getByRole("button", { name: "Edit" }));
  fireEvent.click(screen.getByRole("button", { name: "Preview Drift" }));
  const preview = screen.getByRole("dialog", { name: "Drift" });
  await releaseFetches();
  expect(screen.queryByRole("dialog", { name: "Theme action failed" })).toBeNull();

  fireEvent.click(within(preview).getByRole("button", { name: "Close" }));
  const failed = await screen.findByRole("dialog", { name: "Theme action failed" });
  expect(within(failed).getByText("Theme could not be opened.")).toBeTruthy();
});

// OK clears the error; the next failure sets it again and opens it again.
it("OK clears an error, and the next failure opens it again", async () => {
  vi.stubGlobal("fetch", async () => ({ ok: false }));
  renderLibrary({ themes: [drift] });

  fireEvent.click(within(driftRow()).getByRole("button", { name: "Edit" }));
  const first = await screen.findByRole("dialog", { name: "Theme action failed" });
  fireEvent.click(within(first).getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Theme action failed" })).toBeNull(),
  );

  fireEvent.click(within(driftRow()).getByRole("button", { name: "Edit" }));
  expect(await screen.findByRole("dialog", { name: "Theme action failed" })).toBeTruthy();
});

// Codex review on #762 (P1): the busy announcement and a page notice must not
// wait on each other. The notice shows; the announcement waits for it.
it("a page notice is not held back by the busy announcement, which waits for it", async () => {
  vi.stubGlobal("fetch", async () => ({ ok: false }));
  render(
    <>
      <ThemeLibraryScreen
        busyAction={null}
        companionStatus="online"
        device={null}
        onInstallCustomTheme={async () => false}
        onInstallTheme={vi.fn()}
        onSelectTheme={vi.fn()}
        selectedThemeId=""
        storefrontConfigured={false}
        themeInstallEnabled={false}
        themes={[drift]}
      />
      <SystemBusyDialog onClose={() => {}} />
    </>,
  );
  fireEvent.click(within(driftRow()).getByRole("button", { name: "Edit" }));

  expect(await screen.findByRole("dialog", { name: "Theme action failed" })).toBeTruthy();
  // Settled: the notice stays, and the busy announcement does not come back over it.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  expect(screen.getByRole("dialog", { name: "Theme action failed" })).toBeTruthy();
  expect(screen.queryByRole("dialog", { name: systemBusyCopy.title })).toBeNull();
});
