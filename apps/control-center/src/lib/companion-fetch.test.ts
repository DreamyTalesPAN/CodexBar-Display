import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAIThemeCapabilities, saveAIThemeCredential } from "./ai-theme";
import { sendThemeToVibeTV } from "./theme-install";
import { createBlankThemeSpec } from "./theme-studio";
import type { ThemeStudioDocument } from "@/components/theme-studio/theme-studio-editor-state";

const origin = "http://127.0.0.1:47832";
const document: ThemeStudioDocument = { packName: "Test", assets: {}, spec: createBlankThemeSpec() };

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AI request transport contract", () => {
  it("keeps the caller's abort signal, method, body and headers, with no timeout or retry", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetcher = vi.fn().mockImplementation(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetcher);
    await fetchAIThemeCapabilities(controller.signal);
    await saveAIThemeCredential("openai", "test-key");
    expect(fetcher.mock.calls).toEqual([
      [`${origin}/v1/ai-theme/capabilities`, { method: "GET", signal: controller.signal, cache: "no-store" }],
      [`${origin}/v1/ai-theme/providers/openai/credential`, {
        method: "PUT", body: '{"apiKey":"test-key"}', headers: { "Content-Type": "application/json" }, cache: "no-store",
      }],
    ]);
    expect(timeout).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["not json", null], ["null", null], ['{"ok":false}', { ok: false }],
  ])("returns successful HTTP bodies unchanged, including %s", async (body, expected) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body as string)));
    expect(await fetchAIThemeCapabilities()).toEqual(expected);
  });

  it.each([
    ['{"error":{"code":"provider_timeout"}}', "OpenAI took too long. Try again."],
    ["not json", "AI Theme Builder could not complete this request."],
    ["null", "AI Theme Builder could not complete this request."],
  ])("maps failed HTTP bodies with AI-specific text: %s", async (body, message) => {
    const fetcher = vi.fn(async () => new Response(body, { status: 502 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(fetchAIThemeCapabilities()).rejects.toThrow(message);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("theme-send request transport contract", () => {
  it("POSTs the ZIP then reads each job after 500 ms with a fresh 30-second signal", async () => {
    const signals = Array.from({ length: 3 }, () => new AbortController().signal);
    const timeout = vi.spyOn(AbortSignal, "timeout")
      .mockReturnValueOnce(signals[0]).mockReturnValueOnce(signals[1]).mockReturnValueOnce(signals[2]);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ job: { id: "job /?&", phase: "installing" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ job: { phase: "installing", message: "Working." } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ job: { phase: "complete", result: {}, message: "Sent." } })));
    vi.stubGlobal("fetch", fetcher);
    const status = vi.fn();
    const onJob = vi.fn();
    const result = sendThemeToVibeTV(document, status, null, onJob);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onJob).toHaveBeenCalledExactlyOnceWith("job /?&");
    const query = new URLSearchParams({ async: "true", slot: "live", themeId: document.spec.themeId, themeName: "Test" });
    expect(fetcher.mock.calls[0]).toEqual([
      `${origin}/v1/themes/install?${query}`,
      { method: "POST", headers: { "Content-Type": "application/zip" }, body: expect.any(Uint8Array), cache: "no-store", signal: signals[0] },
    ]);
    await vi.advanceTimersByTimeAsync(499);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(status).toHaveBeenCalledExactlyOnceWith("Working.");
    await vi.advanceTimersByTimeAsync(499);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe("Sent.");
    expect(fetcher.mock.calls.slice(1)).toEqual(signals.slice(1).map((signal) => [
      `${origin}/v1/themes/install/status?jobId=job%20%2F%3F%26`, { cache: "no-store", signal },
    ]));
    expect(timeout.mock.calls).toEqual([[30_000], [30_000], [30_000]]);
    expect(onJob.mock.calls).toEqual([["job /?&"], [null]]);
    expect(status.mock.calls).toEqual([["Working."], ["Sent."]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    [200, '{"ok":false,"error":{"code":"bad","nextAction":"Action.","message":"Message."}}', "Action.", "bad"],
    [503, '{"error":{"code":"bad","message":"Message."}}', "Message.", "bad"],
    [200, "not json", "Open the VibeTV Mac App and connect your display.", undefined],
    [200, "null", "Open the VibeTV Mac App and connect your display.", undefined],
    [503, "not json", "Open the VibeTV Mac App and connect your display.", undefined],
  ])("rejects failed HTTP, payload and parse results with its own text (%s, %s)", async (status, body, message, code) => {
    const fetcher = vi.fn(async () => new Response(body, { status }));
    vi.stubGlobal("fetch", fetcher);
    const onJob = vi.fn();
    const rejected = expect(sendThemeToVibeTV(document, vi.fn(), "pending", onJob)).rejects.toMatchObject({ message, code });
    await vi.advanceTimersByTimeAsync(1500);
    await rejected;
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onJob).not.toHaveBeenCalled();
  });
});

describe.each(["AI", "theme"])("%s transport failures", (kind) => {
  it.each([new Error("Network failed."), new DOMException("Aborted", "AbortError"), new DOMException("Timed out", "TimeoutError")])(
    "preserves the original rejection without retrying: %s", async (error) => {
      const fetcher = vi.fn().mockRejectedValue(error);
      vi.stubGlobal("fetch", fetcher);
      const pending = kind === "AI" ? fetchAIThemeCapabilities() : sendThemeToVibeTV(document, vi.fn(), "pending", vi.fn());
      const rejected = expect(pending).rejects.toBe(error);
      await vi.advanceTimersByTimeAsync(1500);
      await rejected;
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
});
