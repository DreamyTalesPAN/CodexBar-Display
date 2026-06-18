import type { CompanionReleaseInfo } from "@/lib/companion-release";

export const dynamic = "force-dynamic";

const DEFAULT_RELEASE_API_URL =
  "https://api.github.com/repos/DreamyTalesPAN/CodexBar-Display/releases/latest";
const INSTALLER_ASSET_NAME = "install-control-center-companion.sh";
const PACKAGE_ASSET_RE = /^VibeTV-Companion-API-(arm64|amd64)-v.+\.pkg$/;

type GitHubRelease = {
  tag_name?: string;
  assets?: GitHubReleaseAsset[];
};

type GitHubReleaseAsset = {
  name?: string;
  browser_download_url?: string;
};

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
    const installer = (release.assets || []).find(
      (asset) => asset.name === INSTALLER_ASSET_NAME,
    );
    const packageDownloadUrls = findPackageDownloadUrls(release.assets || []);
    const hasPackageDownload = Boolean(
      packageDownloadUrls.macosArm64 || packageDownloadUrls.macosAmd64,
    );

    if (!installer?.browser_download_url && !hasPackageDownload) {
      return Response.json({
        checkedAt,
        status: "missing_asset",
        release: releaseTag || undefined,
        latestVersion: latestVersion || undefined,
        installedVersion: installedVersion || undefined,
        updateAvailable: false,
        message:
          "Companion installer is not published in the latest release yet.",
      } satisfies CompanionReleaseInfo);
    }

    return Response.json({
      checkedAt,
      status: "available",
      release: releaseTag || undefined,
      latestVersion: latestVersion || undefined,
      installedVersion: installedVersion || undefined,
      updateAvailable: Boolean(
        latestVersion &&
          installedVersion &&
          compareSemver(latestVersion, installedVersion) > 0,
      ),
      ...(installer?.browser_download_url
        ? { installerDownloadUrl: installer.browser_download_url }
        : {}),
      ...(hasPackageDownload ? { packageDownloadUrls } : {}),
      message: hasPackageDownload
        ? "Companion package is available for macOS."
        : installedVersion
          ? "Companion installer is available."
          : "Companion installer is available for this Mac.",
    } satisfies CompanionReleaseInfo);
  } catch {
    return Response.json({
      checkedAt,
      status: "check_failed",
      installedVersion: installedVersion || undefined,
      updateAvailable: false,
      message: "Companion release check failed.",
    } satisfies CompanionReleaseInfo);
  }
}

async function fetchLatestRelease(): Promise<GitHubRelease> {
  const releaseUrl =
    process.env.CONTROL_CENTER_COMPANION_RELEASE_API_URL ||
    DEFAULT_RELEASE_API_URL;
  const response = await fetch(releaseUrl, {
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "vibetv-control-center",
    },
  });

  if (!response.ok) {
    throw new Error(`companion release status ${response.status}`);
  }

  return (await response.json()) as GitHubRelease;
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

function findPackageDownloadUrls(assets: GitHubReleaseAsset[]) {
  const urls: NonNullable<CompanionReleaseInfo["packageDownloadUrls"]> = {};

  for (const asset of assets) {
    const name = asset.name || "";
    const match = name.match(PACKAGE_ASSET_RE);
    if (!match || !asset.browser_download_url) {
      continue;
    }
    if (match[1] === "arm64") {
      urls.macosArm64 = asset.browser_download_url;
    }
    if (match[1] === "amd64") {
      urls.macosAmd64 = asset.browser_download_url;
    }
  }

  return urls;
}
