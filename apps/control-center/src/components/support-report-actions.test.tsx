// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadSupportReport, supportReportFilename } from "./support-report";
import { SupportReportActions } from "./support-report-actions";

vi.mock("./support-report", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./support-report")>()),
  downloadSupportReport: vi.fn(),
}));

afterEach(cleanup);

describe("SupportReportActions", () => {
  // Issue #545: Windows saves the report without any sign that it did.
  it("confirms a download on Windows with the file name and the folder", () => {
    // 08:58 on this computer's clock, whatever its time zone.
    const report = { ok: true, generatedAt: new Date(2026, 9, 7, 8, 58).toISOString() };
    const view = render(
      <SupportReportActions diagnostics={report} onCreate={vi.fn()} windowsHost />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    expect(downloadSupportReport).toHaveBeenCalledWith(report);
    expect(screen.getByRole("button", { name: "Downloaded" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(
      "Saved as vibetv-support-report-2026-10-07T08-58-00-000.json in your Downloads folder.",
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

  // Issue #582: the Mac app says how its save dialog ended.
  it("confirms a download on the Mac once the Mac app says the report was saved", () => {
    render(
      <SupportReportActions
        diagnostics={{ ok: true, generatedAt: "2026-10-07T06:58:00.000Z" }}
        onCreate={vi.fn()}
      />,
    );
    const saveDialogEnded = (fileName: string, saved: boolean) =>
      act(() => {
        window.dispatchEvent(
          new CustomEvent("vibetv:download-finished", { detail: { fileName, saved } }),
        );
      });
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    // The file is named after this computer's own time (#579), whatever its zone.
    const reportFile = supportReportFilename("2026-10-07T06:58:00.000Z");

    saveDialogEnded(reportFile, false);
    saveDialogEnded("vibetv-theme-new-theme.zip", true);
    expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();

    saveDialogEnded(reportFile, true);
    expect(screen.getByRole("button", { name: "Downloaded" })).toBeTruthy();
    // The customer chose the folder, so the Downloads folder is not named.
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
