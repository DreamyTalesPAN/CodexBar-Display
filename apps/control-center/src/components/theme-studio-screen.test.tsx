// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function renderStudio(
  source: "blank" | "custom",
  props: Partial<ComponentProps<typeof ThemeStudioScreen>> = {},
) {
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
        {...props}
      />
    </TooltipProvider>,
  );
}
const button = (name: string) =>
  screen.getByRole("button", { name }) as HTMLButtonElement;

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

// Issue #551: the JSON tab kept a copy of the theme that only an edit renewed.
it("shows the theme as it is in the JSON tab after Save renamed its id and after Undo", async () => {
  renderStudio("blank", {
    // The library gives a theme whose id is taken a free one.
    onSaveToLibrary: async payload => ({
      document: {
        assets: payload.assets, packName: payload.packName,
        spec: { ...payload.spec, themeId: "my-theme-2" },
      },
      libraryId: "my-theme-2", savedAt: "2026-10-08T00:00:00Z",
    }),
  });
  fireEvent.click(button("Advanced"));
  fireEvent.mouseDown(screen.getByRole("tab", { name: "JSON" }));
  const json = () => screen.getByLabelText("Theme JSON") as HTMLTextAreaElement;
  expect(json().value).toContain('"id": "my-theme"');

  fireEvent.click(button("Save theme"));
  await waitFor(() => expect(json().value).toContain('"id": "my-theme-2"'));

  fireEvent.click(screen.getAllByRole("button", { name: "Text" })[0]);
  expect(json().value).toContain('"t": "tx"');
  fireEvent.click(button("Undo"));
  expect(json().value).not.toContain('"t": "tx"');

  // An emptied field stays empty, so new JSON can be pasted into it.
  fireEvent.change(json(), { target: { value: "" } });
  expect(json().value).toBe("");
  fireEvent.click(button("Reset JSON"));
  expect(json().value).toContain('"id": "my-theme-2"');
});

// Issue #551: the name could only be changed under Advanced › Project, so
// themes were saved as "New Theme".
it("lets the customer name the theme in the header, without opening Advanced", async () => {
  const saved: string[] = [];
  renderStudio("blank", {
    onSaveToLibrary: async payload => {
      saved.push(payload.packName);
      return {
        document: { assets: payload.assets, packName: payload.packName, spec: payload.spec },
        libraryId: payload.spec.themeId, savedAt: "2026-10-08T00:00:00Z",
      };
    },
  });

  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Retro Clock" } });
  fireEvent.click(button("Save theme"));
  await waitFor(() => expect(saved).toEqual(["Retro Clock"]));

  // The field moved; Advanced › Project no longer holds a second one.
  fireEvent.click(button("Advanced"));
  expect(screen.getAllByLabelText("Name")).toHaveLength(1);
  expect(screen.getByLabelText("ID")).toBeTruthy();
});

// Issue #551: a greyed-out Send to VibeTV gave no reason.
it("says why Send to VibeTV is unavailable, and stops once it is available", async () => {
  renderStudio("blank");
  const reason = "Save this theme before sending it to VibeTV.";
  expect(button("Send to VibeTV").disabled).toBe(false);
  expect(screen.queryByText(reason)).toBeNull();

  fireEvent.click(screen.getAllByRole("button", { name: "Text" })[0]);
  expect(button("Send to VibeTV").disabled).toBe(true);
  expect(screen.getByText(reason)).toBeTruthy();

  fireEvent.click(button("Save theme"));
  await waitFor(() => expect(button("Send to VibeTV").disabled).toBe(false));
  expect(screen.queryByText(reason)).toBeNull();
});

it("names a failed check instead of asking to save while Save is unavailable too", () => {
  renderStudio("blank");
  fireEvent.click(button("Advanced"));
  fireEvent.change(screen.getByLabelText("ID"), { target: { value: "x" } });

  expect(button("Send to VibeTV").disabled).toBe(true);
  expect(button("Save theme").disabled).toBe(true);
  // Once above the buttons, once in the Inspector's Validation box.
  expect(screen.getAllByText("Theme ID must be lowercase and 3-64 characters.")).toHaveLength(2);
  expect(screen.queryByText("Save this theme before sending it to VibeTV.")).toBeNull();
});

it("names the VibeTV's own limit when that is what keeps Send unavailable", () => {
  renderStudio("custom", { deviceCapabilities: { supportsStoredThemes: false } });
  expect(button("Send to VibeTV").disabled).toBe(true);
  expect(button("Save theme").disabled).toBe(false);
  expect(screen.getByText("This VibeTV does not support stored themes.")).toBeTruthy();
});

// Issue #551: Export ZIP did not say where the file went. Windows saves a
// download without asking (see #545); the Mac asks where and can be cancelled.
it.each([
  [true, "Saved as vibetv-theme-my-theme.zip in your Downloads folder. Nothing was sent."],
  [false, "vibetv-theme-my-theme.zip exported. Nothing was sent."],
])("says after Export ZIP where the file is when the app saved it itself (windows=%s)", (windowsHost, message) => {
  // jsdom has neither blob URLs nor downloads.
  URL.createObjectURL = () => "blob:theme";
  URL.revokeObjectURL = () => {};
  const download = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  renderStudio("custom", { windowsHost });

  fireEvent.click(button("Export ZIP"));

  expect(download).toHaveBeenCalledTimes(1);
  expect(screen.getByText(message)).toBeTruthy();
});
