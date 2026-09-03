// @vitest-environment jsdom
//
// Regression tests for the live-observed customer failures (2026-08-06):
// an Overview that says "VibeTV is connected" while the preview is stuck on
// "PREVIEW UNAVAILABLE" forever. A connected Overview must never present a
// permanent preview error: as long as the device is connected, the preview
// must keep retrying the render pack and recover on its own.
//
// DO NOT weaken these tests to make them pass. Fix the component.
import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LiveVibeTVPreview } from "./live-vibetv-preview";

const themeSpecPath = "/themes/codex/spec-v7.json";
const themeSpecHash = "hash-v7";

const connectedDevice = {
  active: true,
  connected: true,
  ready: true,
  paired: true,
  activeTheme: "codex",
  display: {
    themeSpec: { active: true, path: themeSpecPath, hash: themeSpecHash },
  },
};

const renderableFrame = {
  ok: true,
  frame: {
    v: 2,
    provider: "codex",
    label: "Codex",
    usageSlots: [{ id: "weekly", label: "Weekly", percent: 29 }],
  },
};

const matchingPack = {
  themeId: "codex",
  spec: { p: [] },
  specPath: themeSpecPath,
  specHash: themeSpecHash,
  assets: {},
};

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 503,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("connected preview must self-heal (customer bug 2026-08-06)", () => {
  it("renders a real frame instead of a stale provider-setup placeholder", async () => {
    const onPreviewReadyChange = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(matchingPack)));

    render(
      createElement(LiveVibeTVPreview, {
        device: {
          ...connectedDevice,
          target: "http://192.168.178.73",
          ready: false,
          health: { ok: true },
          stream: {
            healthy: false,
            running: true,
            target: "http://192.168.178.73",
            errorCode: "provider_setup_required",
          },
        },
        displayFrame: renderableFrame,
        onPreviewReadyChange,
        usage: null,
      }),
    );

    expect(
      await screen.findByRole("img", {
        name: /Rendered VibeTV theme codex showing Codex/i,
      }),
    ).toBeTruthy();
    expect(screen.queryByText(/Waiting for AI setup/i)).toBeNull();
    expect(onPreviewReadyChange).toHaveBeenCalledWith(true);
  });

  it("keeps retrying the render pack while connected instead of staying on PREVIEW UNAVAILABLE", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => jsonResponse({}, false));
    vi.stubGlobal("fetch", fetchMock);

    render(
      createElement(LiveVibeTVPreview, {
        device: connectedDevice,
        displayFrame: renderableFrame,
        usage: null,
      }),
    );

    // Let the first fetch cycle fail -> component enters its error state.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.queryByText(/preview unavailable/i)).not.toBeNull();
    const callsAfterFirstCycle = fetchMock.mock.calls.length;
    expect(callsAfterFirstCycle).toBeGreaterThan(0);

    // A connected device must not park in the error state: within 30 seconds
    // the component has to try the render pack again on its own.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirstCycle);
  });

  it("recovers to the rendered preview once the render pack becomes available", async () => {
    vi.useFakeTimers();
    let failing = true;
    const fetchMock = vi.fn(async () =>
      failing ? jsonResponse({}, false) : jsonResponse(matchingPack),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      createElement(LiveVibeTVPreview, {
        device: connectedDevice,
        displayFrame: renderableFrame,
        usage: null,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.queryByText(/preview unavailable/i)).not.toBeNull();

    // Companion recovers (pack becomes servable) - the preview must follow
    // without a page reload within a minute.
    failing = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.queryByText(/preview unavailable/i)).toBeNull();
  });
});
