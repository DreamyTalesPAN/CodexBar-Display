import { type FirmwareUpdateInfo } from "@/lib/firmware";
import type { ThemeProduct } from "@/lib/themes";
import { type ApiError } from "./control-center-types";
import { formatTime } from "./event-log";
import { themeInstallErrorText } from "./control-center-errors";
import { pollCompanionJob, type RunCompanion } from "@/lib/companion-request";
export type { RunCompanion } from "@/lib/companion-request";

export type ThemeInstallResult = {
  themeId: string;
  packId: string;
  name: string;
  activePath: string;
  themeRev: number;
};

export type ThemeInstallJob = {
  id: string;
  themeId?: string;
  themeName?: string;
  slot?: "live" | "screensaver";
  phase: "installing" | "complete" | "error";
  message?: string;
  progress?: number;
  startedAt?: string;
  finishedAt?: string;
  logs?: string[];
  result?: ThemeInstallResult;
  error?: ApiError;
};

export type FirmwareUpdateResult = {
  firmware?: string;
  observedFirmware?: string;
  target?: string;
  deviceId?: string;
  artifactValidated?: boolean;
  uploadAccepted?: boolean;
  helloVerified?: boolean;
  healthVerified?: boolean;
  streamVerified?: boolean;
  renderVerified?: boolean;
  renderSkipped?: string;
};

export type FirmwareUpdateJob = {
  id: string;
  phase: "installing" | "complete" | "attention" | "error";
  stage?: string;
  outcome?: string;
  retryPolicy?: "power_cycle" | "reconnect_cable" | "cable_required";
  message?: string;
  progress?: number;
  startedAt?: string;
  finishedAt?: string;
  logs?: string[];
  result?: FirmwareUpdateResult;
  error?: ApiError;
};

export type FirmwareUpdateStatus = {
  phase: "installing" | "complete" | "attention" | "error";
  stage?: string;
  outcome?: string;
  retryAllowed?: boolean;
  startedAt: string;
  finishedAt?: string;
  message?: string;
  progress?: number;
  logs: string[];
  result?: FirmwareUpdateResult;
  error?: string;
};

export type ThemeInstallStatus = {
  phase: "installing" | "complete" | "error";
  themeId: string;
  title: string;
  startedAt: string;
  finishedAt?: string;
  message?: string;
  progress?: number;
  logs: string[];
  result?: ThemeInstallResult;
  error?: string;
  failure?: ApiError;
};

export async function pollFirmwareUpdateJob({
  applyUpdateJob,
  jobId,
  runCompanion,
}: {
  applyUpdateJob: (job: FirmwareUpdateJob) => void;
  jobId: string;
  runCompanion: RunCompanion;
}): Promise<FirmwareUpdateJob> {
  return pollCompanionJob({
    path: `/v1/updates/install/status?jobId=${encodeURIComponent(jobId)}`,
    runCompanion,
    applyJob: applyUpdateJob,
    isFinished: (job) => {
      if (job.phase === "complete" || job.phase === "attention" || job.phase === "error") return true;
      if (job.phase !== "installing") {
        throw {
          code: "firmware_update_status_invalid",
          message: "VibeTV returned an unknown update status.",
          nextAction: "Keep VibeTV powered on, then create a support report.",
        } satisfies ApiError;
      }
      return false;
    },
    attempts: 1200,
    wait: delay,
    timeoutError: {
      code: "firmware_update_timeout",
      message: "VibeTV update is taking longer than expected.",
      nextAction: "Keep VibeTV powered on, then create a support report.",
    },
  });
}

// The app's own latest version comes with the status and is repeated there for
// six hours. After "Check for updates" the next status read asks for it again.
// The flag waits for that read, because the click's own read is skipped while
// another one is under way.
export function takeStatusPath(appUpdateCheckRequested: { current: boolean }): string {
  const path = appUpdateCheckRequested.current
    ? "/v1/status?checkAppUpdate=1"
    : "/v1/status";
  appUpdateCheckRequested.current = false;
  return path;
}

// /v1/status names the latest install job on every read. A finished job is
// news once: applied again, it replaced a later failure that never became a
// job (the Mac App refused the theme file) with that older job's "Installed".
export function statusThemeInstallIsNews(
  seen: { current: string },
  job: ThemeInstallJob | undefined,
): job is ThemeInstallJob {
  if (!job) {
    return false;
  }
  const key = `${job.id}:${job.phase}`;
  const news = job.phase === "installing" || seen.current !== key;
  seen.current = key;
  return news;
}

export function themeInstallStatusFromJob(
  job: ThemeInstallJob,
  themes: ThemeProduct[],
  fallback: { startedAt?: string; themeId?: string; title?: string } = {},
): ThemeInstallStatus {
  const phase =
    job.phase === "complete"
      ? "complete"
      : job.phase === "error"
        ? "error"
        : "installing";
  const noun = job.slot === "screensaver" ? "Screensaver" : "Theme";
  const themeId = job.result?.themeId || job.themeId || fallback.themeId || "";
  const catalogTitle = themes.find((theme) => theme.themeId === themeId)?.title;
  const title =
    job.result?.name ||
    job.themeName ||
    fallback.title ||
    catalogTitle ||
    themeId ||
    noun;
  const logs = customerInstallLogs(job.logs, [
    `Preparing ${noun.toLowerCase()} install.`,
  ]);
  const finished = phase === "complete" || phase === "error";
  return {
    phase,
    themeId,
    title,
    startedAt: job.startedAt || fallback.startedAt || formatTime(),
    finishedAt: finished ? job.finishedAt || formatTime() : undefined,
    message: job.error?.nextAction || job.message || logs[logs.length - 1],
    progress: clampProgress(job.progress),
    logs,
    result: job.result,
    error: job.error ? themeInstallErrorText(job.error) : undefined,
    failure: job.error,
  };
}

export function firmwareUpdateStatusFromJob(
  job: FirmwareUpdateJob,
  fallbackStartedAt = formatTime(),
): FirmwareUpdateStatus {
  const phase =
    job.phase === "complete"
      ? "complete"
      : job.phase === "attention"
        ? "attention"
        : job.phase === "error"
          ? "error"
          : "installing";
  const logs = customerUpdateLogs(job.logs);
  const finished =
    phase === "complete" || phase === "attention" || phase === "error";
  return {
    phase,
    stage: job.stage,
    outcome: job.outcome,
    retryAllowed: job.retryPolicy !== "power_cycle",
    startedAt: job.startedAt || fallbackStartedAt,
    finishedAt: finished ? job.finishedAt || formatTime() : undefined,
    message:
      job.error?.nextAction ||
      job.message ||
      logs[logs.length - 1] ||
      "Preparing VibeTV update.",
    progress: clampProgress(job.progress),
    logs,
    result: job.result,
    error: job.error?.nextAction,
  };
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function currentFirmwareUpdate(firmware: string): FirmwareUpdateInfo {
  return {
    checkedAt: new Date().toISOString(),
    installedFirmware: firmware,
    latestFirmware: firmware,
    updateAvailable: false,
    status: "current",
    message: "Firmware is up to date.",
  };
}

export function customerInstallLogs(
  logs: string[] | undefined,
  fallback: string[] = [],
): string[] {
  const cleaned = (logs || [])
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, index, all) => all.indexOf(line) === index);
  return cleaned.length > 0 ? cleaned : fallback;
}

export function customerUpdateLogs(
  logs: string[] | undefined,
  fallback: string[] = ["Preparing VibeTV update."],
): string[] {
  const cleaned = (logs || [])
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, index, all) => all.indexOf(line) === index);
  return cleaned.length > 0 ? cleaned : fallback;
}

export function clampProgress(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 5;
  }
  return Math.max(5, Math.min(100, Math.round(value)));
}

/** The share the Cable rescue reported as really written, from its log. */
export function firmwareWrittenPercent(logs: string[] = []): number | undefined {
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const match = /^Updating VibeTV: (\d{1,3})%\.$/.exec(logs[index]);
    if (match) {
      return Number(match[1]);
    }
  }
  return undefined;
}
