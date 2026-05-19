import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
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

          if (req.method === "POST" && req.url === "/api/theme-packs/publish") {
            const payload = await readJsonBody(req);
            const themeId = typeof payload.themeId === "string" ? payload.themeId.trim() : "";
            if (!themeIdPattern.test(themeId)) {
              await sendJson(res, 400, { error: "Theme id must be lowercase and 3-64 characters." });
              return;
            }
            if (!Array.isArray(payload.files) || payload.files.length === 0) {
              await sendJson(res, 400, { error: "Theme pack payload has no files." });
              return;
            }

            const tempDir = path.join(themePackRoot, `.publish-${themeId}-${Date.now()}`);
            const targetDir = path.join(themePackRoot, themeId);
            await rm(tempDir, { recursive: true, force: true });
            await mkdir(tempDir, { recursive: true });

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

            const build = spawnSync(process.execPath, ["scripts/build-theme-packs.mjs"], {
              cwd: repoRoot,
              encoding: "utf8",
            });
            if (build.status !== 0) {
              throw new Error(build.stderr || build.stdout || "Theme pack build failed.");
            }

            await sendJson(res, 200, {
              ok: true,
              themeId,
              themeIds: await listThemePackIds(),
              output: build.stdout.trim(),
            });
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
