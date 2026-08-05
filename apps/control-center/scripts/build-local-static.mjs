import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  cp,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(appRoot, "../..");
const workRoot = path.join(repoRoot, "tmp", "control-center-local-export");
const buildRoot = path.join(workRoot, "app");
const outRoot = path.join(appRoot, "out-local");
const nextBin = path.join(appRoot, "node_modules", "next", "dist", "bin", "next");
const localCompanionThemeCatalogUrl =
  "http://127.0.0.1:47832/theme-packs/vibetv-theme-packs-v2.json";

async function main() {
  await ensureNodeModules();
  await rm(workRoot, { force: true, recursive: true });
  await rm(outRoot, { force: true, recursive: true });
  await mkdir(workRoot, { recursive: true });
  await cp(appRoot, buildRoot, {
    filter: shouldCopyAppFile,
    recursive: true,
  });
  await symlink(path.join(appRoot, "node_modules"), path.join(buildRoot, "node_modules"), "dir");
  await rm(path.join(buildRoot, "src", "app", "api"), {
    force: true,
    recursive: true,
  });
  await cp(
    path.join(repoRoot, "dist", "theme-packs", "vibetv-theme-packs-v2.json"),
    path.join(buildRoot, "local-theme-packs.json"),
  );

  await runCommand(process.execPath, [nextBin, "build", "--webpack"], {
    cwd: buildRoot,
    env: {
      ...process.env,
      CONTROL_CENTER_ALLOW_CATALOG_FALLBACK: "1",
      CONTROL_CENTER_GITHUB_TOKEN: "",
      GITHUB_TOKEN: "",
      SHOPIFY_SHOP_DOMAIN: "",
      SHOPIFY_STORE_DOMAIN: "",
      SHOPIFY_STOREFRONT_ACCESS_TOKEN: "",
      SHOPIFY_STOREFRONT_PRIVATE_TOKEN: "",
      THEME_PACK_CATALOG_URL: localCompanionThemeCatalogUrl,
      VIBETV_CONTROL_CENTER_LOCAL_EXPORT: "1",
    },
  });

  await copyLocalThemePackDownloads(path.join(buildRoot, "out"));
  await cp(path.join(buildRoot, "out"), outRoot, { recursive: true });
  await rm(workRoot, { force: true, recursive: true });
  console.log(`built local Control Center static export at ${path.relative(repoRoot, outRoot)}`);
}

function shouldCopyAppFile(source) {
  const relative = path.relative(appRoot, source);
  if (!relative) {
    return true;
  }
  const first = relative.split(path.sep)[0];
  return ![
    ".local-export-work",
    ".next",
    "node_modules",
    "out",
    "out-local",
  ].includes(first);
}

async function ensureNodeModules() {
  try {
    await stat(nextBin);
  } catch {
    throw new Error("missing apps/control-center/node_modules; run npm ci first");
  }
}

async function copyLocalThemePackDownloads(exportRoot) {
  const source = path.join(repoRoot, "dist", "theme-packs");
  const target = path.join(exportRoot, "theme-packs");
  // dist keeps every archive it ever published, because published bytes are
  // immutable. The app only ships the ones whose theme the catalog still
  // offers, so a withdrawn theme cannot be installed from the packaged app.
  const catalog = JSON.parse(
    await readFile(path.join(source, "vibetv-theme-packs-v2.json"), "utf8"),
  );
  const offeredThemeIds = (catalog.themes || []).map((theme) => theme.id);
  await mkdir(target, { recursive: true });
  await cp(source, target, {
    filter: (entry) => !isWithdrawnThemeArchive(path.basename(entry), offeredThemeIds),
    force: true,
    recursive: true,
  });
}

// Matching the theme id by prefix keeps this independent of the version format,
// which may carry a SemVer prerelease suffix. The `-v` guards against one theme
// id being the prefix of another.
function isWithdrawnThemeArchive(fileName, offeredThemeIds) {
  if (!fileName.startsWith("vibetv-theme-") || !fileName.endsWith(".zip")) {
    return false;
  }
  return !offeredThemeIds.some(
    (themeId) =>
      fileName === `vibetv-theme-${themeId}.zip` ||
      fileName.startsWith(`vibetv-theme-${themeId}-v`),
  );
}

async function runCommand(command, args, options) {
  const child = spawn(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  const [code, signal] = await once(child, "exit");
  if (code !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with ${
        signal ? `signal ${signal}` : `exit code ${code}`
      }`,
    );
  }
}

main().catch((error) => {
  console.error(`error: ${error.message}`);
  process.exit(1);
});
