import { afterEach, expect, it, vi } from "vitest";
import { sendThemeToVibeTV } from "./theme-install";
import type { ThemeStudioDocument } from "@/components/theme-studio/theme-studio-editor-state";

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
