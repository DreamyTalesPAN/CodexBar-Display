import type { NextRequest } from "next/server";

const TARGET = "http://127.0.0.1:47852";
const LIMIT = 12 * 1024 * 1024;
const PATHS = new Set([
  "/v1/ai-theme/capabilities",
  "/v1/ai-theme/concepts",
  "/v1/ai-theme/providers/openai/credential",
  "/v1/ai-theme/providers/openai/verify",
]);

export async function proxyAITheme(request: NextRequest, pathname: string) {
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  const sameOrigin =
    origin === request.nextUrl.origin ||
    (!origin &&
      request.method === "GET" &&
      request.headers.get("sec-fetch-site") === "same-origin");
  if (
    process.env.VIBETV_AI_THEME_PREVIEW !== "1" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(request.nextUrl.hostname) ||
    request.nextUrl.protocol !== "http:" ||
    host !== request.nextUrl.host ||
    !sameOrigin ||
    request.nextUrl.search ||
    !PATHS.has(pathname)
  ) {
    return Response.json(
      { error: { code: "feature_disabled" } },
      { status: 403 },
    );
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  try {
    if (reader)
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > LIMIT) {
          await reader.cancel();
          return Response.json(
            { error: { code: "request_too_large" } },
            { status: 413 },
          );
        }
        chunks.push(value);
      }
    // Next can expose an empty stream for bodyless POST/DELETE requests.
    // Require JSON only when there are actual bytes to decode.
    if (
      size > 0 &&
      !request.headers.get("content-type")?.startsWith("application/json")
    ) {
      return Response.json(
        { error: { code: "request_invalid" } },
        { status: 415 },
      );
    }
    const upstream = await fetch(TARGET + pathname, {
      method: request.method,
      body: size > 0 ? Buffer.concat(chunks) : undefined,
      headers: { "Content-Type": "application/json", Origin: TARGET },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(240_000)]),
      redirect: "error",
      cache: "no-store",
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json(
      { error: { code: "provider_unavailable" } },
      { status: 503 },
    );
  } finally {
    reader?.releaseLock();
  }
}
