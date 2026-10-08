// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ThemeLibraryScreen, type ThemeLibraryScreenProps, type ThemeInstallStatus } from "./theme-library-screen";

vi.mock("./theme-render-preview", () => ({ ThemeRenderPreview: () => null }));
afterEach(cleanup);

function libraryProps(status: ThemeInstallStatus, retry = vi.fn()): ThemeLibraryScreenProps {
  return {
    themes: [{ id: "test-theme", themeId: "test-theme", title: "Test theme", isFree: true, priceLabel: "Free", packUrl: "https://example.com/theme.zip", packSha256: "a".repeat(64), packSizeBytes: 123, source: "github-catalog" }],
    selectedThemeId: "test-theme", companionStatus: "online", themeInstallEnabled: true, busyAction: null,
    device: { connected: true, paired: true, ready: false, activeTheme: "test-theme", capabilities: { theme: { supportsThemeSpecV1: true } } },
    onInstallTheme: retry, onInstallCustomTheme: async () => false, onSelectTheme: vi.fn(), storefrontConfigured: false,
    installStatus: status,
  };
}

// Issue #583: the Companion says when VibeTV went back to the previous theme;
// the dialog shows that sentence with the advice, under the reason.
it("says in the failure dialog that the previous theme is back", () => {
  const failure = { code: "display_render_failed", message: "Theme installed, but VibeTV could not redraw the image.", nextAction: "Your previous theme is back on VibeTV. Keep VibeTV connected and try installing the theme again." };
  render(<ThemeLibraryScreen {...libraryProps({ phase: "error", themeId: "test-theme", title: "Test theme", startedAt: "10:00:00", logs: [], failure })} />);
  const dialog = screen.getByRole("dialog", { name: failure.message });
  expect(within(dialog).getByText(failure.nextAction)).toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "Try again" })).toBeTruthy();
});

it("keeps failed Cable rendering recoverable through a dismissible popup and theme retry", () => {
  const failure = { code: "display_render_failed", message: "Theme installed, but VibeTV could not redraw the image.", nextAction: "Keep VibeTV connected and try installing the theme again." };
  const status: ThemeInstallStatus = { phase: "error", themeId: "test-theme", title: "Test theme", startedAt: "10:00:00", logs: [], failure };
  const retry = vi.fn();
  const props = libraryProps(status, retry);
  const view = render(<ThemeLibraryScreen {...props} />);
  const dialog = screen.getByRole("dialog", { name: failure.message });
  expect(within(dialog).getByText(failure.nextAction)).toBeTruthy();
  expect(screen.queryByRole("progressbar")).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  view.rerender(<ThemeLibraryScreen {...props} installStatus={{ ...status }} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(retry.mock.calls[0][0].themeId).toBe("test-theme");
  view.rerender(<ThemeLibraryScreen {...props} installStatus={{ ...status, phase: "installing", startedAt: "10:00:01" }} />);
  view.rerender(<ThemeLibraryScreen {...props} installStatus={{ ...status, startedAt: "10:00:01" }} />);
  expect(screen.getByRole("dialog", { name: failure.message })).toBeTruthy();
});
