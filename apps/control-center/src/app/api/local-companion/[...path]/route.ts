import type { NextRequest } from "next/server";
import { proxyAITheme } from "./ai-theme-proxy";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

async function localMacAppOrigin() {
  const configured = process.env.VIBETV_LOCAL_MAC_APP_ORIGIN?.trim();
  // Reuse the native runtime's existing port discovery and listener ownership
  // check. A stale endpoint must never receive a customer's theme pack.
  const stdout = configured || (await execFileAsync("/bin/bash", ["-c",
    'source "$1"; origin=$(bench::resolve_api); bench::api_owned_by_runtime "$origin" && printf "%s" "$origin"',
    "vibetv", resolve(process.cwd(), "../../scripts/lib/vibetv-bench-api.sh"),
  ], { timeout: 10_000 })).stdout.trim();
  const url = new URL(stdout);
  if (url.protocol !== "http:" || !isLoopbackHostname(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Invalid local Mac App origin");
  return url.origin;
}

type RouteContext = {
  params: Promise<{ path?: string[] }> | { path?: string[] };
};

export async function GET(request: NextRequest, context: RouteContext) {
  return proxyLocalMacApp(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxyLocalMacApp(request, context);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return proxyLocalMacApp(request, context);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return proxyLocalMacApp(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return proxyLocalMacApp(request, context);
}

async function proxyLocalMacApp(request: NextRequest, context: RouteContext) {
  if (!isLoopbackHostname(request.nextUrl.hostname)) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "LOCAL_COMPANION_PROXY_DEV_ONLY",
          message: "Local Mac App proxy is available only in local development.",
          nextAction: "Open the local Control Center on this Mac.",
        },
      },
      { status: 404 },
    );
  }

  const params = await context.params;
  const pathname = `/${(params.path || []).map(encodeURIComponent).join("/")}`;
  if (pathname === "/v1/ai-theme" || pathname.startsWith("/v1/ai-theme/")) {
    return proxyAITheme(request, pathname);
  }
  try {
    const targetUrl = new URL(`${await localMacAppOrigin()}${pathname}`);
    targetUrl.search = request.nextUrl.search;
    const upstream = await fetch(targetUrl, {
      body: request.method === "GET" ? undefined : await request.arrayBuffer(),
      cache: "no-store",
      headers: localRequestHeaders(request.headers),
      method: request.method,
    });
    return new Response(upstream.body, {
      headers: localResponseHeaders(upstream.headers),
      status: upstream.status,
    });
  } catch {
    return Response.json(
      {
        ok: false,
        error: {
          code: "COMPANION_UNREACHABLE",
          message: "Mac App needs setup.",
          nextAction: "Run setup again, then try again.",
        },
      },
      { status: 503 },
    );
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return ["127.0.0.1", "localhost", "::1"].includes(hostname);
}

function localRequestHeaders(source: Headers): Headers {
  const headers = new Headers();
  const accept = source.get("accept");
  const contentType = source.get("content-type");
  if (accept) {
    headers.set("accept", accept);
  }
  if (contentType) {
    headers.set("content-type", contentType);
  }
  return headers;
}

function localResponseHeaders(source: Headers): Headers {
  const headers = new Headers();
  const contentType = source.get("content-type");
  if (contentType) {
    headers.set("content-type", contentType);
  }
  headers.set("cache-control", "no-store");
  return headers;
}
