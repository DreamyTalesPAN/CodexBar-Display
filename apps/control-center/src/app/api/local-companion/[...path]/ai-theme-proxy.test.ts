import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxyAITheme } from "./ai-theme-proxy";

const path = "/v1/ai-theme/providers/openai/credential";
function request(
  url = "http://localhost:3015/api/local-companion" + path,
  origin = "http://localhost:3015",
  host = "localhost:3015",
) {
  return new NextRequest(url, {
    method: "PUT",
    headers: { host, origin, "content-type": "application/json" },
    body: JSON.stringify({ apiKey: "dummy-sensitive-key" }),
  });
}
describe("local AI proxy", () => {
  beforeEach(() => {
    vi.stubEnv("VIBETV_AI_THEME_PREVIEW", "1");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ configured: true })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("is disabled by default", async () => {
    vi.stubEnv("VIBETV_AI_THEME_PREVIEW", "");
    expect((await proxyAITheme(request(), path)).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    [
      "https://app.vibetv.shop/api/local-companion" + path,
      "https://app.vibetv.shop",
      "app.vibetv.shop",
    ],
    [
      "http://localhost:3015/api/local-companion" + path,
      "https://evil.test",
      "localhost:3015",
    ],
    [
      "http://localhost:3015/api/local-companion" + path,
      "null",
      "localhost:3015",
    ],
    [
      "http://localhost:3015/api/local-companion" + path,
      "http://localhost:3015",
      "evil.test",
    ],
    [
      "http://localhost:3015/api/local-companion" +
        path +
        "?url=http://169.254.169.254",
      "http://localhost:3015",
      "localhost:3015",
    ],
  ])(
    "rejects hosted requests, foreign origins, rebinding, and query URLs",
    async (url, origin, host) => {
      expect(
        (await proxyAITheme(request(url, origin, host), path)).status,
      ).toBe(403);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("uses a fixed AI-only helper with an explicit origin after validation", async () => {
    expect((await proxyAITheme(request(), path)).status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:47852" + path,
      expect.objectContaining({
        redirect: "error",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://127.0.0.1:47852",
        },
      }),
    );
  });
  it("does not relay any device or arbitrary provider route", async () => {
    expect((await proxyAITheme(request(), "/v1/themes/install")).status).toBe(
      403,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    ["POST", "/v1/ai-theme/providers/openai/verify"],
    ["DELETE", "/v1/ai-theme/providers/openai/credential"],
  ])(
    "forwards bodyless %s even when Next provides an empty stream",
    async (method, pathname) => {
      const req = new NextRequest(
        "http://localhost:3015/api/local-companion" + pathname,
        {
          method,
          headers: { host: "localhost:3015", origin: "http://localhost:3015" },
          body: "",
        },
      );
      expect(req.body).not.toBeNull();
      expect((await proxyAITheme(req, pathname)).status).toBe(200);
      expect(fetch).toHaveBeenCalledWith(
        "http://127.0.0.1:47852" + pathname,
        expect.objectContaining({ method, body: undefined }),
      );
    },
  );
  it("still rejects non-JSON content without forwarding it", async () => {
    const req = new NextRequest(
      "http://localhost:3015/api/local-companion" + path,
      {
        method: "PUT",
        headers: {
          host: "localhost:3015",
          origin: "http://localhost:3015",
          "content-type": "text/plain",
        },
        body: "not-json",
      },
    );
    expect((await proxyAITheme(req, path)).status).toBe(415);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("bounds bodies and redacts transport errors", async () => {
    const large = new NextRequest(
      "http://localhost:3015/api/local-companion" + path,
      {
        method: "PUT",
        headers: {
          host: "localhost:3015",
          origin: "http://localhost:3015",
          "content-type": "application/json",
        },
        body: "x".repeat(12 * 1024 * 1024 + 1),
      },
    );
    expect((await proxyAITheme(large, path)).status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockRejectedValue(new Error("dummy-sensitive-key"));
    const response = await proxyAITheme(request(), path);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("dummy-sensitive-key");
  });
});
