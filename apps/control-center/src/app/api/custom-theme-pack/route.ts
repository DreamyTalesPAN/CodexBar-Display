import { storeCustomThemePack } from "@/lib/custom-theme-pack-store";
import type { ThemeStudioAsset, ThemeStudioSpec } from "@/lib/theme-studio";

export const dynamic = "force-dynamic";

type CustomThemePackRequest = {
  assets?: Record<string, ThemeStudioAsset>;
  packName?: string;
  spec?: ThemeStudioSpec;
};

export async function POST(request: Request) {
  let payload: CustomThemePackRequest;
  try {
    payload = (await request.json()) as CustomThemePackRequest;
  } catch {
    return Response.json(
      { ok: false, error: "Theme could not be prepared." },
      { status: 400 },
    );
  }

  if (!payload.spec) {
    return Response.json(
      { ok: false, error: "Theme could not be prepared." },
      { status: 400 },
    );
  }

  try {
    const stored = storeCustomThemePack({
      assets: payload.assets || {},
      packName: payload.packName || payload.spec.themeId,
      spec: payload.spec,
    });
    const packUrl = new URL(
      `/api/custom-theme-pack/${encodeURIComponent(stored.id)}.zip`,
      request.url,
    );
    packUrl.searchParams.set("token", stored.token);
    return Response.json({
      ok: true,
      fileName: stored.fileName,
      name: stored.name,
      packUrl: packUrl.toString(),
      themeId: stored.themeId,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Theme could not be prepared.",
      },
      { status: 400 },
    );
  }
}
