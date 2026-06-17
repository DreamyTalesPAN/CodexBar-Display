"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ThemeCatalogResponse } from "@/lib/themes";
import { ControlCenterShell } from "./control-center-shell";
import type {
  ActiveTab,
  ApiError,
  CompanionInfo,
  CompanionStatus,
  ControlCenterEvent,
  DeviceInfo,
  DeviceState,
} from "./control-center-types";
import { LogsScreen } from "./logs-screen";
import { OverviewScreen } from "./overview-screen";
import { SettingsScreen } from "./settings-screen";
import { ThemeLibraryScreen } from "./theme-library-screen";
import { UpdatesScreen } from "./updates-screen";

const COMPANION_URL = "http://127.0.0.1:47832";
const COMPANION_ENDPOINT = "127.0.0.1:47832";

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
  const [activeTab, setActiveTab] = useState<ActiveTab>(
    initialThemeId ? "theme-library" : "overview",
  );
  const [companionStatus, setCompanionStatus] =
    useState<CompanionStatus>("unknown");
  const [companionInfo, setCompanionInfo] = useState<CompanionInfo | null>(
    null,
  );
  const [deviceState, setDeviceState] = useState<DeviceState>("unknown");
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [brightness, setBrightness] = useState<number | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [lastError, setLastError] = useState<ApiError | null>(null);
  const [lastInstall, setLastInstall] = useState<InstallResponse["result"]>();
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [themeInstallEnabled, setThemeInstallEnabled] = useState(false);
  const [events, setEvents] = useState<ControlCenterEvent[]>(() => [
    {
      id: "session-start",
      label: "Control Center geöffnet",
      detail: "Lokale Browser-Sitzung gestartet.",
      at: "Session",
      tone: "unknown",
    },
  ]);

  const selectedTheme = useMemo(
    () =>
      catalog.themes.find((theme) => theme.themeId === selectedThemeId) ||
      initialTheme,
    [catalog.themes, initialTheme, selectedThemeId],
  );

  const addEvent = useCallback(
    (event: Omit<ControlCenterEvent, "id" | "at"> & { at?: string }) => {
      setEvents((current) =>
        [
          {
            id: `${Date.now()}-${current.length}`,
            at: event.at || formatTime(),
            ...event,
          },
          ...current,
        ].slice(0, 10),
      );
    },
    [],
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

  const refreshDevice = useCallback(
    async ({ quiet = false }: { quiet?: boolean } = {}) => {
      try {
        const payload = await runCompanion<{ device: DeviceInfo }>(
          "/v1/device",
        );
        setDevice(payload.device);
        setDeviceState(payload.device.paired ? "paired" : "online");
        if (!quiet) {
          addEvent({
            label: "Device gelesen",
            detail: `${payload.device.target || "VibeTV"} ist ${
              payload.device.connected ? "verbunden" : "nicht verbunden"
            }.`,
            tone: payload.device.connected ? "ready" : "attention",
          });
        }
        return payload.device;
      } catch (error) {
        setDevice((current) =>
          current ? { ...current, connected: false } : current,
        );
        setDeviceState("offline");
        if (!quiet) {
          const normalized = normalizeCaughtError(
            error,
            "VibeTV wurde nicht gefunden.",
          );
          setLastError(normalized);
          addEvent({
            label: "Device nicht erreichbar",
            detail: normalized.nextAction,
            tone: "attention",
          });
        }
        return null;
      }
    },
    [addEvent, runCompanion],
  );

  const checkCompanion = useCallback(async () => {
    setBusyAction("status");
    try {
      const payload = await runCompanion<{
        companion?: CompanionInfo;
        device?: DeviceInfo;
      }>("/v1/status");
      const checkedAt = formatTime();
      setCompanionStatus("online");
      setCompanionInfo(payload.companion || null);
      setLastCheckedAt(checkedAt);
      setThemeInstallEnabled(
        Boolean(payload.companion?.features?.themeInstallEnabled),
      );
      if (payload.device?.target) {
        setDevice(payload.device);
        setDeviceState(
          payload.device.paired
            ? "paired"
            : payload.device.connected
              ? "online"
              : "unknown",
        );
        void refreshDevice({ quiet: true });
      } else {
        setDeviceState("unknown");
      }
      addEvent({
        label: "Bridge geprüft",
        detail: payload.device?.target
          ? `Companion online, Ziel ${payload.device.target}.`
          : "Companion online, noch kein Device-Ziel bestätigt.",
        at: checkedAt,
        tone: "ready",
      });
    } catch (error) {
      const normalized = normalizeCaughtError(error, "Companion läuft nicht.");
      setCompanionStatus("missing");
      setCompanionInfo(null);
      setThemeInstallEnabled(false);
      setLastError(normalized);
      addEvent({
        label: "Bridge nicht erreichbar",
        detail: normalized.nextAction,
        tone: "attention",
      });
    } finally {
      setBusyAction(null);
    }
  }, [addEvent, refreshDevice, runCompanion]);

  const loadSettings = useCallback(async () => {
    setBusyAction("settings");
    try {
      const payload = await runCompanion<SettingsResponse>("/v1/settings");
      const loadedBrightness =
        payload.settings?.display?.brightnessPercent ?? null;
      setBrightness(loadedBrightness);
      addEvent({
        label: "Settings geladen",
        detail:
          loadedBrightness == null
            ? "Helligkeit wurde noch nicht gemeldet."
            : `Helligkeit steht auf ${loadedBrightness}%.`,
        tone: "ready",
      });
    } catch (error) {
      const normalized = normalizeCaughtError(
        error,
        "Settings konnten nicht geladen werden.",
      );
      setLastError(normalized);
      addEvent({
        label: "Settings-Read fehlgeschlagen",
        detail: normalized.nextAction,
        tone: "attention",
      });
    } finally {
      setBusyAction(null);
    }
  }, [addEvent, runCompanion]);

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
      addEvent({
        label: "Device gefunden",
        detail: payload.device.target || "VibeTV wurde vom Companion gefunden.",
        tone: payload.device.connected ? "ready" : "unknown",
      });
      if (payload.device.connected) {
        void loadSettings();
      }
    } catch (error) {
      const normalized = normalizeCaughtError(
        error,
        "VibeTV wurde nicht gefunden.",
      );
      setDeviceState("offline");
      setLastError(normalized);
      addEvent({
        label: "Discovery fehlgeschlagen",
        detail: normalized.nextAction,
        tone: "attention",
      });
    } finally {
      setBusyAction(null);
    }
  }, [addEvent, loadSettings, runCompanion]);

  const pairDevice = useCallback(async () => {
    setBusyAction("pair");
    try {
      const payload = await runCompanion<{ device: DeviceInfo }>(
        "/v1/device/pair",
        { method: "POST", body: "{}" },
      );
      setDeviceState("paired");
      setDevice(payload.device);
      addEvent({
        label: "Device gepairt",
        detail: payload.device.target || "Pairing-Token wurde gespeichert.",
        tone: "ready",
      });
      if (payload.device.connected) {
        void loadSettings();
      }
    } catch (error) {
      const normalized = normalizeCaughtError(error, "Pairing fehlgeschlagen.");
      setLastError(normalized);
      addEvent({
        label: "Pairing fehlgeschlagen",
        detail: normalized.nextAction,
        tone: "attention",
      });
    } finally {
      setBusyAction(null);
    }
  }, [addEvent, loadSettings, runCompanion]);

  const saveBrightness = useCallback(
    async (value: number) => {
      setBrightness(value);
      setBusyAction("brightness");
      try {
        const payload = await runCompanion<SettingsResponse>("/v1/settings", {
          method: "POST",
          body: JSON.stringify({ brightnessPercent: value }),
        });
        const savedValue =
          payload.settings?.display?.brightnessPercent ?? value;
        setBrightness(savedValue);
        addEvent({
          label: "Helligkeit gespeichert",
          detail: `Display-Helligkeit steht auf ${savedValue}%.`,
          tone: "ready",
        });
      } catch (error) {
        const normalized = normalizeCaughtError(
          error,
          "Helligkeit konnte nicht gespeichert werden.",
        );
        setLastError(normalized);
        addEvent({
          label: "Helligkeit nicht gespeichert",
          detail: normalized.nextAction,
          tone: "attention",
        });
      } finally {
        setBusyAction(null);
      }
    },
    [addEvent, runCompanion],
  );

  const installTheme = useCallback(async () => {
    if (!selectedTheme) {
      return;
    }
    setBusyAction("install");
    setLastInstall(undefined);
    addEvent({
      label: "Theme-Install gestartet",
      detail: `${selectedTheme.title} wird mit Firmware-Update-Skip angefragt.`,
      tone: "unknown",
    });
    try {
      const payload = await runCompanion<InstallResponse>(
        "/v1/themes/install",
        {
          method: "POST",
          body: JSON.stringify({
            themeId: selectedTheme.themeId,
            packUrl: selectedTheme.packUrl,
            skipFirmwareUpdate: true,
          }),
        },
      );
      setLastInstall(payload.result);
      addEvent({
        label: "Theme installiert",
        detail: payload.result?.name || selectedTheme.title,
        tone: "ready",
      });
      await loadSettings();
    } catch (error) {
      const normalized = normalizeCaughtError(
        error,
        "Theme konnte nicht installiert werden.",
      );
      setLastError(normalized);
      addEvent({
        label: "Theme-Install blockiert",
        detail: normalized.nextAction,
        tone: "attention",
      });
    } finally {
      setBusyAction(null);
    }
  }, [addEvent, loadSettings, runCompanion, selectedTheme]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void checkCompanion();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [checkCompanion]);

  const activeTheme = lastInstall
    ? {
        themeId: lastInstall.themeId,
        title: lastInstall.name,
        themeVersion: String(lastInstall.themeRev),
      }
    : selectedTheme
      ? {
          themeId: selectedTheme.themeId,
          title: selectedTheme.title,
          themeVersion: selectedTheme.themeVersion,
        }
      : null;

  const logs = events.map((event) => ({
    id: event.id,
    label: event.label,
    detail: event.detail,
    timestamp: event.at,
  }));

  return (
    <ControlCenterShell
      activeTab={activeTab}
      companionEndpoint={COMPANION_ENDPOINT}
      companionStatus={companionStatus}
      device={device}
      deviceState={deviceState}
      onTabChange={setActiveTab}
    >
      {activeTab === "overview" ? (
        <OverviewScreen
          activeTheme={activeTheme}
          companionEndpoint={COMPANION_URL}
          companionStatus={companionStatus}
          device={device}
          deviceState={deviceState}
          events={events.slice(0, 4)}
          lastCheckedAt={lastCheckedAt}
          lastError={lastError}
          themeInstallEnabled={themeInstallEnabled}
        />
      ) : null}

      {activeTab === "settings" ? (
        <SettingsScreen
          brightness={brightness}
          busyAction={busyAction}
          companionStatus={companionStatus}
          companionUrl={COMPANION_ENDPOINT}
          device={device}
          deviceState={deviceState}
          lastError={lastError}
          onBrightnessChange={setBrightness}
          onCheckBridge={checkCompanion}
          onDiscoverDevice={discoverDevice}
          onLoadSettings={loadSettings}
          onPairDevice={pairDevice}
          onSaveBrightness={saveBrightness}
          themeInstallEnabled={themeInstallEnabled}
        />
      ) : null}

      {activeTab === "theme-library" ? (
        <ThemeLibraryScreen
          busyAction={busyAction}
          catalogIssue={catalog.issue}
          companionStatus={companionStatus}
          device={device}
          lastInstall={lastInstall}
          onDiscoverDevice={discoverDevice}
          onInstallTheme={installTheme}
          onSelectTheme={setSelectedThemeId}
          selectedTheme={selectedTheme}
          selectedThemeId={selectedThemeId}
          themeInstallEnabled={themeInstallEnabled}
          themes={catalog.themes}
        />
      ) : null}

      {activeTab === "updates" ? (
        <UpdatesScreen
          busyAction={busyAction}
          companionStatus={companionStatus}
          companionVersion={companionInfo?.version}
          device={device}
          onCheckBridge={checkCompanion}
        />
      ) : null}

      {activeTab === "logs" ? (
        <LogsScreen
          busyAction={busyAction}
          events={logs}
          lastError={lastError}
          onRefresh={checkCompanion}
        />
      ) : null}
    </ControlCenterShell>
  );
}

function normalizeError(error: unknown, status: number): ApiError {
  if (error && typeof error === "object") {
    const maybeError = error as Partial<ApiError>;
    return {
      code: maybeError.code || `HTTP_${status}`,
      message: maybeError.message || "Request failed.",
      nextAction: maybeError.nextAction || "Bitte erneut versuchen.",
    };
  }
  return {
    code: `HTTP_${status}`,
    message: "Request failed.",
    nextAction: "Bitte erneut versuchen.",
  };
}

function normalizeCaughtError(error: unknown, fallbackMessage: string): ApiError {
  if (error && typeof error === "object" && "code" in error) {
    return error as ApiError;
  }
  if (error instanceof Error) {
    return {
      code: "CLIENT_ERROR",
      message: fallbackMessage,
      nextAction: error.message,
    };
  }
  return {
    code: "CLIENT_ERROR",
    message: fallbackMessage,
    nextAction: "Bitte Companion und VibeTV-Verbindung prüfen.",
  };
}

function formatTime(): string {
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}
