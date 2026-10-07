// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createBlankThemeSpec } from "@/lib/theme-studio";
import { ThemeStudioScreen } from "./theme-studio-screen";

// jsdom has no matchMedia; the preview asks it about reduced motion.
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderStudio(source: "blank" | "custom") {
  render(
    <TooltipProvider>
      <ThemeStudioScreen
        initialTheme={{
          assets: {}, packName: "New Theme", source, spec: createBlankThemeSpec(),
        }}
        onSaveToLibrary={async payload => ({
          document: { assets: payload.assets, packName: payload.packName, spec: payload.spec },
          libraryId: payload.spec.themeId, savedAt: "2026-10-08T00:00:00Z",
        })}
      />
    </TooltipProvider>,
  );
}

it("calls a new theme a draft until it is saved, and counts one element", async () => {
  renderStudio("blank");
  expect(screen.getByText("1 element")).toBeTruthy();
  expect(screen.getByText("Draft")).toBeTruthy();
  expect(screen.queryByText("Saved")).toBeNull();

  fireEvent.click(screen.getAllByRole("button", { name: "Text" })[0]);
  expect(screen.getByText("2 elements")).toBeTruthy();
  expect(screen.getByText("Unsaved changes")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Save theme" }));
  expect(await screen.findByText("Saved")).toBeTruthy();
});

it("calls a theme opened from the library saved", () => {
  renderStudio("custom");
  expect(screen.getByText("Saved")).toBeTruthy();
});
