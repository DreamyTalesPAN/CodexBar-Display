import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LOCAL_MAC_APP_ORIGIN =
  process.env.VIBETV_LOCAL_MAC_APP_ORIGIN?.trim() ||
  "http://127.0.0.1:47832";

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
  const params = await context.params;
  const pathname = `/${(params.path || []).map(encodeURIComponent).join("/")}`;
  const targetUrl = new URL(`${LOCAL_MAC_APP_ORIGIN}${pathname}`);
  targetUrl.search = request.nextUrl.search;

  try {
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
