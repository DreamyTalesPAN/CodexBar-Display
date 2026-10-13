import { describe, expect, it } from "vitest";
import { friendlyElementName } from "./theme-studio-customer-labels";
import { AI_THEME_SCREENMASTER_ASSET_PATH } from "@/lib/ai-theme";

describe("Customer element names", () => {
  it("names both reset countdown windows without exposing template tokens", () => {
    for (const [slot, name] of [
      [1, "First usage reset"],
      [2, "Second usage reset"],
    ] as const) {
      expect(
        friendlyElementName(
          {
            type: "text",
            x: 0,
            y: 0,
            text: `Reset in {usageSlot${slot}Reset}`,
          },
          {},
        ),
      ).toBe(name);
    }
  });
  it("never exposes generated or imported filenames", () => {
    expect(
      friendlyElementName(
        {
          type: "sprite",
          x: 0,
          y: 0,
          assetPath: AI_THEME_SCREENMASTER_ASSET_PATH,
        },
        {},
      ),
    ).toBe("Background artwork");
    expect(
      friendlyElementName(
        { type: "sprite", x: 0, y: 0, assetPath: "/themes/u/private-file.cbi" },
        {},
      ),
    ).toBe("Image");
    expect(
      friendlyElementName(
        {
          type: "sprite",
          x: 0,
          y: 0,
          frameCount: 4,
          assetPath: "/themes/u/mystery.cba",
        },
        {},
      ),
    ).toBe("Animation");
  });
  it("explains dynamic readings instead of exposing tokens", () => {
    expect(
      friendlyElementName({ type: "text", x: 0, y: 0, text: "{session}%" }, {}),
    ).toBe("Session usage");
    expect(
      friendlyElementName({ type: "text", x: 0, y: 0, text: "{time}" }, {}),
    ).toBe("Clock");
    expect(
      friendlyElementName(
        { type: "text", x: 0, y: 0, binding: "someFutureReading" },
        {},
      ),
    ).toBe("Live reading");
    expect(
      friendlyElementName(
        { type: "progress", x: 0, y: 0, binding: "session" },
        {},
      ),
    ).toBe("Usage bar");
  });
  it("preserves customer text and names shapes by their purpose", () => {
    expect(
      friendlyElementName({ type: "text", x: 0, y: 0, text: "My monster" }, {}),
    ).toBe("My monster");
    expect(
      friendlyElementName({ type: "rect", x: 0, y: 0, color: "#123456" }, {}),
    ).toBe("Background shape");
  });
});
