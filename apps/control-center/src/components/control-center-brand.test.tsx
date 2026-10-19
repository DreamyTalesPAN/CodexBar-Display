import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ControlCenterBrand } from "./control-center-brand";

describe("ControlCenterBrand", () => {
  it("sets the TV of the hero wordmark in the lime brand token on every background", () => {
    const html = renderToStaticMarkup(<ControlCenterBrand variant="hero" />);

    expect(html).toContain('<span class="text-primary">TV</span>');
    expect(html).not.toContain("vibetv-support");
  });

  it("keeps the sidebar wordmark TV in the sidebar lime", () => {
    const html = renderToStaticMarkup(<ControlCenterBrand />);

    expect(html).toContain('<span class="text-sidebar-primary">TV</span>');
  });
});
