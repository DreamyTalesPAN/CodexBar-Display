import { readFile } from "node:fs/promises";
import path from "node:path";
import { themeSpecHash } from "@/lib/theme-spec-hash";

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
    if (expectedPath) {
      const revisionPack = await readRevisionRenderPack(
        safeThemeId,
        expectedPath,
      );
      if (
        revisionPack &&
        (!expectedHash || revisionPack.specHash === expectedHash)
      ) {
        return Response.json(revisionPack);
      }
      return Response.json(
        { ok: false, error: "Theme revision is not available." },
        { status: 404 },
      );
    }

    const themeDir = path.join(themePacksDir(), safeThemeId);
    const manifest = JSON.parse(
      await readFile(path.join(themeDir, "manifest.json"), "utf8"),
    ) as ThemePackManifest;
    const specFile = cleanRelativeFile(manifest.themeSpec?.file || "theme.json");
    const specRaw = await readFile(path.join(themeDir, specFile), "utf8");
    const spec = JSON.parse(specRaw);
    const specPath = manifest.themeSpec?.path?.trim() || "";
    const specHash = themeSpecHash(specRaw);
    if (
      expectedHash && expectedHash !== specHash
    ) {
      return Response.json(
        { ok: false, error: "Theme revision is not available." },
        { status: 404 },
      );
    }
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
      specHash,
      specPath,
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

async function readRevisionRenderPack(
  themeId: string,
  specPath: string,
): Promise<{
  ok?: boolean;
  themeId?: string;
  name?: string;
  spec?: unknown;
  specHash?: string;
  specPath?: string;
  assets?: Record<string, ThemePackAsset>;
} | null> {
  const specFile = cleanThemeSpecFile(specPath);
  if (!specFile) {
    return null;
  }
  try {
    const payload = JSON.parse(
      await readFile(
        path.join(themeRenderPacksDir(), themeId, specFile),
        "utf8",
      ),
    );
    if (
      payload?.themeId !== themeId ||
      payload?.specPath !== specPath ||
      !payload?.spec ||
      !/^[a-f0-9]{8}$/.test(payload?.specHash || "")
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function themeRenderPacksDir(): string {
  return path.resolve(process.cwd(), "../../dist/theme-packs/render");
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

function cleanThemeSpecFile(value: string): string {
  const file = path.posix.basename(value.trim());
  return /^[a-zA-Z0-9._-]+\.json$/.test(file) ? file : "";
}
