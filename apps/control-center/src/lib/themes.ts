export type ThemeSource = "shopify" | "github-catalog" | "fallback";

export type ThemeProduct = {
  id: string;
  title: string;
  handle?: string;
  description?: string;
  imageUrl?: string;
  imageAlt?: string;
  priceLabel: string;
  isFree: boolean;
  themeId: string;
  themeVersion?: string;
  manifestUrl?: string;
  packUrl?: string;
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

const SHOPIFY_API_VERSION =
  process.env.SHOPIFY_STOREFRONT_API_VERSION?.trim() || "2026-04";
const SHOPIFY_COLLECTION_HANDLE =
  process.env.SHOPIFY_THEME_COLLECTION_HANDLE?.trim() || "themes-2";
const GITHUB_CATALOG_URL =
  process.env.THEME_PACK_CATALOG_URL?.trim() ||
  "https://raw.githubusercontent.com/DreamyTalesPAN/CodexBar-Display/main/dist/theme-packs/vibetv-theme-packs.json";

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
  themeVersion?: ShopifyMetafield;
  manifestUrl?: ShopifyMetafield;
  packUrl?: ShopifyMetafield;
  compatibleBoards?: ShopifyMetafield;
  requiresFirmware?: ShopifyMetafield;
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
    packUrl?: string;
    manifestUrl?: string;
    themeRev?: number;
    version?: string;
  }>;
};

export async function getThemeCatalog(): Promise<ThemeCatalogResponse> {
  const shopDomain = normalizeShopDomain(
    process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_SHOP_DOMAIN,
  );
  const storefrontToken = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN?.trim();

  if (shopDomain && storefrontToken) {
    try {
      const themes = await fetchShopifyThemes(shopDomain, storefrontToken);
      return {
        themes,
        source: "shopify",
        storefrontConfigured: true,
      };
    } catch (error) {
      const fallback = await fetchGitHubCatalog(
        `Shopify Storefront API konnte nicht geladen werden: ${messageFromError(error)}`,
      );
      return { ...fallback, storefrontConfigured: true };
    }
  }

  return fetchGitHubCatalog(
    "Shopify Storefront API ist noch nicht konfiguriert. Setze SHOPIFY_STORE_DOMAIN und SHOPIFY_STOREFRONT_ACCESS_TOKEN.",
  );
}

async function fetchShopifyThemes(
  shopDomain: string,
  storefrontToken: string,
): Promise<ThemeProduct[]> {
  const response = await fetch(
    `https://${shopDomain}/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": storefrontToken,
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
    .map(mapShopifyProduct)
    .filter((theme): theme is ThemeProduct => Boolean(theme));
}

function mapShopifyProduct(product: ShopifyProduct): ThemeProduct | null {
  const themeId = product.themeId?.value?.trim();
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
    description: product.description?.trim() || undefined,
    imageUrl: product.featuredImage?.url || undefined,
    imageAlt: product.featuredImage?.altText || product.title,
    priceLabel: isFree ? "Kostenlos" : formatMoney(amount, currency),
    isFree,
    themeId,
    themeVersion: product.themeVersion?.value?.trim() || undefined,
    manifestUrl: product.manifestUrl?.value?.trim() || undefined,
    packUrl: product.packUrl?.value?.trim() || undefined,
    compatibleBoards: splitList(product.compatibleBoards?.value),
    requiresFirmware: product.requiresFirmware?.value?.trim() || undefined,
    source: "shopify",
  };
}

async function fetchGitHubCatalog(
  issue?: string,
): Promise<ThemeCatalogResponse> {
  try {
    const response = await fetch(GITHUB_CATALOG_URL, {
      next: { revalidate: 300 },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const catalog = (await response.json()) as ThemePackCatalog;
    const themes = (catalog.themes || [])
      .map((theme): ThemeProduct | null => {
        const themeId = theme.id?.trim();
        if (!themeId) {
          return null;
        }
        return {
          id: themeId,
          title: theme.title || theme.name || titleFromThemeId(themeId),
          description: theme.description,
          priceLabel: "Kostenlos",
          isFree: true,
          themeId,
          themeVersion:
            theme.version ||
            (theme.themeRev ? `rev ${theme.themeRev}` : undefined),
          manifestUrl: theme.manifestUrl,
          packUrl: resolveCatalogUrl(theme.downloadUrl || theme.packUrl),
          source: "github-catalog",
        };
      })
      .filter((theme): theme is ThemeProduct => Boolean(theme));

    return {
      themes,
      source: "github-catalog",
      storefrontConfigured: false,
      issue,
    };
  } catch (error) {
    return {
      themes: fallbackThemes(),
      source: "fallback",
      storefrontConfigured: false,
      issue: issue || messageFromError(error),
    };
  }
}

function fallbackThemes(): ThemeProduct[] {
  return [
    {
      id: "mini-classic",
      title: "Mini Classic",
      description: "Kompaktes Standard-Theme für den ersten Install-Test.",
      priceLabel: "Kostenlos",
      isFree: true,
      themeId: "mini-classic",
      packUrl:
        "https://raw.githubusercontent.com/DreamyTalesPAN/CodexBar-Display/main/dist/theme-packs/vibetv-theme-mini-classic.zip",
      source: "fallback",
    },
  ];
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
  if (!raw) {
    return undefined;
  }
  if (/^https?:\/\//.test(raw)) {
    return raw;
  }
  return new URL(raw, GITHUB_CATALOG_URL).toString();
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

function titleFromThemeId(themeId: string): string {
  return themeId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : "Unbekannter Fehler";
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
            themeVersion: metafield(namespace: "vibetv", key: "theme_version") {
              value
            }
            manifestUrl: metafield(namespace: "vibetv", key: "manifest_url") {
              value
            }
            packUrl: metafield(namespace: "vibetv", key: "pack_url") {
              value
            }
            compatibleBoards: metafield(namespace: "vibetv", key: "compatible_boards") {
              value
            }
            requiresFirmware: metafield(namespace: "vibetv", key: "requires_firmware") {
              value
            }
          }
        }
      }
    }
  }
`;
