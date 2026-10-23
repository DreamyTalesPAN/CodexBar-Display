import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SetupLog, type SetupLogLine } from "./setup-log";

const lines: SetupLogLine[] = [
  { id: "a", text: "connecting to 192.168.178.153" },
  { id: "b", text: "connected · VibeTV 5804508" },
];

describe("SetupLog", () => {
  it("is as tall as its lines and grows to five before it scrolls", () => {
    const empty = renderToStaticMarkup(<SetupLog lines={[]} />);

    expect(empty).toContain("max-h-[120px]");
    expect(empty).not.toContain("h-[118px]");
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

  it("hides the scrollbar and fades the top edge only once lines are out of view", () => {
    const html = renderToStaticMarkup(<SetupLog lines={lines} />);

    expect(html).toContain("[scrollbar-width:none]");
    expect(html).toContain("overflow-y-auto");
    expect(html).not.toContain("mask-image");

    const long = Array.from({ length: 6 }, (_, index) => ({
      id: String(index),
      text: `line ${index}`,
    }));
    expect(renderToStaticMarkup(<SetupLog lines={long} />)).toContain("mask-image");
  });

  it("fades a new line in", () => {
    expect(renderToStaticMarkup(<SetupLog lines={lines} />)).toContain(
      "fade-in",
    );
  });

  it("dims every line above the newest, and never the error", () => {
    const html = renderToStaticMarkup(
      <SetupLog
        lines={[...lines, { id: "c", text: "error: update did not finish", tone: "error" }]}
      />,
    );

    expect(html.match(/opacity-55/g)).toHaveLength(2);
    expect(html).not.toContain("vibetv-caret-blink");
  });

  it("never holds back its announcements with aria-busy", () => {
    expect(renderToStaticMarkup(<SetupLog lines={lines} />)).not.toContain(
      "aria-busy",
    );
    expect(renderToStaticMarkup(<SetupLog lines={lines} running />)).not.toContain(
      "aria-busy",
    );
  });
});
