#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultCatalogPath = path.join(
  repoRoot,
  "dist",
  "theme-packs",
  "vibetv-theme-packs.json",
);
const defaultLockPath = path.join(
  repoRoot,
  "release",
  "shopify-theme-pack-legacy-lock.json",
);

export function validateShopifyThemeProducts(products, legacyThemes) {
  const errors = [];
  const seenThemeIds = new Set();
  const legacyById = new Map(legacyThemes.map((theme) => [theme.id, theme]));

  if (!products.length) {
    errors.push("Shopify theme collection is empty");
  }

  for (const product of products) {
    const label = product.handle || product.title || product.id || "unknown product";
    const themeId =
      metafieldValue(product.themeId) || metafieldValue(product.legacyThemeId);
    if (!themeId) {
      errors.push(`${label}: missing vibetv.theme_id or theme.theme_id`);
      continue;
    }
    if (seenThemeIds.has(themeId)) {
      errors.push(`${label}: duplicate theme id ${themeId}`);
      continue;
    }
    seenThemeIds.add(themeId);

    const legacy = legacyById.get(themeId);
    if (!legacy) {
      errors.push(
        `${label}: theme id ${themeId} is not present in the frozen legacy catalog`,
      );
      continue;
    }

    const packUrl =
      metafieldValue(product.packUrl) || metafieldValue(product.legacyPackUrl);
    const packSha256 = metafieldValue(product.packSha256).toLowerCase();
    const packSizeBytes = positiveInteger(metafieldValue(product.packSizeBytes));
    const packValuesPresent = [
      Boolean(packUrl),
      Boolean(packSha256),
      Boolean(packSizeBytes),
    ].filter(Boolean).length;

    if (packValuesPresent !== 0 && packValuesPresent !== 3) {
      errors.push(
        `${label}: Shopify pack URL, SHA-256 and byte size must be all empty or one complete frozen-legacy triplet`,
      );
    }

    if (packValuesPresent === 3) {
      if (assetName(packUrl) !== legacy.downloadAsset) {
        errors.push(
          `${label}: pack URL must reference frozen asset ${legacy.downloadAsset}`,
        );
      }
      if (packSha256 !== legacy.sha256) {
        errors.push(`${label}: pack SHA-256 does not match the frozen legacy catalog`);
      }
      if (packSizeBytes !== legacy.bytes) {
        errors.push(`${label}: pack byte size does not match the frozen legacy catalog`);
      }
    }

    const themeVersion =
      metafieldValue(product.themeVersion) ||
      metafieldValue(product.legacyThemeVersion);
    if (themeVersion && themeVersion !== legacy.version) {
      errors.push(
        `${label}: theme version ${themeVersion} must stay at frozen legacy version ${legacy.version}`,
      );
    }
  }

  return errors;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const legacyThemes = await loadLegacyThemes(
    options.catalogPath,
    options.lockPath,
  );
  const products = options.fixturePath
    ? await loadFixtureProducts(options.fixturePath)
    : await fetchShopifyThemeProducts();
  const errors = validateShopifyThemeProducts(products, legacyThemes);

  if (errors.length) {
    for (const error of errors) {
      console.error(`error: ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `Shopify theme compatibility ok: ${products.length} products use the frozen legacy generation`,
  );
}

function parseArgs(args) {
  let catalogPath = defaultCatalogPath;
  let lockPath = defaultLockPath;
  let fixturePath;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--catalog") {
      catalogPath = requireValue(args, ++index, arg);
    } else if (arg === "--lock") {
      lockPath = requireValue(args, ++index, arg);
    } else if (arg === "--fixture") {
      fixturePath = requireValue(args, ++index, arg);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return {
    catalogPath: path.resolve(catalogPath),
    lockPath: path.resolve(lockPath),
    fixturePath: fixturePath ? path.resolve(fixturePath) : undefined,
  };
}

function requireValue(args, index, option) {
  const value = args[index]?.trim();
  if (!value) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

async function loadLegacyThemes(catalogPath, lockPath) {
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  if (catalog.schemaVersion !== 1 || catalog.generation) {
    throw new Error("Shopify guard requires the frozen generation-1 catalog");
  }
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  if (lock.schemaVersion !== 1 || lock.generation !== 1) {
    throw new Error("invalid Shopify legacy theme metadata lock");
  }
  const lockById = new Map(lock.themes.map((theme) => [theme.id, theme]));
  return catalog.themes.map((theme) => {
    const locked = lockById.get(theme.id);
    if (
      !locked ||
      locked.downloadAsset !== theme.downloadAsset ||
      locked.sha256 !== theme.sha256 ||
      locked.bytes !== theme.bytes ||
      !locked.version
    ) {
      throw new Error(`Shopify legacy lock does not match catalog for ${theme.id}`);
    }
    return locked;
  });
}

async function loadFixtureProducts(fixturePath) {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  if (Array.isArray(fixture)) {
    return fixture;
  }
  return fixture.products || connectionProducts(fixture);
}

async function fetchShopifyThemeProducts() {
  const shop = normalizeShop(process.env.VIBETV_SHOPIFY_SHOP);
  const clientId = requiredEnv("VIBETV_SHOPIFY_CLIENT_ID");
  const clientSecret = requiredEnv("VIBETV_SHOPIFY_CLIENT_SECRET");
  const apiVersion = process.env.VIBETV_SHOPIFY_API_VERSION?.trim() || "2025-07";
  const collectionHandle =
    process.env.SHOPIFY_THEME_COLLECTION_HANDLE?.trim() || "themes-2";
  const tokenResponse = await fetch(
    `https://${shop}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    },
  );
  if (!tokenResponse.ok) {
    throw new Error(
      `Shopify token request failed with HTTP ${tokenResponse.status}`,
    );
  }
  const accessToken = String((await tokenResponse.json()).access_token || "");
  if (!accessToken) {
    throw new Error("Shopify token response did not include an access token");
  }

  const products = [];
  let cursor = null;
  do {
    const response = await fetch(
      `https://${shop}/admin/api/${apiVersion}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({
          query: SHOPIFY_THEME_COMPATIBILITY_QUERY,
          variables: { handle: collectionHandle, after: cursor },
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`Shopify Admin GraphQL failed with HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (payload.errors?.length) {
      throw new Error(
        `Shopify Admin GraphQL error: ${payload.errors
          .map((error) => error.message)
          .join("; ")}`,
      );
    }
    const collection = payload.data?.collectionByHandle;
    if (!collection) {
      throw new Error(`Shopify collection ${collectionHandle} was not found`);
    }
    products.push(...connectionProducts(payload));
    cursor = collection.products?.pageInfo?.hasNextPage
      ? collection.products.pageInfo.endCursor
      : null;
  } while (cursor);

  return products;
}

function connectionProducts(payload) {
  return (
    payload.data?.collectionByHandle?.products?.nodes ||
    payload.data?.collection?.products?.nodes ||
    []
  );
}

function normalizeShop(rawShop) {
  const shop = requiredValue(rawShop, "VIBETV_SHOPIFY_SHOP")
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  return shop.endsWith(".myshopify.com") ? shop : `${shop}.myshopify.com`;
}

function requiredEnv(name) {
  return requiredValue(process.env[name], name);
}

function requiredValue(rawValue, name) {
  const value = rawValue?.trim();
  if (!value) {
    throw new Error(`missing required environment variable ${name}`);
  }
  return value;
}

function metafieldValue(field) {
  return String(field?.value || "").trim();
}

function positiveInteger(rawValue) {
  const value = Number(rawValue);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function assetName(rawUrl) {
  try {
    return path.posix.basename(new URL(rawUrl).pathname);
  } catch {
    return path.posix.basename(rawUrl);
  }
}

const SHOPIFY_THEME_COMPATIBILITY_QUERY = `#graphql
  query VibeTVThemeCompatibility($handle: String!, $after: String) {
    collectionByHandle(handle: $handle) {
      products(first: 100, after: $after) {
        nodes {
          id
          title
          handle
          themeId: metafield(namespace: "vibetv", key: "theme_id") { value }
          legacyThemeId: metafield(namespace: "theme", key: "theme_id") { value }
          themeVersion: metafield(namespace: "vibetv", key: "theme_version") { value }
          legacyThemeVersion: metafield(namespace: "theme", key: "theme_version") { value }
          packUrl: metafield(namespace: "vibetv", key: "pack_url") { value }
          legacyPackUrl: metafield(namespace: "theme", key: "pack_url") { value }
          packSha256: metafield(namespace: "vibetv", key: "pack_sha256") { value }
          packSizeBytes: metafield(namespace: "vibetv", key: "pack_size_bytes") { value }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
