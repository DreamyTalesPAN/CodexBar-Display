"use client";

import Image from "next/image";
import {
  Activity,
  AlertTriangle,
  Check,
  Download,
  Monitor,
  PlugZap,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Wifi,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ThemeCatalogResponse, ThemeProduct } from "@/lib/themes";

const COMPANION_URL = "http://127.0.0.1:47832";

type ApiError = {
  code: string;
  message: string;
  nextAction: string;
};

type CompanionStatus = "unknown" | "online" | "missing";
type DeviceState = "unknown" | "online" | "offline" | "paired";

type DeviceInfo = {
  target?: string;
  connected: boolean;
  paired?: boolean;
  board?: string;
  firmware?: string;
  capabilities?: {
    display?: {
      brightness?: {
        supported?: boolean;
        minPercent?: number;
        maxPercent?: number;
      };
    };
    theme?: {
      supportsThemeSpecV1?: boolean;
      maxThemeGifBytes?: number;
    };
    transport?: {
      active?: string;
    };
  };
};

type SettingsResponse = {
  settings?: {
    display?: {
      brightnessPercent?: number;
    };
  };
};

type InstallResponse = {
  result?: {
    themeId: string;
    packId: string;
    name: string;
    activePath: string;
    themeRev: number;
  };
};

type Props = {
  catalog: ThemeCatalogResponse;
  initialThemeId?: string;
};

export function ControlCenterApp({ catalog, initialThemeId }: Props) {
  const initialTheme = useMemo(
    () =>
      catalog.themes.find((theme) => theme.themeId === initialThemeId) ||
      catalog.themes[0],
    [catalog.themes, initialThemeId],
  );
  const [selectedThemeId, setSelectedThemeId] = useState(
    initialTheme?.themeId || "",
  );
  const [companionStatus, setCompanionStatus] =
    useState<CompanionStatus>("unknown");
  const [deviceState, setDeviceState] = useState<DeviceState>("unknown");
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [brightness, setBrightness] = useState<number | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [lastError, setLastError] = useState<ApiError | null>(null);
  const [lastInstall, setLastInstall] = useState<InstallResponse["result"]>();

  const selectedTheme = useMemo(
    () =>
      catalog.themes.find((theme) => theme.themeId === selectedThemeId) ||
      initialTheme,
    [catalog.themes, initialTheme, selectedThemeId],
  );

  const runCompanion = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      setLastError(null);
      const response = await fetch(`${COMPANION_URL}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...init?.headers,
        },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw normalizeError(payload?.error, response.status);
      }
      return payload as T;
    },
    [],
  );

  const checkCompanion = useCallback(async () => {
    setBusyAction("status");
    try {
      const payload = await runCompanion<{ device?: DeviceInfo }>("/v1/status");
      setCompanionStatus("online");
      if (payload.device?.target) {
        setDevice(payload.device);
      }
    } catch (error) {
      setCompanionStatus("missing");
      setLastError(normalizeCaughtError(error, "Companion läuft nicht."));
    } finally {
      setBusyAction(null);
    }
  }, [runCompanion]);

  const discoverDevice = useCallback(async () => {
    setBusyAction("discover");
    try {
      const payload = await runCompanion<{ device: DeviceInfo }>(
        "/v1/device/discover",
        { method: "POST", body: "{}" },
      );
      setCompanionStatus("online");
      setDeviceState(payload.device.paired ? "paired" : "online");
      setDevice(payload.device);
    } catch (error) {
      setDeviceState("offline");
      setLastError(normalizeCaughtError(error, "VibeTV wurde nicht gefunden."));
    } finally {
      setBusyAction(null);
    }
  }, [runCompanion]);

  const pairDevice = useCallback(async () => {
    setBusyAction("pair");
    try {
      const payload = await runCompanion<{ device: DeviceInfo }>(
        "/v1/device/pair",
        { method: "POST", body: "{}" },
      );
      setDeviceState("paired");
      setDevice(payload.device);
    } catch (error) {
      setLastError(normalizeCaughtError(error, "Pairing fehlgeschlagen."));
    } finally {
      setBusyAction(null);
    }
  }, [runCompanion]);

  const loadSettings = useCallback(async () => {
    setBusyAction("settings");
    try {
      const payload = await runCompanion<SettingsResponse>("/v1/settings");
      setBrightness(payload.settings?.display?.brightnessPercent ?? null);
    } catch (error) {
      setLastError(
        normalizeCaughtError(error, "Settings konnten nicht geladen werden."),
      );
    } finally {
      setBusyAction(null);
    }
  }, [runCompanion]);

  const saveBrightness = useCallback(
    async (value: number) => {
      setBrightness(value);
      setBusyAction("brightness");
      try {
        const payload = await runCompanion<SettingsResponse>("/v1/settings", {
          method: "POST",
          body: JSON.stringify({ brightnessPercent: value }),
        });
        setBrightness(payload.settings?.display?.brightnessPercent ?? value);
      } catch (error) {
        setLastError(
          normalizeCaughtError(
            error,
            "Helligkeit konnte nicht gespeichert werden.",
          ),
        );
      } finally {
        setBusyAction(null);
      }
    },
    [runCompanion],
  );

  const installTheme = useCallback(async () => {
    if (!selectedTheme) {
      return;
    }
    setBusyAction("install");
    setLastInstall(undefined);
    try {
      const payload = await runCompanion<InstallResponse>(
        "/v1/themes/install",
        {
          method: "POST",
          body: JSON.stringify({
            themeId: selectedTheme.themeId,
            packUrl: selectedTheme.packUrl,
          }),
        },
      );
      setLastInstall(payload.result);
      await loadSettings();
    } catch (error) {
      setLastError(
        normalizeCaughtError(error, "Theme konnte nicht installiert werden."),
      );
    } finally {
      setBusyAction(null);
    }
  }, [loadSettings, runCompanion, selectedTheme]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void checkCompanion();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [checkCompanion]);

  const brightnessSupported =
    device?.capabilities?.display?.brightness?.supported ?? true;
  const minBrightness =
    device?.capabilities?.display?.brightness?.minPercent ?? 10;
  const maxBrightness =
    device?.capabilities?.display?.brightness?.maxPercent ?? 100;

  return (
    <main className="min-h-screen bg-[#f5f6f3] text-[#171b1f]">
      <div className="border-b border-[#d9ddd2] bg-[#fcfdf8]">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-5 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center border border-[#262b2f] bg-[#262b2f] text-[#f6f2df]">
                <Monitor size={20} aria-hidden />
              </div>
              <div>
                <h1 className="text-2xl font-semibold">
                  VibeTV Control Center
                </h1>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <StatusPill
              icon={<PlugZap size={15} />}
              label="Companion"
              value={labelForCompanion(companionStatus)}
              tone={companionStatus === "online" ? "good" : "warn"}
            />
            <StatusPill
              icon={<Wifi size={15} />}
              label="Gerät"
              value={labelForDevice(deviceState, device)}
              tone={device?.connected ? "good" : "warn"}
            />
            <StatusPill
              icon={<ShieldCheck size={15} />}
              label="Pairing"
              value={device?.paired ? "Bereit" : "Offen"}
              tone={device?.paired ? "good" : "neutral"}
            />
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <section className="border border-[#d9ddd2] bg-white">
            <SectionHeader
              icon={<Search size={17} />}
              title="Theme Library"
              detail={`${catalog.themes.length} Themes`}
            />
            {catalog.issue ? (
              <div className="border-t border-[#eceee8] px-4 py-3 text-sm text-[#7a5a16]">
                {catalog.issue}
              </div>
            ) : null}
            <div className="divide-y divide-[#eceee8]">
              {catalog.themes.length ? (
                catalog.themes.map((theme) => (
                  <button
                    key={theme.themeId}
                    className={`grid w-full grid-cols-[76px_minmax(0,1fr)] gap-3 px-4 py-3 text-left transition ${
                      theme.themeId === selectedTheme?.themeId
                        ? "bg-[#edf6ee]"
                        : "hover:bg-[#f8f9f4]"
                    }`}
                    onClick={() => setSelectedThemeId(theme.themeId)}
                    type="button"
                  >
                    <ThemePreview theme={theme} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">
                        {theme.title}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-2 text-xs text-[#687160]">
                        <span>{theme.priceLabel}</span>
                        <span>{theme.themeId}</span>
                      </span>
                      <span className="mt-2 line-clamp-2 text-xs leading-5 text-[#5a6356]">
                        {theme.description ||
                          "Bereit für die Installation über den Companion."}
                      </span>
                    </span>
                  </button>
                ))
              ) : (
                <div className="px-4 py-8 text-sm leading-6 text-[#586252]">
                  Keine Shopify-Themes geladen. Prüfe die Storefront-API-Env
                  und die Collection `themes-2`.
                </div>
              )}
            </div>
          </section>
        </aside>

        <div className="space-y-5">
          <section className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
            <div className="border border-[#d9ddd2] bg-white">
              <SectionHeader
                icon={<Download size={17} />}
                title="Installieren"
                detail={selectedTheme?.themeId || "Kein Theme"}
              />
              <div className="grid gap-5 p-4 md:grid-cols-[180px_minmax(0,1fr)]">
                {selectedTheme ? (
                  <ThemePreview large theme={selectedTheme} />
                ) : null}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold">
                        {selectedTheme?.title || "Theme auswählen"}
                      </h2>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-[#586252]">
                        {selectedTheme?.description ||
                          "Wähle links ein Theme aus der Library aus."}
                      </p>
                    </div>
                    {selectedTheme?.isFree ? (
                      <span className="border border-[#a5d2ad] bg-[#edf8ef] px-2.5 py-1 text-xs font-semibold text-[#1d6b36]">
                        Kostenlos
                      </span>
                    ) : (
                      <span className="border border-[#e0c987] bg-[#fff8df] px-2.5 py-1 text-xs font-semibold text-[#7a5a16]">
                        Nicht im MVP
                      </span>
                    )}
                  </div>

                  <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
                    <Fact label="Theme-ID" value={selectedTheme?.themeId} />
                    <Fact
                      label="Version"
                      value={selectedTheme?.themeVersion || "MVP"}
                    />
                    <Fact
                      label="Firmware"
                      value={selectedTheme?.requiresFirmware || "aktuell"}
                    />
                  </dl>

                  <div className="mt-5 flex flex-wrap gap-3">
                    <IconButton
                      busy={busyAction === "install"}
                      disabled={!selectedTheme?.isFree || !device?.connected}
                      icon={<Download size={16} />}
                      label="Auf VibeTV installieren"
                      onClick={installTheme}
                      primary
                    />
                    <IconButton
                      busy={busyAction === "discover"}
                      icon={<RefreshCw size={16} />}
                      label="Gerät suchen"
                      onClick={discoverDevice}
                    />
                  </div>

                  {lastInstall ? (
                    <div className="mt-4 border border-[#a5d2ad] bg-[#f1faf2] p-3 text-sm text-[#245d33]">
                      <div className="flex items-center gap-2 font-semibold">
                        <Check size={16} aria-hidden />
                        Installiert: {lastInstall.name}
                      </div>
                      <div className="mt-1 font-mono text-xs">
                        {lastInstall.activePath}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="border border-[#d9ddd2] bg-white">
              <SectionHeader
                icon={<Activity size={17} />}
                title="Verbindung"
                detail={device?.target || "127.0.0.1:47832"}
              />
              <div className="space-y-4 p-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Fact label="Board" value={device?.board || "unbekannt"} />
                  <Fact
                    label="Firmware"
                    value={device?.firmware || "unbekannt"}
                  />
                  <Fact
                    label="Transport"
                    value={device?.capabilities?.transport?.active || "wifi"}
                  />
                  <Fact
                    label="ThemeSpec"
                    value={
                      device?.capabilities?.theme?.supportsThemeSpecV1
                        ? "bereit"
                        : "offen"
                    }
                  />
                </div>
                <div className="flex flex-wrap gap-3">
                  <IconButton
                    busy={busyAction === "status"}
                    icon={<PlugZap size={16} />}
                    label="Companion prüfen"
                    onClick={checkCompanion}
                  />
                  <IconButton
                    busy={busyAction === "discover"}
                    icon={<Search size={16} />}
                    label="Suchen"
                    onClick={discoverDevice}
                  />
                  <IconButton
                    busy={busyAction === "pair"}
                    disabled={!device?.connected}
                    icon={<ShieldCheck size={16} />}
                    label="Pairen"
                    onClick={pairDevice}
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-5 xl:grid-cols-[minmax(360px,0.8fr)_minmax(0,1.2fr)]">
            <div className="border border-[#d9ddd2] bg-white">
              <SectionHeader
                icon={<SlidersHorizontal size={17} />}
                title="Helligkeit"
                detail={brightness == null ? "nicht geladen" : `${brightness}%`}
              />
              <div className="space-y-4 p-4">
                <input
                  aria-label="Helligkeit"
                  className="h-2 w-full accent-[#2f7d46]"
                  disabled={!brightnessSupported || brightness == null}
                  max={maxBrightness}
                  min={minBrightness}
                  onChange={(event) =>
                    setBrightness(Number(event.target.value))
                  }
                  onMouseUp={() =>
                    brightness != null && void saveBrightness(brightness)
                  }
                  onTouchEnd={() =>
                    brightness != null && void saveBrightness(brightness)
                  }
                  type="range"
                  value={brightness ?? minBrightness}
                />
                <div className="flex flex-wrap gap-3">
                  <IconButton
                    busy={busyAction === "settings"}
                    disabled={!device?.connected}
                    icon={<Settings size={16} />}
                    label="Settings laden"
                    onClick={loadSettings}
                  />
                  <IconButton
                    busy={busyAction === "brightness"}
                    disabled={!device?.connected || brightness == null}
                    icon={<Check size={16} />}
                    label="Speichern"
                    onClick={() =>
                      brightness != null && void saveBrightness(brightness)
                    }
                  />
                </div>
              </div>
            </div>

            <div className="border border-[#d9ddd2] bg-white">
              <SectionHeader
                icon={<AlertTriangle size={17} />}
                title="Status"
                detail={lastError ? lastError.code : "bereit"}
              />
              <div className="p-4">
                {lastError ? (
                  <div className="border border-[#e3c27d] bg-[#fff8df] p-3 text-sm text-[#664b13]">
                    <div className="font-semibold">{lastError.message}</div>
                    <div className="mt-1">{lastError.nextAction}</div>
                    <div className="mt-2 font-mono text-xs">
                      {lastError.code}
                    </div>
                  </div>
                ) : (
                  <div className="border border-[#d7e6d5] bg-[#f4faf0] p-3 text-sm text-[#315d32]">
                    Companion-API bereit. Wähle ein Theme, prüfe das Gerät und
                    starte die Installation.
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function ThemePreview({
  theme,
  large,
}: {
  theme: ThemeProduct;
  large?: boolean;
}) {
  const className = large
    ? "relative aspect-square w-full overflow-hidden border border-[#d9ddd2] bg-[#eef1e8]"
    : "relative size-[76px] overflow-hidden border border-[#d9ddd2] bg-[#eef1e8]";

  return (
    <span className={className}>
      {theme.imageUrl ? (
        <Image
          alt={theme.imageAlt || theme.title}
          className="object-cover"
          fill
          sizes={large ? "180px" : "76px"}
          src={theme.imageUrl}
        />
      ) : (
        <span className="grid h-full place-items-center bg-[#26302f] text-center text-sm font-semibold text-[#f5f1df]">
          {theme.themeId.slice(0, 2).toUpperCase()}
        </span>
      )}
    </span>
  );
}

function SectionHeader({
  icon,
  title,
  detail,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[#eceee8] px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </div>
      <div className="truncate text-xs text-[#6a7365]">{detail}</div>
    </div>
  );
}

function StatusPill({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: "good" | "warn" | "neutral";
}) {
  const toneClass =
    tone === "good"
      ? "border-[#a5d2ad] bg-[#edf8ef] text-[#245d33]"
      : tone === "warn"
        ? "border-[#e3c27d] bg-[#fff8df] text-[#664b13]"
        : "border-[#d6d8d1] bg-[#f5f6f3] text-[#50584d]";

  return (
    <div className={`min-w-0 border px-3 py-2 ${toneClass}`}>
      <div className="flex items-center gap-1.5 text-xs">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 truncate font-semibold">{value}</div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value?: string }) {
  return (
    <div className="min-w-0 border border-[#eceee8] bg-[#fbfcf7] px-3 py-2">
      <div className="text-xs text-[#6a7365]">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold">
        {value || "offen"}
      </div>
    </div>
  );
}

function IconButton({
  icon,
  label,
  onClick,
  disabled,
  busy,
  primary,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      className={`inline-flex h-10 items-center gap-2 border px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${
        primary
          ? "border-[#26302f] bg-[#26302f] text-white hover:bg-[#3b4745]"
          : "border-[#cbd1c4] bg-white text-[#26302f] hover:bg-[#f4f6ef]"
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

function labelForCompanion(status: CompanionStatus): string {
  if (status === "online") {
    return "Online";
  }
  if (status === "missing") {
    return "Fehlt";
  }
  return "Prüfen";
}

function labelForDevice(state: DeviceState, device: DeviceInfo | null): string {
  if (device?.connected) {
    return state === "paired" || device.paired ? "Verbunden" : "Gefunden";
  }
  if (state === "offline") {
    return "Offline";
  }
  return "Unbekannt";
}

function normalizeError(
  raw: Partial<ApiError> | undefined,
  status: number,
): ApiError {
  return {
    code: raw?.code || `http_${status}`,
    message: raw?.message || "Request fehlgeschlagen.",
    nextAction:
      raw?.nextAction || "Prüfe Companion und VibeTV, dann erneut versuchen.",
  };
}

function normalizeCaughtError(error: unknown, fallback: string): ApiError {
  if (typeof error === "object" && error && "code" in error) {
    return error as ApiError;
  }
  if (error instanceof TypeError) {
    return {
      code: "companion_unreachable",
      message: fallback,
      nextAction:
        "Starte den Mac Companion und prüfe, dass er auf 127.0.0.1:47832 läuft.",
    };
  }
  return {
    code: "request_failed",
    message: fallback,
    nextAction: "Bitte erneut versuchen.",
  };
}
