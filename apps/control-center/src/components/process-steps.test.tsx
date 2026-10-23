import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProcessSteps, type ProcessStep } from "./process-steps";

const steps: ProcessStep[] = [
  { id: "a", text: "Preparing theme install.", tone: "done" },
  { id: "b", text: "Uploading theme files." },
];

describe("ProcessSteps", () => {
  it("writes each step as a '> text' line in the setup-log type", () => {
    const html = renderToStaticMarkup(<ProcessSteps steps={steps} />);

    expect(html).toContain("&gt; Preparing theme install.");
    expect(html).toContain("&gt; Uploading theme files.");
    expect(html).toContain("font-mono");
    expect(html).toContain("text-[13px]");
    expect(html).toContain("leading-6");
  });

  it("fades each step in with the setup reveal", () => {
    const html = renderToStaticMarkup(<ProcessSteps steps={steps} />);

    expect(html.match(/fade-in/g)).toHaveLength(2);
    expect(html).toContain("animate-in");
  });

  it("list shows every step and mutes the finished ones", () => {
    const html = renderToStaticMarkup(<ProcessSteps steps={steps} variant="list" />);

    expect(html).toContain("&gt; Preparing theme install.");
    expect(html).toContain("&gt; Uploading theme files.");
    expect(html).toContain("opacity-55");
    expect(html.match(/text-muted-foreground/g)).toHaveLength(2);
    expect(html).toContain('data-variant="list"');
  });

  it("single shows only the current, last step", () => {
    const html = renderToStaticMarkup(<ProcessSteps steps={steps} variant="single" />);

    expect(html).not.toContain("Preparing theme install.");
    expect(html).toContain("&gt; Uploading theme files.");
    expect(html).not.toContain("opacity-55");
    expect(html).toContain('data-variant="single"');
  });

  it("is list by default", () => {
    expect(renderToStaticMarkup(<ProcessSteps steps={steps} />)).toContain(
      "&gt; Preparing theme install.",
    );
  });

  it("marks failures destructive", () => {
    const html = renderToStaticMarkup(
      <ProcessSteps steps={[{ id: "x", text: "Update did not finish.", tone: "error" }]} />,
    );

    expect(html).toContain("text-destructive");
    expect(html).not.toContain("text-muted-foreground");
  });

  it("draws no cursor block, in either variant", () => {
    for (const variant of ["list", "single"] as const) {
      const html = renderToStaticMarkup(<ProcessSteps steps={steps} variant={variant} />);

      expect(html).not.toContain("vibetv-caret-blink");
      expect(html).not.toContain("bg-foreground");
    }
  });
});
