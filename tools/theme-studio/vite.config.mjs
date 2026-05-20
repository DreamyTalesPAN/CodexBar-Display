import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const themeIdPattern = /^[a-z0-9][a-z0-9\-_]{2,63}$/;
const toolRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolRoot, "../..");
const themePackRoot = path.join(repoRoot, "theme-packs");

export default defineConfig({
  plugins: [themePackPublishPlugin()],
});

function themePackPublishPlugin() {
  return {
    name: "vibetv-theme-pack-publish",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          if (req.method === "GET" && req.url === "/api/theme-packs") {
            await sendJson(res, 200, { themeIds: await listThemePackIds() });
            return;
          }

          if (req.method === "GET" && req.url === "/api/theme-packs/sources") {
            await sendJson(res, 200, { themes: await loadThemePackSources() });
            return;
          }

          if (req.method === "GET" && req.url?.startsWith("/api/theme-packs/")) {
            const themeId = decodeURIComponent(req.url.slice("/api/theme-packs/".length));
            if (!themeIdPattern.test(themeId)) {
              await sendJson(res, 400, { error: "Invalid theme id." });
              return;
            }
            const themeIds = await listThemePackIds();
            await sendJson(res, 200, { exists: themeIds.includes(themeId), themeIds });
            return;
          }

          if (req.method === "POST" && req.url === "/api/theme-packs/save") {
            const payload = await readJsonBody(req);
            const result = await writeThemePackPayload(payload, { buildDist: false });
            await sendJson(res, 200, result);
            return;
          }

          if (req.method === "POST" && req.url === "/api/theme-packs/publish") {
            const payload = await readJsonBody(req);
            const result = await writeThemePackPayload(payload, { buildDist: true });
            await sendJson(res, 200, result);
            return;
          }
        } catch (error) {
          await sendJson(res, 500, { error: error instanceof Error ? error.message : "Theme pack publish failed." });
          return;
        }

        next();
      });
    },
  };
}

async function listThemePackIds() {
  const entries = await readdir(themePackRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .filter((name) => themeIdPattern.test(name))
    .sort((a, b) => a.localeCompare(b));
}

async function loadThemePackSources() {
  const themeIds = await listThemePackIds();
  const themes = [];
  for (const themeId of themeIds) {
    const theme = await loadThemePackSource(themeId);
    if (theme !== null) {
      themes.push(theme);
    }
  }
  return themes;
}

async function loadThemePackSource(themeId) {
  const packDir = path.join(themePackRoot, themeId);
  try {
    const manifest = JSON.parse(await readFile(path.join(packDir, "manifest.json"), "utf8"));
    const themeSpecFile = safePackFile(manifest?.themeSpec?.file || "theme.json");
    const spec = JSON.parse(await readFile(path.join(packDir, themeSpecFile), "utf8"));
    const assets = [];
    for (const entry of Array.isArray(manifest?.assets) ? manifest.assets : []) {
      const file = safePackFile(entry?.file);
      const data = await readFile(path.join(packDir, file));
      assets.push({
        path: typeof entry?.path === "string" ? entry.path : "",
        file,
        contentType: typeof entry?.contentType === "string" ? entry.contentType : "",
        dataBase64: data.toString("base64"),
      });
    }
    const packStat = await stat(packDir);
    return {
      themeId,
      savedAt: packStat.mtime.toISOString(),
      spec,
      assets,
    };
  } catch {
    return null;
  }
}

async function writeThemePackPayload(payload, options) {
  const themeId = typeof payload.themeId === "string" ? payload.themeId.trim() : "";
  if (!themeIdPattern.test(themeId)) {
    throw new Error("Theme id must be lowercase and 3-64 characters.");
  }
  if (!Array.isArray(payload.files) || payload.files.length === 0) {
    throw new Error("Theme pack payload has no files.");
  }

  const tempDir = path.join(themePackRoot, `.publish-${themeId}-${Date.now()}`);
  const targetDir = path.join(themePackRoot, themeId);
  await rm(tempDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true });

  try {
    for (const fileEntry of payload.files) {
      const file = safePackFile(fileEntry?.file);
      const dataBase64 = typeof fileEntry?.dataBase64 === "string" ? fileEntry.dataBase64 : "";
      if (!dataBase64) {
        throw new Error(`Missing data for ${file}.`);
      }
      const absolutePath = path.join(tempDir, file);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, Buffer.from(dataBase64, "base64"));
    }

    validateThemePack(tempDir);
    await rm(targetDir, { recursive: true, force: true });
    await rename(tempDir, targetDir);
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }

  let output = "";
  if (options.buildDist) {
    const build = spawnSync(process.execPath, ["scripts/build-theme-packs.mjs"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    if (build.status !== 0) {
      throw new Error(build.stderr || build.stdout || "Theme pack build failed.");
    }
    output = build.stdout.trim();
  }

  return {
    ok: true,
    themeId,
    themeIds: await listThemePackIds(),
    output,
  };
}

function safePackFile(value) {
  if (typeof value !== "string") {
    throw new Error("Theme pack file path is missing.");
  }
  const normalized = value.trim().replace(/\\/g, "/");
  const clean = path.posix.normalize(normalized);
  if (!clean || clean === "." || clean.startsWith("../") || clean === ".." || clean.startsWith("/")) {
    throw new Error(`Unsafe theme pack file path: ${value}`);
  }
  return clean;
}

function validateThemePack(packPath) {
  const result = spawnSync("go", ["run", "./cmd/codexbar-display", "theme-pack", "validate", "--pack", packPath], {
    cwd: path.join(repoRoot, "companion"),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Theme pack validation failed.");
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("error", reject);
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(data));
  res.end(data);
}
