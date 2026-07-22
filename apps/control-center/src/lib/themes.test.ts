import { describe, expect, it } from "vitest";
import { chooseCompleteThemePackMetadata } from "./themes";

const shopifySHA = "a".repeat(64);
const githubSHA = "b".repeat(64);

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
