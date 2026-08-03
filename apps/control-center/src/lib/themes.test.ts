import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chooseCompleteThemePackMetadata,
  getThemeCatalog,
  mergeThemeProductWithCatalog,
  requireCurrentThemeCatalog,
  type ThemeProduct,
} from "./themes";

const shopifySHA = "a".repeat(64);
const githubSHA = "b".repeat(64);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Shopify theme usage", () => {
  it("uses the usage metafield and defaults unsupported values to live", async () => {
    vi.stubEnv("SHOPIFY_STORE_DOMAIN", "vibetv.shop");
    vi.stubEnv("SHOPIFY_STOREFRONT_PRIVATE_TOKEN", "");
    vi.stubEnv("SHOPIFY_STOREFRONT_ACCESS_TOKEN", "storefront-token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) => {
        if (String(input).includes("/graphql.json")) {
          return new Response(
            JSON.stringify({
              data: {
                collection: {
                  products: {
                    edges: [
                      {
                        node: {
                          id: "gid://shopify/Product/screensaver",
                          title: "Night Clock",
                          handle: "night-clock",
                          themeId: { value: "night-clock" },
                          usage: null,
                          legacyUsage: { value: "screensaver" },
                          priceRange: {
                            minVariantPrice: {
                              amount: "0",
                              currencyCode: "EUR",
                            },
                          },
                        },
                      },
                      {
                        node: {
                          id: "gid://shopify/Product/unknown",
                          title: "Unknown Usage",
                          handle: "unknown-usage",
                          themeId: { value: "unknown-usage" },
                          usage: { value: "both" },
                          legacyUsage: null,
                          priceRange: {
                            minVariantPrice: {
                              amount: "0",
                              currencyCode: "EUR",
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            }),
            { status: 200 },
          );
        }
        return new Response("catalog unavailable", { status: 503 });
      },
    );

    const catalog = await getThemeCatalog();

    expect(catalog.themes.map((theme) => theme.usage)).toEqual([
      "screensaver",
      "live",
    ]);
    const storefrontRequest = fetchMock.mock.calls[0]?.[1];
    const query = JSON.parse(String(storefrontRequest?.body)).query as string;
    expect(query).toContain(
      'usage: metafield(namespace: "vibetv", key: "usage")',
    );
    expect(query).toContain(
      'legacyUsage: metafield(namespace: "theme", key: "usage")',
    );
  });
});

describe("chooseCompleteThemePackMetadata", () => {
  it("keeps a complete valid Shopify metadata triplet", () => {
    expect(
      chooseCompleteThemePackMetadata(
        {
          packUrl: " https://shop.example/theme.zip ",
          packSha256: shopifySHA.toUpperCase(),
          packSizeBytes: 123,
        },
        {
          packUrl: "https://github.example/theme.zip",
          packSha256: githubSHA,
          packSizeBytes: 456,
        },
      ),
    ).toEqual({
      packUrl: "https://shop.example/theme.zip",
      packSha256: shopifySHA,
      packSizeBytes: 123,
    });
  });

  it("uses the complete GitHub triplet when Shopify only has a URL", () => {
    expect(
      chooseCompleteThemePackMetadata(
        { packUrl: "https://shop.example/theme.zip" },
        {
          packUrl: "https://github.example/theme.zip",
          packSha256: githubSHA,
          packSizeBytes: 456,
        },
      ),
    ).toEqual({
      packUrl: "https://github.example/theme.zip",
      packSha256: githubSHA,
      packSizeBytes: 456,
    });
  });

  it("never combines a partial Shopify triplet with GitHub metadata", () => {
    expect(
      chooseCompleteThemePackMetadata(
        {
          packUrl: "https://shop.example/theme.zip",
          packSha256: shopifySHA,
        },
        {
          packUrl: "https://github.example/theme.zip",
          packSha256: githubSHA,
          packSizeBytes: 456,
        },
      ),
    ).toEqual({
      packUrl: "https://github.example/theme.zip",
      packSha256: githubSHA,
      packSizeBytes: 456,
    });
  });

  it("does not borrow missing values when neither source is complete", () => {
    expect(
      chooseCompleteThemePackMetadata(
        {
          packUrl: "https://shop.example/theme.zip",
          packSha256: shopifySHA,
        },
        {
          packUrl: "https://github.example/theme.zip",
          packSizeBytes: 456,
        },
      ),
    ).toEqual({
      packUrl: "https://shop.example/theme.zip",
      packSha256: shopifySHA,
      packSizeBytes: undefined,
    });
  });
});

describe("mergeThemeProductWithCatalog", () => {
  it("keeps Shopify presentation but uses generation-matched catalog install metadata", () => {
    const product = {
      id: "gid://shopify/Product/1",
      isFree: true,
      packSha256: shopifySHA,
      packSizeBytes: 123,
      packUrl: "https://shop.example/legacy.zip",
      priceLabel: "Kostenlos",
      requiresFirmware: "1.0.24",
      source: "shopify",
      themeId: "synthwave",
      themeVersion: "1.0.0",
      title: "Synthwave Shop",
    } satisfies ThemeProduct;
    const catalogTheme = {
      id: "synthwave",
      isFree: true,
      packSha256: githubSHA,
      packSizeBytes: 456,
      packUrl: "https://github.example/synthwave-v1.1.0.zip",
      priceLabel: "Kostenlos",
      requiredCapabilities: ["usage-slots-v1"],
      requiresFirmware: "1.0.40",
      source: "github-catalog",
      themeId: "synthwave",
      themeRev: 2,
      themeSpecPath: "/themes/u/synthwa-2-5f8ac7.json",
      themeVersion: "1.1.0",
      title: "Synthwave",
    } satisfies ThemeProduct;

    expect(mergeThemeProductWithCatalog(product, catalogTheme)).toEqual({
      ...product,
      packSha256: githubSHA,
      packSizeBytes: 456,
      packUrl: "https://github.example/synthwave-v1.1.0.zip",
      requiredCapabilities: ["usage-slots-v1"],
      requiresFirmware: "1.0.40",
      themeRev: 2,
      themeSpecPath: "/themes/u/synthwa-2-5f8ac7.json",
      themeVersion: "1.1.0",
    });
  });

  it("keeps Shopify technical metadata atomically when catalog metadata is incomplete", () => {
    const product = {
      id: "gid://shopify/Product/1",
      isFree: true,
      packSha256: shopifySHA,
      packSizeBytes: 123,
      packUrl: "https://shop.example/legacy.zip",
      priceLabel: "Kostenlos",
      requiresFirmware: "1.0.24",
      source: "shopify",
      themeId: "synthwave",
      themeVersion: "1.0.0",
      title: "Synthwave Shop",
    } satisfies ThemeProduct;
    const incompleteCatalogTheme = {
      id: "synthwave",
      isFree: true,
      packUrl: "https://github.example/synthwave-v1.1.0.zip",
      priceLabel: "Kostenlos",
      requiredCapabilities: ["usage-slots-v1"],
      requiresFirmware: "1.0.40",
      source: "github-catalog",
      themeId: "synthwave",
      themeVersion: "1.1.0",
      title: "Synthwave",
    } satisfies ThemeProduct;

    expect(
      mergeThemeProductWithCatalog(product, incompleteCatalogTheme),
    ).toEqual({
      ...product,
      compatibleBoards: undefined,
      manifestUrl: undefined,
      requiredCapabilities: undefined,
      themeRev: undefined,
      themeSpecPath: undefined,
    });
  });
});

describe("requireCurrentThemeCatalog", () => {
  it("accepts only the current app catalog generation", () => {
    expect(() =>
      requireCurrentThemeCatalog({ generation: 2, schemaVersion: 1 }),
    ).not.toThrow();
    expect(() =>
      requireCurrentThemeCatalog({ generation: undefined, schemaVersion: 1 }),
    ).toThrow("unsupported theme catalog generation");
    expect(() =>
      requireCurrentThemeCatalog({ generation: 1, schemaVersion: 1 }),
    ).toThrow("unsupported theme catalog generation");
  });
});
