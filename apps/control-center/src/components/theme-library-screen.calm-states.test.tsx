// @vitest-environment jsdom
//
// Calm rules on the Themes and Screensavers page: an error or a storage notice
// is an overlay dialog over the page, never an inline alert box; a page state
// with nothing to show (no screensavers, no catalog) is text, not a framed card.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ThemeProduct } from "@/lib/themes";
import { ThemeLibraryScreen, type ThemeLibraryScreenProps } from "./theme-library-screen";

const stored = vi.hoisted(() => ({
  storageError: null as null | string,
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
      : { ok: true, value: { themes: [] } },
  loadThemeStudioRecovery: () => ({ ok: true, value: null }),
  clearThemeStudioRecovery: () => ({ ok: true, value: null }),
}));

afterEach(() => {
  cleanup();
  stored.storageError = null;
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
