import type { FirmwareUpdateInfo } from "@/lib/firmware";

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
      message: "Device firmware information is not available yet.",
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
        message: "No firmware release is listed for this board.",
      } satisfies FirmwareUpdateInfo);
    }

    const comparison = compareSemver(artifact.firmwareVersion, installedFirmware);
    const updateAvailable = comparison > 0;

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
      message: "Firmware release check failed.",
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
  return (manifest.artifacts || [])
    .filter((artifact) => normalize(artifact.board) === normalizedBoard)
    .sort((a, b) =>
      compareSemver(b.firmwareVersion || "0.0.0", a.firmwareVersion || "0.0.0"),
    )[0];
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

function normalize(value?: string): string {
  return (value || "").trim().toLowerCase();
}
