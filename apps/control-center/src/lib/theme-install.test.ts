import { afterEach, expect, it, vi } from "vitest";
import { sendThemeToVibeTV } from "./theme-install";
import type { ThemeStudioDocument } from "@/components/theme-studio/theme-studio-editor-state";
import { createBlankThemeSpec } from "./theme-studio";
import { encodeAIThemeCBA1 } from "./ai-theme";

afterEach(() => vi.unstubAllGlobals());

async function check(status: number, code: string) {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, error: { code, message: "Failed." } }), { status })));
  const jobs: Array<string | null> = [];
  const sent = sendThemeToVibeTV({} as ThemeStudioDocument, () => {}, "job-1", (id) => jobs.push(id)).catch((error: Error) => error.message);
  await vi.advanceTimersByTimeAsync(600);
  vi.useRealTimers();
  expect(await sent).toBe("Failed.");
  return jobs;
}

it("forgets a transfer the Mac App no longer knows and keeps one it could not reach", async () => {
  expect(await check(404, "install_job_not_found")).toEqual([null]);
  expect(await check(503, "COMPANION_UNREACHABLE")).toEqual([]);
});

it("prepares a saved transparent animation when sending and leaves the editable asset untouched", async () => {
  const path = "/themes/u/ai-pet-1.cba";
  const frame = new Uint8ClampedArray(16 * 16 * 4);
  frame.set([0, 0, 255, 255]);
  const original = encodeAIThemeCBA1([frame, frame, frame, frame], 16, 16, 2);
  const document: ThemeStudioDocument = {
    packName: "Saved cat", usage: "live",
    assets: { [path]: { contentType: "text/plain", encoding: "text", data: original } },
    spec: { ...createBlankThemeSpec(), primitives: [
      { type: "rect", x: 0, y: 0, width: 240, height: 240, color: "#FF0000" },
      { type: "sprite", x: 20, y: 20, width: 16, height: 16, assetPath: path, frameCount: 4, fps: 2 },
    ] },
  };
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { themeId: document.spec.themeId } })));
  vi.stubGlobal("fetch", fetcher);
  await sendThemeToVibeTV(document, () => {}, null, () => {});
  const body = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as Uint8Array;
  // ZIP entries are stored uncompressed: the animation must contain the red
  // backdrop as well as its blue figure, not transparent runs over the image.
  const zipText = new TextDecoder().decode(body);
  const animation = zipText.slice(zipText.indexOf("CBA1\n")).split("\n");
  expect(animation.slice(3, 3 + Number(animation[2]))).toContain("#FF0000");
  expect(document.assets[path].data).toBe(original);
});
