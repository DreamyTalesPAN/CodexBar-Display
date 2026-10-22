import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ControlCenterBrand } from "./control-center-brand";

describe("ControlCenterBrand hero on light pages", () => {
  // Paul, 19.10.: lime TV everywhere, as in the calm master (overrules #710).
  it("sets the TV of the wordmark in lime, also on light pages", () => {
    const html = renderToStaticMarkup(<ControlCenterBrand variant="hero" />);

    expect(html).toContain('<span class="text-primary">TV</span>');
    expect(html).not.toContain("vibetv-support");
  });
});
