// @vitest-environment jsdom
//
// There is one recovery copy. Opening another theme while an older unsaved
// draft waits in it wrote over that draft with the first change, and Discard
// in the editor removed it: the older draft was gone without a question.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createBlankThemeSpec } from "@/lib/theme-studio";
import { ThemeLibraryScreen } from "./theme-library-screen";

const stored = vi.hoisted(() => ({ cleared: 0, recovery: true }));

vi.mock("@/lib/theme-studio-storage", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadUserThemes: () => ({ ok: true, value: { themes: [] } }),
  loadThemeStudioRecovery: () => ({
    ok: true,
    value: stored.recovery
      ? {
          document: { assets: {}, packName: "Draft keep me", spec: createBlankThemeSpec() },
          source: "blank",
          updatedAt: "2026-10-08T20:00:00Z",
        }
      : null,
  }),
  clearThemeStudioRecovery: () => {
    stored.cleared += 1;
    return { ok: true, value: null };
  },
}));

vi.mock("./theme-studio-screen", () => ({
  ThemeStudioScreen: () => <p>Editor open</p>,
}));

afterEach(() => {
  cleanup();
  stored.cleared = 0;
  stored.recovery = true;
});

function renderLibrary() {
  render(
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
    />,
  );
}

it("asks before a new theme takes the place of an older unsaved draft", async () => {
  renderLibrary();
  await screen.findByText("Continue your unsaved theme");
  fireEvent.click(screen.getByRole("button", { name: "Create Theme" }));
  expect(screen.getByRole("alertdialog", { name: "Replace your changes?" })).toBeTruthy();
  expect(
    screen.getByText("Draft keep me has changes that are not saved. What you open takes its place."),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.queryByText("Editor open")).toBeNull();
  expect(stored.cleared).toBe(0);
  expect(screen.getByText("Continue your unsaved theme")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Create Theme" }));
  fireEvent.click(screen.getByRole("button", { name: "Replace" }));
  expect(stored.cleared).toBe(1);
  expect(screen.getByText("Editor open")).toBeTruthy();
});

it("opens a new theme at once when no unsaved draft waits", () => {
  stored.recovery = false;
  renderLibrary();
  fireEvent.click(screen.getByRole("button", { name: "Create Theme" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(screen.getByText("Editor open")).toBeTruthy();
});
