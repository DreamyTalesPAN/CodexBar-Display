import { readFile } from "node:fs/promises";
import path from "node:path";
import { isRemoteThemePackUrl } from "./theme-pack-url";

export type ThemeSource = "shopify" | "github-catalog" | "fallback";

export type ThemeProduct = {
  id: string;
  title: string;
  handle?: string;
  productUrl?: string;
  description?: string;
  imageUrl?: string;
  imageAlt?: string;
  priceLabel: string;
  isFree: boolean;
  themeId: string;
  themeVersion?: string;
  manifestUrl?: string;
  packUrl?: string;
  packSha256?: string;
  packSizeBytes?: number;
  compatibleBoards?: string[];
  requiresFirmware?: string;
  source: ThemeSource;
};

export type ThemeCatalogResponse = {
  themes: ThemeProduct[];
  source: ThemeSource;
  storefrontConfigured: boolean;
  issue?: string;
};

type StorefrontTokenMode = "public" | "private";

const SHOPIFY_API_VERSION =
  process.env.SHOPIFY_STOREFRONT_API_VERSION?.trim() || "2026-04";
const SHOPIFY_COLLECTION_HANDLE =
  process.env.SHOPIFY_THEME_COLLECTION_HANDLE?.trim() || "themes-2";
const GITHUB_CATALOG_URL =
  process.env.THEME_PACK_CATALOG_URL?.trim() ||
  "https://raw.githubusercontent.com/DreamyTalesPAN/CodexBar-Display/main/dist/theme-packs/vibetv-theme-packs.json";
const ALLOW_CATALOG_FALLBACK =
  process.env.CONTROL_CENTER_ALLOW_CATALOG_FALLBACK === "1";
const LOCAL_STATIC_EXPORT =
  process.env.VIBETV_CONTROL_CENTER_LOCAL_EXPORT === "1";
const CUSTOMER_THEME_CATALOG_ISSUE = "Themes could not be loaded right now.";
const CUSTOMER_THEME_CATALOG_UNAVAILABLE =
  "Themes are not available right now.";

type ShopifyMetafield = { value?: string | null } | null;

type ShopifyProduct = {
  id: string;
  title: string;
  handle: string;
  description?: string | null;
  availableForSale?: boolean;
  featuredImage?: { url?: string | null; altText?: string | null } | null;
  priceRange?: {
    minVariantPrice?: { amount?: string | null; currencyCode?: string | null };
  };
  themeId?: ShopifyMetafield;
  legacyThemeId?: ShopifyMetafield;
  themeVersion?: ShopifyMetafield;
  legacyThemeVersion?: ShopifyMetafield;
  manifestUrl?: ShopifyMetafield;
  legacyManifestUrl?: ShopifyMetafield;
  packUrl?: ShopifyMetafield;
  legacyPackUrl?: ShopifyMetafield;
  packSha256?: ShopifyMetafield;
  packSizeBytes?: ShopifyMetafield;
  compatibleBoards?: ShopifyMetafield;
  legacyCompatibleBoards?: ShopifyMetafield;
  requiresFirmware?: ShopifyMetafield;
  legacyRequiresFirmware?: ShopifyMetafield;
};

type ShopifyCollectionResponse = {
  data?: {
    collection?: {
      products?: {
        edges?: Array<{ node?: ShopifyProduct | null }>;
      };
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

type ThemePackCatalog = {
  themes?: Array<{
    id?: string;
    title?: string;
    name?: string;
    description?: string;
    downloadUrl?: string;
    downloadAsset?: string;
    packUrl?: string;
    manifestUrl?: string;
    themeRev?: number;
    version?: string;
    compatibleBoards?: string[];
    requiresFirmware?: string;
    sha256?: string;
    bytes?: number;
  }>;
};

export async function getThemeCatalog(): Promise<ThemeCatalogResponse> {
  if (LOCAL_STATIC_EXPORT) {
    return fetchLocalStaticCatalog();
  }

  const shopDomain = normalizeShopDomain(
    process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_SHOP_DOMAIN,
  );
  const privateStorefrontToken =
    process.env.SHOPIFY_STOREFRONT_PRIVATE_TOKEN?.trim();
  const publicStorefrontToken =
    process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN?.trim();
  const storefrontToken = privateStorefrontToken || publicStorefrontToken;
  const storefrontTokenMode: StorefrontTokenMode | "auto" =
    privateStorefrontToken ? "private" : "auto";

  if (shopDomain && storefrontToken) {
    try {
      const shopifyThemes = await fetchShopifyThemes(
        shopDomain,
        storefrontToken,
        storefrontTokenMode,
      );
      const themes = await enrichThemesWithGitHubCatalog(shopifyThemes);
      return {
        themes,
        source: "shopify",
        storefrontConfigured: true,
      };
    } catch {
      const issue = CUSTOMER_THEME_CATALOG_ISSUE;
      if (ALLOW_CATALOG_FALLBACK) {
        const fallback = await fetchGitHubCatalog(issue);
        return { ...fallback, storefrontConfigured: true };
      }
      return emptyCatalog(issue, true);
    }
  }

  const issue = CUSTOMER_THEME_CATALOG_UNAVAILABLE;
  if (ALLOW_CATALOG_FALLBACK) {
    return fetchGitHubCatalog(issue);
  }
  return emptyCatalog(issue, false);
}

export async function getStaticThemeIds(): Promise<string[]> {
  try {
    const catalog = await readLocalThemePackCatalog();
    return (catalog.themes || [])
      .map((theme) => theme.id?.trim())
      .filter((themeId): themeId is string => Boolean(themeId));
  } catch {
    return [];
  }
}

async function fetchShopifyThemes(
  shopDomain: string,
  storefrontToken: string,
  tokenMode: StorefrontTokenMode | "auto",
): Promise<ThemeProduct[]> {
  const modes: StorefrontTokenMode[] =
    tokenMode === "auto" ? ["public", "private"] : [tokenMode];
  let lastError: unknown;

  for (const mode of modes) {
    try {
      return await fetchShopifyThemesWithMode(shopDomain, storefrontToken, mode);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function fetchShopifyThemesWithMode(
  shopDomain: string,
  storefrontToken: string,
  tokenMode: StorefrontTokenMode,
): Promise<ThemeProduct[]> {
  const response = await fetch(
    `https://${shopDomain}/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [tokenMode === "private"
          ? "Shopify-Storefront-Private-Token"
          : "X-Shopify-Storefront-Access-Token"]: storefrontToken,
      },
      body: JSON.stringify({
        query: SHOPIFY_THEMES_QUERY,
        variables: { handle: SHOPIFY_COLLECTION_HANDLE },
      }),
      next: { revalidate: 300 },
    },
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = (await response.json()) as ShopifyCollectionResponse;
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }

  const products = payload.data?.collection?.products?.edges
    ?.map((edge) => edge.node)
    .filter((product): product is ShopifyProduct => Boolean(product));

  if (!products?.length) {
    return [];
  }

  return products
    .map((product) => mapShopifyProduct(product, shopDomain))
    .filter((theme): theme is ThemeProduct => Boolean(theme));
}

function mapShopifyProduct(
  product: ShopifyProduct,
  shopDomain: string,
): ThemeProduct | null {
  const themeId =
    product.themeId?.value?.trim() || product.legacyThemeId?.value?.trim();
  if (!themeId) {
    return null;
  }

  const amount = Number(product.priceRange?.minVariantPrice?.amount || "0");
  const currency = product.priceRange?.minVariantPrice?.currencyCode || "EUR";
  const isFree = amount === 0;

  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    productUrl: product.handle
      ? `https://${shopDomain}/products/${encodeURIComponent(product.handle)}`
      : undefined,
    description: product.description?.trim() || undefined,
    imageUrl: product.featuredImage?.url || undefined,
    imageAlt: product.featuredImage?.altText || product.title,
    priceLabel: isFree ? "Kostenlos" : formatMoney(amount, currency),
    isFree,
    themeId,
    themeVersion:
      product.themeVersion?.value?.trim() ||
      product.legacyThemeVersion?.value?.trim() ||
      undefined,
    manifestUrl:
      product.manifestUrl?.value?.trim() ||
      product.legacyManifestUrl?.value?.trim() ||
      undefined,
    packUrl:
      product.packUrl?.value?.trim() ||
      product.legacyPackUrl?.value?.trim() ||
      undefined,
    packSha256: product.packSha256?.value?.trim().toLowerCase() || undefined,
    packSizeBytes: positiveInteger(product.packSizeBytes?.value),
    compatibleBoards: splitList(
      product.compatibleBoards?.value || product.legacyCompatibleBoards?.value,
    ),
    requiresFirmware:
      product.requiresFirmware?.value?.trim() ||
      product.legacyRequiresFirmware?.value?.trim() ||
      undefined,
    source: "shopify",
  };
}

async function fetchGitHubCatalog(
  issue?: string,
): Promise<ThemeCatalogResponse> {
  try {
    const themes = await fetchGitHubCatalogThemes();

    return {
      themes,
      source: "github-catalog",
      storefrontConfigured: false,
      issue,
    };
  } catch {
    return emptyCatalog(issue || CUSTOMER_THEME_CATALOG_ISSUE, false);
  }
}

async function fetchLocalStaticCatalog(): Promise<ThemeCatalogResponse> {
  try {
    const catalog = await readLocalThemePackCatalog();
    const themes = mapThemePackCatalog(catalog);
    return {
      themes,
      source: "github-catalog",
      storefrontConfigured: false,
    };
  } catch {
    return emptyCatalog(CUSTOMER_THEME_CATALOG_UNAVAILABLE, false);
  }
}

async function fetchGitHubCatalogThemes(): Promise<ThemeProduct[]> {
  const response = await fetch(GITHUB_CATALOG_URL, {
    next: { revalidate: 300 },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const catalog = (await response.json()) as ThemePackCatalog;
  return (catalog.themes || [])
    .map(mapThemePackCatalogEntry)
    .filter((theme): theme is ThemeProduct => Boolean(theme));
}

function mapThemePackCatalog(catalog: ThemePackCatalog): ThemeProduct[] {
  return (catalog.themes || [])
    .map(mapThemePackCatalogEntry)
    .filter((theme): theme is ThemeProduct => Boolean(theme));
}

function mapThemePackCatalogEntry(
  theme: NonNullable<ThemePackCatalog["themes"]>[number],
): ThemeProduct | null {
  const themeId = theme.id?.trim();
  if (!themeId) {
    return null;
  }
  const packUrl = resolveCatalogUrl(
    theme.downloadUrl || theme.packUrl || theme.downloadAsset,
  );
  return {
    id: themeId,
    title: theme.title || theme.name || titleFromThemeId(themeId),
    description: theme.description,
    priceLabel: "Kostenlos",
    isFree: true,
    themeId,
    themeVersion:
      theme.version || (theme.themeRev ? `rev ${theme.themeRev}` : undefined),
    manifestUrl: theme.manifestUrl,
    packUrl,
    packSha256: theme.sha256?.trim().toLowerCase(),
    packSizeBytes: theme.bytes,
    compatibleBoards: theme.compatibleBoards,
    requiresFirmware: theme.requiresFirmware,
    source: "github-catalog",
  };
}

async function readLocalThemePackCatalog(): Promise<ThemePackCatalog> {
  if (LOCAL_STATIC_EXPORT) {
    return JSON.parse(
      await readFile(path.join(process.cwd(), "local-theme-packs.json"), "utf8"),
    ) as ThemePackCatalog;
  }
  const repoRoot = process.env.VIBETV_REPO_ROOT
    ? path.resolve(process.env.VIBETV_REPO_ROOT)
    : path.resolve(process.cwd(), "../..");
  const catalogPath = path.join(
    repoRoot,
    "dist",
    "theme-packs",
    "vibetv-theme-packs.json",
  );
  return JSON.parse(await readFile(catalogPath, "utf8")) as ThemePackCatalog;
}

async function enrichThemesWithGitHubCatalog(
  shopifyThemes: ThemeProduct[],
): Promise<ThemeProduct[]> {
  if (!shopifyThemes.length) {
    return shopifyThemes;
  }

  try {
    const githubThemes = await fetchGitHubCatalogThemes();
    const githubByThemeId = new Map(
      githubThemes.map((theme) => [theme.themeId, theme]),
    );
    return shopifyThemes.map((theme) => {
      const fallback = githubByThemeId.get(theme.themeId);
      if (!fallback) {
        return theme;
      }
      return {
        ...theme,
        compatibleBoards:
          theme.compatibleBoards || fallback.compatibleBoards,
        manifestUrl: theme.manifestUrl || fallback.manifestUrl,
        packUrl: chooseThemePackUrl(theme.packUrl, fallback.packUrl),
        packSha256: theme.packSha256 || fallback.packSha256,
        packSizeBytes: theme.packSizeBytes || fallback.packSizeBytes,
        requiresFirmware:
          theme.requiresFirmware || fallback.requiresFirmware,
        themeVersion: theme.themeVersion || fallback.themeVersion,
      };
    });
  } catch {
    return shopifyThemes;
  }
}

function emptyCatalog(
  issue: string,
  storefrontConfigured: boolean,
): ThemeCatalogResponse {
  return {
    themes: [],
    source: "fallback",
    storefrontConfigured,
    issue,
  };
}

function normalizeShopDomain(raw: string | undefined): string {
  const value = raw
    ?.trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  if (!value) {
    return "";
  }
  if (value.endsWith(".myshopify.com")) {
    return value;
  }
  return value;
}

function resolveCatalogUrl(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) {
    return undefined;
  }
  try {
    const resolved = /^https?:\/\//i.test(value)
      ? value
      : new URL(value, GITHUB_CATALOG_URL).toString();
    return isRemoteThemePackUrl(resolved) ? resolved : undefined;
  } catch {
    return undefined;
  }
}

function chooseThemePackUrl(
  primary?: string,
  fallback?: string,
): string | undefined {
  if (isRemoteThemePackUrl(primary)) {
    return primary?.trim();
  }
  if (isRemoteThemePackUrl(fallback)) {
    return fallback?.trim();
  }
  return primary?.trim() || fallback?.trim() || undefined;
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency,
  }).format(amount);
}

function splitList(value: string | undefined | null): string[] | undefined {
  const parts = value
    ?.split(/[,\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts?.length ? parts : undefined;
}

function positiveInteger(value: string | undefined | null): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function titleFromThemeId(themeId: string): string {
  return themeId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const SHOPIFY_THEMES_QUERY = `#graphql
  query VibeTVThemeProducts($handle: String!) {
    collection(handle: $handle) {
      products(first: 50) {
        edges {
          node {
            id
            title
            handle
            description
            availableForSale
            featuredImage {
              url
              altText
            }
            priceRange {
              minVariantPrice {
                amount
                currencyCode
              }
            }
            themeId: metafield(namespace: "vibetv", key: "theme_id") {
              value
            }
            legacyThemeId: metafield(namespace: "theme", key: "theme_id") {
              value
            }
            themeVersion: metafield(namespace: "vibetv", key: "theme_version") {
              value
            }
            legacyThemeVersion: metafield(namespace: "theme", key: "theme_version") {
              value
            }
            manifestUrl: metafield(namespace: "vibetv", key: "manifest_url") {
              value
            }
            legacyManifestUrl: metafield(namespace: "theme", key: "manifest_url") {
              value
            }
            packUrl: metafield(namespace: "vibetv", key: "pack_url") {
              value
            }
            legacyPackUrl: metafield(namespace: "theme", key: "pack_url") {
              value
            }
            packSha256: metafield(namespace: "vibetv", key: "pack_sha256") {
              value
            }
            packSizeBytes: metafield(namespace: "vibetv", key: "pack_size_bytes") {
              value
            }
            compatibleBoards: metafield(namespace: "vibetv", key: "compatible_boards") {
              value
            }
            legacyCompatibleBoards: metafield(namespace: "theme", key: "compatible_boards") {
              value
            }
            requiresFirmware: metafield(namespace: "vibetv", key: "requires_firmware") {
              value
            }
            legacyRequiresFirmware: metafield(namespace: "theme", key: "requires_firmware") {
              value
            }
          }
        }
      }
    }
  }
`;
