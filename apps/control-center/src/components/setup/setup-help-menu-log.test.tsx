// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetupEventsContext } from "../setup-event-log";
import { SetupHelpMenu } from "./setup-help-menu";

afterEach(cleanup);

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
  });

  it("offers no setup log where the app cannot read one", () => {
    render(<SetupHelpMenu onCreateSupportReport={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.queryByRole("menuitemcheckbox")).toBeNull();
  });
});
