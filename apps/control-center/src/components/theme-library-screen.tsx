"use client";

import Image from "next/image";
import {
  Check,
  Download,
  Library,
  Lock,
  Monitor,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import type { ThemeProduct } from "@/lib/themes";

export type ThemeLibraryCompanionStatus = "unknown" | "online" | "missing";

export type ThemeLibraryDeviceInfo = {
  connected: boolean;
  paired?: boolean;
  board?: string;
  firmware?: string;
};

export type ThemeInstallResult = {
  themeId: string;
  packId: string;
  name: string;
  activePath: string;
  themeRev: number;
};

export type ThemeLibraryScreenProps = {
  themes: ThemeProduct[];
  selectedTheme?: ThemeProduct;
  selectedThemeId: string;
  companionStatus: ThemeLibraryCompanionStatus;
  device: ThemeLibraryDeviceInfo | null;
  themeInstallEnabled: boolean;
  busyAction: string | null;
  lastInstall?: ThemeInstallResult;
  onSelectTheme: (themeId: string) => void;
  onInstallTheme: () => void;
  onDiscoverDevice?: () => void;
};

export function ThemeLibraryScreen({
  themes,
  selectedTheme,
  selectedThemeId,
  companionStatus,
  device,
  themeInstallEnabled,
  busyAction,
  lastInstall,
  onSelectTheme,
  onInstallTheme,
  onDiscoverDevice,
}: ThemeLibraryScreenProps) {
  const visibleThemes = themes.length ? themes : MOCK_THEMES;
  const displayTheme =
    selectedTheme ||
    visibleThemes.find((theme) => theme.themeId === selectedThemeId) ||
    visibleThemes[0];

  return (
    <div className="mx-auto max-w-[1180px]">
      <section className="grid min-h-[330px] items-center gap-10 border-b border-[#747A60] py-10 lg:grid-cols-[minmax(0,520px)_minmax(360px,1fr)]">
        <div className="min-w-0">
          <div className="flex items-start gap-5">
            <HeroIcon>
              <Library size={36} aria-hidden />
            </HeroIcon>
            <div className="min-w-0">
              <h2 className="max-w-[520px] text-[clamp(2.7rem,4.8vw,4.5rem)] font-black leading-[1.05] tracking-normal text-[#1B1B1B]">
                Choose a theme
              </h2>
              <p className="mt-5 text-xl leading-8 text-[#444933]">
                Browse the catalog, preview the selected pack and keep install
                writes guarded.
              </p>
            </div>
          </div>
        </div>

        <div className="border-y border-[#747A60] py-4">
          <dl className="grid gap-0">
            <StatusRow
              icon={<Library size={18} aria-hidden />}
              label="Catalog"
              value={`${visibleThemes.length} themes`}
            />
            <StatusRow
              icon={<Search size={18} aria-hidden />}
              label="Source"
              value="VibeTV catalog"
            />
            <StatusRow
              icon={<ShieldCheck size={18} aria-hidden />}
              label="Install"
              value="Protected"
              detail="Hardware writes stay guarded"
            />
          </dl>
        </div>
      </section>

      <section className="border-b border-[#747A60] py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <h3 className="text-base font-bold text-[#1B1B1B]">Theme Library</h3>
          <div className="flex flex-wrap gap-2">
            <FilterPill active>Free</FilterPill>
            <FilterPill>Compatible</FilterPill>
            <FilterPill>Installed</FilterPill>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {visibleThemes.map((theme) => (
            <button
              className={`grid grid-cols-[96px_minmax(0,1fr)] gap-4 border p-4 text-left transition ${
                theme.themeId === displayTheme?.themeId
                  ? "border-[#1B1B1B] bg-[#EEEEEE]"
                  : "border-[#747A60] bg-[#F9F9F9] hover:bg-[#EEEEEE]"
              }`}
              key={theme.themeId}
              onClick={() => onSelectTheme(theme.themeId)}
              type="button"
            >
              <ThemePreview theme={theme} />
              <span className="min-w-0">
                <span className="flex items-start justify-between gap-3">
                  <span className="truncate text-lg font-bold text-[#1B1B1B]">
                    {theme.title}
                  </span>
                  <span className="shrink-0 bg-[#CCFF00] px-2 py-0.5 text-xs font-semibold text-[#1B1B1B]">
                    {theme.isFree ? "Free" : "Locked"}
                  </span>
                </span>
                <span className="mt-2 line-clamp-2 text-sm leading-6 text-[#444933]">
                  {theme.description || "Theme from the VibeTV catalog."}
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-8 py-8 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div>
          {displayTheme ? (
            <ThemePreview large theme={displayTheme} />
          ) : (
            <div className="grid aspect-square place-items-center border border-[#747A60] bg-[#EEEEEE] text-[#444933]">
              No theme selected
            </div>
          )}
        </div>

        <div className="min-w-0">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-3xl font-black leading-tight text-[#1B1B1B]">
                {displayTheme?.title || "Select a theme"}
              </h3>
              <p className="mt-3 max-w-2xl text-base leading-7 text-[#444933]">
                {displayTheme?.description ||
                  "Pick a catalog item to inspect compatibility and install readiness."}
              </p>
            </div>
            {lastInstall ? (
              <div className="bg-[#CCFF00] px-3 py-2 text-sm font-semibold text-[#1B1B1B]">
                Installed: {lastInstall.name}
              </div>
            ) : null}
          </div>

          <dl className="mb-6 grid gap-4 md:grid-cols-3">
            <CheckRow
              label="Companion"
              value={companionStatus === "online" ? "Online" : "Ready"}
            />
            <CheckRow
              label="Device"
              value={device?.connected ? "Connected" : "Ready"}
            />
            <CheckRow
              label="Install"
              value={themeInstallEnabled ? "Enabled" : "Protected"}
            />
          </dl>

          <div className="mb-6 border border-[#747A60] p-4 text-sm leading-6 text-[#444933]">
            <div className="mb-1 flex items-center gap-2 font-bold text-[#1B1B1B]">
              <Lock size={16} aria-hidden />
              Install readiness
            </div>
            Theme preview is ready. Device installs stay protected until they
            are unlocked from Settings.
          </div>

          <div className="flex flex-wrap gap-3">
            <ActionButton
              busy={busyAction === "install"}
              disabled={!themeInstallEnabled}
              icon={<Download size={18} aria-hidden />}
              label="Install on VibeTV"
              onClick={onInstallTheme}
              primary
            />
            {onDiscoverDevice ? (
              <ActionButton
                busy={busyAction === "discover"}
                icon={<RefreshCw size={18} aria-hidden />}
                label="Find device"
                onClick={onDiscoverDevice}
              />
            ) : null}
          </div>

          {displayTheme ? (
            <dl className="mt-8 grid gap-4 md:grid-cols-3">
              <Fact label="Theme ID" value={displayTheme.themeId} />
              <Fact label="Version" value={displayTheme.themeVersion || "MVP"} />
              <Fact
                label="Firmware"
                value={displayTheme.requiresFirmware || "Not specified"}
              />
            </dl>
          ) : null}
        </div>
      </section>
    </div>
  );
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
    requiresFirmware: "1.0.34",
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
    requiresFirmware: "1.0.34",
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
    requiresFirmware: "1.0.34",
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
    requiresFirmware: "1.0.34",
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
    requiresFirmware: "1.0.34",
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

function StatusRow({
  detail,
  icon,
  label,
  value,
}: {
  detail?: string;
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="grid min-h-[54px] grid-cols-[28px_1fr_150px] items-start gap-3 border-b border-[#747A60] py-3 last:border-b-0">
      <div className="pt-0.5 text-[#506600]">{icon}</div>
      <dt className="font-medium text-[#1B1B1B]">{label}</dt>
      <dd className="min-w-0 text-[#1B1B1B]">
        <span>{value}</span>
        {detail ? <div className="mt-1 text-sm text-[#444933]">{detail}</div> : null}
      </dd>
    </div>
  );
}

function FilterPill({
  active,
  children,
}: {
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      className={`h-9 border px-3 text-sm font-semibold ${
        active
          ? "border-[#CCFF00] bg-[#CCFF00] text-[#1B1B1B]"
          : "border-[#747A60] bg-[#F9F9F9] text-[#1B1B1B]"
      }`}
      type="button"
    >
      {children}
    </button>
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
    ? "relative aspect-square w-full overflow-hidden border border-[#747A60] bg-[#EEEEEE]"
    : "relative size-24 overflow-hidden border border-[#747A60] bg-[#EEEEEE]";

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

function CheckRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 border-r border-[#747A60] pr-4 last:border-r-0">
      <Check size={22} className="text-[#506600]" aria-hidden />
      <div>
        <dt className="font-bold text-[#1B1B1B]">{label}</dt>
        <dd className="mt-1 text-sm text-[#444933]">{value}</dd>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-r border-[#747A60] pr-4 last:border-r-0">
      <dt className="text-sm font-bold text-[#1B1B1B]">{label}</dt>
      <dd className="mt-1 truncate text-sm text-[#444933]">{value}</dd>
    </div>
  );
}

function ActionButton({
  busy,
  disabled,
  icon,
  label,
  onClick,
  primary,
}: {
  busy?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      className={`inline-flex h-12 items-center justify-center gap-2 border px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
        primary
          ? "border-[#CCFF00] bg-[#CCFF00] text-[#1B1B1B] hover:bg-[#ABD600]"
          : "border-[#747A60] bg-[#F9F9F9] text-[#1B1B1B] hover:bg-[#EEEEEE]"
      }`}
      disabled={disabled || busy}
      onClick={onClick}
      type="button"
    >
      {busy ? <RefreshCw className="animate-spin" size={18} /> : icon}
      <span>{busy ? "Working..." : label}</span>
    </button>
  );
}
