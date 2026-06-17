"use client";

import Image from "next/image";
import { Library, Monitor, X } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
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
  onSelectTheme,
}: ThemeLibraryScreenProps) {
  const visibleThemes = themes.length ? themes : MOCK_THEMES;
  const [previewTheme, setPreviewTheme] = useState<ThemeProduct | null>(null);
  const displayTheme =
    selectedTheme ||
    visibleThemes.find((theme) => theme.themeId === selectedThemeId) ||
    visibleThemes[0];

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
              <p className="mt-5 text-xl leading-8 text-[#444933]">
                Browse the catalog, preview each pack and install only when
                device access is ready.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-[#747A60] py-8">
        <div className="mb-6">
          <h3 className="text-base font-bold text-[#1B1B1B]">Theme Library</h3>
        </div>

        <ul className="divide-y divide-[#747A60] border-y border-[#747A60]">
          {visibleThemes.map((theme) => (
            <li
              className={`grid grid-cols-[96px_minmax(0,1fr)_auto] items-center gap-5 py-4 transition ${
                theme.themeId === displayTheme?.themeId ? "bg-[#EEEEEE]" : ""
              }`}
              key={theme.themeId}
            >
              <button
                aria-label={`Preview ${theme.title}`}
                className="text-left"
                onClick={() => setPreviewTheme(theme)}
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
                className="mr-3 h-10 border border-[#747A60] bg-[#F9F9F9] px-4 text-sm font-semibold text-[#1B1B1B] transition hover:bg-[#CCFF00]"
                onClick={() => onSelectTheme(theme.themeId)}
                type="button"
              >
                Install
              </button>
            </li>
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
