import type { CompanionReleaseInfo } from "@/lib/companion-release";

export const dynamic = "force-dynamic";

const DEFAULT_RELEASE_API_URL =
  "https://api.github.com/repos/DreamyTalesPAN/CodexBar-Display/releases/latest";
const RELEASE_CACHE_TTL_MS = 60_000;

type GitHubRelease = {
  tag_name?: string;
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
    if (!latestVersion) {
      return Response.json({
        checkedAt,
        status: "check_failed",
        release: releaseTag || undefined,
        installedVersion: installedVersion || undefined,
        updateAvailable: false,
        message: "Mac App check failed.",
      } satisfies CompanionReleaseInfo);
    }

    const updateAvailable = Boolean(
      installedVersion && compareSemver(latestVersion, installedVersion) > 0,
    );

    return Response.json({
      checkedAt,
      status: "available",
      release: releaseTag || undefined,
      latestVersion,
      installedVersion: installedVersion || undefined,
      updateAvailable,
      message: updateAvailable
        ? "Mac App update is available."
        : "Mac App is up to date.",
    } satisfies CompanionReleaseInfo);
  } catch {
    return Response.json({
      checkedAt,
      status: "check_failed",
      installedVersion: installedVersion || undefined,
      updateAvailable: false,
      message: "Mac App check failed.",
    } satisfies CompanionReleaseInfo);
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
