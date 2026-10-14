// @vitest-environment jsdom
//
// Saving a catalog theme opened to edit must add a theme to the customer's
// library. A later catalog can give one of its themes the id under which the
// customer already saved a theme of their own; the saved copy then took that
// record's place and the customer's theme was gone.

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createBlankThemeSpec } from "@/lib/theme-studio";
import type { UserThemeRecord } from "@/lib/theme-studio-storage";
import type { ThemeProduct } from "@/lib/themes";
import { ThemeLibraryScreen } from "./theme-library-screen";
import type { ThemeStudioScreenProps } from "./theme-studio-screen";

const own: UserThemeRecord = {
  id: "namesake",
  updatedAt: "2026-07-01T00:00:00Z",
  document: {
    assets: {},
    packName: "My Theme",
    spec: { ...createBlankThemeSpec(), themeId: "namesake" },
  },
};

const written = vi.hoisted(() => ({ themes: [] as unknown[] }));

vi.mock("@/lib/theme-studio-storage", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadUserThemes: () => ({ ok: true, value: { themes: [own] } }),
  loadThemeStudioRecovery: () => ({ ok: true, value: null }),
  clearThemeStudioRecovery: () => ({ ok: true, value: null }),
  writeUserThemes: (themes: unknown[]) => {
    written.themes = themes;
    return { ok: true, value: { themes } };
  },
}));

// The editor itself is not under test: Save hands back what it was opened with.
vi.mock("./theme-studio-screen", () => ({
  ThemeStudioScreen: ({ initialTheme, onSaveToLibrary }: ThemeStudioScreenProps) => (
    <button
      onClick={() =>
        void onSaveToLibrary?.({
          assets: initialTheme?.assets ?? {},
          libraryId: initialTheme?.libraryId,
          packName: initialTheme?.packName ?? "",
          source: initialTheme?.source ?? "blank",
          spec: initialTheme!.spec,
          usage: initialTheme?.usage,
        })
      }
      type="button"
    >
      Save in editor
    </button>
  ),
}));

const namesake: ThemeProduct = {
  id: "namesake",
  isFree: true,
  packSha256: "a".repeat(64),
  packSizeBytes: 100,
  packUrl: "https://example.com/namesake.zip",
  priceLabel: "Free",
  source: "github-catalog",
  themeId: "namesake",
  title: "Catalog Namesake",
  usage: "live",
};

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

it("keeps the customer's own theme when a catalog theme with its id is edited and saved", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        assets: {},
        name: "Catalog Namesake",
        spec: { ...createBlankThemeSpec(), themeId: "namesake" },
      }),
    })),
  );
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  await act(async () => {
    root.render(
      <ThemeLibraryScreen
        busyAction={null}
        companionStatus="online"
        device={null}
        onInstallCustomTheme={async () => false}
        onInstallTheme={vi.fn()}
        onSaveStandby={vi.fn()}
        onSelectTheme={vi.fn()}
        selectedThemeId=""
        storefrontConfigured={false}
        themeInstallEnabled={false}
        themes={[namesake]}
        usage="live"
      />,
    );
  });
  await settle();

  const catalogRow = document
    .querySelector('[aria-label="Preview Catalog Namesake"]')!
    .closest('[role="listitem"]')!;
  const edit = [...catalogRow.querySelectorAll("button")].find(
    (button) => button.textContent === "Edit",
  )!;
  await act(async () => edit.click());
  await settle();
  const save = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Save in editor",
  )!;
  await act(async () => save.click());
  await settle();

  const saved = written.themes as UserThemeRecord[];
  expect(saved.map((theme) => theme.id).sort()).toEqual([
    "namesake",
    "namesake-custom",
  ]);
  expect(saved.find((theme) => theme.id === "namesake")?.document.packName).toBe(
    "My Theme",
  );
  expect(saved.find((theme) => theme.id === "namesake-custom")).toMatchObject({
    originThemeId: "namesake",
    document: { packName: "Catalog Namesake Custom" },
  });
  await act(async () => root.unmount());
});
