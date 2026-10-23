import { companionRequestUrl } from "@/components/control-center-runtime";
import type { ApiError } from "@/components/control-center-types";

export async function fetchCompanionJson(path: string, init: RequestInit) {
  const response = await fetch(companionRequestUrl(path), { ...init, cache: "no-store" });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

export type RunCompanion = <T>(
  path: string,
  init?: RequestInit,
  options?: { preserveLastError?: boolean; timeoutMs?: number },
) => Promise<T>;

export async function pollCompanionJob<Job>({
  path, runCompanion, applyJob, isFinished, attempts, timeoutError,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: {
  path: string;
  runCompanion: RunCompanion;
  applyJob: (job: Job) => void;
  isFinished: (job: Job) => boolean;
  attempts: number;
  timeoutError: ApiError;
  wait?: (ms: number) => Promise<unknown>;
}): Promise<Job> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await wait(500);
    const payload = await runCompanion<{ job: Job }>(path, undefined, { preserveLastError: true });
    applyJob(payload.job);
    if (isFinished(payload.job)) return payload.job;
  }
  throw timeoutError;
}
