#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(repoRoot, "theme-packs");
const distRoot = path.join(repoRoot, "dist/theme-packs");
const companionRoot = path.join(repoRoot, "companion");

await rm(distRoot, { recursive: true, force: true });
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
  themes: [],
};

for (const theme of themeDirs) {
  validatePack(theme.dir);

  const manifest = JSON.parse(await readFile(path.join(theme.dir, "manifest.json"), "utf8"));
  const zipName = `vibetv-theme-${manifest.id}.zip`;
  const zipPath = path.join(distRoot, zipName);
  await rm(zipPath, { force: true });

  const files = await listPackFiles(theme.dir);
  const zipResult = spawnSync("zip", ["-X", "-q", zipPath, ...files], {
    cwd: theme.dir,
    encoding: "utf8",
  });
  if (zipResult.status !== 0) {
    throw new Error(`zip failed for ${manifest.id}: ${zipResult.stderr || zipResult.stdout}`);
  }

  validatePack(zipPath);

  const zipBytes = await readFile(zipPath);
  catalog.themes.push({
    id: manifest.id,
    title: manifest.name || manifest.id,
    themeRev: await themeRevFromManifest(manifest),
    downloadAsset: zipName,
    sha256: createHash("sha256").update(zipBytes).digest("hex"),
    bytes: zipBytes.byteLength,
  });
  console.log(`built ${zipName} (${zipBytes.byteLength} bytes)`);
}

await writeCatalog(catalog);
console.log(`built GitHub theme catalog dist/theme-packs/vibetv-theme-packs.json (${catalog.themes.length} themes)`);

function validatePack(packRef) {
  const result = spawnSync("go", ["run", "./cmd/codexbar-display", "theme-pack", "validate", "--pack", packRef], {
    cwd: companionRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`theme-pack validation failed for ${packRef}:\n${result.stderr || result.stdout}`);
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
  await writeFile(path.join(distRoot, "vibetv-theme-packs.json"), `${JSON.stringify(catalog, null, 2)}\n`);
}
