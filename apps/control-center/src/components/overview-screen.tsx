import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  PlugZap,
  Radio,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import type { ReactNode } from "react";
import { DeviceMockup } from "./device-mockup";
import type {
  ApiError,
  CompanionStatus,
  ControlCenterEvent,
  DeviceInfo,
  DeviceMockupTheme,
  DeviceState,
  ReadinessItem,
  ReadinessTone,
} from "./control-center-types";

type OverviewScreenProps = {
  companionStatus: CompanionStatus;
  deviceState: DeviceState;
  device: DeviceInfo | null;
  themeInstallEnabled: boolean;
  companionEndpoint?: string;
  lastError?: ApiError | null;
  lastCheckedAt?: string | null;
  events?: ControlCenterEvent[];
  activeTheme?: DeviceMockupTheme | null;
};

export function OverviewScreen({
  companionStatus,
  deviceState,
  device,
  themeInstallEnabled,
  companionEndpoint = "http://127.0.0.1:47832",
  lastError,
  lastCheckedAt,
  events,
  activeTheme,
}: OverviewScreenProps) {
  const connected = Boolean(device?.connected);
  const readiness = buildReadiness({
    companionStatus,
    deviceState,
    device,
    themeInstallEnabled,
  });
  const displayEvents =
    events?.length
      ? events
      : buildSessionEvents({
          companionStatus,
          device,
          themeInstallEnabled,
          lastError,
          lastCheckedAt,
        });
  const hero = buildHeroCopy({ companionStatus, connected, lastError });

  return (
    <div className="mx-auto grid max-w-7xl gap-5">
      <section className="border border-[#747A60] bg-[#1B1B1B] text-[#EDEDED]">
        <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:p-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 bg-[#CCFF00] px-3 py-1 text-xs font-bold uppercase tracking-normal text-[#1B1B1B]">
                {hero.icon}
                {hero.state}
              </span>
              <span className="break-all font-mono text-xs text-[#EDEDED]">
                {companionEndpoint}
              </span>
            </div>
            <h2 className="mt-5 max-w-3xl text-4xl font-black leading-none tracking-normal text-[#EDEDED] sm:text-5xl">
              {hero.title}
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-[#EDEDED]">
              {hero.detail}
            </p>
          </div>

          <dl className="grid content-start border border-[#747A60] text-sm">
            <HeroFact label="Bridge" value={labelForCompanion(companionStatus)} />
            <HeroFact label="Device" value={labelForDevice(deviceState, device)} />
            <HeroFact label="Firmware" value={device?.firmware || "Unknown"} />
            <HeroFact label="Updates" value="No endpoint yet" />
            <HeroFact
              label="Write Access"
              value={themeInstallEnabled ? "Enabled" : "Install locked"}
            />
            <HeroFact
              label="Signal Freshness"
              value={lastCheckedAt || "Local session"}
            />
          </dl>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_440px]">
        <div className="grid gap-5">
          <ReadinessStrip items={readiness} />
          <LastEvents events={displayEvents} />
        </div>

        <div className="border border-[#747A60] bg-[#EEEEEE] p-5">
          <DeviceMockup
            activeTheme={activeTheme}
            companionStatus={companionStatus}
            device={device}
            deviceState={deviceState}
            freshnessLabel={lastCheckedAt || "local session"}
            themeInstallEnabled={themeInstallEnabled}
          />
        </div>
      </section>
    </div>
  );
}

function ReadinessStrip({ items }: { items: ReadinessItem[] }) {
  return (
    <section className="border border-[#747A60] bg-[#F9F9F9]">
      <SectionTitle
        detail="Overview only"
        icon={<ShieldCheck size={18} aria-hidden />}
        title="Readiness"
      />
      <dl className="grid md:grid-cols-5">
        {items.map((item) => (
          <div
            className="min-w-0 border-t border-[#747A60] px-4 py-4 md:border-r md:last:border-r-0"
            key={item.label}
          >
            <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-normal text-[#506600]">
              <ToneMark tone={item.tone} />
              {item.label}
            </dt>
            <dd className="mt-2 break-words text-lg font-bold text-[#1B1B1B]">
              {item.value}
            </dd>
            {item.detail ? (
              <dd className="mt-1 break-words text-xs leading-5 text-[#444933]">
                {item.detail}
              </dd>
            ) : null}
          </div>
        ))}
      </dl>
    </section>
  );
}

function LastEvents({ events }: { events: ControlCenterEvent[] }) {
  return (
    <section className="border border-[#747A60] bg-[#F9F9F9]">
      <SectionTitle
        detail="Browser session"
        icon={<Activity size={18} aria-hidden />}
        title="Last Events"
      />
      <ol className="divide-y divide-[#747A60] border-t border-[#747A60]">
        {events.map((event) => (
          <li className="grid gap-3 px-4 py-4 sm:grid-cols-[140px_minmax(0,1fr)]" key={event.id}>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-normal text-[#506600]">
              <ToneMark tone={event.tone || "unknown"} />
              {event.at || "Now"}
            </div>
            <div className="min-w-0">
              <div className="break-words text-sm font-bold text-[#1B1B1B]">
                {event.label}
              </div>
              <div className="mt-1 break-words text-sm leading-6 text-[#444933]">
                {event.detail}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SectionTitle({
  detail,
  icon,
  title,
}: {
  detail: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-bold text-[#1B1B1B]">
        {icon}
        {title}
      </div>
      <div className="truncate text-xs font-semibold uppercase tracking-normal text-[#506600]">
        {detail}
      </div>
    </div>
  );
}

function HeroFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] border-b border-[#747A60] last:border-b-0">
      <dt className="border-r border-[#747A60] px-3 py-2 text-xs font-semibold uppercase tracking-normal text-[#CCFF00]">
        {label}
      </dt>
      <dd className="min-w-0 break-words px-3 py-2 text-sm font-semibold text-[#EDEDED]">
        {value}
      </dd>
    </div>
  );
}

function ToneMark({ tone }: { tone: ReadinessTone }) {
  if (tone === "ready") {
    return <CheckCircle2 size={15} aria-hidden />;
  }
  if (tone === "attention") {
    return <AlertTriangle size={15} aria-hidden />;
  }
  return <Clock3 size={15} aria-hidden />;
}

function buildReadiness({
  companionStatus,
  deviceState,
  device,
  themeInstallEnabled,
}: {
  companionStatus: CompanionStatus;
  deviceState: DeviceState;
  device: DeviceInfo | null;
  themeInstallEnabled: boolean;
}): ReadinessItem[] {
  const connected = Boolean(device?.connected);

  const items: ReadinessItem[] = [
    {
      label: "Device",
      value: labelForDevice(deviceState, device),
      detail: device?.target || "Discovery required before control.",
      tone: connected
        ? "ready"
        : deviceState === "offline"
          ? "attention"
          : "unknown",
    },
    {
      label: "Bridge",
      value: labelForCompanion(companionStatus),
      detail: "Local Companion API.",
      tone:
        companionStatus === "online"
          ? "ready"
          : companionStatus === "missing"
            ? "attention"
            : "unknown",
    },
    {
      label: "Firmware",
      value: device?.firmware || "Unknown",
      detail: device?.board || "Device facts not loaded.",
      tone: device?.firmware ? "ready" : "unknown",
    },
    {
      label: "Updates",
      value: "No endpoint",
      detail: "Update availability is future API work.",
      tone: "unknown",
    },
    {
      label: "Write Access",
      value: themeInstallEnabled ? "Enabled" : "Locked",
      detail: themeInstallEnabled
        ? "Install flag is active."
        : "Theme installs remain guarded.",
      tone: themeInstallEnabled ? "ready" : "attention",
    },
  ];

  return items;
}

function buildSessionEvents({
  companionStatus,
  device,
  themeInstallEnabled,
  lastError,
  lastCheckedAt,
}: {
  companionStatus: CompanionStatus;
  device: DeviceInfo | null;
  themeInstallEnabled: boolean;
  lastError?: ApiError | null;
  lastCheckedAt?: string | null;
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
          ? "Companion API is reachable for read-only overview state."
          : "Start or check the Companion before controlling the device.",
      at: lastCheckedAt || "Session",
      tone: companionStatus === "online" ? "ready" : "attention",
    },
    {
      id: "device",
      label: device?.connected ? "Device health read" : "Device not connected",
      detail: device?.connected
        ? `${device.target || "VibeTV"} reports ${device.firmware || "unknown firmware"}.`
        : "Discovery or pairing is needed before settings and installs.",
      at: "Session",
      tone: device?.connected ? "ready" : "unknown",
    },
    {
      id: "install-lock",
      label: themeInstallEnabled ? "Install lock open" : "Theme install locked",
      detail: themeInstallEnabled
        ? "The local Companion currently allows install writes."
        : "Writes stay disabled unless the Companion is started with the install flag.",
      at: "Session",
      tone: themeInstallEnabled ? "ready" : "attention",
    },
  ];

  if (lastError) {
    events.unshift({
      id: "last-error",
      label: lastError.message,
      detail: lastError.nextAction,
      at: lastError.code,
      tone: "attention",
    });
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
      state: "Missing bridge",
      title: "Companion bridge is not reachable.",
      detail:
        lastError?.nextAction ||
        "Start the local Companion before changing settings or installing themes.",
      icon: <PlugZap size={15} aria-hidden />,
    };
  }
  if (connected) {
    return {
      state: "Connected",
      title: "VibeTV is visible and ready to inspect.",
      detail:
        "Overview is status-only. Settings and Theme Library handle control actions in their own screens.",
      icon: <Wifi size={15} aria-hidden />,
    };
  }
  return {
    state: "Awaiting signal",
    title: "Bridge state is visible. Device state is not confirmed.",
    detail:
      "Use Settings for discovery and pairing before changing display values or installing a theme.",
    icon: <Radio size={15} aria-hidden />,
  };
}

function labelForCompanion(status: CompanionStatus): string {
  if (status === "online") {
    return "Online";
  }
  if (status === "missing") {
    return "Missing";
  }
  return "Unknown";
}

function labelForDevice(state: DeviceState, device: DeviceInfo | null): string {
  if (device?.connected) {
    return state === "paired" || device.paired ? "Connected" : "Found";
  }
  if (state === "offline") {
    return "Offline";
  }
  return "Unknown";
}
