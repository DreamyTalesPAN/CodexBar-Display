"use client";

import Image from "next/image";
import {
  Check,
  Download,
  Lock,
  Monitor,
  RefreshCw,
  Search,
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
  catalogIssue?: string;
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
  catalogIssue,
  onSelectTheme,
  onInstallTheme,
  onDiscoverDevice,
}: ThemeLibraryScreenProps) {
  const readinessReason = installReadinessReason({
    companionStatus,
    device,
    selectedTheme,
    themeInstallEnabled,
  });
  const installDisabled = Boolean(readinessReason);

  return (
    <section className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
      <section className="border border-[#747A60] bg-[#F9F9F9]">
        <SectionHeader
          detail={`${themes.length} Themes`}
          icon={<Search size={17} aria-hidden />}
          title="Theme Library"
        />
        {catalogIssue ? (
          <div className="border-b border-[#747A60] bg-[#EEEEEE] p-3 text-sm leading-6 text-[#444933]">
            {catalogIssue}
          </div>
        ) : null}
        <div className="min-h-[420px] divide-y divide-[#747A60]">
          {themes.length ? (
            themes.map((theme) => (
              <button
                key={theme.themeId}
                className={`grid w-full grid-cols-[76px_minmax(0,1fr)] gap-3 px-4 py-3 text-left transition ${
                  theme.themeId === selectedThemeId
                    ? "bg-[#EEEEEE]"
                    : "bg-[#F9F9F9] hover:bg-[#EEEEEE]"
                }`}
                onClick={() => onSelectTheme(theme.themeId)}
                type="button"
              >
                <ThemePreview theme={theme} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-[#1B1B1B]">
                    {theme.title}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-2 text-xs text-[#747A60]">
                    <span>{theme.priceLabel}</span>
                    <span>{theme.themeId}</span>
                  </span>
                  <span className="mt-2 line-clamp-2 text-xs leading-5 text-[#444933]">
                    {theme.description || "Theme aus dem Katalog."}
                  </span>
                </span>
              </button>
            ))
          ) : (
            <div className="p-4 text-sm leading-6 text-[#444933]">
              Keine Themes geladen. Die Library bleibt leer, bis Shopify oder
              der lokale Katalog Daten liefert.
            </div>
          )}
        </div>
      </section>

      <section className="border border-[#747A60] bg-[#F9F9F9]">
        <SectionHeader
          detail={selectedTheme?.themeId || "kein Theme"}
          icon={<Download size={17} aria-hidden />}
          title="Selected Theme"
        />
        <div className="grid gap-5 p-4 md:grid-cols-[220px_minmax(0,1fr)]">
          {selectedTheme ? (
            <ThemePreview large theme={selectedTheme} />
          ) : (
            <div className="grid aspect-square w-full place-items-center border border-[#747A60] bg-[#EEEEEE] text-sm text-[#444933]">
              Kein Theme ausgewählt
            </div>
          )}

          <div className="min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-[#1B1B1B]">
                  {selectedTheme?.title || "Theme auswählen"}
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#444933]">
                  {selectedTheme?.description ||
                    "Wähle links ein Theme, um Details und Install-Status zu sehen."}
                </p>
              </div>
              {selectedTheme ? (
                <span className="border border-[#747A60] bg-[#EEEEEE] px-2.5 py-1 text-xs font-semibold text-[#506600]">
                  {selectedTheme.isFree ? "Kostenlos" : "Nicht im MVP"}
                </span>
              ) : null}
            </div>

            {selectedTheme ? (
              <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
                <Fact label="Theme-ID" value={selectedTheme.themeId} />
                <Fact
                  label="Version"
                  value={selectedTheme.themeVersion || "MVP"}
                />
                <Fact
                  label="Firmware"
                  value={selectedTheme.requiresFirmware || "nicht angegeben"}
                />
                <Fact
                  label="Board"
                  value={selectedTheme.compatibleBoards?.join(", ") || "offen"}
                />
                <Fact
                  label="Quelle"
                  value={sourceLabel(selectedTheme.source)}
                />
                <Fact
                  label="Pack"
                  value={selectedTheme.packUrl ? "vorhanden" : "fehlt"}
                />
              </dl>
            ) : null}

            <div className="mt-5 border border-[#747A60] bg-[#EEEEEE] p-3 text-sm leading-6 text-[#444933]">
              <div className="flex items-center gap-2 font-semibold text-[#1B1B1B]">
                <Lock size={16} aria-hidden />
                Install Readiness
              </div>
              <div className="mt-1">
                {readinessReason ||
                  "Bereit: kostenloses Theme, Companion online, VibeTV verbunden und lokaler Install-Flag aktiv."}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <ActionButton
                busy={busyAction === "install"}
                disabled={installDisabled}
                icon={<Download size={16} aria-hidden />}
                label="Auf VibeTV installieren"
                onClick={onInstallTheme}
                primary
              />
              {onDiscoverDevice ? (
                <ActionButton
                  busy={busyAction === "discover"}
                  icon={<RefreshCw size={16} aria-hidden />}
                  label="Gerät suchen"
                  onClick={onDiscoverDevice}
                />
              ) : null}
            </div>

            {lastInstall ? (
              <div className="mt-5 border border-[#747A60] bg-[#CCFF00] p-3 text-sm text-[#1B1B1B]">
                <div className="flex items-center gap-2 font-semibold">
                  <Check size={16} aria-hidden />
                  Zuletzt installiert: {lastInstall.name}
                </div>
                <div className="mt-1 font-mono text-xs">
                  {lastInstall.activePath}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </section>
  );
}

function SectionHeader({
  detail,
  icon,
  title,
}: {
  detail: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-[#747A60] px-4 py-3">
      <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[#1B1B1B]">
        {icon}
        <span className="truncate">{title}</span>
      </div>
      <div className="truncate text-xs text-[#747A60]">{detail}</div>
    </header>
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
    : "relative size-[76px] overflow-hidden border border-[#747A60] bg-[#EEEEEE]";

  return (
    <span className={className}>
      {theme.imageUrl ? (
        <Image
          alt={theme.imageAlt || theme.title}
          className="object-cover"
          fill
          sizes={large ? "220px" : "76px"}
          src={theme.imageUrl}
        />
      ) : (
        <span className="grid h-full place-items-center bg-[#1B1B1B] text-center text-sm font-semibold text-[#EDEDED]">
          <Monitor size={large ? 32 : 20} aria-hidden />
        </span>
      )}
    </span>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border border-[#747A60] bg-[#EEEEEE] px-3 py-2">
      <dt className="text-xs text-[#747A60]">{label}</dt>
      <dd className="mt-1 truncate text-sm font-semibold text-[#1B1B1B]">
        {value}
      </dd>
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
      className={`inline-flex h-10 items-center gap-2 border px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
        primary
          ? "border-[#CCFF00] bg-[#CCFF00] text-[#1B1B1B] hover:bg-[#ABD600]"
          : "border-[#747A60] bg-[#F9F9F9] text-[#1B1B1B] hover:bg-[#EEEEEE]"
      }`}
      disabled={disabled || busy}
      onClick={onClick}
      type="button"
    >
      {busy ? <RefreshCw className="animate-spin" size={16} /> : icon}
      <span>{busy ? "Läuft..." : label}</span>
    </button>
  );
}

function installReadinessReason({
  companionStatus,
  device,
  selectedTheme,
  themeInstallEnabled,
}: {
  companionStatus: ThemeLibraryCompanionStatus;
  device: ThemeLibraryDeviceInfo | null;
  selectedTheme?: ThemeProduct;
  themeInstallEnabled: boolean;
}) {
  if (!selectedTheme) {
    return "Wähle zuerst ein Theme aus.";
  }
  if (!selectedTheme.isFree) {
    return "Bezahlte Themes sind im MVP noch nicht installierbar.";
  }
  if (!selectedTheme.packUrl) {
    return "Dieses Theme hat noch keine Pack-URL im Katalog.";
  }
  if (companionStatus !== "online") {
    return "Der lokale Companion ist nicht online.";
  }
  if (!device?.connected) {
    return "VibeTV ist noch nicht verbunden.";
  }
  if (!themeInstallEnabled) {
    return "Install bleibt gesperrt, bis VIBETV_ENABLE_WIFI_THEME_INSTALL gesetzt ist.";
  }
  return "";
}

function sourceLabel(source: ThemeProduct["source"]) {
  if (source === "shopify") {
    return "Shopify";
  }
  if (source === "github-catalog") {
    return "GitHub Katalog";
  }
  return "Fallback";
}
