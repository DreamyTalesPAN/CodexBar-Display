// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadSupportReport } from "./support-report";
import { SupportReportActions } from "./support-report-actions";

vi.mock("./support-report", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./support-report")>()),
  downloadSupportReport: vi.fn(),
}));

afterEach(cleanup);

describe("SupportReportActions", () => {
  // Issue #545: Windows saves the report without any sign that it did.
  it("confirms a download on Windows with the file name and the folder", () => {
    const report = { ok: true, generatedAt: "2026-10-07T06:58:00.000Z" };
    const view = render(
      <SupportReportActions diagnostics={report} onCreate={vi.fn()} windowsHost />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    expect(downloadSupportReport).toHaveBeenCalledWith(report);
    expect(screen.getByRole("button", { name: "Downloaded" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(
      "Saved as vibetv-support-report-2026-10-07T06-58-00-000Z.json in your Downloads folder.",
    );

    // A report created afterwards has not been saved yet.
    view.rerender(
      <SupportReportActions
        diagnostics={{ ok: true, generatedAt: "2026-10-07T07:00:00.000Z" }}
        onCreate={vi.fn()}
        windowsHost
      />,
    );
    expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("leaves the confirmation to the save dialog on the Mac", () => {
    render(
      <SupportReportActions
        diagnostics={{ ok: true, generatedAt: "2026-10-07T06:58:00.000Z" }}
        onCreate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps support report creation primary by default", () => {
    const html = renderToStaticMarkup(
      <SupportReportActions onCreate={vi.fn()} />,
    );

    expect(html).toContain('data-variant="default"');
    expect(html).toContain("Create report");
  });

  it("allows the boot screen to lower report emphasis", () => {
    const html = renderToStaticMarkup(
      <SupportReportActions
        align="center"
        emphasis="secondary"
        onCreate={vi.fn()}
      />,
    );

    expect(html).toContain('data-variant="secondary"');
    expect(html).toContain("justify-items-center");
    expect(html).toContain("sm:justify-center");
  });

  it("allows setup recovery to name the support action explicitly", () => {
    const html = renderToStaticMarkup(
      <SupportReportActions
        createLabel="Create support report"
        onCreate={vi.fn()}
      />,
    );

    expect(html).toContain("Create support report");
  });

  it("only disables creation while a report itself is being created", () => {
    const available = renderToStaticMarkup(
      <SupportReportActions onCreate={vi.fn()} />,
    );
    const creating = renderToStaticMarkup(
      <SupportReportActions creating onCreate={vi.fn()} />,
    );

    expect(available).not.toContain('disabled=""');
    expect(creating).toContain('disabled=""');
    expect(creating).toContain("Creating report");
  });
});
