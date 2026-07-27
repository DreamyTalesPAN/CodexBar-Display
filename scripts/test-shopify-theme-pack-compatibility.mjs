#!/usr/bin/env node
import assert from "node:assert/strict";
import { validateShopifyThemeProducts } from "./check-shopify-theme-pack-compatibility.mjs";

const legacyThemes = [
  {
    id: "synthwave",
    downloadAsset: "vibetv-theme-synthwave.zip",
    sha256: "legacy-sha",
    bytes: 1528,
    version: "1.0.0",
  },
];

const exactLegacyProduct = {
  handle: "synthwave",
  themeId: { value: "synthwave" },
  themeVersion: { value: "1.0.0" },
  packUrl: {
    value:
      "https://github.com/DreamyTalesPAN/CodexBar-Display/raw/main/dist/theme-packs/vibetv-theme-synthwave.zip",
  },
  packSha256: { value: "LEGACY-SHA" },
  packSizeBytes: { value: "1528" },
};

assert.deepEqual(
  validateShopifyThemeProducts([exactLegacyProduct], legacyThemes),
  [],
  "exact frozen legacy metadata must pass",
);
assert.deepEqual(
  validateShopifyThemeProducts(
    [
      {
        handle: "synthwave",
        legacyThemeId: { value: "synthwave" },
      },
    ],
    legacyThemes,
  ),
  [],
  "empty technical metadata must pass because old apps use their frozen catalog",
);

const currentGenerationErrors = validateShopifyThemeProducts(
  [
    {
      ...exactLegacyProduct,
      themeVersion: { value: "1.1.0" },
      packUrl: {
        value:
          "https://example.test/vibetv-theme-synthwave-v1.1.0.zip",
      },
      packSha256: { value: "current-sha" },
      packSizeBytes: { value: "1600" },
    },
  ],
  legacyThemes,
);
assert.equal(currentGenerationErrors.length, 4);
assert(currentGenerationErrors.some((error) => error.includes("frozen asset")));
assert(currentGenerationErrors.some((error) => error.includes("SHA-256")));
assert(currentGenerationErrors.some((error) => error.includes("byte size")));
assert(currentGenerationErrors.some((error) => error.includes("theme version")));

assert.match(
  validateShopifyThemeProducts(
    [
      {
        handle: "partial",
        themeId: { value: "synthwave" },
        packUrl: { value: "https://example.test/vibetv-theme-synthwave.zip" },
      },
    ],
    legacyThemes,
  )[0],
  /all empty or one complete/,
);
assert.match(
  validateShopifyThemeProducts(
    [{ handle: "future", themeId: { value: "future-theme" } }],
    legacyThemes,
  )[0],
  /not present in the frozen legacy catalog/,
);

console.log("Shopify theme compatibility guard tests passed");
