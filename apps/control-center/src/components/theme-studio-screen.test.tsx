// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  createBlankThemeSpec,
  THEME_STUDIO_DRAFT_STORAGE_KEY,
} from "@/lib/theme-studio";
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

// Seen on the Windows app on 2026-10-07: emptying the name raised a red Library
// notice about the recovery copy, and typing a name again did not remove it.
it("takes an emptied name without a notice and still keeps the recovery copy", async () => {
  window.localStorage.clear();
  renderStudio("blank");
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "" } });

  // The copy is stored under the name Save would give the theme.
  await waitFor(() =>
    expect(
      JSON.parse(window.localStorage.getItem(THEME_STUDIO_DRAFT_STORAGE_KEY) || "{}")
        .recovery?.document.packName,
    ).toBe("My Theme"),
  );
  expect(screen.queryByRole("alert")).toBeNull();
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
});

it("drops the notice of a recovery copy that was not written once a later one is", async () => {
  window.localStorage.clear();
  const failed = "Theme data could not be saved to this browser.";
  vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
    throw new Error("storage failed");
  });
  renderStudio("blank");

  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "First" } });
  expect(await screen.findByText(failed)).toBeTruthy();

  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Second" } });
  await waitFor(() => expect(screen.queryByText(failed)).toBeNull());
});

// Issue #551: a greyed-out Send to VibeTV gave no reason.
it("says why Send to VibeTV is unavailable, and stops once it is available", async () => {
  renderStudio("custom");
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

// Seen on the Windows app on 2026-10-07: a new theme was sent before it was
// ever saved. VibeTV then showed a theme that no list in the app contained.
it.each([
  ["live", "Save theme", "Save this theme before sending it to VibeTV."],
  ["screensaver", "Save screensaver", "Save this screensaver before sending it to VibeTV."],
] as const)("keeps Send to VibeTV unavailable until a new %s theme is saved", async (usage, save, reason) => {
  renderStudio("blank", {
    initialTheme: {
      assets: {}, packName: "New", source: "blank", spec: createBlankThemeSpec(), usage,
    },
  });
  expect(screen.getByText("Draft")).toBeTruthy();
  expect(button("Send to VibeTV").disabled).toBe(true);
  expect(screen.getByText(reason)).toBeTruthy();

  fireEvent.click(button(save));
  await waitFor(() => expect(button("Send to VibeTV").disabled).toBe(false));
  expect(screen.queryByText(reason)).toBeNull();
});

// Issue #558: Screensaver Studio's button read "Save theme".
it.each([
  ["live", "Save theme", "Theme could not be saved."],
  ["screensaver", "Save screensaver", "Screensaver could not be saved."],
] as const)("names what Save saves, also when it fails (%s)", async (usage, save, failed) => {
  renderStudio("blank", {
    initialTheme: {
      assets: {}, packName: "New", source: "blank", spec: createBlankThemeSpec(), usage,
    },
    onSaveToLibrary: () => Promise.reject("storage failed"),
  });
  expect(screen.getAllByRole("button", { name: /^Save / })).toHaveLength(1);

  fireEvent.click(button(save));
  expect(await screen.findByText(failed)).toBeTruthy();
});

// Issue #558: "Sending theme after your click." and "Theme installed through
// the app." were the app's own words, not the customer's.
it.each([
  ["live", "Sending the theme to VibeTV.", "Theme is installed on VibeTV."],
  ["screensaver", "Sending the screensaver to VibeTV.", "Screensaver is ready on VibeTV."],
] as const)("says in plain words that it sends and that VibeTV has the %s", async (usage, sending, done) => {
  let finish = (_installed: boolean) => {};
  renderStudio("custom", {
    initialTheme: {
      assets: {}, packName: "Mine", source: "custom", spec: createBlankThemeSpec(), usage,
    },
    onInstallTheme: () => new Promise<boolean>(resolve => { finish = resolve; }),
  });

  fireEvent.click(button("Send to VibeTV"));
  expect(await screen.findByText(sending)).toBeTruthy();
  finish(true);
  expect(await screen.findByText(done)).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/after your click|through the/);
});

// Issue #558: Screensaver Studio said "theme" under Advanced.
it.each([
  ["live", "Import theme JSON", "Theme JSON"],
  ["screensaver", "Import screensaver JSON", "Screensaver JSON"],
] as const)("names what Advanced imports and edits (%s)", (usage, importJson, json) => {
  renderStudio("custom", {
    initialTheme: {
      assets: {}, packName: "Mine", source: "custom", spec: createBlankThemeSpec(), usage,
    },
  });
  fireEvent.click(button("Advanced"));
  expect(button(importJson)).toBeTruthy();
  fireEvent.mouseDown(screen.getByRole("tab", { name: "JSON" }));
  expect(screen.getByLabelText(json)).toBeTruthy();
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

// While the library cannot be written, Save is unavailable as well.
it("names why the theme cannot be saved instead of asking to save it", () => {
  const locked = "Saved themes contain invalid data. The original data was left unchanged.";
  renderStudio("blank", { saveBlockedReason: locked });

  expect(button("Send to VibeTV").disabled).toBe(true);
  expect(button("Save theme").disabled).toBe(true);
  // Once above the buttons, once as the Library notice.
  expect(screen.getAllByText(locked)).toHaveLength(2);
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
// Windows gets no file name: it saves a second export as "… (1).zip".
// Seen on the Mac app on 2026-10-09: "… exported." stood while the save dialog
// was still open and after Cancel. The app does not learn how that dialog
// ended, so the Mac sentence claims no saved file.
// Found in review: a pre-DMG install still opens this page in a plain browser,
// which saves without asking or asks, as it is set; the Mac sentence about a
// save dialog is said in the Mac app only.
it.each([
  [true, true, "Saved in your Downloads folder. Nothing was sent."],
  [false, true, "Choose where to save vibetv-theme-new-theme.zip. Nothing was sent."],
  [false, false, "Export started in your browser: vibetv-theme-new-theme.zip. Nothing was sent."],
])("says after Export ZIP where the file is when the app saved it itself (windows=%s, app=%s)", (windowsHost, nativeApp, message) => {
  if (nativeApp) {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("VibeTVControlCenter/1.0");
  }
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

// Issue #551: the notices sat under the Inspector's fields, below the fold
// for an element with many fields.
it("shows what Save, Export and Send answered above the Inspector's fields", async () => {
  renderStudio("blank");
  fireEvent.click(button("Save theme"));
  const notice = await screen.findByText("Saved to library.");
  expect(
    notice.compareDocumentPosition(screen.getByText("Inspector")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

// The Inspector box is hidden in a window narrower than 1024 px; the Windows
// app can be 960 px wide. The notices must not be hidden with it.
it("keeps those notices outside the box a narrow window hides", async () => {
  renderStudio("blank");
  fireEvent.click(button("Save theme"));
  const notice = await screen.findByText("Saved to library.");
  expect(screen.getByText("Inspector").closest("aside")!.className).toContain("hidden");
  expect(notice.closest("aside")).toBeNull();
});

// Seen on the Windows app on 2026-10-07: "Saved to library." stayed above the
// Inspector after the next change, beside the badge "Unsaved changes".
it("takes Saved to library away with the next change, Undo included", async () => {
  renderStudio("blank");
  const addText = () => fireEvent.click(screen.getAllByRole("button", { name: "Text" })[0]);
  fireEvent.click(button("Save theme"));
  await screen.findByText("Saved to library.");

  addText();
  expect(screen.getByText("Unsaved changes")).toBeTruthy();
  expect(screen.queryByText("Saved to library.")).toBeNull();

  fireEvent.click(button("Save theme"));
  await screen.findByText("Saved to library.");
  fireEvent.click(button("Undo"));
  expect(screen.queryByText("Saved to library.")).toBeNull();
});

// Also seen there: "Export … Nothing was sent." stood beside "Theme installed".
it("shows one answer at a time for Save, Export and Send, errors included", async () => {
  URL.createObjectURL = () => "blob:theme";
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const saved = "Saved to library.";
  const exported = "Export started in your browser: vibetv-theme-new-theme.zip. Nothing was sent.";
  const sendFailed = "Theme install needs attention. Check the install status.";
  const shown = () => [saved, exported, sendFailed].filter(text => screen.queryByText(text));
  renderStudio("blank", { onInstallTheme: async () => false });

  fireEvent.click(button("Save theme"));
  await waitFor(() => expect(shown()).toEqual([saved]));
  fireEvent.click(button("Export ZIP"));
  expect(shown()).toEqual([exported]);
  fireEvent.click(button("Send to VibeTV"));
  await waitFor(() => expect(shown()).toEqual([sendFailed]));
  fireEvent.click(button("Save theme"));
  await waitFor(() => expect(shown()).toEqual([saved]));
});

// Why nothing can be saved is not an answer to a click and stays.
it("keeps saying why saving is locked after a change and after Export", () => {
  URL.createObjectURL = () => "blob:theme";
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const locked = "Saved themes contain invalid data. The original data was left unchanged.";
  renderStudio("custom", { saveBlockedReason: locked });
  expect(screen.getAllByText(locked)).toHaveLength(1);

  fireEvent.click(button("Export ZIP"));
  expect(screen.getAllByText(locked)).toHaveLength(1);
  fireEvent.click(screen.getAllByRole("button", { name: "Text" })[0]);
  // Now the line above the buttons names it too.
  expect(screen.getAllByText(locked)).toHaveLength(2);
});

// Issue #558: "Mini theme" took the draft's place, name and id included,
// without a question.
it("asks before Mini theme or an opened file replaces a draft with changes", async () => {
  const fetchMock = vi.fn(async () => new Response("{}", { status: 404 }));
  vi.stubGlobal("fetch", fetchMock);
  renderStudio("blank");
  fireEvent.click(button("Advanced"));

  fireEvent.click(screen.getAllByRole("button", { name: "Text" })[0]);
  fireEvent.click(button("Mini theme"));
  expect(screen.getByRole("alertdialog", { name: "Replace your changes?" })).toBeTruthy();
  fireEvent.click(button("Keep editing"));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();

  fireEvent.click(button("Import theme JSON"));
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  fireEvent.click(button("Keep editing"));

  fireEvent.click(button("Mini theme"));
  fireEvent.click(button("Replace"));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

// JSON typed under Advanced › JSON and not applied is a change too: what is
// opened would throw it away, and Undo does not bring it back.
it("asks before Mini theme replaces JSON that was typed and not applied", async () => {
  const fetchMock = vi.fn(async () => new Response("{}", { status: 404 }));
  vi.stubGlobal("fetch", fetchMock);
  renderStudio("blank");
  fireEvent.click(button("Advanced"));
  fireEvent.mouseDown(screen.getByRole("tab", { name: "JSON" }));
  const json = screen.getByLabelText("Theme JSON") as HTMLTextAreaElement;
  const unchanged = json.value;

  // Typed text that is the theme as it is: nothing would be lost.
  fireEvent.change(json, { target: { value: unchanged } });
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Project" }));
  fireEvent.click(button("Mini theme"));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

  fireEvent.mouseDown(screen.getByRole("tab", { name: "JSON" }));
  fireEvent.change(screen.getByLabelText("Theme JSON"), { target: { value: `${unchanged} ` } });
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Project" }));
  fireEvent.click(button("Mini theme"));
  expect(screen.getByRole("alertdialog", { name: "Replace your changes?" })).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("opens Mini theme at once in a draft without changes", async () => {
  const fetchMock = vi.fn(async () => new Response("{}", { status: 404 }));
  vi.stubGlobal("fetch", fetchMock);
  renderStudio("blank");
  fireEvent.click(button("Advanced"));
  fireEvent.click(button("Mini theme"));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
});

// Seen on the Windows app on 2026-10-09: with Show screensaver off the list
// would not install a screensaver, and Screensaver Studio sent one anyway.
it("does not send while the library says why nothing can be installed", () => {
  const reason = "Turn on Show screensaver first.";
  renderStudio("custom", { installBlockedReason: reason });
  expect(button("Send to VibeTV").disabled).toBe(true);
  expect(screen.getByText(reason)).toBeTruthy();
});

// Seen on the Windows app on 2026-10-09: Apply JSON answered with the
// parser's own sentence, "Unexpected token 'Q', ... is not valid JSON".
it("says in one plain sentence that typed or imported JSON is not valid, and keeps the text", async () => {
  renderStudio("blank");
  fireEvent.click(button("Advanced"));
  const file = new File(['{"p": [QA'], "broken.json", { type: "application/json" });
  fireEvent.change(document.querySelector('input[accept="application/json,.json"]')!, {
    target: { files: [file] },
  });
  fireEvent.mouseDown(screen.getByRole("tab", { name: "JSON" }));
  expect(await screen.findByText("This file is not valid JSON. Nothing was changed.")).toBeTruthy();

  const json = screen.getByLabelText("Theme JSON") as HTMLTextAreaElement;
  fireEvent.change(json, { target: { value: '{"p": [QA-TYPED' } });
  fireEvent.click(button("Apply JSON"));
  expect(screen.getByText("This text is not valid JSON. Nothing was changed.")).toBeTruthy();
  expect(screen.queryByText(/Unexpected token/)).toBeNull();
  expect(json.value).toBe('{"p": [QA-TYPED');
});

// Seen on the Windows app on 2026-10-09: a second Export ZIP left the same
// sentence standing, so nothing showed that it had saved another file.
it("says on Windows that a repeated Export ZIP saved again", () => {
  URL.createObjectURL = () => "blob:theme";
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  renderStudio("custom", { windowsHost: true });

  fireEvent.click(button("Export ZIP"));
  expect(screen.getByText("Saved in your Downloads folder. Nothing was sent.")).toBeTruthy();
  fireEvent.click(button("Export ZIP"));
  expect(screen.getByText("Saved again in your Downloads folder (export 2). Nothing was sent.")).toBeTruthy();
  fireEvent.click(button("Export ZIP"));
  expect(screen.getByText("Saved again in your Downloads folder (export 3). Nothing was sent.")).toBeTruthy();

  // Found in review: the count is of one file. Under another name the theme
  // is saved as another file, and that one for the first time.
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Renamed" } });
  fireEvent.click(button("Export ZIP"));
  expect(screen.getByText("Saved in your Downloads folder. Nothing was sent.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New Theme" } });
  fireEvent.click(button("Export ZIP"));
  expect(screen.getByText("Saved again in your Downloads folder (export 4). Nothing was sent.")).toBeTruthy();
});

// Seen on the Mac app on 2026-10-09: "Import screensaver JSON" does not fit
// the left panel in one line, and a button's label does not wrap by itself,
// so the whole panel grew wider and was cut off on the right. jsdom lays
// nothing out: this checks the classes that let the label wrap, not a picture.
it("lets the long labels under Advanced › Project wrap inside the panel", () => {
  renderStudio("custom", {
    initialTheme: {
      assets: {}, packName: "S", source: "custom", spec: createBlankThemeSpec(), usage: "screensaver",
    },
  });
  fireEvent.click(button("Advanced"));
  for (const name of ["Import screensaver JSON", "Mini theme"]) {
    const classes = button(name).className.split(" ");
    expect(classes).toEqual(expect.arrayContaining(["h-auto", "whitespace-normal", "w-full"]));
  }
  expect(document.getElementById("theme-studio-panel-project")!.className.split(" ")).toContain("min-w-0");
  // And the list they sit in does not grow with what is in it.
  expect(
    document.getElementById("theme-studio-panel-project")!.closest('[data-slot="scroll-area"]')!.className,
  ).toContain("[&_[data-slot=scroll-area-viewport]>div]:block!");
});

// Seen on the Windows app on 2026-10-09: the import button is on Advanced ›
// Project, and what it answered stood on the JSON tab only. It also stayed
// there through three exports.
it("answers a file that could not be imported where Save, Export and Send answer, until the next answer", async () => {
  URL.createObjectURL = () => "blob:theme";
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const failed = "This file is not valid JSON. Nothing was changed.";
  renderStudio("custom");
  fireEvent.click(button("Advanced"));
  fireEvent.change(document.querySelector('input[accept="application/json,.json"]')!, {
    target: { files: [new File(['{"p": [QA'], "broken.json")] },
  });
  const notice = await screen.findByText(failed);
  expect(screen.getByRole("tab", { name: "Project" }).getAttribute("aria-selected")).toBe("true");
  expect(
    notice.compareDocumentPosition(screen.getByText("Inspector")) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();

  // A change to the theme takes it away, like what Save answered.
  fireEvent.click(screen.getAllByRole("button", { name: "Text" })[0]);
  expect(screen.queryByText(failed)).toBeNull();
  fireEvent.change(document.querySelector('input[accept="application/json,.json"]')!, {
    target: { files: [new File(["{"], "broken.json")] },
  });
  await screen.findByText(failed);
  fireEvent.click(button("Export ZIP"));
  expect(screen.queryByText(failed)).toBeNull();
  fireEvent.mouseDown(screen.getByRole("tab", { name: "JSON" }));
  expect(screen.queryByText(failed)).toBeNull();

  // What Apply JSON answered leaves with the next answer too.
  const rejected = "This text is not valid JSON. Nothing was changed.";
  fireEvent.change(screen.getByLabelText("Theme JSON"), { target: { value: "{" } });
  fireEvent.click(button("Apply JSON"));
  expect(screen.getByText(rejected)).toBeTruthy();
  fireEvent.click(button("Export ZIP"));
  expect(screen.queryByText(rejected)).toBeNull();
});

// Seen on the Windows app on 2026-10-09: after only the id was changed in the
// JSON text, Apply JSON renamed "New Theme" to a name made up from that id.
// The JSON holds no name, so it cannot change one.
it("keeps the theme's name when JSON is applied", () => {
  renderStudio("blank");
  fireEvent.click(button("Advanced"));
  fireEvent.mouseDown(screen.getByRole("tab", { name: "JSON" }));
  const json = screen.getByLabelText("Theme JSON") as HTMLTextAreaElement;
  fireEvent.change(json, { target: { value: json.value.replace('"my-theme"', '"myqa-theme-7"') } });
  fireEvent.click(button("Apply JSON"));
  expect(json.value).toContain('"id": "myqa-theme-7"');
  expect(screen.getByDisplayValue("New Theme")).toBeTruthy();
  expect(screen.queryByDisplayValue("Myqa Theme 7")).toBeNull();
});
