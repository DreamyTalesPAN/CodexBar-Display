import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

let releaseUrlCounter = 0;

function stubRelease(tagName: string, assets?: unknown[]) {
  // A unique release URL per test bypasses the module-level release cache.
  releaseUrlCounter += 1;
  vi.stubEnv(
    "CONTROL_CENTER_COMPANION_RELEASE_API_URL",
    `http://localhost/release-${releaseUrlCounter}`,
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ tag_name: tagName, assets }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

function windowsAsset(
  name = "VibeTV-Control-Center-Setup.exe",
  overrides: Record<string, unknown> = {},
) {
  return {
    name,
    state: "uploaded",
    size: 1024,
    browser_download_url: `https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.0.44/${name}`,
    ...overrides,
  };
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

describe("Mac App update check route", () => {
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

describe("Windows installer download", () => {
  it("stays disabled until the feature flag is switched on", async () => {
    stubRelease("v1.0.44", [windowsAsset()]);

    const body = await (await GET(companionRequest("1.0.44"))).json();
    expect(body.windowsSetupDownloadStatus).toBe("disabled");
    expect(body.windowsSetupDownloadUrl).toBeUndefined();
  });

  it("offers the verified installer from the current release", async () => {
    vi.stubEnv("CONTROL_CENTER_ENABLE_WINDOWS_APP_SETUP_DOWNLOAD", "1");
    stubRelease("v1.0.44", [windowsAsset()]);

    const body = await (await GET(companionRequest("1.0.44"))).json();
    expect(body.windowsSetupDownloadStatus).toBe("available");
    expect(body.windowsSetupDownloadUrl).toBe(
      "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.0.44/VibeTV-Control-Center-Setup.exe",
    );
  });

  it("reports a missing installer instead of a dead link", async () => {
    vi.stubEnv("CONTROL_CENTER_ENABLE_WINDOWS_APP_SETUP_DOWNLOAD", "1");
    stubRelease("v1.0.44", []);

    const body = await (await GET(companionRequest("1.0.44"))).json();
    expect(body.status).toBe("available");
    expect(body.windowsSetupDownloadStatus).toBe("missing_asset");
    expect(body.windowsSetupDownloadUrl).toBeUndefined();
  });

  it("rejects an installer that is still uploading or empty", async () => {
    vi.stubEnv("CONTROL_CENTER_ENABLE_WINDOWS_APP_SETUP_DOWNLOAD", "1");
    stubRelease("v1.0.44", [
      windowsAsset(undefined, { state: "starter" }),
      windowsAsset(undefined, { size: 0 }),
    ]);

    const body = await (await GET(companionRequest("1.0.44"))).json();
    expect(body.windowsSetupDownloadStatus).toBe("missing_asset");
  });

  it("rejects an installer url that does not belong to this release", async () => {
    vi.stubEnv("CONTROL_CENTER_ENABLE_WINDOWS_APP_SETUP_DOWNLOAD", "1");
    stubRelease("v1.0.44", [
      windowsAsset(undefined, {
        browser_download_url:
          "https://github.example.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.0.44/VibeTV-Control-Center-Setup.exe",
      }),
      windowsAsset(undefined, {
        browser_download_url:
          "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.0.43/VibeTV-Control-Center-Setup.exe",
      }),
      windowsAsset(undefined, {
        browser_download_url:
          "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.0.44/VibeTV-Control-Center-Setup.exe?redirect=1",
      }),
    ]);

    const body = await (await GET(companionRequest("1.0.44"))).json();
    expect(body.windowsSetupDownloadStatus).toBe("missing_asset");
  });

  it("follows the configured asset name when the release settles on another one", async () => {
    vi.stubEnv("CONTROL_CENTER_ENABLE_WINDOWS_APP_SETUP_DOWNLOAD", "1");
    vi.stubEnv(
      "CONTROL_CENTER_WINDOWS_APP_SETUP_ASSET_NAME",
      "VibeTV-Control-Center_1.0.44_x64-setup.exe",
    );
    stubRelease("v1.0.44", [
      windowsAsset("VibeTV-Control-Center_1.0.44_x64-setup.exe"),
    ]);

    const body = await (await GET(companionRequest("1.0.44"))).json();
    expect(body.windowsSetupDownloadStatus).toBe("available");
  });

  it("leaves the Mac download untouched by the Windows check", async () => {
    vi.stubEnv("CONTROL_CENTER_ENABLE_WINDOWS_APP_SETUP_DOWNLOAD", "1");
    vi.stubEnv("CONTROL_CENTER_ENABLE_MAC_APP_DMG_DOWNLOAD", "1");
    stubRelease("v1.0.44", [
      windowsAsset(),
      {
        name: "VibeTV-Control-Center.dmg",
        state: "uploaded",
        size: 2048,
        browser_download_url:
          "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.0.44/VibeTV-Control-Center.dmg",
      },
    ]);

    const body = await (await GET(companionRequest("1.0.44"))).json();
    expect(body.dmgDownloadStatus).toBe("available");
    expect(body.dmgDownloadUrl).toBe(
      "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.0.44/VibeTV-Control-Center.dmg",
    );
  });
});
