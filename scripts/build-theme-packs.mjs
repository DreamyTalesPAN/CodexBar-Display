#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(repoRoot, "theme-packs");
const distRoot = path.join(repoRoot, "dist/theme-packs");
const renderRoot = path.join(distRoot, "render");
const companionRoot = path.join(repoRoot, "companion");
const currentCatalogName = "vibetv-theme-packs-v2.json";
const deterministicZipTimestamp = "200001010000.00";

await mkdir(distRoot, { recursive: true });

const themeDirs = [];
for (const name of await readdir(sourceRoot)) {
  if (name.startsWith(".")) {
    continue;
  }
  const dir = path.join(sourceRoot, name);
  if ((await stat(dir)).isDirectory()) {
    themeDirs.push({ id: name, dir });
  }
}
themeDirs.sort((a, b) => a.id.localeCompare(b.id));

if (themeDirs.length === 0) {
  throw new Error(`No theme packs found in ${sourceRoot}`);
}

const catalog = {
  schemaVersion: 1,
  generation: 2,
  themes: [],
};

for (const theme of themeDirs) {
  validatePack(theme.dir);

  const manifest = JSON.parse(await readFile(path.join(theme.dir, "manifest.json"), "utf8"));
  if (manifest.id !== theme.id) {
    throw new Error(`theme directory ${theme.id} contains manifest id ${manifest.id}`);
  }
  const version = String(manifest.version || "").trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`theme ${manifest.id} needs a SemVer version`);
  }
  const zipName = `vibetv-theme-${manifest.id}-v${version}.zip`;
  const zipPath = path.join(distRoot, zipName);
  const zipBytes = await buildImmutableZip(theme.dir, manifest.id, zipPath);
  catalog.themes.push({
    id: manifest.id,
    title: manifest.name || manifest.id,
    version,
    themeRev: await themeRevFromManifest(manifest),
    themeSpecPath: manifest.themeSpec?.path,
    requiresFirmware: manifest.minFirmware,
    requiredCapabilities: manifest.requiredCapabilities,
    downloadAsset: zipName,
    sha256: createHash("sha256").update(zipBytes).digest("hex"),
    bytes: zipBytes.byteLength,
  });
  console.log(`built ${zipName} (${zipBytes.byteLength} bytes)`);
}

await writeCatalog(catalog);
await writeRenderPacks();
console.log(`built GitHub theme catalog dist/theme-packs/${currentCatalogName} (${catalog.themes.length} themes)`);

async function buildImmutableZip(themeDir, themeId, zipPath) {
  const tempZipPath = `${zipPath}.tmp-${process.pid}.zip`;
  await rm(tempZipPath, { force: true });
  try {
    const files = await listPackFiles(themeDir);
    normalizeZipFileTimestamps(themeDir, files);
    const zipResult = spawnSync("zip", ["-X", "-q", tempZipPath, ...files], {
      cwd: themeDir,
      encoding: "utf8",
    });
    if (zipResult.status !== 0) {
      throw new Error(`zip failed for ${themeId}: ${zipResult.stderr || zipResult.stdout}`);
    }

    validatePack(tempZipPath);
    const zipBytes = await readFile(tempZipPath);
    let publishedBytes;
    try {
      publishedBytes = await readFile(zipPath);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
    if (publishedBytes && !publishedBytes.equals(zipBytes)) {
      throw new Error(
        `refusing to overwrite immutable theme asset ${path.basename(zipPath)}; bump manifest.version`,
      );
    }
    if (!publishedBytes) {
      await rename(tempZipPath, zipPath);
    }
    return zipBytes;
  } finally {
    await rm(tempZipPath, { force: true });
  }
}

function validatePack(packRef) {
  const result = spawnSync("go", ["run", "./cmd/codexbar-display", "theme-pack", "validate", "--pack", packRef], {
    cwd: companionRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`theme-pack validation failed for ${packRef}:\n${result.stderr || result.stdout}`);
  }
}

function normalizeZipFileTimestamps(root, files) {
  if (files.length === 0) {
    return;
  }
  const result = spawnSync("touch", ["-t", deterministicZipTimestamp, ...files], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`touch failed for ${root}: ${result.stderr || result.stdout}`);
  }
}

async function listPackFiles(root) {
  const files = [];
  await walk("");
  return files.sort();

  async function walk(relativeDir) {
    const absoluteDir = path.join(root, relativeDir);
    const entries = await readdir(absoluteDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relativePath = path.posix.join(relativeDir.split(path.sep).join(path.posix.sep), entry.name);
      const absolutePath = path.join(root, relativePath);
      if (entry.isDirectory()) {
        await walk(relativePath);
      } else if (entry.isFile()) {
        files.push(path.relative(root, absolutePath).split(path.sep).join(path.posix.sep));
      }
    }
  }
}

async function themeRevFromManifest(manifest) {
  const specPath = path.join(sourceRoot, manifest.id, manifest.themeSpec?.file || "theme.json");
  try {
    const spec = JSON.parse(await readFile(specPath, "utf8"));
    return Number(spec.rev || spec.themeRev || 1);
  } catch {
    return 1;
  }
}

async function writeCatalog(catalog) {
  catalog.themes.sort((a, b) => a.id.localeCompare(b.id));
  await writeFile(path.join(distRoot, currentCatalogName), `${JSON.stringify(catalog, null, 2)}\n`);
}

async function writeRenderPacks() {
  // Revision files are immutable preview inputs for VibeTVs that have not
  // installed the newest theme yet. Keep them and only advance the aliases.
  await mkdir(renderRoot, { recursive: true });

  for (const theme of themeDirs) {
    const pack = await readRenderPack(theme.dir, theme.id);
    await writeRenderPack(pack, true);
  }

  const legacyCatalog = JSON.parse(
    await readFile(path.join(distRoot, "vibetv-theme-packs.json"), "utf8"),
  );
  for (const theme of legacyCatalog.themes || []) {
    const themeID = cleanThemeID(theme.id);
    const archiveName = cleanRelativeFile(theme.downloadAsset);
    const extractRoot = await mkdtemp(path.join(tmpdir(), `vibetv-theme-${themeID}-`));
    try {
      const unzipResult = spawnSync("unzip", ["-q", path.join(distRoot, archiveName), "-d", extractRoot], {
        cwd: repoRoot,
        encoding: "utf8",
      });
      if (unzipResult.status !== 0) {
        throw new Error(`unzip failed for ${archiveName}: ${unzipResult.stderr || unzipResult.stdout}`);
      }
      await writeRenderPack(await readRenderPack(extractRoot, themeID), false);
    } finally {
      await rm(extractRoot, { force: true, recursive: true });
    }
  }
}

async function readRenderPack(themeDir, fallbackThemeID) {
  const manifest = JSON.parse(await readFile(path.join(themeDir, "manifest.json"), "utf8"));
  const specFile = cleanRelativeFile(manifest.themeSpec?.file || "theme.json");
  const specRaw = await readFile(path.join(themeDir, specFile), "utf8");
  const assets = {};
  for (const asset of manifest.assets || []) {
    const devicePath = String(asset.path || "").trim();
    const file = cleanRelativeFile(asset.file || "");
    if (!devicePath || !file) {
      continue;
    }
    const contentType = String(asset.contentType || "application/octet-stream").trim();
    const data = await readFile(path.join(themeDir, file));
    const textAsset = /^text\//i.test(contentType) || /\.(cbi|cba)$/i.test(file);
    assets[devicePath] = {
      contentType,
      data: textAsset ? data.toString("utf8") : data.toString("base64"),
      encoding: textAsset ? "text" : "base64",
    };
  }
  return {
    ok: true,
    themeId: cleanThemeID(manifest.id || fallbackThemeID),
    name: manifest.name || fallbackThemeID,
    spec: JSON.parse(specRaw),
    specHash: fnv1aHex8(specRaw),
    specPath: String(manifest.themeSpec?.path || "").trim(),
    assets,
  };
}

async function writeRenderPack(pack, writeLatestAlias) {
  const specFile = cleanThemeSpecFile(pack.specPath);
  const revisionDir = path.join(renderRoot, pack.themeId);
  const payload = `${JSON.stringify(pack)}\n`;
  await mkdir(revisionDir, { recursive: true });
  await writeFile(path.join(revisionDir, specFile), payload);
  if (writeLatestAlias) {
    await writeFile(path.join(renderRoot, `${pack.themeId}.json`), payload);
  }
}

function cleanThemeID(value) {
  const clean = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(clean)) {
    throw new Error(`unsafe theme id: ${value}`);
  }
  return clean;
}

function cleanThemeSpecFile(value) {
  const clean = path.posix.basename(String(value || "").trim());
  if (!/^[a-zA-Z0-9._-]+\.json$/.test(clean)) {
    throw new Error(`unsafe ThemeSpec path: ${value}`);
  }
  return clean;
}

function cleanRelativeFile(value) {
  const clean = String(value || "").trim();
  if (!clean || clean.startsWith("/") || clean.includes("..")) {
    throw new Error(`unsafe theme file path: ${value}`);
  }
  return clean;
}

function fnv1aHex8(value) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(String(value).trim())) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
