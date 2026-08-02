import { describe, expect, it } from "vitest";
import { themeSpecHash, themeSpecObjectHash } from "./theme-spec-hash";

describe("ThemeSpec device fingerprint", () => {
  it("matches firmware trimming before FNV-1a hashing", () => {
    const compact = '{"v":1,"id":"custom","rev":1,"p":[]}';
    expect(themeSpecHash(`${compact}\n`)).toBe(themeSpecHash(compact));
    expect(themeSpecHash(`  ${compact}\r\n`)).toBe(themeSpecHash(compact));
  });

  it("fingerprints the exact JSON object order used by render packs", () => {
    const spec = { v: 1, id: "custom", rev: 1, p: [] };
    expect(themeSpecObjectHash(spec)).toBe(themeSpecHash(JSON.stringify(spec)));
  });
});
