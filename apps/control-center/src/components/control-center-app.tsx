"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { hasFirmwareUpdate, type FirmwareUpdateInfo } from "@/lib/firmware";
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
const DEVICE_TARGET_STORAGE_KEY = "vibetv.controlCenter.deviceTarget";

type SettingsResponse = {
  settings?: {
    display?: {
      brightnessPercent?: number;
    };
  };
  device?: DeviceInfo;
};

type InstallResponse = {
  result?: {
    themeId: string;
    packId: string;
    name: string;
    activePath: string;
    themeRev: number;
  };
  logs?: string[];
};

type Props = {
  catalog: ThemeCatalogResponse;
  initialThemeId?: string;
};

type ThemeInstallStatus = {
  phase: "installing" | "complete" | "error";
  themeId: string;
  title: string;
  startedAt: string;
  finishedAt?: string;
  logs: string[];
  result?: InstallResponse["result"];
  error?: string;
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
  const [deviceTarget, setDeviceTarget] = useState(readInitialDeviceTarget);
  const [brightness, setBrightness] = useState<number | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [lastError, setLastError] = useState<ApiError | null>(null);
  const [lastInstall, setLastInstall] = useState<InstallResponse["result"]>();
  const [themeInstallStatus, setThemeInstallStatus] =
    useState<ThemeInstallStatus | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [firmwareUpdate, setFirmwareUpdate] =
    useState<FirmwareUpdateInfo | null>(null);
  const [themeInstallEnabled, setThemeInstallEnabled] = useState(false);
  const [events, setEvents] = useState<ControlCenterEvent[]>(() => [
    {
      id: "session-start",
      label: "Control Center opened",
      detail: "Browser session started.",
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

  const refreshCompanionFeatures = useCallback(async () => {
    try {
      const payload = await runCompanion<{
        companion?: CompanionInfo;
      }>("/v1/status");
      setCompanionStatus("online");
      setCompanionInfo(payload.companion || null);
      setThemeInstallEnabled(
        Boolean(payload.companion?.features?.themeInstallEnabled),
      );
    } catch {
      setThemeInstallEnabled(false);
    }
  }, [runCompanion]);

  const refreshDevice = useCallback(
    async ({ quiet = false }: { quiet?: boolean } = {}) => {
      try {
        const payload = await runCompanion<{ device: DeviceInfo }>(
          "/v1/device",
        );
        setDevice(payload.device);
        if (payload.device.target) {
          setDeviceTarget(payload.device.target);
          rememberDeviceTarget(payload.device.target);
        }
        setDeviceState(payload.device.paired ? "paired" : "online");
        if (!quiet) {
          addEvent({
            label: "Device checked",
            detail: `${payload.device.target || "VibeTV"} is ${
              payload.device.connected ? "connected" : "waiting for signal"
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
            "VibeTV needs attention.",
          );
          setLastError(normalized);
          addEvent({
            label: "Device check needs attention",
            detail: normalized.nextAction,
            tone: "attention",
          });
        }
        return null;
      }
    },
    [addEvent, runCompanion],
  );

  const loadSettings = useCallback(async () => {
    setBusyAction("settings");
    try {
      const payload = await runCompanion<SettingsResponse>("/v1/settings");
      const loadedBrightness =
        payload.settings?.display?.brightnessPercent ?? null;
      setBrightness(loadedBrightness);
      if (payload.device) {
        setDevice(payload.device);
        setDeviceState(payload.device.paired ? "paired" : "online");
        if (
          payload.device.activeTheme &&
          catalog.themes.some(
            (theme) => theme.themeId === payload.device?.activeTheme,
          )
        ) {
          setSelectedThemeId(payload.device.activeTheme);
        }
        if (payload.device.target) {
          setDeviceTarget(payload.device.target);
          rememberDeviceTarget(payload.device.target);
        }
      }
      addEvent({
        label: "Settings loaded",
        detail:
          loadedBrightness == null
            ? "Brightness is ready to load."
            : `Brightness is set to ${loadedBrightness}%.`,
        tone: "ready",
      });
    } catch (error) {
      const normalized = normalizeCaughtError(
        error,
        "Settings need attention.",
      );
      setLastError(normalized);
      addEvent({
        label: "Settings check needs attention",
        detail: normalized.nextAction,
        tone: "attention",
      });
    } finally {
      setBusyAction(null);
    }
  }, [addEvent, catalog.themes, runCompanion]);

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
        setDeviceTarget(payload.device.target);
        rememberDeviceTarget(payload.device.target);
        setDeviceState(
          payload.device.paired
            ? "paired"
            : payload.device.connected
              ? "online"
              : "unknown",
        );
        const refreshed = await refreshDevice({ quiet: true });
        if (refreshed?.connected) {
          void loadSettings();
        }
      } else {
        setDeviceState("unknown");
      }
      addEvent({
        label: "Bridge checked",
        detail: payload.device?.target
          ? `Companion online, target ${payload.device.target}.`
          : "Companion online, device target pending.",
        at: checkedAt,
        tone: "ready",
      });
    } catch (error) {
      const normalized = normalizeCaughtError(error, "Companion needs attention.");
      setCompanionStatus("missing");
      setCompanionInfo(null);
      setThemeInstallEnabled(false);
      setLastError(normalized);
      addEvent({
        label: "Bridge check needs attention",
        detail: normalized.nextAction,
        tone: "attention",
      });
    } finally {
      setBusyAction(null);
    }
  }, [addEvent, loadSettings, refreshDevice, runCompanion]);

  const discoverDevice = useCallback(async (targetOverride?: string) => {
    setBusyAction("discover");
    try {
      const target = normalizeDeviceTarget(targetOverride || deviceTarget);
      const payload = await runCompanion<{ device: DeviceInfo }>(
        "/v1/device/discover",
        {
          method: "POST",
          body: target ? JSON.stringify({ target }) : "{}",
        },
      );
      setCompanionStatus("online");
      void refreshCompanionFeatures();
      setDeviceState(payload.device.paired ? "paired" : "online");
      setDevice(payload.device);
      if (payload.device.target) {
        setDeviceTarget(payload.device.target);
        rememberDeviceTarget(payload.device.target);
      }
      addEvent({
        label: "Device found",
        detail: payload.device.target || "VibeTV is available through Companion.",
        tone: payload.device.connected ? "ready" : "unknown",
      });
      if (payload.device.connected) {
        void loadSettings();
      }
    } catch (error) {
      const normalized = normalizeCaughtError(
        error,
        "VibeTV needs attention.",
      );
      setDeviceState("offline");
      setLastError(normalized);
      addEvent({
        label: "Discovery needs attention",
        detail: normalized.nextAction,
        tone: "attention",
      });
    } finally {
      setBusyAction(null);
    }
  }, [
    addEvent,
    deviceTarget,
    loadSettings,
    refreshCompanionFeatures,
    runCompanion,
  ]);

  const pairDevice = useCallback(async () => {
    setBusyAction("pair");
    try {
      const target = normalizeDeviceTarget(deviceTarget);
      const payload = await runCompanion<{ device: DeviceInfo }>(
        "/v1/device/pair",
        {
          method: "POST",
          body: target ? JSON.stringify({ target }) : "{}",
        },
      );
      setDeviceState("paired");
      void refreshCompanionFeatures();
      setDevice(payload.device);
      if (payload.device.target) {
        setDeviceTarget(payload.device.target);
        rememberDeviceTarget(payload.device.target);
      }
      addEvent({
        label: "Device paired",
        detail: payload.device.target || "Pairing is ready.",
        tone: "ready",
      });
      if (payload.device.connected) {
        void loadSettings();
      }
    } catch (error) {
      const normalized = normalizeCaughtError(error, "Pairing needs attention.");
      setLastError(normalized);
      addEvent({
        label: "Pairing needs attention",
        detail: normalized.nextAction,
        tone: "attention",
      });
    } finally {
      setBusyAction(null);
    }
  }, [
    addEvent,
    deviceTarget,
    loadSettings,
    refreshCompanionFeatures,
    runCompanion,
  ]);

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
        if (payload.device) {
          setDevice(payload.device);
          setDeviceState(payload.device.paired ? "paired" : "online");
          if (payload.device.target) {
            setDeviceTarget(payload.device.target);
            rememberDeviceTarget(payload.device.target);
          }
        }
        addEvent({
          label: "Brightness saved",
          detail: `Display brightness is set to ${savedValue}%.`,
          tone: "ready",
        });
      } catch (error) {
        const normalized = normalizeCaughtError(
          error,
          "Brightness needs attention.",
        );
        setLastError(normalized);
        addEvent({
          label: "Brightness save needs attention",
          detail: normalized.nextAction,
          tone: "attention",
        });
      } finally {
        setBusyAction(null);
      }
    },
    [addEvent, runCompanion],
  );

  const installTheme = useCallback(async (theme = selectedTheme) => {
    if (!theme) {
      return;
    }
    setBusyAction("install");
    setLastInstall(undefined);
    setSelectedThemeId(theme.themeId);
    const startedAt = formatTime();
    const initialLogs = [
      "Install request sent to Companion.",
      `Theme: ${theme.title}`,
      theme.packUrl ? `Pack URL: ${theme.packUrl}` : "Pack URL missing.",
    ];
    setThemeInstallStatus({
      phase: "installing",
      themeId: theme.themeId,
      title: theme.title,
      startedAt,
      logs: initialLogs,
    });
    addEvent({
      label: "Theme install started",
      detail: `${theme.title} is ready for device install.`,
      at: startedAt,
      tone: "unknown",
    });
    try {
      const payload = await runCompanion<InstallResponse>(
        "/v1/themes/install",
        {
          method: "POST",
          body: JSON.stringify({
            themeId: theme.themeId,
            packUrl: theme.packUrl,
            skipFirmwareUpdate: true,
          }),
        },
      );
      setLastInstall(payload.result);
      const finishedAt = formatTime();
      setThemeInstallStatus({
        phase: "complete",
        themeId: theme.themeId,
        title: theme.title,
        startedAt,
        finishedAt,
        logs: [...initialLogs, ...(payload.logs || [])],
        result: payload.result,
      });
      if (payload.result?.themeId) {
        setDevice((current) =>
          current
            ? { ...current, activeTheme: payload.result?.themeId }
            : current,
        );
      }
      addEvent({
        label: "Theme installed",
        detail: payload.result?.name || theme.title,
        at: finishedAt,
        tone: "ready",
      });
      await loadSettings();
    } catch (error) {
      const normalized = normalizeCaughtError(
        error,
        "Theme install needs attention.",
      );
      setLastError(normalized);
      setThemeInstallStatus({
        phase: "error",
        themeId: theme.themeId,
        title: theme.title,
        startedAt,
        finishedAt: formatTime(),
        logs: [...initialLogs, normalized.message, normalized.nextAction],
        error: normalized.nextAction,
      });
      addEvent({
        label: "Theme install protected",
        detail: normalized.nextAction,
        tone: "attention",
      });
    } finally {
      setBusyAction(null);
    }
  }, [addEvent, loadSettings, runCompanion, selectedTheme]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (deviceTarget) {
        void discoverDevice(deviceTarget);
        return;
      }
      void checkCompanion();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [checkCompanion, deviceTarget, discoverDevice]);

  const deviceBoard = device?.board;
  const deviceFirmware = device?.firmware;

  const refreshFirmwareUpdate = useCallback(
    async (signal?: AbortSignal) => {
      if (!deviceBoard || !deviceFirmware) {
        setFirmwareUpdate(null);
        return;
      }

      const params = new URLSearchParams({
        board: deviceBoard,
        firmware: deviceFirmware,
      });

      try {
        const response = await fetch(`/api/firmware/latest?${params.toString()}`, {
          signal,
        });
        if (!response.ok) {
          throw new Error(`firmware check failed: ${response.status}`);
        }
        setFirmwareUpdate((await response.json()) as FirmwareUpdateInfo);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setFirmwareUpdate({
          checkedAt: new Date().toISOString(),
          installedFirmware: deviceFirmware,
          updateAvailable: false,
          status: "check_failed",
          message: "Firmware release check failed.",
        });
      }
    },
    [deviceBoard, deviceFirmware],
  );

  const checkFirmwareUpdates = useCallback(async () => {
    setBusyAction("firmware-check");
    try {
      await refreshFirmwareUpdate();
    } finally {
      setBusyAction(null);
    }
  }, [refreshFirmwareUpdate]);

  useEffect(() => {
    if (!deviceBoard || !deviceFirmware) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void refreshFirmwareUpdate(controller.signal);
    }, 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [deviceBoard, deviceFirmware, refreshFirmwareUpdate]);

  const logs = events.map((event) => ({
    id: event.id,
    label: event.label,
    detail: event.detail,
    timestamp: event.at,
  }));
  const effectiveFirmwareUpdate =
    firmwareUpdate?.installedFirmware === device?.firmware
      ? firmwareUpdate
      : null;
  const firmwareUpdateAvailable = hasFirmwareUpdate(effectiveFirmwareUpdate);

  return (
    <ControlCenterShell
      activeTab={activeTab}
      companionEndpoint={COMPANION_ENDPOINT}
      companionStatus={companionStatus}
      device={device}
      deviceState={deviceState}
      firmwareUpdateAvailable={firmwareUpdateAvailable}
      onTabChange={setActiveTab}
    >
      {activeTab === "overview" ? (
        <OverviewScreen
          companionEndpoint={COMPANION_URL}
          companionStatus={companionStatus}
          device={device}
          deviceState={deviceState}
          events={events.slice(0, 4)}
          lastCheckedAt={lastCheckedAt}
          lastError={lastError}
          firmwareUpdate={effectiveFirmwareUpdate}
          busyAction={busyAction}
          onCheckBridge={checkCompanion}
          onDiscoverDevice={discoverDevice}
          themeInstallEnabled={themeInstallEnabled}
        />
      ) : null}

      {activeTab === "settings" ? (
        <SettingsScreen
          brightness={brightness}
          busyAction={busyAction}
          companionUrl={COMPANION_ENDPOINT}
          device={device}
          deviceTarget={deviceTarget}
          lastError={lastError}
          onBrightnessChange={setBrightness}
          onCheckBridge={checkCompanion}
          onDeviceTargetChange={setDeviceTarget}
          onDiscoverDevice={discoverDevice}
          onPairDevice={pairDevice}
          onSaveBrightness={saveBrightness}
        />
      ) : null}

      {activeTab === "theme-library" ? (
        <ThemeLibraryScreen
          busyAction={busyAction}
          companionStatus={companionStatus}
          device={device}
          installStatus={themeInstallStatus}
          lastInstall={lastInstall}
          onDiscoverDevice={discoverDevice}
          onCheckBridge={checkCompanion}
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
          firmwareUpdate={effectiveFirmwareUpdate}
          onCheckUpdates={checkFirmwareUpdates}
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
      nextAction: maybeError.nextAction || "Try again.",
    };
  }
  return {
    code: `HTTP_${status}`,
    message: "Request failed.",
    nextAction: "Try again.",
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
    nextAction: "Check Companion and VibeTV connection.",
  };
}

function readInitialDeviceTarget(): string {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    const params = new URLSearchParams(window.location.search);
    return normalizeDeviceTarget(
      params.get("target") ||
        window.localStorage.getItem(DEVICE_TARGET_STORAGE_KEY) ||
        "",
    );
  } catch {
    return "";
  }
}

function rememberDeviceTarget(target: string) {
  if (typeof window === "undefined") {
    return;
  }
  const normalized = normalizeDeviceTarget(target);
  if (!normalized) {
    return;
  }
  try {
    window.localStorage.setItem(DEVICE_TARGET_STORAGE_KEY, normalized);
  } catch {
    // localStorage may be unavailable in private or restricted browser contexts.
  }
}

function normalizeDeviceTarget(target: string): string {
  const trimmed = target.trim();
  if (!trimmed) {
    return "";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `http://${trimmed}`;
}

function formatTime(): string {
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}
