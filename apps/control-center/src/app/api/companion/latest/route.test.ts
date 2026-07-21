import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

let releaseUrlCounter = 0;

function stubRelease(tagName: string) {
  // A unique release URL per test bypasses the module-level release cache.
  releaseUrlCounter += 1;
  vi.stubEnv(
    "CONTROL_CENTER_COMPANION_RELEASE_API_URL",
    `http://localhost/release-${releaseUrlCounter}`,
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ tag_name: tagName }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

function companionRequest(version: string): Request {
  const url = new URL("http://localhost/api/companion/latest");
  url.searchParams.set("version", version);
  return new Request(url);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GET /api/companion/latest", () => {
  it("offers the final release to an installed RC", async () => {
    stubRelease("v1.0.44");

    const response = await GET(companionRequest("1.0.44-rc.16"));
    const body = await response.json();
    expect(body.updateAvailable).toBe(true);
    expect(body.latestVersion).toBe("1.0.44");
    expect(body.message).toBe("Mac App update is available.");
  });

  it("keeps the exact final release current", async () => {
    stubRelease("v1.0.44");

    const response = await GET(companionRequest("1.0.44"));
    const body = await response.json();
    expect(body.updateAvailable).toBe(false);
    expect(body.message).toBe("Mac App is up to date.");
  });

  it("orders prerelease identifiers numerically", async () => {
    stubRelease("v1.0.44-rc.16");

    const response = await GET(companionRequest("1.0.44-rc.2"));
    const body = await response.json();
    expect(body.updateAvailable).toBe(true);
  });

  it("fails visibly for a malformed installed version", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const response = await GET(companionRequest("banana"));
    const body = await response.json();
    expect(body.status).toBe("check_failed");
    expect(body.updateAvailable).toBe(false);
    expect(body.message).toContain("banana");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails the check when the release tag is not a valid version", async () => {
    stubRelease("nightly-build");

    const response = await GET(companionRequest("1.0.44"));
    const body = await response.json();
    expect(body.status).toBe("check_failed");
    expect(body.updateAvailable).toBe(false);
  });
});
