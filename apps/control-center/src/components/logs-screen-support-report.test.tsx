// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { SupportDiagnostics } from "./control-center-types";
import { LogsScreen } from "./logs-screen";

afterEach(cleanup);

const report: SupportDiagnostics = {
  ok: true,
  generatedAt: "2026-10-18T06:00:00.000Z",
  checks: [],
};

// Run diagnostics and Create report collect the same snapshot, but only Create
// report puts a report on the Support report card.
it("keeps the Support report card on Create report after Run diagnostics", () => {
  const onRun = vi.fn();
  const view = render(
    <LogsScreen onCreateSupportReport={vi.fn()} onLoadDiagnostics={onRun} />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Run diagnostics" }));
  expect(onRun).toHaveBeenCalledTimes(1);

  // The app stores what Run diagnostics collected; the card must not follow.
  view.rerender(
    <LogsScreen
      diagnostics={report}
      onCreateSupportReport={vi.fn()}
      onLoadDiagnostics={onRun}
    />,
  );

  expect(screen.getByRole("button", { name: "Create report" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Create new" })).toBeNull();
});

it("shows Copy, Download and Create new once Create report made the report", () => {
  const onCreate = vi.fn();
  const view = render(
    <LogsScreen onCreateSupportReport={onCreate} onLoadDiagnostics={vi.fn()} />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Create report" }));
  expect(onCreate).toHaveBeenCalledTimes(1);

  view.rerender(
    <LogsScreen
      supportReport={report}
      onCreateSupportReport={onCreate}
      onLoadDiagnostics={vi.fn()}
    />,
  );

  expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Create new" })).toBeTruthy();
});

// Busy states do not cross: Run diagnostics does not show the card as creating,
// and creating a report does not show Run diagnostics as running. While one
// collects, the other button is disabled.
it("keeps the busy states of Run diagnostics and Create report apart", () => {
  const running = render(
    <LogsScreen
      diagnosticsRunning
      onCreateSupportReport={vi.fn()}
      onLoadDiagnostics={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Running diagnostics" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Creating report" })).toBeNull();
  expect(
    (screen.getByRole("button", { name: "Create report" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  running.unmount();

  render(
    <LogsScreen
      onCreateSupportReport={vi.fn()}
      onLoadDiagnostics={vi.fn()}
      supportReportBusy
    />,
  );
  expect(screen.getByRole("button", { name: "Creating report" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Running diagnostics" })).toBeNull();
  expect(
    (screen.getByRole("button", { name: "Run diagnostics" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
