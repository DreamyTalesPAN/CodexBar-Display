import { describe, expect, it } from "vitest";

import { truncateUtf8Bytes } from "./route";

describe("display frame UTF-8 limits", () => {
  it("truncates at complete code points within the byte budget", () => {
    const result = truncateUtf8Bytes("Wöchentliche Nutzung 🚀", 24);

    expect(new TextEncoder().encode(result).byteLength).toBeLessThanOrEqual(24);
    expect(result).not.toContain("\uFFFD");
    expect(result).toBe("Wöchentliche Nutzung");
  });
});
