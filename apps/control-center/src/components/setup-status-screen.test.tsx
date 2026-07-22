import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SetupStatusScreen } from "./setup-status-screen";

describe("SetupStatusScreen", () => {
  it("uses one focused live status while loading", () => {
    const html = renderToStaticMarkup(
      <SetupStatusScreen
        busy
        description="Checking the Mac App."
        statusLabel="Checking the Mac App."
        title="Starting Control Center"
      />,
    );

    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('data-slot="spinner"');
    expect(html).toContain('data-slot="card"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('class="sr-only"');
  });
});
