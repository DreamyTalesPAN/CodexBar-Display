import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Skeleton } from "./skeleton";

describe("Skeleton", () => {
  it("shimmers softly through the shared class instead of pulsing", () => {
    const html = renderToStaticMarkup(<Skeleton className="h-3 w-20" />);

    expect(html).toContain('data-slot="skeleton"');
    expect(html).toContain("vibetv-skeleton");
    expect(html).not.toContain("animate-pulse");
  });
});
