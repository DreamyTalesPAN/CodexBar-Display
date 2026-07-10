"use client";

import { useCallback, useEffect, useState } from "react";
import type { CompanionReleaseInfo } from "@/lib/companion-release";
import {
  companionReleaseApiUrl,
  currentControlCenterOrigin,
} from "./mac-app-install-command";

type UseCompanionReleaseOptions = {
  enabled?: boolean;
};

export function useCompanionRelease(
  companionVersion?: string,
  { enabled = true }: UseCompanionReleaseOptions = {},
) {
  const [release, setRelease] = useState<CompanionReleaseInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setRelease(null);
      return;
    }

    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (companionVersion) {
        params.set("version", companionVersion);
      }
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const endpoint = companionReleaseApiUrl(currentControlCenterOrigin());
      const response = await fetch(`${endpoint}${suffix}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Mac App check failed: ${response.status}`);
      }
      setRelease((await response.json()) as CompanionReleaseInfo);
    } catch {
      setRelease({
        checkedAt: new Date().toISOString(),
        status: "check_failed",
        installedVersion: companionVersion,
        updateAvailable: false,
        message: "Mac App check failed.",
        dmgDownloadStatus: "check_failed",
      });
    } finally {
      setBusy(false);
    }
  }, [companionVersion, enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [enabled, refresh]);

  return {
    busy: enabled ? busy : false,
    refresh,
    release: enabled ? release : null,
  };
}
