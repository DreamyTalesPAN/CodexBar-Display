#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeImmutableFile } from "./immutable-publish.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(repoRoot, "theme-packs");
const distRoot = path.join(repoRoot, "dist", "theme-packs");
const legacyCatalogPath = path.join(distRoot, "vibetv-theme-packs.json");
const currentCatalogPath = path.join(distRoot, "vibetv-theme-packs-v2.json");
const frozenLegacyCatalogSha256 =
  "f704a52016a7a5ca1a66e10a432e80b59b56a122dcd360db4198858431c67800";
const frozenLegacyThemeSpecPaths = new Map([
  ["claude-creature", "/themes/u/claude--1-623de0.json"],
  ["clippy", "/themes/u/clippy-1-caafce.json"],
  ["cozy-meadow", "/themes/u/cm.json"],
  ["mini-classic", "/themes/u/mini-cl-1-e4fe6b.json"],
  ["synthwave", "/themes/u/synthwa-1-6b39a3.json"],
]);

const legacyCatalogBytes = await readFile(legacyCatalogPath);
assert(
  sha256(legacyCatalogBytes) === frozenLegacyCatalogSha256,
  "legacy catalog changed; publish a new catalog generation instead",
);

const legacyCatalog = JSON.parse(legacyCatalogBytes);
const currentCatalog = JSON.parse(await readFile(currentCatalogPath, "utf8"));
assert(legacyCatalog.schemaVersion === 1, "legacy catalog schema changed");
assert(currentCatalog.schemaVersion === 1, "current catalog schema changed");
assert(currentCatalog.generation === 2, "current catalog generation changed");

const legacyById = new Map(legacyCatalog.themes.map((theme) => [theme.id, theme]));
const currentById = new Map(currentCatalog.themes.map((theme) => [theme.id, theme]));
assert(
  legacyById.size === legacyCatalog.themes.length,
  "legacy catalog contains duplicate theme ids",
);
assert(
  currentById.size === currentCatalog.themes.length,
  "current catalog contains duplicate theme ids",
);

for (const legacyTheme of legacyCatalog.themes) {
  assert(currentById.has(legacyTheme.id), `current catalog dropped ${legacyTheme.id}`);
  assert(
    legacyTheme.downloadAsset === `vibetv-theme-${legacyTheme.id}.zip`,
    `legacy asset name changed for ${legacyTheme.id}`,
  );
  await assertCatalogAsset(legacyTheme, "legacy");
  await assertRenderPack(legacyTheme, "legacy");
}

for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith(".")) {
    continue;
  }
  const themeDir = path.join(sourceRoot, entry.name);
  const manifest = JSON.parse(
    await readFile(path.join(themeDir, "manifest.json"), "utf8"),
  );
  const specBytes = await readFile(
    path.join(themeDir, manifest.themeSpec?.file || "theme.json"),
  );
  const spec = JSON.parse(specBytes);
  const catalogTheme = currentById.get(manifest.id);
  assert(catalogTheme, `current catalog is missing ${manifest.id}`);
  assert(manifest.id === entry.name, `manifest id mismatch in ${entry.name}`);
  assert(
    catalogTheme.version === manifest.version,
    `catalog version mismatch for ${manifest.id}`,
  );
  assert(
    catalogTheme.themeRev === spec.rev,
    `catalog revision mismatch for ${manifest.id}`,
  );
  assert(
    catalogTheme.themeSpecPath === manifest.themeSpec.path,
    `catalog ThemeSpec path mismatch for ${manifest.id}`,
  );
  assert(
    catalogTheme.usage === (String(manifest.usage || "live").trim() || "live"),
    `catalog usage mismatch for ${manifest.id}`,
  );
  if (legacyById.has(manifest.id)) {
    assert(spec.rev >= 2, `${manifest.id} must use a post-legacy revision`);
    assert(
      manifest.requiredCapabilities?.includes("usage-slots-v1"),
      `${manifest.id} does not require usage-slots-v1`,
    );
  }
  assert(
    manifest.themeSpec.path.includes(`-${spec.rev}-`),
    `${manifest.id} must use a revisioned ThemeSpec device path`,
  );
  assert(
    manifest.themeSpec.path.length <= 31,
    `${manifest.id} ThemeSpec device path exceeds 31 characters`,
  );
  assert(
    manifest.themeSpec.bytes === specBytes.byteLength,
    `${manifest.id} ThemeSpec byte count is stale`,
  );
  assert(
    manifest.themeSpec.sha256 === sha256(specBytes),
    `${manifest.id} ThemeSpec checksum is stale`,
  );
  assert(
    catalogTheme.downloadAsset ===
      `vibetv-theme-${manifest.id}-v${manifest.version}.zip`,
    `current asset is not versioned for ${manifest.id}`,
  );
  assert(
    catalogTheme.requiresFirmware === manifest.minFirmware,
    `firmware requirement mismatch for ${manifest.id}`,
  );
  assert(
    arraysEqual(
      catalogTheme.requiredCapabilities || [],
      manifest.requiredCapabilities || [],
    ),
    `capability requirement mismatch for ${manifest.id}`,
  );
  await assertCatalogAsset(catalogTheme, "current");
  await assertRenderPack(catalogTheme, "current");
}

for (const catalogTheme of currentCatalog.themes) {
  const themeDir = path.join(sourceRoot, catalogTheme.id);
  assert(await isDirectory(themeDir), `current catalog has no source for ${catalogTheme.id}`);
}

await assertPreservedFactoryMiniRenderPack();
await assertImmutableRevisionPublishing();

console.log(
  `theme pack release flow ok: ${legacyCatalog.themes.length} frozen legacy themes, ${currentCatalog.themes.length} current themes`,
);

async function assertCatalogAsset(theme, generation) {
  const assetPath = path.join(distRoot, theme.downloadAsset);
  const bytes = await readFile(assetPath);
  assert(
    bytes.byteLength === theme.bytes,
    `${generation} asset byte count mismatch for ${theme.id}`,
  );
  assert(
    sha256(bytes) === theme.sha256,
    `${generation} asset checksum mismatch for ${theme.id}`,
  );
}

async function assertRenderPack(theme, generation) {
  const revisionDir = path.join(distRoot, "render", theme.id);
  const expectedSpecPath =
    theme.themeSpecPath ||
    (generation === "legacy" ? frozenLegacyThemeSpecPaths.get(theme.id) : "");
  const specFile = path.posix.basename(expectedSpecPath || "");
  assert(
    /^[a-zA-Z0-9._-]+\.json$/.test(specFile),
    `${generation} render pack path is unsafe for ${theme.id}`,
  );
  const pack = JSON.parse(
    await readFile(path.join(revisionDir, specFile), "utf8"),
  );
  assert(pack.ok === true, `${generation} render pack is not ready for ${theme.id}`);
  assert(pack.themeId === theme.id, `${generation} render pack id mismatch for ${theme.id}`);
  assert(
    pack.specPath === expectedSpecPath,
    `${generation} render pack path mismatch for ${theme.id}`,
  );
  assert(
    Number(pack.spec?.rev || pack.spec?.themeRev || 1) === theme.themeRev,
    `${generation} render pack revision mismatch for ${theme.id}`,
  );
  assert(
    /^[a-f0-9]{8}$/.test(pack.specHash || ""),
    `${generation} render pack fingerprint mismatch for ${theme.id}`,
  );
  if (generation === "current") {
    const alias = JSON.parse(
      await readFile(path.join(distRoot, "render", `${theme.id}.json`), "utf8"),
    );
    assert(
      alias.specPath === pack.specPath && alias.specHash === pack.specHash,
      `current render pack alias mismatch for ${theme.id}`,
    );
  }
}

async function assertPreservedFactoryMiniRenderPack() {
  const specPath = "/themes/u/mini-cl-1-410a37.json";
  const firmwareSource = await readFile(
    path.join(repoRoot, "firmware_esp8266", "src", "main.cpp"),
    "utf8",
  );
  assert(
    firmwareSource.includes(
      'kLegacyMiniThemeSpecPath = "/themes/u/mini-cl-1-410a37.json"',
    ) &&
      firmwareSource.includes(
        'raw.replace("\\"v\\":\\"left\\"", "\\"v\\":\\"{usageMode}\\"")',
      ),
    "preserved factory Mini build compatibility drifted from firmware",
  );

  const pack = JSON.parse(
    await readFile(
      path.join(distRoot, "render", "mini-classic", path.posix.basename(specPath)),
      "utf8",
    ),
  );
  assert(pack.ok === true, "preserved factory Mini render pack is not ready");
  assert(pack.themeId === "mini-classic", "preserved factory Mini id changed");
  assert(pack.specPath === specPath, "preserved factory Mini path changed");
  assert(pack.specHash === "28095cf9", "preserved factory Mini runtime hash changed");
  assert(
    JSON.stringify(pack.spec).includes('"v":"left"') === false,
    "preserved factory Mini kept incompatible hard-coded labels",
  );
  assert(
    JSON.stringify(pack.spec).split('"v":"{usageMode}"').length - 1 === 2,
    "preserved factory Mini compatibility substitution changed",
  );
  assert(
    Object.keys(pack.assets || {}).length === 1 &&
      pack.assets["/themes/mini/mini.gif"]?.encoding === "base64" &&
      sha256(
        Buffer.from(pack.assets["/themes/mini/mini.gif"].data, "base64"),
      ) === "146563e7d7ce76589f50ea80977c1f8cb32a15468a4a9f3da4152c4de1b37230",
    "preserved factory Mini asset mapping changed",
  );

  const currentMini = currentById.get("mini-classic");
  const currentAlias = JSON.parse(
    await readFile(path.join(distRoot, "render", "mini-classic.json"), "utf8"),
  );
  assert(
    currentAlias.specPath === currentMini?.themeSpecPath &&
      currentAlias.specPath !== specPath,
    "preserved factory Mini must not replace the current alias",
  );

  const legacyMini = JSON.parse(
    await readFile(
      path.join(distRoot, "render", "mini-classic", "mini-cl-1-e4fe6b.json"),
      "utf8",
    ),
  );
  assert(
    legacyMini.specPath === "/themes/u/mini-cl-1-e4fe6b.json" &&
      legacyMini.specPath !== specPath,
    "preserved factory Mini must not replace the frozen legacy archive",
  );
}

async function assertImmutableRevisionPublishing() {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "vibetv-render-revision-"));
  const revisionPath = path.join(tempRoot, "theme-1-aaaaaaaa.json");
  const original = Buffer.from('{"specHash":"aaaaaaaa"}\n');
  const conflict = Buffer.from('{"specHash":"bbbbbbbb"}\n');
  const conflictMessage = "refusing to overwrite immutable test revision";

  try {
    assert(
      await writeImmutableFile(revisionPath, original, conflictMessage),
      "new immutable render revision was not written",
    );
    assert(
      !(await writeImmutableFile(revisionPath, original, conflictMessage)),
      "matching immutable render revision was rewritten",
    );

    let rejected = false;
    try {
      await writeImmutableFile(revisionPath, conflict, conflictMessage);
    } catch (error) {
      rejected = error instanceof Error && error.message === conflictMessage;
    }
    assert(rejected, "conflicting immutable render revision was not rejected");
    assert(
      (await readFile(revisionPath)).equals(original),
      "conflicting immutable render revision changed published bytes",
    );
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
}

async function isDirectory(value) {
  try {
    return (await stat(value)).isDirectory();
  } catch {
    return false;
  }
}

function arraysEqual(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
