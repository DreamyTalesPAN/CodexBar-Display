// @vitest-environment jsdom
//
// Issue #579, seen in the Mac and Windows apps: Install on the last row of
// Appearance › Themes put its progress and its "Installed" notice below the
// edge of the window, where nothing showed that anything had happened. Since
// Paul's review of 7198 the card shows no notice at all: the Install button
// says "Installing" with a spinner, and the pill on the picture says Active.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import type { ThemeProduct } from "@/lib/themes";
import { ThemeLibraryScreen, type ThemeInstallStatus } from "./theme-library-screen";

vi.mock("./theme-render-preview", () => ({ ThemeRenderPreview: () => null }));

const theme: ThemeProduct = {
  id: "gauge",
  isFree: true,
  packSha256: "a".repeat(64),
  packSizeBytes: 100,
  packUrl: "https://example.com/gauge.zip",
  priceLabel: "Free",
  source: "github-catalog",
  themeId: "gauge",
  title: "Gauge",
  usage: "live",
};
const install: ThemeInstallStatus = {
  logs: [],
  phase: "installing",
  startedAt: "10:00:00",
  themeId: "gauge",
  title: "Gauge",
};

function list(installStatus?: ThemeInstallStatus, busyAction: string | null = null, selectedThemeId = "") {
  return (
    <ThemeLibraryScreen
      busyAction={busyAction}
      companionStatus="online"
      device={{ connected: true, paired: true, ready: true }}
      installStatus={installStatus}
      onInstallCustomTheme={async () => false}
      onInstallTheme={vi.fn()}
      onSelectTheme={vi.fn()}
      selectedThemeId={selectedThemeId}
      storefrontConfigured={false}
      themeInstallEnabled
      themes={[theme]}
      usage="live"
    />
  );
}

afterEach(cleanup);

// Paul's review of 7198: the card never changes its height. A running install
// is the card's own Install button turned into "Installing" with a spinner;
// nothing is added to the card, and nothing is left behind when it ends.
it("turns the Install button into Installing with a spinner and adds nothing to the card", () => {
  const view = render(list());
  const row = () => document.getElementById("catalog-theme-gauge")!;
  const idleButton = within(row()).getByRole("button", { name: "Install" });
  const idleParts = row().children.length;

  view.rerender(list(install));
  const busy = within(row()).getByRole("button", { name: "Installing" }) as HTMLButtonElement;
  expect(busy.disabled).toBe(true);
  expect(busy.querySelector('[data-slot="spinner"]')).not.toBeNull();
  // Same slot, same width as the Install button, same look.
  expect(busy.className).toContain("min-w-[104px]");
  expect(idleButton.className).toContain("min-w-[104px]");
  expect(busy.className).not.toContain("ghost");
  // No pill, no overlay, no steps, no progress bar, no notice.
  expect(row().querySelector('[data-testid="theme-status-pill"]')).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(row().querySelector('[role="progressbar"], [role="status"], [data-slot="process-steps"]')).toBeNull();
  expect(document.body.textContent).not.toContain("> ");
  // The card has the same parts as before.
  expect(row().children.length).toBe(idleParts);

  view.rerender(list());
  expect(within(row()).getByRole("button", { name: "Install" })).toBeTruthy();
});

it("leaves only the Active pill when the install is done", () => {
  const view = render(list(install, null, "gauge"));
  expect(screen.getByRole("button", { name: "Installing" })).toBeTruthy();

  // (The app still reads VibeTV's settings for a moment after the install.)
  view.rerender(list({ ...install, phase: "complete", message: "Theme is active on VibeTV." }, "install", "gauge"));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByRole("button", { name: "Installing" })).toBeNull();
  expect(document.body.textContent).not.toContain("Theme is active on VibeTV.");
  const pill = screen.getByTestId("theme-status-pill");
  expect(pill.textContent).toBe("Active");
  // Lime with black text, bigger than the old 12 px pill; Installed is neutral.
  expect(pill.className).toContain("bg-primary");
  expect(pill.className).toContain("text-black");
  expect(pill.className).toContain("text-[14px]");
});

it("shows no notice for a finished install found when the list opens", () => {
  render(list({ ...install, phase: "complete" }));

  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.body.textContent).not.toContain("Installed");
});

// Seen in the Windows app (#579): the notice already read "Installed" while
// the row's button said "Wait" for about two seconds, because the app reads
// VibeTV's settings after an install and the button followed that read.
it("shows the row as installed as soon as its install is complete", () => {
  const view = render(list(install, "install", "gauge"));
  expect(screen.getByRole("button", { name: "Installing" })).toBeTruthy();
  expect(screen.queryByTestId("theme-status-pill")).toBeNull();

  for (const busyAction of ["install", "settings"]) {
    view.rerender(list({ ...install, phase: "complete" }, busyAction, "gauge"));
    expect(screen.queryByRole("dialog")).toBeNull();
    // "Installed" is the pill on the picture now, not a button.
    expect(screen.queryByRole("button", { name: "Installed" })).toBeNull();
    // (This row is the one the customer picked, so its pill says Active.)
    expect(screen.getByTestId("theme-status-pill").textContent).toBe("Active");
    expect(screen.queryByRole("button", { name: "Wait" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Installing" })).toBeNull();
  }
});
