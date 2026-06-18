"use client";

import Image from "next/image";
import { Library, Lock, Monitor, RefreshCw, ShieldCheck, Wifi, X } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import type { ThemeProduct } from "@/lib/themes";

export type ThemeLibraryCompanionStatus = "unknown" | "online" | "missing";

export type ThemeLibraryDeviceInfo = {
  connected: boolean;
  paired?: boolean;
  board?: string;
  firmware?: string;
  activeTheme?: string;
};

export type ThemeInstallResult = {
  themeId: string;
  packId: string;
  name: string;
  activePath: string;
  themeRev: number;
};

export type ThemeInstallStatus = {
  phase: "installing" | "complete" | "error";
  themeId: string;
  title: string;
  startedAt: string;
  finishedAt?: string;
  logs: string[];
  result?: ThemeInstallResult;
  error?: string;
};

export type ThemeLibraryScreenProps = {
  themes: ThemeProduct[];
  selectedTheme?: ThemeProduct;
  selectedThemeId: string;
  companionStatus: ThemeLibraryCompanionStatus;
  device: ThemeLibraryDeviceInfo | null;
  themeInstallEnabled: boolean;
  busyAction: string | null;
  installStatus?: ThemeInstallStatus | null;
  lastInstall?: ThemeInstallResult;
  onSelectTheme: (themeId: string) => void;
  onInstallTheme: (theme: ThemeProduct) => void;
  onCheckBridge?: () => void;
  onDiscoverDevice?: () => void;
};

export function ThemeLibraryScreen({
  themes,
  selectedTheme,
  selectedThemeId,
  busyAction,
  device,
  installStatus,
  lastInstall,
  companionStatus,
  themeInstallEnabled,
  onCheckBridge,
  onDiscoverDevice,
  onSelectTheme,
  onInstallTheme,
}: ThemeLibraryScreenProps) {
  const visibleThemes = themes.length ? themes : MOCK_THEMES;
  const [previewTheme, setPreviewTheme] = useState<ThemeProduct | null>(null);
  const displayTheme =
    selectedTheme ||
    visibleThemes.find((theme) => theme.themeId === selectedThemeId) ||
    visibleThemes[0];
  const readiness = buildInstallReadiness({
    companionStatus,
    device,
    themeInstallEnabled,
  });

  return (
    <div className="mx-auto max-w-[1180px]">
      <section className="min-h-[330px] border-b border-[#747A60] py-10">
        <div className="min-w-0">
          <div className="flex items-start gap-5">
            <HeroIcon>
              <Library size={36} aria-hidden />
            </HeroIcon>
            <div className="min-w-0">
              <h2 className="max-w-[520px] text-[clamp(2.7rem,4.8vw,4.5rem)] font-black leading-[1.05] tracking-normal text-[#1B1B1B]">
                Choose a theme
              </h2>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-[#747A60] py-8">
        <div className="mb-6 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="flex min-w-0 gap-4">
            <div className="grid size-11 shrink-0 place-items-center rounded-full bg-[#1B1B1B] text-[#CCFF00]">
              {readiness.icon}
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-[#1B1B1B]">
                {readiness.title}
              </h3>
              <p className="mt-1 max-w-[720px] text-sm leading-6 text-[#444933]">
                {readiness.detail}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row md:justify-end">
            {companionStatus !== "online" ? (
              <button
                className="inline-flex h-11 items-center justify-center gap-2 border border-[#747A60] bg-[#F9F9F9] px-4 text-sm font-semibold text-[#1B1B1B] transition hover:bg-[#CCFF00]"
                onClick={onCheckBridge}
                type="button"
              >
                <Wifi size={17} aria-hidden />
                Check bridge
              </button>
            ) : null}
            {companionStatus === "online" && !device?.connected ? (
              <button
                className="inline-flex h-11 items-center justify-center gap-2 border border-[#747A60] bg-[#1B1B1B] px-4 text-sm font-semibold text-[#EDEDED] transition hover:bg-[#CCFF00] hover:text-[#1B1B1B]"
                onClick={onDiscoverDevice}
                type="button"
              >
                <Monitor size={17} aria-hidden />
                Find VibeTV
              </button>
            ) : null}
          </div>
        </div>

        <ul className="divide-y divide-[#747A60] border-y border-[#747A60]">
          {visibleThemes.map((theme) => (
            <ThemeListItem
              busyAction={busyAction}
              device={device}
              displayThemeId={displayTheme?.themeId}
              installStatus={installStatus}
              key={theme.themeId}
              lastInstall={lastInstall}
              onInstallTheme={onInstallTheme}
              onPreviewTheme={setPreviewTheme}
              onSelectTheme={onSelectTheme}
              selectedThemeId={selectedThemeId}
              theme={theme}
              themeInstallBlockedReason={readiness.buttonReason}
              themeInstallEnabled={themeInstallEnabled}
            />
          ))}
        </ul>
      </section>

      {previewTheme ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-[#1B1B1B]/80 p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`${previewTheme.title} preview`}
        >
          <div className="w-full max-w-[640px] border border-[#747A60] bg-[#F9F9F9] p-5">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h3 className="truncate text-2xl font-black text-[#1B1B1B]">
                {previewTheme.title}
              </h3>
              <button
                aria-label="Close preview"
                className="grid size-10 place-items-center border border-[#747A60] bg-[#F9F9F9] text-[#1B1B1B] hover:bg-[#CCFF00]"
                onClick={() => setPreviewTheme(null)}
                type="button"
              >
                <X size={20} aria-hidden />
              </button>
            </div>
            <ThemePreview large theme={previewTheme} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ThemeListItem({
  busyAction,
  device,
  displayThemeId,
  installStatus,
  lastInstall,
  onInstallTheme,
  onPreviewTheme,
  onSelectTheme,
  selectedThemeId,
  theme,
  themeInstallBlockedReason,
  themeInstallEnabled,
}: {
  busyAction: string | null;
  device: ThemeLibraryDeviceInfo | null;
  displayThemeId?: string;
  installStatus?: ThemeInstallStatus | null;
  lastInstall?: ThemeInstallResult;
  onInstallTheme: (theme: ThemeProduct) => void;
  onPreviewTheme: (theme: ThemeProduct) => void;
  onSelectTheme: (themeId: string) => void;
  selectedThemeId: string;
  theme: ThemeProduct;
  themeInstallBlockedReason: string;
  themeInstallEnabled: boolean;
}) {
  const installed =
    lastInstall?.themeId === theme.themeId || device?.activeTheme === theme.themeId;
  const installing = busyAction === "install" && theme.themeId === selectedThemeId;
  const activeInstall =
    installStatus?.themeId === theme.themeId &&
    installStatus.phase !== "complete";
  const disabled =
    installing ||
    installed ||
    !device?.connected ||
    !themeInstallEnabled ||
    !theme.packUrl;
  const title = disabled
    ? installDisabledReason({
        installed,
        connected: Boolean(device?.connected),
        hasPack: Boolean(theme.packUrl),
        themeInstallBlockedReason,
        themeInstallEnabled,
      })
    : `Install ${theme.title}`;

  return (
    <li className={theme.themeId === displayThemeId ? "bg-[#EEEEEE]" : ""}>
      <div className="grid grid-cols-[96px_minmax(0,1fr)_auto] items-center gap-5 py-4 transition">
        <button
          aria-label={`Preview ${theme.title}`}
          className="text-left"
          onClick={() => onPreviewTheme(theme)}
          type="button"
        >
          <ThemePreview theme={theme} />
        </button>
        <div className="min-w-0">
          <div className="truncate text-lg font-bold text-[#1B1B1B]">
            {theme.title}
          </div>
          <div className="mt-1 line-clamp-1 text-sm leading-6 text-[#444933]">
            {theme.description || "Theme from the VibeTV catalog."}
          </div>
        </div>
        <button
          className="mr-3 h-10 min-w-[96px] border border-[#747A60] bg-[#F9F9F9] px-4 text-sm font-semibold text-[#1B1B1B] transition hover:bg-[#CCFF00] disabled:cursor-not-allowed disabled:bg-[#EEEEEE] disabled:text-[#444933] disabled:opacity-70"
          disabled={disabled}
          onClick={() => {
            onSelectTheme(theme.themeId);
            onInstallTheme(theme);
          }}
          title={title}
          type="button"
        >
          {labelForInstallButton({
            busy: busyAction === "install",
            installed,
            selected: theme.themeId === selectedThemeId,
            disabled,
          })}
        </button>
      </div>
      {activeInstall ? <InlineInstallProgress status={installStatus} /> : null}
    </li>
  );
}

function InlineInstallProgress({ status }: { status: ThemeInstallStatus }) {
  const failed = status.phase === "error";
  const progressWidth = failed ? "w-full" : "w-2/3";

  return (
    <div className="px-0 pb-4">
      <div className="mr-3 h-2 overflow-hidden border border-[#747A60] bg-[#F9F9F9]">
        <div
          className={`h-full bg-[#CCFF00] ${progressWidth} ${
            failed ? "" : "animate-pulse"
          }`}
        />
      </div>
      <details className="mr-3 mt-3">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-bold text-[#1B1B1B]">
          {failed ? (
            <X size={16} aria-hidden />
          ) : (
            <RefreshCw className="animate-spin" size={16} aria-hidden />
          )}
          <span>{failed ? "Install failed" : "Installing"}</span>
          <span className="font-normal text-[#444933]">
            {status.logs.length} log lines
          </span>
        </summary>
        <ol className="mt-3 divide-y divide-[#747A60] border-y border-[#747A60]">
          {status.logs.slice(-8).map((line, index) => (
            <li
              className="grid grid-cols-[32px_minmax(0,1fr)] gap-3 py-2 text-sm text-[#444933]"
              key={`${line}-${index}`}
            >
              <span className="font-mono text-xs text-[#506600]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="break-words">{line}</span>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

function labelForInstallButton({
  busy,
  disabled,
  installed,
  selected,
}: {
  busy: boolean;
  disabled: boolean;
  installed: boolean;
  selected: boolean;
}) {
  if (busy && selected) {
    return "Installing";
  }
  if (installed) {
    return "Installed";
  }
  if (disabled) {
    return "Locked";
  }
  return "Install";
}

function buildInstallReadiness({
  companionStatus,
  device,
  themeInstallEnabled,
}: {
  companionStatus: ThemeLibraryCompanionStatus;
  device: ThemeLibraryDeviceInfo | null;
  themeInstallEnabled: boolean;
}) {
  if (companionStatus !== "online") {
    return {
      title: "Companion required",
      detail:
        "Themes can be browsed now. Installing needs the local Companion running on this computer.",
      buttonReason: "Start Companion first.",
      icon: <Wifi size={22} aria-hidden />,
    };
  }
  if (!device?.connected) {
    return {
      title: "VibeTV not found",
      detail:
        "Companion is online. Search for VibeTV on the same WiFi network before enabling install.",
      buttonReason: "Find VibeTV first.",
      icon: <Monitor size={22} aria-hidden />,
    };
  }
  if (!themeInstallEnabled) {
    return {
      title: "Install protected",
      detail:
        "Device reads are ready. Theme install writes stay locked until the hardware-safe release gate is enabled.",
      buttonReason: "Theme install is protected for this release gate.",
      icon: <Lock size={22} aria-hidden />,
    };
  }
  return {
    title: "Ready for install",
    detail:
      "Companion and VibeTV are online, and this Companion build allows theme install writes.",
    buttonReason: "",
    icon: <ShieldCheck size={22} aria-hidden />,
  };
}

function installDisabledReason({
  connected,
  hasPack,
  installed,
  themeInstallBlockedReason,
  themeInstallEnabled,
}: {
  connected: boolean;
  hasPack: boolean;
  installed: boolean;
  themeInstallBlockedReason: string;
  themeInstallEnabled: boolean;
}) {
  if (installed) {
    return "Theme is already installed.";
  }
  if (!hasPack) {
    return "Theme pack URL is missing.";
  }
  if (!connected) {
    return themeInstallBlockedReason || "Find VibeTV first.";
  }
  if (!themeInstallEnabled) {
    return themeInstallBlockedReason || "Theme install is protected.";
  }
  return "Install is not available right now.";
}

const MOCK_THEMES: ThemeProduct[] = [
  {
    id: "mock-synthwave",
    title: "Synthwave",
    description: "Neon grid, pixel sun and high-contrast usage bars.",
    priceLabel: "Free",
    isFree: true,
    themeId: "synthwave",
    themeVersion: "1.0",
    packUrl: "mock://themes/synthwave",
    requiresFirmware: "1.0.30",
    source: "fallback",
  },
  {
    id: "mock-claude-creature",
    title: "Claude Creature",
    description: "Warm character theme with clean usage tracking.",
    priceLabel: "Free",
    isFree: true,
    themeId: "claude-creature",
    themeVersion: "1.0",
    packUrl: "mock://themes/claude-creature",
    requiresFirmware: "1.0.30",
    source: "fallback",
  },
  {
    id: "mock-clippy",
    title: "Clippy",
    description: "Classic assistant energy for your daily quota screen.",
    priceLabel: "Free",
    isFree: true,
    themeId: "clippy",
    themeVersion: "1.0",
    packUrl: "mock://themes/clippy",
    requiresFirmware: "1.0.30",
    source: "fallback",
  },
  {
    id: "mock-cozy-meadow",
    title: "Cozy Meadow",
    description: "Soft scenery with calm progress indicators.",
    priceLabel: "Free",
    isFree: true,
    themeId: "cozy-meadow",
    themeVersion: "1.0",
    packUrl: "mock://themes/cozy-meadow",
    requiresFirmware: "1.0.30",
    source: "fallback",
  },
  {
    id: "mock-mini-classic",
    title: "Mini Classic",
    description: "Sharp monochrome layout for maximum readability.",
    priceLabel: "Free",
    isFree: true,
    themeId: "mini-classic",
    themeVersion: "1.0",
    packUrl: "mock://themes/mini-classic",
    requiresFirmware: "1.0.30",
    source: "fallback",
  },
];

function HeroIcon({ children }: { children: ReactNode }) {
  return (
    <div className="grid size-16 shrink-0 place-items-center rounded-full border border-[#747A60] bg-[#EEEEEE] text-[#1B1B1B]">
      {children}
    </div>
  );
}

function ThemePreview({
  large,
  theme,
}: {
  large?: boolean;
  theme: ThemeProduct;
}) {
  const className = large
    ? "relative block aspect-square w-full overflow-hidden border border-[#747A60] bg-[#EEEEEE]"
    : "relative block size-24 overflow-hidden border border-[#747A60] bg-[#EEEEEE]";

  return (
    <span className={className}>
      {theme.imageUrl ? (
        <Image
          alt={theme.imageAlt || theme.title}
          className="object-cover"
          fill
          sizes={large ? "320px" : "(min-width: 1280px) 300px, 50vw"}
          src={theme.imageUrl}
        />
      ) : (
        <span className="grid h-full place-items-center bg-[#1B1B1B] text-center text-sm font-semibold text-[#EDEDED]">
          <Monitor size={large ? 36 : 24} aria-hidden />
        </span>
      )}
    </span>
  );
}
