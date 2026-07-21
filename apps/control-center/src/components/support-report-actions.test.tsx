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
      <SupportReportActions emphasis="secondary" onCreate={vi.fn()} />,
    );

    expect(html).toContain('data-variant="secondary"');
  });
});
