import type { CompanionReleaseInfo } from "@/lib/companion-release";

export const dynamic = "force-dynamic";

const DEFAULT_RELEASE_API_URL =
  "https://api.github.com/repos/DreamyTalesPAN/CodexBar-Display/releases/latest";
const MAC_APP_DMG_ASSET_NAME = "VibeTV-Control-Center.dmg";
const MAC_APP_DMG_DOWNLOAD_FLAG =
  "CONTROL_CENTER_ENABLE_MAC_APP_DMG_DOWNLOAD";
const RELEASE_CACHE_TTL_MS = 60_000;

type GitHubRelease = {
  tag_name?: string;
  assets?: GitHubReleaseAsset[];
};

type GitHubReleaseAsset = {
  name?: string;
  state?: string;
  size?: number;
  browser_download_url?: string;
};

type ReleaseCacheEntry = {
  expiresAt: number;
  key: string;
  release: GitHubRelease;
};

type ReleaseFetchInFlight = {
  key: string;
  promise: Promise<GitHubRelease>;
};

let releaseCache: ReleaseCacheEntry | null = null;
let releaseFetchInFlight: ReleaseFetchInFlight | null = null;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const installedVersion = normalizeVersion(
    url.searchParams.get("version")?.trim() || "",
  );
  const checkedAt = new Date().toISOString();

  try {
    const release = await fetchLatestRelease();
    const releaseTag = release.tag_name?.trim() || "";
    const latestVersion = normalizeVersion(releaseTag);
    const dmgDownloadEnabled = macAppDmgDownloadEnabled();
    const dmgAsset = dmgDownloadEnabled
      ? verifiedDmgAsset(release, releaseTag)
      : null;
    if (!latestVersion) {
      return publicJson({
        checkedAt,
        status: "check_failed",
        release: releaseTag || undefined,
        installedVersion: installedVersion || undefined,
        updateAvailable: false,
        message: "Mac App check failed.",
        dmgDownloadStatus: "check_failed",
      } satisfies CompanionReleaseInfo);
    }

    const updateAvailable = Boolean(
      installedVersion && compareSemver(latestVersion, installedVersion) > 0,
    );

    return publicJson({
      checkedAt,
      status: "available",
      release: releaseTag || undefined,
      latestVersion,
      installedVersion: installedVersion || undefined,
      updateAvailable,
      message: updateAvailable
        ? "Mac App update is available."
        : "Mac App is up to date.",
      dmgDownloadStatus: !dmgDownloadEnabled
        ? "disabled"
        : dmgAsset
          ? "available"
          : "missing_asset",
      dmgDownloadUrl: dmgAsset?.browser_download_url?.trim() || undefined,
    } satisfies CompanionReleaseInfo);
  } catch {
    return publicJson({
      checkedAt,
      status: "check_failed",
      installedVersion: installedVersion || undefined,
      updateAvailable: false,
      message: "Mac App check failed.",
      dmgDownloadStatus: "check_failed",
    } satisfies CompanionReleaseInfo);
  }
}

function publicJson(payload: CompanionReleaseInfo): Response {
  return Response.json(payload, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}

function macAppDmgDownloadEnabled(): boolean {
  return process.env[MAC_APP_DMG_DOWNLOAD_FLAG]?.trim() === "1";
}

function verifiedDmgAsset(
  release: GitHubRelease,
  releaseTag: string,
): GitHubReleaseAsset | null {
  if (!releaseTag) {
    return null;
  }
  return (
    release.assets?.find((asset) =>
      isVerifiedDmgAsset(asset, releaseTag),
    ) || null
  );
}

function isVerifiedDmgAsset(
  asset: GitHubReleaseAsset,
  releaseTag: string,
): boolean {
  if (
    asset.name?.trim() !== MAC_APP_DMG_ASSET_NAME ||
    asset.state?.trim() !== "uploaded" ||
    !Number.isFinite(asset.size) ||
    Number(asset.size) <= 0
  ) {
    return false;
  }

  try {
    const url = new URL(asset.browser_download_url?.trim() || "");
    const path = url.pathname.split("/").filter(Boolean);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      url.search === "" &&
      url.hash === "" &&
      path.length === 6 &&
      path[0] === "DreamyTalesPAN" &&
      path[1] === "CodexBar-Display" &&
      path[2] === "releases" &&
      path[3] === "download" &&
      decodeURIComponent(path[4]) === releaseTag &&
      decodeURIComponent(path[5]) === MAC_APP_DMG_ASSET_NAME
    );
  } catch {
    return false;
  }
}

async function fetchLatestRelease(): Promise<GitHubRelease> {
  const releaseUrl =
    process.env["CONTROL_CENTER_COMPANION_RELEASE_API_URL"] ||
    DEFAULT_RELEASE_API_URL;
  const token = githubReleaseToken();
  const headers = githubReleaseHeaders(token);
  const cacheKey = releaseCacheKey(releaseUrl, token);
  const now = Date.now();
  if (
    releaseCache?.key === cacheKey &&
    releaseCache.expiresAt > now
  ) {
    return releaseCache.release;
  }

  if (releaseFetchInFlight?.key === cacheKey) {
    return releaseFetchInFlight.promise;
  }

  const promise = fetch(releaseUrl, {
    cache: "no-store",
    headers,
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`companion release status ${response.status}`);
    }
    return (await response.json()) as GitHubRelease;
  });
  releaseFetchInFlight = { key: cacheKey, promise };

  try {
    const release = await promise;
    releaseCache = {
      expiresAt: Date.now() + RELEASE_CACHE_TTL_MS,
      key: cacheKey,
      release,
    };
    return release;
  } finally {
    if (releaseFetchInFlight?.promise === promise) {
      releaseFetchInFlight = null;
    }
  }
}

function githubReleaseToken(): string {
  return (
    process.env["CONTROL_CENTER_GITHUB_TOKEN"] ||
    process.env["GITHUB_TOKEN"] ||
    ""
  ).trim();
}

function githubReleaseHeaders(token: string): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "vibetv-control-center",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function releaseCacheKey(releaseUrl: string, token: string): string {
  return `${releaseUrl}|${token ? tokenFingerprint(token) : "anon"}`;
}

function tokenFingerprint(token: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `auth-${(hash >>> 0).toString(16)}`;
}

function compareSemver(left: string, right: string): number {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);
  for (let index = 0; index < 3; index += 1) {
    const diff = leftParts[index] - rightParts[index];
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function parseSemver(version: string): [number, number, number] {
  const match = version.trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return [0, 0, 0];
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}
