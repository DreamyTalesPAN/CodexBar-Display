import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildFrameData,
  primitiveUsageSlotVisible,
  ThemeSpecPreview,
  themeTextLayout,
  themeTextWidth,
  themeSpecAriaLabel,
  type ThemePrimitive,
} from "./live-vibetv-preview";

const lane1: ThemePrimitive = { t: "r", x: 0, y: 0, w: 10, h: 10, sl: 1 };
const lane2: ThemePrimitive = { t: "r", x: 0, y: 0, w: 10, h: 10, sl: 2 };

describe("dynamic usage slot preview", () => {
  it.each([
    { count: 0, slots: [] },
    {
      count: 1,
      slots: [{ id: "weekly", label: "Weekly", percent: 42, resetSecs: 100 }],
    },
    {
      count: 2,
      slots: [
        { id: "weekly", label: "Weekly", percent: 42, resetSecs: 100 },
        { id: "spark", label: "Codex Spark Weekly", percent: 7, resetSecs: 200 },
      ],
    },
  ])("matches complete lane visibility for $count slots", ({ count, slots }) => {
    const frame = buildFrameData("2026-07-24T12:00:00Z", {
      v: 2,
      provider: "codex",
      label: "Codex",
      session: 42,
      weekly: 7,
      usageMode: "used",
      usageSlots: slots,
    });

    expect(primitiveUsageSlotVisible(lane1, frame)).toBe(count >= 1);
    expect(primitiveUsageSlotVisible(lane2, frame)).toBe(count >= 2);
    const ariaLabel = themeSpecAriaLabel("mini-classic", frame);
    expect(ariaLabel).toContain(
      count > 0
        ? `${slots[0]?.label} ${slots[0]?.percent}% used`
        : "no usage windows available",
    );
    if (count < 2) {
      expect(ariaLabel).not.toContain("Codex Spark Weekly");
    }
  });
});

describe("firmware-compatible ThemeSpec text layout", () => {
  it.each([
    {
      name: "keeps short right-aligned text at the right edge",
      textWidth: 48,
      maxWidth: 81,
      align: "right",
      expectedAnchor: "end",
      expectedX: 226,
      expectedClipWidth: 81,
    },
    {
      name: "clips an overlong provider-neutral label from the lane start",
      textWidth: 190,
      maxWidth: 81,
      align: "right",
      expectedAnchor: "start",
      expectedX: 145,
      expectedClipWidth: 81,
    },
    {
      name: "does not clip text without an explicit width",
      textWidth: 190,
      maxWidth: 0,
      align: "right",
      expectedAnchor: "start",
      expectedX: 145,
      expectedClipWidth: 0,
    },
  ])(
    "$name",
    ({
      textWidth,
      maxWidth,
      align,
      expectedAnchor,
      expectedX,
      expectedClipWidth,
    }) => {
      expect(themeTextLayout(145, maxWidth, align, textWidth)).toEqual({
        clipWidth: expectedClipWidth,
        textAnchor: expectedAnchor,
        textX: expectedX,
      });
    },
  );

  it("uses a measured Unicode width and ignores an invalid hidden-SVG measurement", () => {
    expect(themeTextWidth("月次 Nutzung", 16, 79.5)).toBe(79.5);
    expect(themeTextWidth("月次 Nutzung", 16, 0)).toBeGreaterThan(0);
    expect(themeTextLayout(20, 80, "center", 79.5)).toEqual({
      clipWidth: 80,
      textAnchor: "middle",
      textX: 60,
    });
    expect(themeTextLayout(20, 80, "center", 80.5)).toEqual({
      clipWidth: 80,
      textAnchor: "start",
      textX: 20,
    });
  });

  it("clips only text primitives with an explicit ThemeSpec width", () => {
    const markup = renderToStaticMarkup(
      createElement(ThemeSpecPreview, {
        animate: false,
        pack: {
          themeId: "provider-neutral",
          spec: {
            p: [
              {
                t: "tx",
                x: 145,
                y: 46,
                w: 81,
                al: "right",
                v: "Provider Enterprise Monthly",
                s: 1,
                f: 2,
              },
              {
                t: "tx",
                x: 10,
                y: 80,
                w: 100,
                al: "center",
                v: "Short",
                s: 1,
                f: 2,
              },
              {
                t: "tx",
                x: 10,
                y: 10,
                al: "right",
                v: "Unbounded",
                s: 1,
                f: 2,
              },
            ],
          },
        },
        status: "ready",
        themeId: "provider-neutral",
      }),
    );

    const clipPathIds = [...markup.matchAll(/<clipPath id="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(clipPathIds).toHaveLength(2);
    expect(new Set(clipPathIds).size).toBe(2);
    expect(markup).toMatch(
      /<clipPath id="([^"]+)"><rect height="20" width="81" x="145" y="46"><\/rect><\/clipPath>/,
    );
    expect(markup).toContain('clip-path="url(#theme-text-');
    expect(markup).toContain(
      'text-anchor="start" x="145" y="46">Provider Enterprise Monthly</text>',
    );
    expect(markup).toContain(
      'text-anchor="start" x="10" y="10">Unbounded</text>',
    );
  });
});
