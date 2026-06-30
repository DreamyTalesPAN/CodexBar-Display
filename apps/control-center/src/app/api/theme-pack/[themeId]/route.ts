import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_THEME_PACK_RAW_BASE_URL =
  "https://raw.githubusercontent.com/DreamyTalesPAN/CodexBar-Display/main/theme-packs";

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
    return Response.json(await readThemePackFromLocalFiles(safeThemeId));
  } catch {
    try {
      return Response.json(await readThemePackFromRemoteFiles(safeThemeId));
    } catch {
      return Response.json(
        { ok: false, error: "Theme is not available." },
        { status: 404 },
      );
    }
  }
}

function themePacksDir(): string {
  return path.resolve(process.cwd(), "../../theme-packs");
}

async function readThemePackFromLocalFiles(safeThemeId: string) {
  const themeDir = path.join(themePacksDir(), safeThemeId);
  const manifest = JSON.parse(
    await readFile(path.join(themeDir, "manifest.json"), "utf8"),
  ) as ThemePackManifest;
  return buildThemePackResponse(safeThemeId, manifest, async (file) =>
    readFile(path.join(themeDir, file)),
  );
}

async function readThemePackFromRemoteFiles(safeThemeId: string) {
  const baseUrl = themePackRawBaseUrl();
  const manifest = (await readRemoteJson(
    `${baseUrl}/${safeThemeId}/manifest.json`,
  )) as ThemePackManifest;
  return buildThemePackResponse(safeThemeId, manifest, (file) =>
    readRemoteBytes(`${baseUrl}/${safeThemeId}/${file}`),
  );
}

async function buildThemePackResponse(
  safeThemeId: string,
  manifest: ThemePackManifest,
  readBytes: (file: string) => Promise<Buffer>,
) {
  const specFile = cleanRelativeFile(manifest.themeSpec?.file || "theme.json");
  if (!specFile) {
    throw new Error("Theme spec file is invalid.");
  }
  const spec = JSON.parse((await readBytes(specFile)).toString("utf8"));
  const assets: Record<string, ThemePackAsset> = {};

  for (const asset of manifest.assets || []) {
    const devicePath = asset.path?.trim();
    const file = cleanRelativeFile(asset.file || "");
    if (!devicePath || !file) {
      continue;
    }
    const contentType = asset.contentType?.trim() || "application/octet-stream";
    const data = await readBytes(file);
    const textAsset = /^text\//i.test(contentType) || /\.(cbi|cba)$/i.test(file);
    assets[devicePath] = {
      contentType,
      data: textAsset ? data.toString("utf8") : data.toString("base64"),
      encoding: textAsset ? "text" : "base64",
    };
  }

  return {
    ok: true,
    themeId: manifest.id || safeThemeId,
    name: manifest.name || safeThemeId,
    spec,
    specPath: manifest.themeSpec?.path,
    assets,
  };
}

function themePackRawBaseUrl(): string {
  const configured = process.env.THEME_PACK_RAW_BASE_URL?.trim();
  return (configured || DEFAULT_THEME_PACK_RAW_BASE_URL).replace(/\/+$/, "");
}

async function readRemoteJson(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Theme pack file is not available: ${response.status}`);
  }
  return response.json();
}

async function readRemoteBytes(url: string): Promise<Buffer> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Theme pack file is not available: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
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
