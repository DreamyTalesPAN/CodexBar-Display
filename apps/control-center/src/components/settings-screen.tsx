"use client";

import {
  Check,
  Lock,
  PlugZap,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Wifi,
} from "lucide-react";
import type { ReactNode } from "react";

export type SettingsCompanionStatus = "unknown" | "online" | "missing";
export type SettingsDeviceState =
  | "unknown"
  | "online"
  | "offline"
  | "paired";

export type SettingsApiError = {
  code: string;
  message: string;
  nextAction: string;
};

export type SettingsDeviceInfo = {
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

export type SettingsScreenProps = {
  companionStatus: SettingsCompanionStatus;
  deviceState: SettingsDeviceState;
  device: SettingsDeviceInfo | null;
  brightness: number | null;
  themeInstallEnabled: boolean;
  busyAction: string | null;
  lastError?: SettingsApiError | null;
  companionUrl?: string;
  onCheckBridge: () => void;
  onDiscoverDevice: () => void;
  onPairDevice: () => void;
  onLoadSettings: () => void;
  onBrightnessChange: (value: number) => void;
  onSaveBrightness: (value: number) => void;
};

export function SettingsScreen({
  companionStatus,
  deviceState,
  device,
  brightness,
  themeInstallEnabled,
  busyAction,
  lastError,
  companionUrl = "127.0.0.1:47832",
  onCheckBridge,
  onDiscoverDevice,
  onPairDevice,
  onLoadSettings,
  onBrightnessChange,
  onSaveBrightness,
}: SettingsScreenProps) {
  const brightnessSupport =
    device?.capabilities?.display?.brightness?.supported ?? true;
  const minBrightness =
    device?.capabilities?.display?.brightness?.minPercent ?? 10;
  const maxBrightness =
    device?.capabilities?.display?.brightness?.maxPercent ?? 100;
  const currentBrightness = brightness ?? minBrightness;
  const themeSpecReady = Boolean(
    device?.capabilities?.theme?.supportsThemeSpecV1,
  );
  const installSafetyReason = themeInstallEnabled
    ? "Lokale Theme-Installationen sind für dieses Testfenster freigeschaltet."
    : "Theme-Installationen sind gesperrt, solange VIBETV_ENABLE_WIFI_THEME_INSTALL nicht gesetzt ist.";

  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="grid gap-4">
        <section className="border border-[#747A60] bg-[#F9F9F9]">
          <SectionHeader
            detail={companionUrl}
            icon={<PlugZap size={17} aria-hidden />}
            title="Connection Controls"
          />
          <div className="grid gap-3 p-4 sm:grid-cols-4">
            <StatusTile
              icon={<PlugZap size={16} aria-hidden />}
              label="Bridge"
              value={labelForCompanion(companionStatus)}
            />
            <StatusTile
              icon={<Wifi size={16} aria-hidden />}
              label="Gerät"
              value={labelForDevice(deviceState, device)}
            />
            <StatusTile
              icon={<ShieldCheck size={16} aria-hidden />}
              label="Pairing"
              value={device?.paired ? "Gepaart" : "Offen"}
            />
            <StatusTile
              icon={<Lock size={16} aria-hidden />}
              label="Install"
              value={themeInstallEnabled ? "Aktiv" : "Gesperrt"}
            />
          </div>
          <div className="flex flex-wrap gap-2 border-t border-[#747A60] px-4 py-3">
            <ActionButton
              busy={busyAction === "status"}
              icon={<PlugZap size={16} aria-hidden />}
              label="Bridge prüfen"
              onClick={onCheckBridge}
            />
            <ActionButton
              busy={busyAction === "discover"}
              icon={<Search size={16} aria-hidden />}
              label="Gerät suchen"
              onClick={onDiscoverDevice}
            />
            <ActionButton
              busy={busyAction === "pair"}
              disabled={!device?.connected}
              icon={<ShieldCheck size={16} aria-hidden />}
              label="Pairen"
              onClick={onPairDevice}
            />
          </div>
        </section>

        <section className="border border-[#747A60] bg-[#F9F9F9]">
          <SectionHeader
            detail={device?.target || "nicht verbunden"}
            icon={<Wifi size={17} aria-hidden />}
            title="Device Facts"
          />
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
            <Fact label="Target URL" value={device?.target || "unbekannt"} />
            <Fact label="Board" value={device?.board || "unbekannt"} />
            <Fact label="Firmware" value={device?.firmware || "unbekannt"} />
            <Fact
              label="Transport"
              value={device?.capabilities?.transport?.active || "unbekannt"}
            />
            <Fact
              label="ThemeSpec"
              value={themeSpecReady ? "bereit" : "nicht bestätigt"}
            />
          </div>
        </section>

        <section className="border border-[#747A60] bg-[#F9F9F9]">
          <SectionHeader
            detail={brightness == null ? "nicht geladen" : `${brightness}%`}
            icon={<SlidersHorizontal size={17} aria-hidden />}
            title="Display Controls"
          />
          <div className="space-y-4 p-4">
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3 text-sm text-[#444933]">
                <span>Helligkeit</span>
                <span className="font-semibold text-[#1B1B1B]">
                  {brightness == null ? "offen" : `${brightness}%`}
                </span>
              </div>
              <input
                aria-label="Helligkeit"
                className="h-2 w-full accent-[#CCFF00] disabled:opacity-50"
                disabled={!brightnessSupport || brightness == null}
                max={maxBrightness}
                min={minBrightness}
                onChange={(event) =>
                  onBrightnessChange(Number(event.target.value))
                }
                type="range"
                value={currentBrightness}
              />
              <div className="flex justify-between text-xs text-[#747A60]">
                <span>{minBrightness}%</span>
                <span>{maxBrightness}%</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <ActionButton
                busy={busyAction === "settings"}
                disabled={!device?.connected}
                icon={<RefreshCw size={16} aria-hidden />}
                label="Settings laden"
                onClick={onLoadSettings}
              />
              <ActionButton
                busy={busyAction === "brightness"}
                disabled={!device?.connected || brightness == null}
                icon={<Check size={16} aria-hidden />}
                label="Helligkeit speichern"
                onClick={() => onSaveBrightness(currentBrightness)}
                primary
              />
            </div>
          </div>
        </section>
      </div>

      <aside className="grid content-start gap-4">
        <section className="border border-[#747A60] bg-[#F9F9F9]">
          <SectionHeader
            detail={themeInstallEnabled ? "freigegeben" : "gesperrt"}
            icon={<Lock size={17} aria-hidden />}
            title="Install Safety"
          />
          <div className="space-y-3 p-4 text-sm leading-6 text-[#444933]">
            <p>{installSafetyReason}</p>
            <div className="border border-[#747A60] bg-[#EEEEEE] p-3">
              <div className="text-xs font-semibold uppercase text-[#506600]">
                Warum
              </div>
              <p className="mt-1">
                Schreibzugriffe auf echte VibeTV-Hardware bleiben bewusst aus,
                bis das lokale Testfenster explizit aktiviert wurde.
              </p>
            </div>
          </div>
        </section>

        <section className="border border-[#747A60] bg-[#F9F9F9]">
          <SectionHeader
            detail={lastError?.code || "bereit"}
            icon={<ShieldCheck size={17} aria-hidden />}
            title="Request Status"
          />
          <div className="p-4">
            {lastError ? (
              <div className="border border-[#747A60] bg-[#EEEEEE] p-3 text-sm leading-6 text-[#444933]">
                <div className="font-semibold text-[#1B1B1B]">
                  {lastError.message}
                </div>
                <div className="mt-1">{lastError.nextAction}</div>
                <div className="mt-2 font-mono text-xs text-[#747A60]">
                  {lastError.code}
                </div>
              </div>
            ) : (
              <div className="border border-[#747A60] bg-[#EEEEEE] p-3 text-sm text-[#444933]">
                Noch kein Fehler in dieser Sitzung.
              </div>
            )}
          </div>
        </section>
      </aside>
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

function StatusTile({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 border border-[#747A60] bg-[#EEEEEE] px-3 py-3">
      <div className="flex items-center gap-2 text-xs text-[#506600]">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 truncate text-base font-semibold text-[#1B1B1B]">
        {value}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border border-[#747A60] bg-[#EEEEEE] px-3 py-2">
      <div className="text-xs text-[#747A60]">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-[#1B1B1B]">
        {value}
      </div>
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

function labelForCompanion(status: SettingsCompanionStatus): string {
  if (status === "online") {
    return "Online";
  }
  if (status === "missing") {
    return "Fehlt";
  }
  return "Prüfen";
}

function labelForDevice(
  state: SettingsDeviceState,
  device: SettingsDeviceInfo | null,
): string {
  if (device?.connected) {
    return state === "paired" || device.paired ? "Verbunden" : "Gefunden";
  }
  if (state === "offline") {
    return "Offline";
  }
  return "Unbekannt";
}
