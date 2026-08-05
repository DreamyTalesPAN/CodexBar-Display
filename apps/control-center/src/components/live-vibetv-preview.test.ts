import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  boundValue,
  buildFrameData,
  fetchThemeRenderPackRevision,
  hasRenderableUsage,
  LiveVibeTVPreview,
  liveThemePreviewMessage,
  livePreviewDisplayFrame,
  primitiveUsageSlotVisible,
  progressPercent,
  THEME_CATALOG_PREVIEW_FRAME,
  ThemeSpecPreview,
  themeFirmwareTextMetrics,
  themeTextFittedSize,
  themeTextLayout,
  themeTextWidth,
  themeSpecAriaLabel,
  themeRenderPackMatchesActiveRevision,
  type ThemePrimitive,
} from "./live-vibetv-preview";

const lane1: ThemePrimitive = { t: "r", x: 0, y: 0, w: 10, h: 10, sl: 1 };
const lane2: ThemePrimitive = { t: "r", x: 0, y: 0, w: 10, h: 10, sl: 2 };

describe("dynamic usage slot preview", () => {
  it("explains an external active theme without treating the VibeTV as disconnected", () => {
    expect(liveThemePreviewMessage("error")).toBe(
      "Theme active on VibeTV. Preview not stored on this Mac.",
    );
    expect(liveThemePreviewMessage("loading")).toBeUndefined();
  });

  it("keeps a prior valid frame for a selected reachable VibeTV while readiness waits", () => {
    const device = {
      active: true,
      connected: true,
      paired: true,
      ready: false,
      activeTheme: "synthwave",
      stream: {
        healthy: false,
        running: true,
      },
    };
    const displayFrame = {
      ok: true,
      frame: {
        v: 2,
        provider: "codex",
        label: "Codex",
        usageSlots: [{ id: "weekly", label: "Weekly", percent: 29 }],
      },
    };

    expect(livePreviewDisplayFrame(device, displayFrame)).toBe(displayFrame);

    const markup = renderToStaticMarkup(
      createElement(LiveVibeTVPreview, {
        device,
        displayFrame,
        usage: null,
      }),
    );

    expect(markup).toContain("Loading preview");
    expect(markup).not.toContain("Waiting for usage");
    expect(markup).not.toContain("Reconnect VibeTV to continue");
  });

  it("shows usage loading only when no renderable last frame exists", () => {
    const markup = renderToStaticMarkup(
      createElement(LiveVibeTVPreview, {
        device: {
          active: true,
          connected: true,
          paired: true,
          ready: false,
          stream: {
            healthy: false,
            running: true,
          },
        },
        displayFrame: null,
        usage: null,
      }),
    );

    expect(markup).toContain("Waiting for usage");
    expect(markup).not.toContain("Reconnect VibeTV to continue");
  });

  it("keeps a prior valid frame when a connected VibeTV is not display-ready but the stream is healthy", () => {
    const displayFrame = {
      ok: true,
      frame: {
        v: 2,
        provider: "codex",
        label: "Codex",
        usageSlots: [{ id: "weekly", label: "Weekly", percent: 29 }],
      },
    };
    const markup = renderToStaticMarkup(
      createElement(LiveVibeTVPreview, {
        device: {
          active: true,
          connected: true,
          paired: true,
          ready: false,
          activeTheme: "synthwave",
          stream: {
            healthy: true,
            running: true,
          },
        },
        displayFrame,
        usage: null,
      }),
    );

    expect(markup).toContain("Loading preview");
    expect(markup).not.toContain("Reconnect VibeTV to continue");
  });

  it("ignores a prior frame when the selected VibeTV is disconnected", () => {
    const displayFrame = {
      ok: true,
      frame: {
        v: 2,
        provider: "codex",
        label: "Codex",
        usageSlots: [{ id: "weekly", label: "Weekly", percent: 29 }],
      },
    };
    const device = {
      active: true,
      connected: false,
      paired: true,
      ready: false,
    };

    expect(livePreviewDisplayFrame(device, displayFrame)).toBeNull();

    const markup = renderToStaticMarkup(
      createElement(LiveVibeTVPreview, {
        device,
        displayFrame,
        usage: null,
      }),
    );

    expect(markup).toContain("Reconnect VibeTV to continue");
    expect(markup).not.toContain("Waiting for usage");
  });

  it("waits for actual usage instead of accepting a provider label alone", () => {
    expect(
      hasRenderableUsage({
        ok: true,
        frame: { v: 2, provider: "claude", label: "Claude" },
      }),
    ).toBe(false);
    expect(
      hasRenderableUsage({
        ok: true,
        frame: {
          v: 2,
          provider: "claude",
          label: "Claude",
          usageSlots: [{ id: "session", label: "Session", percent: 0 }],
        },
      }),
    ).toBe(true);
    expect(
      hasRenderableUsage({
        ok: true,
        frame: {
          v: 2,
          provider: "claude",
          label: "Claude",
          usageUnavailable: true,
          usageSlots: [{ id: "session", label: "Session", percent: 25 }],
        },
      }),
    ).toBe(false);
  });

  it("advances every reset countdown from the saved frame time", () => {
    const frame = buildFrameData(
      "2026-07-24T10:30:00Z",
      {
        v: 2,
        provider: "codex",
        label: "Codex",
        resetSecs: 100,
        usageSlots: [
          { id: "session", label: "Session", percent: 10, resetSecs: 100 },
          { id: "weekly", label: "Weekly", percent: 20, resetSecs: 10 },
        ],
      },
      new Date("2026-07-24T10:30:35.900Z"),
    );

    expect(frame.resetSecs).toBe(65);
    expect(frame.usageWindows.map((window) => window.resetSecs)).toEqual([
      65, 0,
    ]);
    expect(frame.usageSlot1ResetSecs).toBe(65);
    expect(frame.usageSlot2ResetSecs).toBe(0);
    expect(frame.time).toBe(
      new Intl.DateTimeFormat("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date("2026-07-24T10:30:35.900Z")),
    );
    expect(frame.date).toBe(
      new Intl.DateTimeFormat("de-DE", {
        day: "2-digit",
        month: "2-digit",
      }).format(new Date("2026-07-24T10:30:35.900Z")),
    );
  });

  it("uses a legacy render cache only when its path matches the active Custom Theme", async () => {
    const oldCompanionPack = {
      themeId: "my-custom",
      spec: { p: [] },
      specPath: "/themes/u/custom-old.json",
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json(oldCompanionPack, { status: 200 }));

    const pack = await fetchThemeRenderPackRevision(
      "my-custom",
      "/themes/u/custom-old.json",
      "1234abcd",
      undefined,
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/theme-pack/my-custom?specPath=%2Fthemes%2Fu%2Fcustom-old.json&specHash=1234abcd",
    );
    expect(fetcher.mock.calls[1]?.[0]).toBe("/api/theme-pack/my-custom");
    expect(
      themeRenderPackMatchesActiveRevision(
        pack,
        "/themes/u/custom-old.json",
        "1234abcd",
      ),
    ).toBe(true);
    expect(
      themeRenderPackMatchesActiveRevision(
        pack,
        "/themes/u/another.json",
        "1234abcd",
      ),
    ).toBe(false);
  });

  it("accepts neutral catalog sample data without changing the default preview", () => {
    const markup = renderToStaticMarkup(
      createElement(ThemeSpecPreview, {
        animate: false,
        frame: THEME_CATALOG_PREVIEW_FRAME,
        pack: {
          themeId: "catalog-preview",
          spec: { p: [] },
        },
        status: "ready",
        themeId: "catalog-preview",
      }),
    );

    expect(markup).toContain(
      "Rendered VibeTV theme catalog-preview showing Codex, Session 64% used, Weekly 28% used",
    );
    expect(markup).not.toContain("Codex Spark Weekly");
  });

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
        {
          id: "spark",
          label: "Codex Spark Weekly",
          percent: 7,
          resetSecs: 200,
        },
      ],
    },
  ])(
    "matches complete lane visibility for $count slots",
    ({ count, slots }) => {
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
    },
  );
});

describe("firmware-compatible ThemeSpec text layout", () => {
  it("chooses the largest configured integer size that fits the text box", () => {
    expect(themeTextFittedSize("Weekly", 1, 3, 108, true)).toBe(3);
    expect(themeTextFittedSize("Codex Spark Weekly", 1, 3, 108, true)).toBe(1);
    expect(themeTextFittedSize("Codex Spark Weekly", 1, 3, 108, false)).toBe(3);
  });

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

  it("uses provider-neutral TFT font metrics for ASCII labels", () => {
    const codex = themeFirmwareTextMetrics("Codex Spark Weekly", 2, 1);
    const anotherProvider = themeFirmwareTextMetrics(
      "Claude Team Monthly",
      2,
      1,
    );

    expect(codex?.width).toBe(123);
    expect(
      codex?.glyphs
        .slice(0, "Codex Spark".length)
        .reduce((width, glyph) => width + glyph.width, 0),
    ).toBe(76);
    expect(anotherProvider?.width).toBeGreaterThan(81);
    expect(
      themeFirmwareTextMetrics(" AIMWaz09~", 2, 1)?.glyphs.map(
        (glyph) => glyph.width,
      ),
    ).toEqual([6, 8, 4, 10, 10, 7, 7, 8, 8, 8]);
  });

  it("matches TFT byte measurement and missing-glyph behavior for UTF-8", () => {
    const font2 = themeFirmwareTextMetrics("月次 Nutzung", 2, 1);
    const font1 = themeFirmwareTextMetrics("Équipe", 1, 1);

    expect(font2?.width).toBe(90);
    expect(font2?.glyphs[0]).toEqual({
      character: " ",
      offset: 0,
      width: 6,
    });
    expect(font2?.glyphs[1]).toEqual({
      character: "N",
      offset: 6,
      width: 8,
    });
    expect(font1?.width).toBe(42);
    expect(font1?.glyphs[0]).toEqual({
      character: "╩",
      offset: 0,
      width: 6,
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
    expect(markup).toContain('dominant-baseline="alphabetic"');
    expect(markup).not.toContain('dominant-baseline="text-before-edge"');
    expect(markup).not.toContain('dominant-baseline="hanging"');
    expect(markup).toMatch(
      /<text[^>]*y="58\.8"[^>]*text-anchor="start"[^>]*x="145">/,
    );
    expect(markup).toMatch(
      /<text[^>]*y="22\.8"[^>]*text-anchor="start"[^>]*x="10">/,
    );
    expect(markup).toContain('lengthAdjust="spacingAndGlyphs"');
  });
});

describe("live VibeTV partial usage", () => {
  it("renders only the unknown lane as unavailable", () => {
    const frame = buildFrameData("2026-07-24T10:30:00Z", {
      v: 1,
      provider: "codex",
      label: "Codex",
      weekly: 60,
      sessionUnavailable: true,
    });

    expect(boundValue("session", frame)).toBe("??");
    expect(boundValue("weekly", frame)).toBe("60");
    expect(progressPercent({ binding: "session" }, frame)).toBe(0);
    expect(progressPercent({ binding: "weekly" }, frame)).toBe(60);
  });
});
