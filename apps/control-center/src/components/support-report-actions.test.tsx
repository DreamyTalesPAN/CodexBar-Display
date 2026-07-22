import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SupportReportActions } from "./support-report-actions";

describe("SupportReportActions", () => {
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
