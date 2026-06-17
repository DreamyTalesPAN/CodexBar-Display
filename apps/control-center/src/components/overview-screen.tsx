import {
  ArrowUpFromLine,
  Check,
  CircleHelp,
  Download,
  ExternalLink,
  Lock,
  Monitor,
  Server,
  Signal,
  SlidersHorizontal,
  Wifi,
} from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";
import type {
  ApiError,
  CompanionStatus,
  ControlCenterEvent,
  DeviceInfo,
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
}: OverviewScreenProps) {
  const connected = Boolean(device?.connected);
  const hero = buildHeroCopy({ companionStatus, connected, lastError });
  const readiness = buildReadiness({
    companionStatus,
    deviceState,
    device,
    themeInstallEnabled,
    lastCheckedAt,
  });
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
              <p className="mt-5 text-xl leading-8 text-[#444933]">
                Know where you stand.
              </p>
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
              badge={device?.firmware ? "Current" : undefined}
              icon={<ArrowUpFromLine size={18} aria-hidden />}
              label="Firmware"
              value={device?.firmware || "Unknown"}
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
        <ol className="grid gap-6 lg:grid-cols-4">
          {displayEvents.slice(0, 4).map((event, index) => (
            <EventItem event={event} index={index} key={event.id} />
          ))}
        </ol>
      </section>

      <ReadinessStrip items={readiness} />

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
  index,
}: {
  event: ControlCenterEvent;
  index: number;
}) {
  const icons = [
    <Wifi size={26} aria-hidden key="wifi" />,
    <Monitor size={26} aria-hidden key="monitor" />,
    <ArrowUpFromLine size={26} aria-hidden key="firmware" />,
    <Lock size={26} aria-hidden key="lock" />,
  ];

  return (
    <li className="grid gap-4 lg:grid-cols-[64px_minmax(0,1fr)] lg:border-r lg:border-[#747A60] lg:pr-7 lg:last:border-r-0">
      <div className="grid size-14 place-items-center rounded-full bg-[#1B1B1B] text-[#CCFF00]">
        {icons[index] || <Signal size={26} aria-hidden />}
      </div>
      <div className="min-w-0">
        <div className="truncate font-bold text-[#1B1B1B]">{event.label}</div>
        <div className="mt-1 truncate text-[#444933]">{event.detail}</div>
        <div className="mt-1 text-[#444933]">{event.at || "Session"}</div>
      </div>
    </li>
  );
}

function ReadinessStrip({ items }: { items: ReadinessItem[] }) {
  return (
    <section className="mt-8 border border-[#747A60] bg-[#F9F9F9] px-8 py-6">
      <h3 className="mb-4 text-base font-bold text-[#1B1B1B]">Readiness</h3>
      <dl className="grid gap-4 md:grid-cols-3 xl:grid-cols-7">
        {items.map((item) => (
          <div
            className="grid min-w-0 grid-cols-[34px_minmax(0,1fr)] items-center gap-3 md:border-r md:border-[#747A60] md:pr-5 md:last:border-r-0"
            key={item.label}
          >
            <div className="text-[#506600]">{iconForReadiness(item.label)}</div>
            <div className="min-w-0">
              <dt className="text-sm font-bold leading-5 text-[#1B1B1B]">
                {item.label}
              </dt>
              <dd className="mt-0.5 text-sm leading-5 text-[#1B1B1B]">
                <span className="block truncate">{item.value}</span>
                {item.detail ? (
                  <span className="block truncate text-[#444933]">
                    {item.detail}
                  </span>
                ) : null}
              </dd>
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
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

function iconForReadiness(label: string) {
  switch (label) {
    case "Connection":
      return <Wifi size={30} aria-hidden />;
    case "Bridge":
      return <Server size={30} aria-hidden />;
    case "Device":
      return <Monitor size={30} aria-hidden />;
    case "Firmware":
      return <ArrowUpFromLine size={30} aria-hidden />;
    case "Updates":
      return <Download size={30} aria-hidden />;
    case "Write Access":
      return <Lock size={30} aria-hidden />;
    default:
      return <Signal size={30} aria-hidden />;
  }
}

function buildReadiness({
  companionStatus,
  deviceState,
  device,
  themeInstallEnabled,
  lastCheckedAt,
}: {
  companionStatus: CompanionStatus;
  deviceState: DeviceState;
  device: DeviceInfo | null;
  themeInstallEnabled: boolean;
  lastCheckedAt?: string | null;
}): ReadinessItem[] {
  const connected = Boolean(device?.connected);

  return [
    {
      label: "Connection",
      value: connected ? "Good" : "Check",
      detail: connected ? undefined : "Discovery",
      tone: connected ? "ready" : "attention",
    },
    {
      label: "Bridge",
      value: labelForCompanion(companionStatus),
      detail: companionStatus === "online" ? undefined : "Start local API",
      tone:
        companionStatus === "online"
          ? "ready"
          : companionStatus === "missing"
            ? "attention"
            : "unknown",
    },
    {
      label: "Device",
      value: labelForDevice(deviceState, device),
      detail: device?.target?.replace(/^https?:\/\//, ""),
      tone: connected ? "ready" : deviceState === "offline" ? "attention" : "unknown",
    },
    {
      label: "Firmware",
      value: device?.firmware ? "Current" : "Unknown",
      detail: device?.firmware || undefined,
      tone: device?.firmware ? "ready" : "unknown",
    },
    {
      label: "Updates",
      value: "No endpoint",
      detail: "MVP",
      tone: "unknown",
    },
    {
      label: "Write Access",
      value: themeInstallEnabled ? "Enabled" : "Locked",
      detail: themeInstallEnabled ? undefined : "Read-only",
      tone: themeInstallEnabled ? "ready" : "attention",
    },
    {
      label: "Signal",
      value: lastCheckedAt ? "Fresh" : "Session",
      detail: lastCheckedAt || undefined,
      tone: lastCheckedAt ? "ready" : "unknown",
    },
  ];
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
      label: device?.firmware ? "Firmware current" : "Firmware unknown",
      detail: device?.firmware || "No device read",
      at: lastCheckedAt || "Session",
      tone: device?.firmware ? "ready" : "unknown",
    },
    {
      id: "install-lock",
      label: themeInstallEnabled ? "Install enabled" : "Install locked",
      detail: themeInstallEnabled ? "Write window open" : "Read-only mode",
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
