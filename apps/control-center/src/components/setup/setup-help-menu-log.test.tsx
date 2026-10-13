// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { SetupEventsContext } from "../setup-event-log";
import { SetupHelpMenu } from "./setup-help-menu";

vi.mock("../support-report", async (original) => ({
  ...(await original<typeof import("../support-report")>()),
  downloadSupportReport: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SetupHelpMenu setup log", () => {
  it("shows the setup log beside Create support report, also while empty", async () => {
    const load = vi.fn().mockResolvedValue({ sessionId: "s", startedAt: "", events: [], truncated: false, dropped: 0 });
    render(
      <SetupEventsContext.Provider value={load}>
        <SetupHelpMenu onCreateSupportReport={vi.fn().mockResolvedValue(null)} />
      </SetupEventsContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(load).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Show setup log" }));
    await act(async () => {});
    expect(load).toHaveBeenCalled();
    expect(screen.getByText("No setup activity recorded yet.")).toBeTruthy();
    const create = screen.getByRole("menuitem", { name: "Create support report" });
    expect(create.hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("menuitemcheckbox", { name: "Hide setup log" }).getAttribute("aria-checked")).toBe("true");
    await expectNoAxeViolations(document.body.innerHTML);
  });

  it("offers no setup log where the app cannot read one", () => {
    render(<SetupHelpMenu onCreateSupportReport={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.queryByRole("menuitemcheckbox")).toBeNull();
  });
});

// Issue #588: on the Mac the help menu read "Report saved" / "It is in your
// Downloads folder." while the save dialog was still open, and after Cancel.
describe("SetupHelpMenu support report", () => {
  const report = { ok: true, generatedAt: "2026-10-08T12:00:00Z" };
  const fileName = "vibetv-support-report-2026-10-08T12-00-00.json";
  const saveDialogEnded = (saved: boolean, name = fileName) =>
    act(() => {
      window.dispatchEvent(
        new CustomEvent("vibetv:download-finished", { detail: { fileName: name, saved } }),
      );
    });
  async function create(windowsHost = false) {
    vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(0);
    render(<SetupHelpMenu onCreateSupportReport={vi.fn().mockResolvedValue(report)} windowsHost={windowsHost} />);
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Create support report" }));
    await act(async () => {});
  }
  const macApp = () => vi.stubGlobal("navigator", { userAgent: "VibeTVControlCenter/1.0.60" });

  it("confirms a report in the Mac app only after its save dialog saved it", async () => {
    macApp();
    await create();
    // The dialog is open: nothing is saved yet. An older Mac app says no
    // more than this, so the sentence holds for a save and for Cancel.
    expect(screen.getByRole("status").textContent).toBe("Report createdChoose where to save the report.");

    await saveDialogEnded(true, "another-file.zip");
    expect(screen.getByRole("status").textContent).toContain("Report created");

    await saveDialogEnded(true);
    // The customer chose the folder, so none is named.
    expect(screen.getByRole("status").textContent).toBe("Report savedAttach it when you ask for help.");
  });

  it("shows nothing in the Mac app after Cancel", async () => {
    macApp();
    await create();
    await saveDialogEnded(false);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Create support report" })).toBeTruthy();
  });

  it("keeps the Downloads sentence on Windows, which saves without asking", async () => {
    vi.stubGlobal("navigator", { userAgent: "VibeTVControlCenter/1.0.60" });
    await create(true);
    expect(screen.getByRole("status").textContent).toBe(
      "Report savedIt is in your Downloads folder. Attach it when you ask for help.",
    );
  });
});

// Keyboard: the menu takes focus when it opens, the arrow keys move between its
// entries, and Escape gives focus back to Help.
describe("SetupHelpMenu keyboard", () => {
  function openMenu() {
    render(
      <SetupHelpMenu
        aiFixPrompt={() => "fix"}
        onCreateSupportReport={vi.fn().mockResolvedValue(null)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    return {
      ask: screen.getByRole("menuitem", { name: "Ask AI to fix" }),
      create: screen.getByRole("menuitem", { name: "Create support report" }),
    };
  }

  it("moves focus onto the first entry when the menu opens", () => {
    const { ask } = openMenu();
    expect(document.activeElement).toBe(ask);
  });

  it("moves between the entries with the arrow keys and wraps around", () => {
    const { ask, create } = openMenu();
    fireEvent.keyDown(ask, { key: "ArrowDown" });
    expect(document.activeElement).toBe(create);
    fireEvent.keyDown(create, { key: "ArrowDown" });
    expect(document.activeElement).toBe(ask);
    fireEvent.keyDown(ask, { key: "ArrowUp" });
    expect(document.activeElement).toBe(create);
  });

  it("jumps to the first and the last entry with Home and End", () => {
    const { ask, create } = openMenu();
    fireEvent.keyDown(ask, { key: "End" });
    expect(document.activeElement).toBe(create);
    fireEvent.keyDown(create, { key: "Home" });
    expect(document.activeElement).toBe(ask);
  });

  it("closes on Escape and gives focus back to Help", () => {
    const { ask } = openMenu();
    fireEvent.keyDown(ask, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Help" }));
  });
});
