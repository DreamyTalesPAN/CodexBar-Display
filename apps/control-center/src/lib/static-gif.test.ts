import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { staticGif } from "./static-gif";
const sharp = createRequire(import.meta.url)("sharp");
describe("animation-off GIF", () => {
  it("retains Mini's exact first decoded pixels while removing later frames", async () => {
    const original = readFileSync(
      "../../theme-packs/mini-classic/assets/mini.gif",
    );
    const still = Buffer.from(staticGif(original.toString("base64")), "base64");
    expect(
      (await sharp(original, { animated: true }).metadata()).pages,
    ).toBeGreaterThan(1);
    expect((await sharp(still, { animated: true }).metadata()).pages).toBe(1);
    const actual = await sharp(still).ensureAlpha().raw().toBuffer();
    const expected = await sharp(original).ensureAlpha().raw().toBuffer();
    expect(actual.equals(expected)).toBe(true);
  });
  it("does not return an animated original when data is malformed", () => {
    expect(staticGif("invalid")).toBe("");
    expect(staticGif(btoa("GIF89a"))).toBe("");
  });
});
