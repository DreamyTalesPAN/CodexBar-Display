import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SetupLog, type SetupLogLine } from "./setup-log";

const lines: SetupLogLine[] = [
  { id: "a", text: "connecting to 192.168.178.153" },
  { id: "b", text: "connected · VibeTV 5804508" },
];

describe("SetupLog", () => {
  it("holds its space before the first line, so nothing moves later", () => {
    const empty = renderToStaticMarkup(<SetupLog lines={[]} />);

    expect(empty).toContain("h-[118px]");
    expect(empty).not.toContain("&gt;");
  });

  it("prefixes every line and keeps them muted", () => {
    const html = renderToStaticMarkup(<SetupLog lines={lines} />);

    expect(html).toContain("&gt; connecting to 192.168.178.153");
    expect(html).toContain("&gt; connected · VibeTV 5804508");
    expect(html.match(/text-muted-foreground/g)).toHaveLength(2);
    expect(html).not.toContain("text-destructive");
  });

  it("marks failures destructive without tinting the lines above", () => {
    const html = renderToStaticMarkup(
      <SetupLog
        lines={[...lines, { id: "c", text: "error: update did not finish", tone: "error" }]}
      />,
    );

    expect(html.match(/text-destructive/g)).toHaveLength(1);
    expect(html.match(/text-muted-foreground/g)).toHaveLength(2);
  });

  it("hides the scrollbar but keeps an edge fade so more content still reads", () => {
    const html = renderToStaticMarkup(<SetupLog lines={lines} />);

    expect(html).toContain("[scrollbar-width:none]");
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("mask-image");
  });

  it("fades a new line in", () => {
    expect(renderToStaticMarkup(<SetupLog lines={lines} />)).toContain(
      "fade-in",
    );
  });

  it("shows the caret only on the last line, and only while running", () => {
    expect(renderToStaticMarkup(<SetupLog lines={lines} />)).not.toContain(
      "vibetv-caret-blink",
    );

    const running = renderToStaticMarkup(<SetupLog lines={lines} running />);

    expect(running.match(/vibetv-caret-blink/g)).toHaveLength(1);
    expect(running.indexOf("vibetv-caret-blink")).toBeGreaterThan(
      running.indexOf("VibeTV 5804508"),
    );
  });
});
