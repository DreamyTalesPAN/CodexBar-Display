"use client";

import { CheckCircle2, Download, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { CompanionReleaseInfo } from "@/lib/companion-release";

type MacPackageKey = "macosArm64" | "macosAmd64";

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
        message: "Mac App check failed.",
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
  return "Not ready yet";
}

export function CompanionDownloadActions({
  action = "install",
  release,
}: {
  action?: "install" | "repair" | "update";
  release: CompanionReleaseInfo | null;
}) {
  const [downloadStartedFor, setDownloadStartedFor] = useState<string | null>(
    null,
  );
  const preferredPackage = usePreferredMacPackage();
  const packages = release?.packageDownloadUrls;
  const downloadKey = [
    action,
    release?.release,
    release?.latestVersion,
    packages?.macosArm64,
    packages?.macosAmd64,
  ].join("|");
  const downloadStarted = downloadStartedFor === downloadKey;
  const packageButtons = sortPackageButtons(
    [
      packages?.macosArm64
        ? {
            href: packages.macosArm64,
            label: packageActionLabel(
              action,
              packages.macosAmd64 ? "Apple silicon" : "Mac",
            ),
            packageKey: "macosArm64" as const,
          }
        : null,
      packages?.macosAmd64
        ? {
            href: packages.macosAmd64,
            label: packageActionLabel(
              action,
              packages.macosArm64 ? "Intel Mac" : "Mac",
            ),
            packageKey: "macosAmd64" as const,
          }
        : null,
    ].filter(
      (item): item is { href: string; label: string; packageKey: MacPackageKey } =>
        Boolean(item),
    ),
    preferredPackage,
  );

  if (packageButtons.length > 0) {
    return (
      <>
        {packageButtons.map((button) => {
          const recommended = button.packageKey === preferredPackage;
          return (
            <DownloadLink
              badge={recommended ? "This Mac" : undefined}
              href={button.href}
              key={button.href}
              label={button.label}
              onDownloadStart={() => setDownloadStartedFor(downloadKey)}
              primary={packageButtons.length === 1 || recommended}
            />
          );
        })}
        {downloadStarted ? <AfterDownloadNotice action={action} /> : null}
      </>
    );
  }

  return <PendingPackageButton release={release} />;
}

export function CompanionPrimaryAction({
  busy,
  onRetry,
  release,
}: {
  busy: boolean;
  onRetry: () => void;
  release: CompanionReleaseInfo | null;
}) {
  const [downloadStartedFor, setDownloadStartedFor] = useState<string | null>(
    null,
  );
  const preferredPackage = usePreferredMacPackage();
  const packages = release?.packageDownloadUrls;
  const packageUrl =
    (preferredPackage ? packages?.[preferredPackage] : undefined) ||
    packages?.macosArm64 ||
    packages?.macosAmd64;
  const downloadKey = [
    "install",
    release?.release,
    release?.latestVersion,
    packageUrl,
  ].join("|");
  const downloadStarted = downloadStartedFor === downloadKey;

  if (packageUrl) {
    return (
      <>
        <a
          className="inline-flex h-12 min-w-[220px] items-center justify-center gap-2 border border-[#1B1B1B] bg-[#1B1B1B] px-5 text-sm font-bold text-[#EDEDED] transition hover:bg-[#CCFF00] hover:text-[#1B1B1B]"
          href={packageUrl}
          onClick={() => setDownloadStartedFor(downloadKey)}
        >
          <Download size={18} aria-hidden />
          <span>Install Mac App</span>
        </a>
        {downloadStarted ? <AfterDownloadNotice action="install" /> : null}
      </>
    );
  }

  if (release?.status === "check_failed") {
    return (
      <button
        className="inline-flex h-12 min-w-[220px] items-center justify-center gap-2 border border-[#1B1B1B] bg-[#1B1B1B] px-5 text-sm font-bold text-[#EDEDED] transition hover:bg-[#CCFF00] hover:text-[#1B1B1B] disabled:cursor-not-allowed disabled:bg-[#EEEEEE] disabled:text-[#444933]"
        disabled={busy}
        onClick={onRetry}
        type="button"
      >
        <RefreshCw
          className={busy ? "animate-spin" : undefined}
          size={18}
          aria-hidden
        />
        <span>{busy ? "Checking" : "Try again"}</span>
      </button>
    );
  }

  if (busy || !release) {
    return (
      <div
        className="inline-flex h-12 min-w-[220px] items-center justify-center gap-2 border border-[#747A60] bg-[#F9F9F9] px-5 text-sm font-bold text-[#444933]"
        role="status"
      >
        <RefreshCw className="animate-spin" size={18} aria-hidden />
        <span>Checking Mac App</span>
      </div>
    );
  }

  return (
    <p
      className="max-w-[260px] border border-[#747A60] bg-[#F9F9F9] px-4 py-3 text-sm font-semibold leading-5 text-[#444933]"
      role="status"
    >
      Mac App is not ready yet.
    </p>
  );
}

function PendingPackageButton({
  release,
}: {
  release?: CompanionReleaseInfo | null;
}) {
  const label =
    release?.status === "check_failed"
      ? "Check failed"
      : release?.status === "missing_asset"
        ? "Not ready yet"
      : release && !hasCompleteMacPackages(release)
        ? "Not ready yet"
        : "Checking Mac App";

  return (
    <button
      className="inline-flex h-12 min-w-[190px] items-center justify-center gap-2 border border-[#747A60] bg-[#F9F9F9] px-4 text-sm font-semibold text-[#444933] opacity-80"
      disabled
      type="button"
    >
      <Download size={18} aria-hidden />
      <span>{label}</span>
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

function DownloadLink({
  badge,
  href,
  label,
  onDownloadStart,
  primary,
}: {
  badge?: string;
  href: string;
  label: string;
  onDownloadStart?: () => void;
  primary?: boolean;
}) {
  return (
    <a
      className={`inline-flex min-h-12 min-w-[190px] flex-wrap items-center justify-center gap-2 border border-[#747A60] px-4 py-2 text-center text-sm font-semibold text-[#1B1B1B] transition ${
        primary
          ? "bg-[#CCFF00] hover:bg-[#ABD600]"
          : "bg-[#F9F9F9] hover:bg-[#EEEEEE]"
      }`}
      href={href}
      onClick={onDownloadStart}
    >
      <Download size={18} aria-hidden />
      <span className="leading-5">{label}</span>
      {badge ? (
        <span className="shrink-0 border border-[#1B1B1B] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-normal">
          {badge}
        </span>
      ) : null}
    </a>
  );
}

function AfterDownloadNotice({
  action,
}: {
  action: "install" | "repair" | "update";
}) {
  return (
    <p
      className="flex w-full max-w-[420px] gap-2 border border-[#747A60] bg-[#F9F9F9] px-3 py-2 text-xs leading-5 text-[#444933]"
      role="status"
    >
      <CheckCircle2
        className="mt-0.5 shrink-0 text-[#506600]"
        size={15}
        aria-hidden
      />
      <span>{afterDownloadDetail(action)}</span>
    </p>
  );
}

function afterDownloadDetail(action: "install" | "repair" | "update"): string {
  if (action === "update") {
    return "Download started. Open the downloaded installer, finish the update, then return here and check the Mac App again.";
  }
  if (action === "repair") {
    return "Download started. Open the downloaded installer, finish the repair, then return here and check the Mac App again.";
  }
  return "Download started. Open the downloaded installer, finish setup, then return here and check the Mac App again.";
}

export function hasCompleteMacPackages(
  release: CompanionReleaseInfo | null,
): boolean {
  return Boolean(
    release?.packageDownloadUrls?.macosArm64 &&
      release.packageDownloadUrls.macosAmd64,
  );
}

function sortPackageButtons<T extends { packageKey: MacPackageKey }>(
  buttons: T[],
  preferredPackage: MacPackageKey | null,
): T[] {
  if (!preferredPackage) {
    return buttons;
  }
  return [...buttons].sort((left, right) => {
    if (left.packageKey === preferredPackage) {
      return -1;
    }
    if (right.packageKey === preferredPackage) {
      return 1;
    }
    return 0;
  });
}

export function usePreferredMacPackage(): MacPackageKey | null {
  const [preferredPackage, setPreferredPackage] =
    useState<MacPackageKey | null>(null);

  useEffect(() => {
    let cancelled = false;
    void detectPreferredMacPackage().then((detectedPackage) => {
      if (!cancelled) {
        setPreferredPackage(detectedPackage);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return preferredPackage;
}

async function detectPreferredMacPackage(): Promise<MacPackageKey | null> {
  if (typeof navigator === "undefined") {
    return null;
  }

  const userAgentData = readUserAgentData();
  const platform =
    userAgentData?.platform || navigator.platform || navigator.userAgent || "";
  if (!/mac/i.test(platform)) {
    return null;
  }

  const architecture = await readUserAgentArchitecture(userAgentData);
  if (/^(arm|arm64|aarch64)$/i.test(architecture)) {
    return "macosArm64";
  }
  if (/^(x86|x86_64|amd64|x64)$/i.test(architecture)) {
    return "macosAmd64";
  }

  return null;
}

type NavigatorUserAgentData = {
  platform?: string;
  getHighEntropyValues?: (
    hints: string[],
  ) => Promise<{ architecture?: string; platform?: string }>;
};

function readUserAgentData(): NavigatorUserAgentData | undefined {
  return (navigator as Navigator & { userAgentData?: NavigatorUserAgentData })
    .userAgentData;
}

async function readUserAgentArchitecture(
  userAgentData?: NavigatorUserAgentData,
): Promise<string> {
  try {
    const values = await userAgentData?.getHighEntropyValues?.([
      "architecture",
      "platform",
    ]);
    return values?.architecture || "";
  } catch {
    return "";
  }
}
