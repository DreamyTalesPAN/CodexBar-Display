import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ControlCenterBrand } from "./control-center-brand";

describe("ControlCenterBrand hero on light pages", () => {
  it("sets the TV of the wordmark in the design-system olive, not lime", () => {
    const html = renderToStaticMarkup(<ControlCenterBrand variant="hero" />);

    expect(html).toContain('<span class="text-[var(--vibetv-support)]">TV</span>');
    expect(html).not.toContain("text-primary");
  });
});
