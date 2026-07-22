import type { FirmwareUpdateInfo } from "@/lib/firmware";
import { compareSemVer, parseSemVer, type ParsedSemVer } from "@/lib/semver";

export const dynamic = "force-dynamic";

const DEFAULT_FIRMWARE_MANIFEST_URL =
  "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/firmware-manifest.json";

type FirmwareManifest = {
  release?: string;
  artifacts?: FirmwareArtifact[];
};

type FirmwareArtifact = {
  board?: string;
  firmwareVersion?: string;
  severity?: string;
  message?: string;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const board = url.searchParams.get("board")?.trim() || "";
  const installedFirmware = url.searchParams.get("firmware")?.trim() || "";
  const checkedAt = new Date().toISOString();

  if (!board || !installedFirmware) {
    return Response.json({
      checkedAt,
      installedFirmware: installedFirmware || undefined,
      updateAvailable: false,
      status: "missing_device_info",
      message: "VibeTV update info is not available yet.",
    } satisfies FirmwareUpdateInfo);
  }

  const installedParsed = parseSemVer(installedFirmware);
  if (!installedParsed) {
    return Response.json({
      checkedAt,
      installedFirmware,
      updateAvailable: false,
      status: "check_failed",
      message: `Installed firmware version "${installedFirmware}" is not a valid version.`,
    } satisfies FirmwareUpdateInfo);
  }

  try {
    const manifest = await fetchFirmwareManifest();
    const artifact = selectLatestArtifactForBoard(manifest, board);

    if (!artifact?.firmwareVersion) {
      return Response.json({
        checkedAt,
        installedFirmware,
        release: manifest.release,
        updateAvailable: false,
        status: "no_board_release",
        message: "No update is available for this VibeTV.",
      } satisfies FirmwareUpdateInfo);
    }

    const latestParsed = parseSemVer(artifact.firmwareVersion);
    if (!latestParsed) {
      return Response.json({
        checkedAt,
        installedFirmware,
        release: manifest.release,
        updateAvailable: false,
        status: "check_failed",
        message: `Published firmware version "${artifact.firmwareVersion}" is not a valid version.`,
      } satisfies FirmwareUpdateInfo);
    }

    const updateAvailable = compareSemVer(latestParsed, installedParsed) > 0;

    return Response.json({
      checkedAt,
      installedFirmware,
      latestFirmware: artifact.firmwareVersion,
      release: manifest.release,
      updateAvailable,
      status: updateAvailable ? "update_available" : "current",
      message: updateAvailable
        ? artifact.message || "Firmware update available."
        : "Firmware is up to date.",
    } satisfies FirmwareUpdateInfo);
  } catch {
    return Response.json({
      checkedAt,
      installedFirmware,
      updateAvailable: false,
      status: "check_failed",
      message: "Firmware check failed.",
    } satisfies FirmwareUpdateInfo);
  }
}

async function fetchFirmwareManifest(): Promise<FirmwareManifest> {
  const manifestUrl =
    process.env.CONTROL_CENTER_FIRMWARE_MANIFEST_URL ||
    DEFAULT_FIRMWARE_MANIFEST_URL;
  const response = await fetch(manifestUrl, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`firmware manifest status ${response.status}`);
  }

  return (await response.json()) as FirmwareManifest;
}

function selectLatestArtifactForBoard(
  manifest: FirmwareManifest,
  board: string,
): FirmwareArtifact | undefined {
  const normalizedBoard = normalize(board);
  let latestArtifact: FirmwareArtifact | undefined;
  let latestParsed: ParsedSemVer | undefined;
  for (const artifact of manifest.artifacts || []) {
    if (normalize(artifact.board) !== normalizedBoard) {
      continue;
    }
    const parsed = parseSemVer(artifact.firmwareVersion || "");
    if (!parsed) {
      continue;
    }
    if (!latestParsed || compareSemVer(parsed, latestParsed) > 0) {
      latestParsed = parsed;
      latestArtifact = artifact;
    }
  }
  return latestArtifact;
}

function normalize(value?: string): string {
  return (value || "").trim().toLowerCase();
}
