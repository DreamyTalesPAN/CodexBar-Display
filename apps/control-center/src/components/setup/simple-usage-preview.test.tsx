import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { displayPreviewFor } from "./setup-display-previews";
import { SimpleUsagePreview } from "./simple-usage-preview";

describe("simple Settings usage previews", () => {
  it.each(["used", "remaining"] as const)("renders both choices from a %s snapshot", (usageMode) => {
    const preview = displayPreviewFor({ id: "codex", label: "Codex", session: 90, weekly: 0,
      usageMode, windows: [{ id: "session", label: "Session", usedPercent: usageMode === "used" ? 90 : 10 }],
    });
    const used = renderToStaticMarkup(<SimpleUsagePreview preview={preview} usageMode="used" />);
    const remaining = renderToStaticMarkup(<SimpleUsagePreview preview={preview} usageMode="remaining" />);
    expect(used).toContain('width:90%');
    expect(remaining).toContain('width:10%');
    expect(used).not.toContain("<svg");
  });

  it("keeps unavailable readings unavailable in Remaining", () => {
    const preview = displayPreviewFor({ id: "gemini", label: "Gemini", session: 0, weekly: 0,
      usageUnavailable: true, windows: [{ id: "weekly", label: "Weekly", usedPercent: 0 }],
    });
    const html = renderToStaticMarkup(<SimpleUsagePreview preview={preview} usageMode="remaining" />);
    expect(html).toContain("--");
    expect(html).not.toContain('width:100%');
  });
});
