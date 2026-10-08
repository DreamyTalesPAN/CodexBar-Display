import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  boundValue,
  buildFrameData,
  fetchThemeRenderPackRevision,
  hasRenderableUsage,
  LiveVibeTVPreview,
  livePreviewDisplayFrame,
  parseLatestDisplayFrameResponse,
  primitiveUsageSlotVisible,
  renderTextPrimitive,
  progressPercent,
  THEME_CATALOG_PREVIEW_FRAME,
  ThemeSpecPreview,
  themeFirmwareTextMetrics,
  themeProgressArc,
  themeTextAlignedY,
  themeTextFittedSize,
  themeTextLayout,
  themeTextValignBoxHeight,
  themeTextWidth,
  themeSpecAriaLabel,
  themeRenderPackMatchesActiveRevision,
  type ThemePrimitive,
} from "./live-vibetv-preview";

const lane1: ThemePrimitive = { t: "r", x: 0, y: 0, w: 10, h: 10, sl: 1 };
const lane2: ThemePrimitive = { t: "r", x: 0, y: 0, w: 10, h: 10, sl: 2 };

describe("latest display frame response", () => {
  it("clears the prior frame only for the authoritative unavailable response", async () => {
    await expect(
      parseLatestDisplayFrameResponse(
        Response.json(
          {
            ok: false,
            error: { code: "display_frame_unavailable" },
          },
          { status: 404 },
        ),
      ),
    ).resolves.toBeNull();
  });

  it("preserves the prior frame for transient failures", async () => {
    await expect(
      parseLatestDisplayFrameResponse(
        Response.json({ ok: false }, { status: 503 }),
      ),
    ).rejects.toThrow("display frame unavailable");
  });
});

describe("dynamic usage slot preview", () => {
  it("renders absent token totals as unavailable instead of zero", () => {
    const withoutTokens = buildFrameData("2026-08-11T09:00:00Z", {
      v: 2,
      provider: "codex",
      label: "Codex",
      session: 12,
      weekly: 34,
    });
    expect(withoutTokens.hasTokenTotals).toBe(false);
    expect(
      renderTextPrimitive({ t: "tx", b: "st" }, withoutTokens),
    ).toBe("--");
    expect(
      renderTextPrimitive({ t: "tx", v: "{totalTokens}" }, withoutTokens),
    ).toBe("--");

    const withTokens = buildFrameData("2026-08-11T09:00:00Z", {
      v: 2,
      provider: "codex",
      label: "Codex",
      session: 12,
      weekly: 34,
      sessionTokens: 1400000,
    });
    expect(withTokens.hasTokenTotals).toBe(true);
    expect(renderTextPrimitive({ t: "tx", b: "st" }, withTokens)).toBe(
      "1.4M",
    );

    const zeroTotalsKnown = buildFrameData("2026-08-11T09:00:00Z", {
      v: 2,
      provider: "codex",
      label: "Codex",
      session: 12,
      weekly: 34,
      tokenTotalsKnown: true,
    });
    expect(zeroTotalsKnown.hasTokenTotals).toBe(true);
    expect(renderTextPrimitive({ t: "tx", b: "st" }, zeroTotalsKnown)).toBe(
      "0",
    );
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

  it("never tells a provider-starved connected VibeTV to reconnect", () => {
    const markup = renderToStaticMarkup(
      createElement(LiveVibeTVPreview, {
        device: {
          target: "http://192.168.178.72",
          active: true,
          connected: true,
          paired: true,
          ready: false,
          health: { ok: true },
          stream: {
            healthy: false,
            running: true,
            target: "http://192.168.178.72",
            errorCode: "provider_setup_required",
          },
        },
        displayFrame: null,
        usage: null,
      }),
    );

    expect(markup).toContain("Waiting for AI setup");
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

  it("keeps the verified frame while the selected VibeTV reconnects", () => {
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
      activeTheme: "synthwave",
      connected: false,
      paired: true,
      ready: false,
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
    expect(markup).not.toContain("Reconnect VibeTV to continue");
    expect(markup).not.toContain("Waiting for usage");
  });

  it("stops presenting a stale cached frame as live once the device stays disconnected", () => {
    const staleFrame = {
      ok: true,
      savedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      frame: {
        v: 2,
        provider: "codex",
        label: "Codex",
        usageSlots: [{ id: "weekly", label: "Weekly", percent: 29 }],
      },
    };
    const device = {
      active: true,
      activeTheme: "synthwave",
      connected: false,
      paired: true,
      ready: false,
    };

    const markup = renderToStaticMarkup(
      createElement(LiveVibeTVPreview, {
        device,
        displayFrame: staleFrame,
        usage: null,
      }),
    );

    expect(markup).toContain("Reconnect VibeTV to continue");
  });

  it("shows wait guidance instead of reconnect guidance during an update-owned reboot", () => {
    const markup = renderToStaticMarkup(
      createElement(LiveVibeTVPreview, {
        device: {
          active: true,
          connected: false,
          paired: true,
          ready: false,
        },
        displayFrame: null,
        updateOwnedDisconnect: true,
        usage: null,
      }),
    );

    expect(markup).toContain("VibeTV is restarting");
    expect(markup).toContain("Keep power connected and wait");
    expect(markup).not.toContain("Reconnect VibeTV to continue");
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
    // The literal device contract: attachClockFields sends "02.01.2006" and
    // the device clock renders "%02d.%02d.%04d". A preview that drops the year
    // would hide width and shrink problems that happen on the hardware.
    expect(frame.date).toBe("24.07.2026");
  });

  it("formats multi-day reset countdowns like the VibeTV firmware", () => {
    expect(
      boundValue("reset", {
        ...THEME_CATALOG_PREVIEW_FRAME,
        resetSecs: (141 * 60 + 4) * 60,
      }),
    ).toBe("5d 21h");
  });

  // The device renders "Reset unavailable" for an expired countdown
  // (theme_spec_renderer_core.h). A preview that showed "0m" instead would
  // contradict the screen it is previewing.
  it("reports an expired countdown the way the firmware does", () => {
    const expired = { ...THEME_CATALOG_PREVIEW_FRAME, resetSecs: 0 };
    expect(boundValue("reset", expired)).toBe("Reset unavailable");
    expect(boundValue("r", expired)).toBe("Reset unavailable");
  });

  it("reports expired slot countdowns the way the firmware does", () => {
    const frame = buildFrameData("2026-07-24T10:30:00Z", {
      v: 2,
      provider: "codex",
      label: "Codex",
      resetSecs: 0,
      usageSlots: [
        { id: "session", label: "Session", percent: 10, resetSecs: 0 },
        { id: "weekly", label: "Weekly", percent: 20, resetSecs: 0 },
      ],
      providerSlots: [{ id: "codex", label: "Codex", percent: 10, resetSecs: 0 }],
    });
    // A frame that carries no deadline anywhere gives the device no basis to
    // stand behind, so nothing in it is idle.
    expect(boundValue("us1r", frame)).toBe("Reset unavailable");
    expect(boundValue("us2r", frame)).toBe("Reset unavailable");
    expect(boundValue("usage.0.reset", frame)).toBe("Reset unavailable");
    expect(boundValue("pv1r", frame)).toBe("Reset unavailable");
  });

  // The Companion clears every countdown of a stale frame to zero but keeps
  // its windows. The device renders "Reset unavailable" for those, and so must
  // the preview: zero alone does not make a window idle.
  it("calls a window idle only over a basis the device still trusts", () => {
    const customerFrame = {
      v: 2,
      provider: "claude",
      label: "Claude",
      resetSecs: 4 * 24 * 3600,
      resetTrust: "live",
          resetSource: "claude:secondary",
      resetTrustSecs: 18000,
      usageWindows: [
        { id: "primary", label: "Session", percent: 0, resetSecs: 0 },
        { id: "secondary", label: "Weekly", percent: 32, resetSecs: 4 * 24 * 3600 },
      ],
    };
    const savedAt = "2026-07-24T10:30:00Z";
    const line = { t: "tx", v: "Resets in {usageSlot1Reset}" } as const;
    expect(
      renderTextPrimitive(line, buildFrameData(savedAt, customerFrame, new Date(savedAt))),
    ).toBe("No active session");
    // Past the five-hour trust budget.
    expect(
      renderTextPrimitive(
        line,
        buildFrameData(savedAt, customerFrame, new Date("2026-07-24T15:30:01Z")),
      ),
    ).toBe("Reset unavailable");
    const stale = {
      ...customerFrame,
      resetSecs: 0,
      resetTrust: "stale",
      resetTrustSecs: 0,
      usageWindows: customerFrame.usageWindows.map((window) => ({ ...window, resetSecs: 0 })),
    };
    expect(
      renderTextPrimitive(line, buildFrameData(savedAt, stale, new Date(savedAt))),
    ).toBe("Reset unavailable");
  });

  // Issue #532: an account in which no window has a reset time. The host
  // marks the current collection "live"; that stands without a deadline, on
  // the device and here. Anything else without a deadline stays unavailable.
  it("calls an account with no reset time anywhere idle only on a live frame", () => {
    const savedAt = "2026-10-07T10:30:00Z";
    const idleAccount = {
      v: 2,
      provider: "claude",
      label: "Claude",
      resetTrust: "live",
      resetSource: "claude",
      resetTrustSecs: 17988,
      usageWindows: [
        { id: "session", label: "Session", percent: 0, resetSecs: 0 },
        { id: "weekly", label: "Weekly", percent: 0, resetSecs: 0 },
      ],
    };
    const textFor = (frame: object, now = savedAt) => {
      const data = buildFrameData(savedAt, frame, new Date(now));
      return [
        boundValue("reset", data),
        boundValue("us1r", data),
        renderTextPrimitive({ t: "tx", v: "Resets in {usageSlot2Reset}" }, data),
      ];
    };
    const idle = ["No active session", "No active session", "No active session"];
    const unavailable = ["Reset unavailable", "Reset unavailable", "Reset unavailable"];
    expect(textFor(idleAccount)).toEqual(idle);
    // Past the budget the host sent.
    expect(textFor(idleAccount, "2026-10-07T15:29:49Z")).toEqual(unavailable);
    // What a Companion before #532 sends, and a resend after a failed collection.
    expect(textFor({ ...idleAccount, resetTrust: "stale", resetTrustSecs: 0 })).toEqual(
      unavailable,
    );
    expect(textFor({ ...idleAccount, resetTrust: "offline" })).toEqual(unavailable);
    expect(textFor({ ...idleAccount, resetTrust: undefined })).toEqual(unavailable);
    expect(textFor({ ...idleAccount, resetSource: "" })).toEqual(unavailable);
    expect(textFor({ ...idleAccount, usageUnavailable: true })).toEqual(unavailable);
    // A window with usage and no deadline is still not idle, and neither is
    // the root line that speaks for all windows.
    expect(
      textFor({
        ...idleAccount,
        usageWindows: [
          { id: "session", label: "Session", percent: 40, resetSecs: 0 },
          { id: "weekly", label: "Weekly", percent: 0, resetSecs: 0 },
        ],
      }),
    ).toEqual(["Reset unavailable", "Reset unavailable", "No active session"]);
  });

  // Review of #524: the host sends resetSecs 0 not only for a window without
  // a deadline but also for a deadline that ran out before the frame left and
  // for a provider that names none. Idle needs nothing used as well, exactly
  // as on the device.
  it("does not call a window with usage and no deadline idle", () => {
    const savedAt = "2026-07-24T10:30:00Z";
    const frameWith = (extra: object) =>
      buildFrameData(
        savedAt,
        {
          v: 2,
          provider: "claude",
          label: "Claude",
          resetSecs: 4 * 24 * 3600,
          resetTrust: "live",
          resetSource: "claude:secondary",
          resetTrustSecs: 18000,
          ...extra,
        },
        new Date(savedAt),
      );
    const used = frameWith({
      usageWindows: [
        { id: "primary", label: "Session", percent: 93, resetSecs: 0 },
        { id: "secondary", label: "Weekly", percent: 0, resetSecs: 0 },
      ],
      providerSlots: [
        { id: "codex", label: "Codex", percent: 0, resetSecs: 0 },
        { id: "claude", label: "Claude", percent: 32, resetSecs: 4 * 24 * 3600 },
      ],
    });
    expect(boundValue("us1r", used)).toBe("Reset unavailable");
    expect(
      renderTextPrimitive({ t: "tx", v: "Resets in {usage.0.reset}" }, used),
    ).toBe("Reset unavailable");
    expect(boundValue("us2r", used)).toBe("No active session");
    // A provider slot is only sent with a deadline, so 0 is one that ran out.
    expect(boundValue("pv1r", used)).toBe("Reset unavailable");

    // A trusted basis names its source, as on the device.
    const unnamed = frameWith({
      resetSource: "",
      usageWindows: [
        { id: "primary", label: "Session", percent: 93, resetSecs: 0 },
        { id: "secondary", label: "Weekly", percent: 0, resetSecs: 0 },
      ],
    });
    expect(boundValue("us2r", unnamed)).toBe("Reset unavailable");

    // Windows kept from a failed collection are unavailable, not idle.
    const retained = frameWith({
      usageUnavailable: true,
      usageWindows: [
        { id: "primary", label: "Session", percent: 0, resetSecs: 0 },
        { id: "secondary", label: "Weekly", percent: 32, resetSecs: 4 * 24 * 3600 },
      ],
    });
    expect(boundValue("us1r", retained)).toBe("Reset unavailable");

    // "remaining" mode sends what is left: nothing used reads 100.
    const remaining = frameWith({
      usageMode: "remaining",
      usageWindows: [
        { id: "primary", label: "Session", percent: 100, resetSecs: 0 },
        { id: "secondary", label: "Weekly", percent: 0, resetSecs: 0 },
      ],
    });
    expect(boundValue("us1r", remaining)).toBe("No active session");
    expect(boundValue("us2r", remaining)).toBe("Reset unavailable");
  });

  // A deadline that ran out between the frame being saved and now is not idle:
  // it reached the reset the host did send, so the countdown is genuinely
  // unavailable until the next frame arrives.
  it("separates an idle window from a countdown that ran out", () => {
    const frame = buildFrameData(
      "2026-07-24T10:30:00Z",
      {
        v: 2,
        provider: "claude",
        label: "Claude",
        resetSecs: 60,
        usageSlots: [
          { id: "session", label: "Session", percent: 40, resetSecs: 60 },
          { id: "weekly", label: "Weekly", percent: 0, resetSecs: 0 },
        ],
      },
      new Date("2026-07-24T11:30:00Z"),
    );
    expect(boundValue("us1r", frame)).toBe("Reset unavailable");
    expect(boundValue("us2r", frame)).toBe("No active session");
    expect(
      renderTextPrimitive({ t: "tx", v: "Resets in {us1r}" }, frame),
    ).toBe("Reset unavailable");
    // One line binding both cannot claim everything is merely idle.
    expect(
      renderTextPrimitive({ t: "tx", v: "{us1r} / {us2r}" }, frame),
    ).toBe("Reset unavailable");
  });

  // #412: the firmware's words for CodexBar's pace, and nothing without it.
  it("renders CodexBar pace like the firmware", () => {
    const sentAt = "2026-09-21T08:30:00Z";
    const paced = {
      v: 2,
      provider: "claude",
      label: "Claude",
      usageWindows: [
        { id: "session", label: "Session", percent: 8, resetSecs: 600, pace: { delta: -25, state: "reserve", lasts: true } },
        { id: "weekly", label: "Weekly", percent: 73, resetSecs: 95000, pace: { delta: 14, state: "deficit", lasts: false } },
      ],
    };
    const keys = ["Delta", "State", "Lasts"].flatMap((field) => [
      `usageSlot1Pace${field}`,
      `usageSlot2Pace${field}`,
    ]);
    const render = (frame: ReturnType<typeof buildFrameData>) =>
      keys.map((key) => boundValue(key, frame));

    expect(render(buildFrameData(sentAt, paced, new Date(sentAt)))).toEqual([
      "-25%", "+14%", "reserve", "deficit", "lasts until reset", "runs out",
    ]);
    // Window 1 resets ten minutes after the frame; its pace ends with it.
    expect(
      render(buildFrameData(sentAt, paced, new Date("2026-09-21T08:45:00Z"))),
    ).toEqual(["", "+14%", "", "deficit", "", "runs out"]);
    const unknown = {
      ...paced,
      usageWindows: paced.usageWindows.map((window) => ({ ...window, pace: undefined })),
    };
    expect(render(buildFrameData(sentAt, unknown, new Date(sentAt)))).toEqual(
      ["", "", "", "", "", ""],
    );
  });

  it("keeps an unavailable slot empty rather than reporting it unavailable", () => {
    const frame = buildFrameData("2026-07-24T10:30:00Z", {
      v: 2,
      provider: "codex",
      label: "Codex",
      resetSecs: 100,
      usageSlots: [{ id: "session", label: "Session", percent: 10, resetSecs: 0 }],
    });
    expect(boundValue("us2r", frame)).toBe("");
  });

  it("replaces the whole template for an expired root countdown", () => {
    const expired = { ...THEME_CATALOG_PREVIEW_FRAME, resetSecs: 0 };
    expect(
      renderTextPrimitive({ t: "tx", v: "Reset in {reset}" }, expired),
    ).toBe("Reset unavailable");
    expect(
      renderTextPrimitive({ t: "tx", v: "Reset in {resetCountdown}" }, expired),
    ).toBe("Reset unavailable");
    expect(renderTextPrimitive({ t: "tx", v: "Reset in {r}" }, expired)).toBe(
      "Reset unavailable",
    );
  });

  // The root token owns no window of its own, so it may only name the idle
  // state when every window the frame carries is idle. Anything else would
  // dress an untrustworthy screen up as a merely idle account.
  it("lets the root countdown name the idle state only when every window is idle", () => {
    const idle = buildFrameData("2026-07-24T10:30:00Z", {
      v: 2,
      provider: "claude",
      label: "Claude",
      resetSecs: 0,
      usageSlots: [{ id: "session", label: "Session", percent: 0, resetSecs: 0 }],
      // Another provider's deadline is the basis the device stands behind.
      providerSlots: [{ id: "codex", label: "Codex", percent: 10, resetSecs: 7200 }],
    });
    expect(boundValue("reset", idle)).toBe("No active session");
    expect(
      renderTextPrimitive({ t: "tx", v: "Reset in {reset}" }, idle),
    ).toBe("No active session");

    const mixed = buildFrameData(
      "2026-07-24T10:30:00Z",
      {
        v: 2,
        provider: "claude",
        label: "Claude",
        resetSecs: 60,
        usageSlots: [
          { id: "session", label: "Session", percent: 0, resetSecs: 0 },
          { id: "weekly", label: "Weekly", percent: 32, resetSecs: 60 },
        ],
      },
      new Date("2026-07-24T11:30:00Z"),
    );
    expect(boundValue("reset", mixed)).toBe("Reset unavailable");
  });

  // A customer received a VibeTV reading "Resets in Reset unavailable": an idle
  // Claude session carries no deadline, and the shipped theme hard-codes the
  // "Resets in " prefix. A line whose only substitution is a countdown without
  // a deadline collapses on the device, and an idle window names that state
  // instead of reporting a fault, so the preview has to match.
  it("collapses a line whose only value is an unavailable countdown", () => {
    const idle = buildFrameData("2026-07-24T10:30:00Z", {
      v: 2,
      provider: "claude",
      label: "Claude",
      resetSecs: 4 * 24 * 3600,
      usageSlots: [
        { id: "session", label: "Session", percent: 0, resetSecs: 0 },
        { id: "weekly", label: "Weekly", percent: 32, resetSecs: 4 * 24 * 3600 },
      ],
    });
    expect(
      renderTextPrimitive({ t: "tx", v: "Resets in {usage.0.reset}" }, idle),
    ).toBe("No active session");
    expect(
      renderTextPrimitive({ t: "tx", v: "Resets in {us1r}" }, idle),
    ).toBe("No active session");
  });

  // The collapse is limited to countdown-only templates. A line that also
  // substitutes a label or a percentage still carries information, so it keeps
  // substituting in place exactly as the firmware does.
  it("keeps substituting in place when the line carries another real value", () => {
    const idle = buildFrameData(
      "2026-07-24T10:30:00Z",
      {
        v: 2,
        provider: "claude",
        label: "Claude",
        resetSecs: 0,
        usageSlots: [
          { id: "session", label: "Session", percent: 0, resetSecs: 0 },
          { id: "weekly", label: "Weekly", percent: 32, resetSecs: 4 * 24 * 3600 },
        ],
      },
      new Date("2026-07-24T10:30:00Z"),
    );
    expect(
      renderTextPrimitive({ t: "tx", v: "{us1l} {us1r}" }, idle),
    ).toBe("Session No active session");
    // A window that does have a deadline is untouched.
    expect(
      renderTextPrimitive({ t: "tx", v: "Resets in {us2r}" }, idle),
    ).toBe("Resets in 4d 0h");
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
      .mockResolvedValueOnce(
        Response.json(oldCompanionPack, { status: 200 }),
      );

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
      "Rendered VibeTV theme catalog-preview showing VibeTV, Session 64% used, Weekly 28% used",
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

  it("vertically centers shrunk glyphs in an explicit height box", () => {
    expect(themeTextValignBoxHeight(32, 2, 2)).toBe(32);
    expect(themeTextValignBoxHeight(0, 2, 2)).toBe(36);
    expect(themeTextAlignedY(20, 32, 32, undefined)).toBe(20);
    expect(themeTextAlignedY(20, 32, 32, "middle")).toBe(20);
    expect(themeTextAlignedY(20, 32, 16, "middle")).toBe(28);
    expect(themeTextAlignedY(20, 32, 16, "center")).toBe(28);
    expect(themeTextAlignedY(20, 32, 16, "bottom")).toBe(36);
  });

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

describe("arc-style progress", () => {
  // The arc of the firmware's own test: a 100 px box at 20,30 with a 10 px
  // ring from 7:30 clockwise over three quarters of a turn.
  const arc: ThemePrimitive = {
    t: "p", x: 20, y: 30, w: 100, h: 100, b: "us1p", ps: "arc", as: 225, aw: 270, at: 10,
    c: "#00FF00", bg: "#333333",
  };
  const frameAt = (percent: number) => ({
    ...THEME_CATALOG_PREVIEW_FRAME,
    usageSlot1Percent: percent,
  });
  const markupFor = (primitive: ThemePrimitive, percent: number) =>
    renderToStaticMarkup(
      createElement(ThemeSpecPreview, {
        animate: false,
        frame: frameAt(percent),
        pack: { ok: true, themeId: "arc", spec: { p: [primitive] } },
        status: "ready",
        themeId: "arc",
      }),
    );
  const strokes = (markup: string) =>
    [...markup.matchAll(/<circle[^>]*>/g)].map(([circle]) => ({
      color: /stroke="([^"]+)"/.exec(circle)?.[1],
      degrees: Number(/stroke-dasharray="([\d.]+) /.exec(circle)?.[1]) / ((45 * Math.PI) / 180),
      circle,
    }));

  it("places the ring in the middle of the box and fills whole degrees like the firmware", () => {
    expect(themeProgressArc(arc, 50)).toEqual({
      cx: 70, cy: 80, radius: 45, thickness: 10, start: 225, sweep: 270, filled: 135,
    });
    // 270 * 33 / 100 is 89.1: the device cuts it to 89 degrees.
    expect(themeProgressArc(arc, 33)?.filled).toBe(89);
    expect(themeProgressArc(arc, 0)?.filled).toBe(0);
    expect(themeProgressArc(arc, 100)?.filled).toBe(270);
    expect(themeProgressArc(arc, 140)?.filled).toBe(270);
    expect(themeProgressArc(arc, -20)?.filled).toBe(0);
    // A box that is not square holds the ring in its middle.
    expect(themeProgressArc({ ...arc, w: 140 }, 50)).toMatchObject({ cx: 90, cy: 80, radius: 45 });
    expect(
      themeProgressArc({ type: "progress", x: 0, y: 0, width: 60, height: 60, progressStyle: "arc", arcSweep: 360, arcThickness: 30 }, 50),
    ).toMatchObject({ radius: 15, thickness: 30, start: 0, sweep: 360, filled: 180 });
  });

  it("draws the track over the sweep and the fill clockwise from the start angle", () => {
    const empty = strokes(markupFor(arc, 0));
    expect(empty).toHaveLength(1);
    expect(empty[0].color).toBe("#333333");
    expect(empty[0].degrees).toBeCloseTo(270);
    expect(empty[0].circle).toContain('cx="70" cy="80"');
    expect(empty[0].circle).toContain('r="45"');
    expect(empty[0].circle).toContain('stroke-width="10"');
    expect(empty[0].circle).toContain('fill="none"');
    // 225 degrees from 12 o'clock is 135 degrees from a circle's 3 o'clock start.
    expect(empty[0].circle).toContain('transform="rotate(135 70 80)"');

    const half = strokes(markupFor(arc, 50));
    expect(half.map((stroke) => stroke.color)).toEqual(["#333333", "#00FF00"]);
    expect(half[0].degrees).toBeCloseTo(270);
    expect(half[1].degrees).toBeCloseTo(135);
    expect(half[1].circle).toContain('transform="rotate(135 70 80)"');

    const full = strokes(markupFor(arc, 100));
    expect(full[1].degrees).toBeCloseTo(270);
    // No bar is drawn beside the ring.
    expect(markupFor(arc, 50)).not.toMatch(/<rect[^>]*x="2[01]"/);
  });

  it("picks the fill colour from the colour stops like the bar", () => {
    const stops = { ...arc, cs: [{ gte: 0, c: "#FF0000" }, { gte: 40, c: "#00FF00" }] };
    // The catalog frame counts used percent: 70 % used leaves 30 %.
    expect(strokes(markupFor(stops, 70))[1].color).toBe("#FF0000");
    expect(strokes(markupFor(stops, 30))[1].color).toBe("#00FF00");
  });

  it.each([
    ["no thickness", { at: undefined }],
    ["a ring thicker than the radius", { at: 51 }],
    ["no sweep", { aw: undefined }],
    ["a sweep above a full turn", { aw: 361 }],
    ["a start of a full turn", { as: 360 }],
    ["a start below 0", { as: -1 }],
  ])("draws nothing for %s, which the firmware skips", (_name, change) => {
    const primitive = { ...arc, ...change };
    expect(themeProgressArc(primitive, 50)).toBeNull();
    expect(markupFor(primitive, 50)).not.toContain("<circle");
  });

  // VibeTV reads the long-form key when it is there, also when it is empty.
  it("draws a straight bar when an empty progressStyle stands beside ps arc", () => {
    const markup = markupFor({ ...arc, progressStyle: "" }, 50);
    expect(markup).not.toContain("<circle");
    expect(markup).toContain("<rect");
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

  it("renders cross-provider slots with per-provider resets and gates their rows", () => {
    const frame = buildFrameData("2026-07-24T12:00:00Z", {
      v: 2,
      provider: "claude",
      label: "Claude",
      providerSlots: [
        { id: "claude", label: "Claude", percent: 40, resetSecs: 3600 },
        { id: "codex", label: "Codex", percent: 4, resetSecs: 12000 },
      ],
    }, new Date("2026-07-24T12:00:00Z"));

    expect(boundValue("providerSlot1Label", frame)).toBe("Claude");
    expect(boundValue("pv1r", frame)).toBe(boundValue("providerSlot1Reset", frame));
    expect(boundValue("providerSlot2Label", frame)).toBe("Codex");
    expect(primitiveUsageSlotVisible({ providerSlot: 1 }, frame)).toBe(true);
    expect(primitiveUsageSlotVisible({ pl: 2 }, frame)).toBe(true);

    const singleProvider = buildFrameData("2026-07-24T12:00:00Z", {
      v: 2,
      provider: "claude",
      label: "Claude",
      providerSlots: [
        { id: "claude", label: "Claude", percent: 40, resetSecs: 3600 },
      ],
    });
    expect(primitiveUsageSlotVisible({ providerSlot: 2 }, singleProvider)).toBe(false);
    expect(boundValue("providerSlot2Label", singleProvider)).toBe("");
  });
});
