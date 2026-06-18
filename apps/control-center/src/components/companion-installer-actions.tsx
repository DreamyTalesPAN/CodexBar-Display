"use client";

import { Download } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { CompanionReleaseInfo } from "@/lib/companion-release";

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
      const response = await fetch(`/api/companion/latest${suffix}`);
      if (!response.ok) {
        throw new Error(`companion release check failed: ${response.status}`);
      }
      setRelease((await response.json()) as CompanionReleaseInfo);
    } catch {
      setRelease({
        checkedAt: new Date().toISOString(),
        status: "check_failed",
        installedVersion: companionVersion,
        updateAvailable: false,
        message: "Companion release check failed.",
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

  return { busy, refresh, release };
}

export function companionPackageLabel(
  release: CompanionReleaseInfo | null,
): string {
  if (!release) {
    return "Checking";
  }

  const packages = release.packageDownloadUrls;
  const hasArm64 = Boolean(packages?.macosArm64);
  const hasAmd64 = Boolean(packages?.macosAmd64);

  if (hasArm64 && hasAmd64) {
    return "Apple silicon + Intel";
  }
  if (hasArm64) {
    return "Apple silicon";
  }
  if (hasAmd64) {
    return "Intel Mac";
  }
  if (release.status === "check_failed") {
    return "Check failed";
  }
  return "Package pending";
}

export function CompanionDownloadActions({
  action = "install",
  release,
}: {
  action?: "install" | "repair" | "update";
  release: CompanionReleaseInfo | null;
}) {
  const packages = release?.packageDownloadUrls;
  const packageButtons = [
    packages?.macosArm64
      ? {
          href: packages.macosArm64,
          label: packageActionLabel(
            action,
            packages.macosAmd64 ? "Apple silicon" : "Mac",
          ),
        }
      : null,
    packages?.macosAmd64
      ? {
          href: packages.macosAmd64,
          label: packageActionLabel(
            action,
            packages.macosArm64 ? "Intel Mac" : "Mac",
          ),
        }
      : null,
  ].filter((item): item is { href: string; label: string } => Boolean(item));

  if (packageButtons.length > 0) {
    return (
      <>
        {packageButtons.map((button) => (
          <DownloadLink
            href={button.href}
            key={button.href}
            label={button.label}
            primary
          />
        ))}
        {release?.installerDownloadUrl ? (
          <DownloadLink
            href={release.installerDownloadUrl}
            label={scriptActionLabel(action)}
          />
        ) : null}
      </>
    );
  }

  if (release?.installerDownloadUrl) {
    return (
      <DownloadLink
        href={release.installerDownloadUrl}
        label={scriptActionLabel(action)}
        primary
      />
    );
  }

  return (
    <button
      className="inline-flex h-12 min-w-[190px] items-center justify-center gap-2 border border-[#747A60] bg-[#F9F9F9] px-4 text-sm font-semibold text-[#444933] opacity-80"
      disabled
      type="button"
    >
      <Download size={18} aria-hidden />
      <span>Installer pending</span>
    </button>
  );
}

function packageActionLabel(
  action: "install" | "repair" | "update",
  platform: "Apple silicon" | "Intel Mac" | "Mac",
): string {
  if (action === "update") {
    return `Update ${platform}`;
  }
  if (action === "repair") {
    return `Repair ${platform}`;
  }
  return `Install ${platform}`;
}

function scriptActionLabel(action: "install" | "repair" | "update"): string {
  if (action === "update") {
    return "Update with script";
  }
  if (action === "repair") {
    return "Repair with script";
  }
  return "Script installer";
}

function DownloadLink({
  href,
  label,
  primary,
}: {
  href: string;
  label: string;
  primary?: boolean;
}) {
  return (
    <a
      className={`inline-flex h-12 min-w-[190px] items-center justify-center gap-2 border border-[#747A60] px-4 text-sm font-semibold text-[#1B1B1B] transition ${
        primary
          ? "bg-[#CCFF00] hover:bg-[#ABD600]"
          : "bg-[#F9F9F9] hover:bg-[#EEEEEE]"
      }`}
      href={href}
    >
      <Download size={18} aria-hidden />
      <span>{label}</span>
    </a>
  );
}
