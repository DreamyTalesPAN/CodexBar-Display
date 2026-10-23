import type { ApiError } from "@/components/control-center-types";
import type { ThemeStudioDocument } from "@/components/theme-studio/theme-studio-editor-state";
import { buildThemePack } from "./theme-studio";
import { flattenCompanionSprites } from "./ai-theme-document";
import { fetchCompanionJson, pollCompanionJob, type RunCompanion } from "./companion-request";

// Editor, library and ZIP export all send the same device-ready copy. Keep
// transparent originals in the editable document so later edits stay correct.
export function buildDeviceThemePack(document: ThemeStudioDocument) {
  const device = flattenCompanionSprites(document);
  return buildThemePack(device.spec, device.packName, device.assets, device.usage);
}

export async function pollThemeInstallJob<Job extends { phase: string }>({
  applyInstallJob,
  jobId,
  noun = "Theme",
  runCompanion,
}: {
  applyInstallJob: (job: Job) => void;
  jobId: string;
  noun?: string;
  runCompanion: RunCompanion;
}): Promise<Job> {
  // The server may spend the full five-minute budget waiting for the first
  // fresh display frame after it has already installed the theme.
  return pollCompanionJob({
    path: `/v1/themes/install/status?jobId=${encodeURIComponent(jobId)}`,
    runCompanion,
    applyJob: applyInstallJob,
    isFinished: (job) => job.phase === "complete" || job.phase === "error",
    attempts: 900,
    timeoutError: {
      code: "theme_install_timeout",
      message: `${noun} install is taking longer than expected.`,
      nextAction: `Keep VibeTV powered on, then check the ${noun.toLowerCase()} again.`,
    },
  });
}

type InstallJob = {
  id: string;
  phase: "installing" | "complete" | "error";
  message?: string;
  result?: unknown;
  error?: ApiError;
};

export async function sendThemeToVibeTV(document: ThemeStudioDocument, onStatus: (message: string) => void, pendingJob: string | null, onJob: (id: string | null) => void) {
  const runCompanion = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const { response, payload } = await fetchCompanionJson(path, {
      ...init, signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok || !payload || payload.ok === false) {
      throw Object.assign(new Error(payload?.error?.nextAction || payload?.error?.message || "Open the VibeTV Mac App and connect your display."), { code: payload?.error?.code });
    }
    return payload;
  };
  if (!pendingJob) {
    const pack = buildDeviceThemePack(document);
    const query = new URLSearchParams({
      async: "true", slot: document.usage || "live",
      themeId: pack.manifest.id, themeName: pack.manifest.name,
    });
    const payload = await runCompanion<{ job?: InstallJob; result?: unknown }>(`/v1/themes/install?${query}`, {
      method: "POST", headers: { "Content-Type": "application/zip" },
      body: new Uint8Array(pack.zipBytes),
    });
    if (!payload.job) {
      if (!payload.result) throw new Error("VibeTV could not confirm the transfer.");
      return "Theme sent to VibeTV.";
    }
    pendingJob = payload.job.id;
    onJob(pendingJob);
  }
  const job = await pollThemeInstallJob({
    jobId: pendingJob, runCompanion,
    applyInstallJob: (job: InstallJob) => onStatus(job.message || "Sending…"),
  }).catch((error) => {
    // A restarted Mac App has forgotten the job: nothing is left to check, so
    // the next Send starts over. Any other failure keeps the job to check again.
    if (error?.code === "install_job_not_found") onJob(null);
    throw error;
  });
  onJob(null);
  if (job.phase === "error") throw new Error(job.error?.nextAction || job.error?.message || job.message || "Theme transfer failed.");
  if (!job.result) throw new Error("VibeTV could not confirm the transfer.");
  return job.message || "Theme sent to VibeTV.";
}
