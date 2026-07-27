import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ themeId: string }>;
};

type ThemePackAsset = {
  contentType: string;
  data: string;
  encoding: "base64" | "text";
};

export async function GET(request: Request, context: RouteContext) {
  const { themeId } = await context.params;
  const safeThemeId = normalizeThemeId(themeId);
  if (!safeThemeId) {
    return Response.json(
      { ok: false, error: "Theme is not available." },
      { status: 404 },
    );
  }

  try {
    const requestUrl = new URL(request.url);
    const expectedPath = requestUrl.searchParams.get("specPath")?.trim() || "";
    const expectedHash =
      requestUrl.searchParams.get("specHash")?.trim().toLowerCase() || "";
    const specFile = expectedPath ? cleanThemeSpecFile(expectedPath) : "";
    if (expectedPath && !specFile) {
      throw new Error("invalid ThemeSpec path");
    }
    const renderPackPath = expectedPath
      ? path.join(themeRenderPacksDir(), safeThemeId, specFile)
      : path.join(themeRenderPacksDir(), `${safeThemeId}.json`);
    const renderPack = JSON.parse(await readFile(renderPackPath, "utf8")) as {
      ok?: boolean;
      themeId?: string;
      name?: string;
      spec?: unknown;
      specHash?: string;
      specPath?: string;
      assets?: Record<string, ThemePackAsset>;
    };
    if (
      renderPack.ok !== true ||
      renderPack.themeId !== safeThemeId ||
      !renderPack.spec ||
      !/^[a-f0-9]{8}$/.test(renderPack.specHash || "") ||
      (expectedPath && renderPack.specPath !== expectedPath) ||
      (expectedHash && renderPack.specHash !== expectedHash)
    ) {
      throw new Error("Theme revision mismatch");
    }
    return Response.json(renderPack);
  } catch {
    return Response.json(
      { ok: false, error: "Theme is not available." },
      { status: 404 },
    );
  }
}

function themeRenderPacksDir(): string {
  return path.resolve(process.cwd(), "../../dist/theme-packs/render");
}

function normalizeThemeId(value: string): string {
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{2,63}$/.test(normalized) ? normalized : "";
}

function cleanThemeSpecFile(value: string): string {
  const file = path.posix.basename(value.trim());
  return /^[a-zA-Z0-9._-]+\.json$/.test(file) ? file : "";
}
