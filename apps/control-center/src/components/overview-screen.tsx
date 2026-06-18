import {
  ArrowUpFromLine,
  Check,
  CircleHelp,
  ExternalLink,
  Lock,
  Monitor,
  Play,
  Server,
  ShieldCheck,
  Signal,
  SlidersHorizontal,
  Wifi,
} from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";
import { hasFirmwareUpdate, type FirmwareUpdateInfo } from "@/lib/firmware";
import type {
  ApiError,
  CompanionStatus,
  ControlCenterEvent,
  DeviceInfo,
  DeviceState,
  ReadinessTone,
} from "./control-center-types";

type OverviewScreenProps = {
  companionStatus: CompanionStatus;
  deviceState: DeviceState;
  device: DeviceInfo | null;
  themeInstallEnabled: boolean;
  companionEndpoint?: string;
  busyAction?: string | null;
  lastError?: ApiError | null;
  lastCheckedAt?: string | null;
  firmwareUpdate?: FirmwareUpdateInfo | null;
  events?: ControlCenterEvent[];
  onCheckBridge?: () => void;
  onDiscoverDevice?: () => void;
};

export function OverviewScreen({
  companionStatus,
  deviceState,
  device,
  themeInstallEnabled,
  companionEndpoint = "http://127.0.0.1:47832",
  busyAction,
  lastError,
  lastCheckedAt,
  firmwareUpdate,
  events,
  onCheckBridge,
  onDiscoverDevice,
}: OverviewScreenProps) {
  const connected = Boolean(device?.connected);
  const hero = buildHeroCopy({ companionStatus, connected, lastError });
  const setup = buildSetupState({
    companionStatus,
    connected,
    deviceState,
    lastError,
  });
  const firmwareUpdateAvailable = hasFirmwareUpdate(firmwareUpdate);
  const displayEvents = buildSessionEvents({
    companionStatus,
    device,
    themeInstallEnabled,
    lastError,
    lastCheckedAt,
    fallbackEvents: events,
  });

  return (
    <div className="mx-auto max-w-[1180px]">
      <section className="grid min-h-[500px] items-center gap-8 border-b border-[#747A60] py-8 lg:grid-cols-[minmax(0,520px)_minmax(420px,1fr)] lg:py-9">
        <div className="min-w-0">
          <div className="flex items-start gap-5">
            <StatusBadge tone={hero.tone}>{hero.icon}</StatusBadge>
            <div className="min-w-0">
              <h2 className="max-w-[440px] text-[clamp(2.8rem,5vw,4.5rem)] font-black leading-[1.05] tracking-normal text-[#1B1B1B]">
                {hero.title}
              </h2>
            </div>
          </div>

          <dl className="mt-9 max-w-[420px]">
            <StatusRow
              icon={<Wifi size={18} aria-hidden />}
              label="Bridge"
              value={labelForCompanion(companionStatus)}
            />
            <StatusRow
              icon={<Monitor size={18} aria-hidden />}
              label="Device"
              value={labelForDevice(deviceState, device)}
            />
            <StatusRow
              badge={firmwareUpdateAvailable ? "Update" : undefined}
              icon={<ArrowUpFromLine size={18} aria-hidden />}
              label="Firmware"
              value={device?.firmware || "Check required"}
            />
          </dl>
        </div>

        <div className="flex justify-center lg:justify-end">
          <Image
            alt="VibeTV device showing the current usage theme"
            className="h-auto w-full max-w-[520px]"
            height={510}
            priority
            src="/images/vibetv-device-overview.png"
            width={570}
          />
        </div>
      </section>

      <section className="border-b border-[#747A60] py-6">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="flex min-w-0 gap-4">
            <div className="grid size-11 shrink-0 place-items-center rounded-full bg-[#1B1B1B] text-[#CCFF00]">
              {setup.icon}
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-[#1B1B1B]">
                {setup.title}
              </h3>
              <p className="mt-1 max-w-[720px] text-sm leading-6 text-[#444933]">
                {setup.detail}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row md:justify-end">
            <button
              className="inline-flex h-11 items-center justify-center gap-2 border border-[#747A60] bg-[#F9F9F9] px-4 text-sm font-semibold text-[#1B1B1B] transition hover:bg-[#CCFF00] disabled:cursor-not-allowed disabled:bg-[#EEEEEE] disabled:text-[#444933]"
              disabled={busyAction === "status"}
              onClick={onCheckBridge}
              type="button"
            >
              <Wifi size={17} aria-hidden />
              {busyAction === "status" ? "Checking" : "Check bridge"}
            </button>
            <button
              className="inline-flex h-11 items-center justify-center gap-2 border border-[#747A60] bg-[#1B1B1B] px-4 text-sm font-semibold text-[#EDEDED] transition hover:bg-[#CCFF00] hover:text-[#1B1B1B] disabled:cursor-not-allowed disabled:bg-[#EEEEEE] disabled:text-[#444933]"
              disabled={companionStatus !== "online" || busyAction === "discover"}
              onClick={onDiscoverDevice}
              type="button"
            >
              <Monitor size={17} aria-hidden />
              {busyAction === "discover" ? "Searching" : "Find VibeTV"}
            </button>
          </div>
        </div>
      </section>

      <section className="border-b border-[#747A60] py-6">
        <div className="mb-6 flex items-center justify-between gap-4">
          <h3 className="text-base font-bold text-[#1B1B1B]">Last events</h3>
          <button
            className="inline-flex items-center gap-2 text-sm font-semibold text-[#506600] transition hover:text-[#1B1B1B]"
            type="button"
          >
            View all logs
            <ExternalLink size={16} aria-hidden />
          </button>
        </div>
        <ol className="grid border-y border-[#747A60]">
          {displayEvents.slice(0, 3).map((event) => (
            <EventItem event={event} key={event.id} />
          ))}
        </ol>
      </section>

      <div className="mt-8 grid gap-4 text-sm text-[#444933] md:hidden">
        <InfoPill icon={<Server size={16} aria-hidden />}>
          {companionEndpoint}
        </InfoPill>
      </div>
    </div>
  );
}

function StatusBadge({
  children,
  tone,
}: {
  children: ReactNode;
  tone: ReadinessTone;
}) {
  const fill = tone === "ready" ? "bg-[#CCFF00]" : "bg-[#EEEEEE]";
  return (
    <div
      className={`grid size-16 shrink-0 place-items-center rounded-full border border-[#747A60] text-[#1B1B1B] ${fill}`}
    >
      {children}
    </div>
  );
}

function StatusRow({
  badge,
  detail,
  icon,
  label,
  value,
}: {
  badge?: string;
  detail?: string;
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="grid min-h-[50px] grid-cols-[28px_1fr_120px] items-start gap-3 border-b border-[#747A60] py-3 last:border-b-0">
      <div className="pt-0.5 text-[#506600]">{icon}</div>
      <dt className="font-medium text-[#1B1B1B]">{label}</dt>
      <dd className="min-w-0 text-[#1B1B1B]">
        <div className="flex flex-wrap items-center gap-2">
          <span>{value}</span>
          {badge ? (
            <span className="rounded-full bg-[#CCFF00] px-2 py-0.5 text-xs font-semibold text-[#1B1B1B]">
              {badge}
            </span>
          ) : null}
          {label === "Write Access" ? (
            <Lock size={15} className="text-[#444933]" aria-hidden />
          ) : null}
        </div>
        {detail ? <div className="mt-1 text-sm text-[#444933]">{detail}</div> : null}
      </dd>
    </div>
  );
}

function EventItem({
  event,
}: {
  event: ControlCenterEvent;
}) {
  return (
    <li className="grid min-h-[74px] grid-cols-[54px_minmax(0,1fr)_96px] items-center gap-5 border-b border-[#747A60] py-4 last:border-b-0">
      <div className="grid size-11 place-items-center rounded-full bg-[#1B1B1B] text-[#CCFF00]">
        {iconForEvent(event)}
      </div>
      <div className="min-w-0">
        <div className="font-bold leading-5 text-[#1B1B1B]">{event.label}</div>
        <div className="mt-1 leading-5 text-[#444933]">{event.detail}</div>
      </div>
      <div className="text-right text-sm text-[#444933]">{event.at || "Session"}</div>
    </li>
  );
}

function iconForEvent(event: ControlCenterEvent) {
  switch (event.id) {
    case "bridge":
      return <Wifi size={22} aria-hidden />;
    case "device":
      return <Monitor size={22} aria-hidden />;
    case "firmware":
      return <ArrowUpFromLine size={22} aria-hidden />;
    case "last-error":
      return <CircleHelp size={22} aria-hidden />;
    default:
      return <Signal size={22} aria-hidden />;
  }
}

function InfoPill({
  children,
  icon,
}: {
  children: ReactNode;
  icon: ReactNode;
}) {
  return (
    <div className="inline-flex items-center gap-2 border border-[#747A60] px-3 py-2">
      <span className="text-[#506600]">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

function buildSessionEvents({
  companionStatus,
  device,
  fallbackEvents,
  themeInstallEnabled,
  lastError,
  lastCheckedAt,
}: {
  companionStatus: CompanionStatus;
  device: DeviceInfo | null;
  themeInstallEnabled: boolean;
  lastError?: ApiError | null;
  lastCheckedAt?: string | null;
  fallbackEvents?: ControlCenterEvent[];
}): ControlCenterEvent[] {
  const events: ControlCenterEvent[] = [
    {
      id: "bridge",
      label:
        companionStatus === "online"
          ? "Bridge checked"
          : "Bridge needs attention",
      detail:
        companionStatus === "online"
          ? device?.target?.replace(/^https?:\/\//, "") ||
            fallbackEvents?.[0]?.detail ||
            "vibetv.local"
          : "Start Companion",
      at: lastCheckedAt || "Session",
      tone: companionStatus === "online" ? "ready" : "attention",
    },
    {
      id: "device",
      label: device?.connected ? "Device health read" : "Device offline",
      detail: device?.connected ? "OK" : "Discovery needed",
      at: lastCheckedAt || "Session",
      tone: device?.connected ? "ready" : "unknown",
    },
    {
      id: "firmware",
      label: device?.firmware ? "Firmware current" : "Firmware pending",
      detail: device?.firmware || "Waiting for device",
      at: lastCheckedAt || "Session",
      tone: device?.firmware ? "ready" : "unknown",
    },
    {
      id: "install-lock",
      label: themeInstallEnabled ? "Install enabled" : "Install protected",
      detail: themeInstallEnabled ? "Ready" : "Protected",
      at: lastCheckedAt || "Session",
      tone: themeInstallEnabled ? "ready" : "attention",
    },
  ];

  if (lastError) {
    events[0] = {
      id: "last-error",
      label: lastError.message,
      detail: lastError.nextAction,
      at: lastError.code,
      tone: "attention",
    };
  }

  return events;
}

function buildHeroCopy({
  companionStatus,
  connected,
  lastError,
}: {
  companionStatus: CompanionStatus;
  connected: boolean;
  lastError?: ApiError | null;
}) {
  if (companionStatus === "missing") {
    return {
      title: "Companion is offline",
      tone: "attention" as ReadinessTone,
      icon: <CircleHelp size={36} aria-hidden />,
      detail: lastError?.nextAction,
    };
  }
  if (connected) {
    return {
      title: "VibeTV is connected",
      tone: "ready" as ReadinessTone,
      icon: <Check size={38} aria-hidden />,
    };
  }
  return {
    title: "VibeTV needs a signal",
    tone: "attention" as ReadinessTone,
    icon: <SlidersHorizontal size={34} aria-hidden />,
  };
}

function buildSetupState({
  companionStatus,
  connected,
  deviceState,
  lastError,
}: {
  companionStatus: CompanionStatus;
  connected: boolean;
  deviceState: DeviceState;
  lastError?: ApiError | null;
}) {
  if (companionStatus === "missing") {
    return {
      title: "Install or start Companion",
      detail:
        "app.vibetv.shop is live, but it can only reach your VibeTV through the local Companion on this computer. The browser permission allows that local connection; it does not start Companion.",
      icon: <Play size={22} aria-hidden />,
    };
  }
  if (!connected && deviceState === "offline") {
    return {
      title: "Find the device on this network",
      detail:
        lastError?.nextAction ||
        "Companion is running, but VibeTV was not found yet. Keep VibeTV powered on and search again.",
      icon: <Monitor size={22} aria-hidden />,
    };
  }
  if (connected) {
    return {
      title: "Read-only checks are ready",
      detail:
        "Companion can read device status and settings. Theme install writes stay protected until the release gate is explicitly enabled for a hardware test.",
      icon: <ShieldCheck size={22} aria-hidden />,
    };
  }
  return {
    title: "Check local bridge",
    detail:
      "Start by checking Companion, then search for VibeTV on the same WiFi network.",
    icon: <Wifi size={22} aria-hidden />,
  };
}

function labelForCompanion(status: CompanionStatus): string {
  if (status === "online") {
    return "Online";
  }
  if (status === "missing") {
    return "Missing";
  }
  return "Waiting for bridge";
}

function labelForDevice(state: DeviceState, device: DeviceInfo | null): string {
  if (device?.connected) {
    return state === "paired" || device.paired ? "Connected" : "Found";
  }
  if (state === "offline") {
    return "Offline";
  }
  return "Waiting for device";
}
