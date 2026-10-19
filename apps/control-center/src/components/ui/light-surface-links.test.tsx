import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge } from "./badge";
import { EmptyDescription } from "./empty";
import { FieldDescription } from "./field";
import { ItemDescription } from "./item";

describe("links and link badges on light surfaces", () => {
  it("turns a link in a field description olive on hover, not lime", () => {
    const html = renderToStaticMarkup(<FieldDescription>Text</FieldDescription>);

    expect(html).toContain("text-[var(--vibetv-support)]");
    expect(html).not.toContain("text-primary");
  });

  it("turns a link in an item description olive on hover, not lime", () => {
    const html = renderToStaticMarkup(<ItemDescription>Text</ItemDescription>);

    expect(html).toContain("text-[var(--vibetv-support)]");
    expect(html).not.toContain("text-primary");
  });

  it("turns a link in an empty-state description olive on hover, not lime", () => {
    const html = renderToStaticMarkup(<EmptyDescription>Text</EmptyDescription>);

    expect(html).toContain("text-[var(--vibetv-support)]");
    expect(html).not.toContain("text-primary");
  });

  it("writes a link badge in olive, not lime", () => {
    const html = renderToStaticMarkup(<Badge variant="link">Open</Badge>);

    expect(html).toContain("text-[var(--vibetv-support)]");
    expect(html).not.toContain("text-primary");
  });
});
