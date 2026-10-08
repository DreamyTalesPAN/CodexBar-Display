// @vitest-environment jsdom
//
// Issue #579, seen in the Mac and Windows apps: Install on the last row of
// Appearance › Themes put its progress and its "Installed" notice below the
// edge of the window, where nothing showed that anything had happened.
import { cleanup, render, screen } from "@testing-library/react";
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

function list(installStatus?: ThemeInstallStatus) {
  return (
    <ThemeLibraryScreen
      busyAction={null}
      companionStatus="online"
      device={{ connected: true, paired: true, ready: true }}
      installStatus={installStatus}
      onInstallCustomTheme={async () => false}
      onInstallTheme={vi.fn()}
      onSelectTheme={vi.fn()}
      selectedThemeId=""
      storefrontConfigured={false}
      themeInstallEnabled
      themes={[theme]}
      usage="live"
    />
  );
}

afterEach(cleanup);

it("brings a row's install notice into view when the install starts and when it ends", () => {
  // jsdom has no scrollIntoView; the browser's moves the page only as far as
  // needed, and not at all for a notice that is in view.
  const scrolled: [Element, unknown][] = [];
  Element.prototype.scrollIntoView = function (this: Element, options?: unknown) {
    scrolled.push([this, options]);
  };
  const view = render(list());
  const preview = screen.getByRole("button", { name: "Preview Gauge" });
  preview.focus();

  view.rerender(list(install));
  expect(scrolled).toEqual([[screen.getByRole("status"), { block: "nearest" }]]);

  // A new line of the same install does not move the page again.
  view.rerender(list({ ...install, logs: ["Checking VibeTV."] }));
  expect(scrolled).toHaveLength(1);

  view.rerender(list({ ...install, phase: "complete" }));
  expect(scrolled).toHaveLength(2);
  expect(scrolled[1]).toEqual([screen.getByRole("status"), { block: "nearest" }]);
  expect(document.activeElement).toBe(preview);
});

it("leaves the page where it is when the list opens with a finished install", () => {
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  render(list({ ...install, phase: "complete" }));

  expect(screen.getByRole("status").textContent).toContain("Installed");
  expect(scrollIntoView).not.toHaveBeenCalled();
});
