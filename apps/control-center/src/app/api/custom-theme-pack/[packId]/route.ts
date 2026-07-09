import { readCustomThemePack } from "@/lib/custom-theme-pack-store";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ packId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { packId } = await context.params;
  const id = packId.replace(/\.zip$/i, "");
  const token = new URL(request.url).searchParams.get("token") || "";
  const pack = readCustomThemePack(id, token);
  if (!pack) {
    return Response.json(
      { ok: false, error: "Theme pack is not available." },
      { status: 404 },
    );
  }

  const body = new Uint8Array(pack.zipBytes);
  return new Response(body, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${pack.fileName}"`,
      "Content-Type": "application/zip",
    },
  });
}
