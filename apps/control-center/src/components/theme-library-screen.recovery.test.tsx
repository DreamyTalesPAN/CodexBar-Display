// @vitest-environment jsdom
//
// There is one recovery copy. Opening another theme while an older unsaved
// draft waits in it wrote over that draft with the first change, and Discard
// in the editor removed it: the older draft was gone without a question.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createBlankThemeSpec } from "@/lib/theme-studio";
import { ThemeLibraryScreen, type ThemeLibraryScreenProps } from "./theme-library-screen";

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
  ThemeStudioScreen: ({ installBlockedReason }: { installBlockedReason?: string }) => (
    <p>Editor open{installBlockedReason ? `, no send: ${installBlockedReason}` : ""}</p>
  ),
}));

afterEach(() => {
  cleanup();
  stored.cleared = 0;
  stored.recovery = true;
});

function renderLibrary(props: Partial<ThemeLibraryScreenProps> = {}) {
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
      {...props}
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
  // Here nothing is being edited: the button keeps the draft and the list.
  expect(screen.queryByRole("button", { name: "Keep editing" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Keep draft" }));
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

// The list does not install a screensaver while Show screensaver is off;
// Screensaver Studio sent one all the same. And while the setting is not
// known -- the settings are still loading, or reading them failed -- both
// were open, although the screensaver may be off (automated review).
const OFF = "Turn on Show screensaver first.";
const UNKNOWN = "Screensaver installs are not available right now.";
const on = { brightnessPercent: 20, enabled: true, timeoutMinutes: 10 };
const withSlot = { connected: true, paired: true, ready: true, standby: { active: false } };
it.each([
  ["not read yet", { device: withSlot, standby: null }, UNKNOWN],
  ["off", { device: withSlot, standby: { ...on, enabled: false } }, OFF],
  ["on", { device: withSlot, standby: on }, ""],
  // Firmware without a screensaver setting reports no standby at all.
  ["not there on this VibeTV", { device: { ...withSlot, standby: undefined }, standby: null }, ""],
] as const)("closes Install and Send for a screensaver while its setting is %s", (_state, props, reason) => {
  stored.recovery = false;
  renderLibrary({
    ...props,
    themes: [
      {
        id: "drift", isFree: true, priceLabel: "Free", source: "github-catalog",
        themeId: "drift", title: "Drift", usage: "screensaver",
      },
    ],
    usage: "screensaver",
  });
  // The row's buttons are Preview, Edit and Install; closed, Install carries
  // the reason as its title.
  const install = screen.getByRole("listitem").querySelectorAll("button")[2];
  expect([OFF, UNKNOWN].find((text) => install.title === text) ?? "").toBe(reason);
  if (reason) {
    expect(install.disabled).toBe(true);
  }
  fireEvent.click(screen.getByRole("button", { name: "Create Screensaver" }));
  expect(screen.getByText(reason ? `Editor open, no send: ${reason}` : "Editor open")).toBeTruthy();
});
