import { describe, expect, it } from "vitest";

import {
  COMPANION_RELEASE_API_PATH,
  DEFAULT_CONTROL_CENTER_ORIGIN,
  companionReleaseApiUrl,
} from "./mac-app-install-command";

describe("companionReleaseApiUrl", () => {
  it("uses the hosted release API from any loopback runtime port", () => {
    expect(companionReleaseApiUrl("http://127.0.0.1:54321", true)).toBe(
      `${DEFAULT_CONTROL_CENTER_ORIGIN}${COMPANION_RELEASE_API_PATH}`,
    );
  });

  it("keeps the relative API route on the hosted app", () => {
    expect(companionReleaseApiUrl(DEFAULT_CONTROL_CENTER_ORIGIN)).toBe(
      COMPANION_RELEASE_API_PATH,
    );
  });
});
