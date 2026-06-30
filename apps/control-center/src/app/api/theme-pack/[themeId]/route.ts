import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ themeId: string }>;
};

type ThemePackManifest = {
  id?: string;
  name?: string;
  themeSpec?: {
    path?: string;
    file?: string;
    contentType?: string;
  };
  assets?: Array<{
    path?: string;
    file?: string;
    contentType?: string;
  }>;
};

type ThemePackAsset = {
  contentType: string;
  data: string;
  encoding: "base64" | "text";
};

export async function GET(_request: Request, context: RouteContext) {
  const { themeId } = await context.params;
  const safeThemeId = normalizeThemeId(themeId);
  if (!safeThemeId) {
    return Response.json(
      { ok: false, error: "Theme is not available." },
      { status: 404 },
    );
  }

  try {
    const themeDir = path.join(themePacksDir(), safeThemeId);
    const manifest = JSON.parse(
      await readFile(path.join(themeDir, "manifest.json"), "utf8"),
    ) as ThemePackManifest;
    const specFile = cleanRelativeFile(manifest.themeSpec?.file || "theme.json");
    const spec = JSON.parse(await readFile(path.join(themeDir, specFile), "utf8"));
    const assets: Record<string, ThemePackAsset> = {};

    for (const asset of manifest.assets || []) {
      const devicePath = asset.path?.trim();
      const file = cleanRelativeFile(asset.file || "");
      if (!devicePath || !file) {
        continue;
      }
      const contentType = asset.contentType?.trim() || "application/octet-stream";
      const data = await readFile(path.join(themeDir, file));
      const textAsset = /^text\//i.test(contentType) || /\.(cbi|cba)$/i.test(file);
      assets[devicePath] = {
        contentType,
        data: textAsset ? data.toString("utf8") : data.toString("base64"),
        encoding: textAsset ? "text" : "base64",
      };
    }

    return Response.json({
      ok: true,
      themeId: manifest.id || safeThemeId,
      name: manifest.name || safeThemeId,
      spec,
      specPath: manifest.themeSpec?.path,
      assets,
    });
  } catch {
    return Response.json(
      { ok: false, error: "Theme is not available." },
      { status: 404 },
    );
  }
}

function themePacksDir(): string {
  return path.resolve(process.cwd(), "../../theme-packs");
}

function normalizeThemeId(value: string): string {
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{2,63}$/.test(normalized) ? normalized : "";
}

function cleanRelativeFile(value: string): string {
  const clean = value.trim();
  if (!clean || clean.startsWith("/") || clean.includes("..")) {
    return "";
  }
  return clean;
}
