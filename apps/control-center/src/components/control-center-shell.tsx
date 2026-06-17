"use client";

import {
  Activity,
  FileText,
  Library,
  Monitor,
  RefreshCw,
  Settings,
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  ActiveTab,
  CompanionStatus,
  DeviceInfo,
  DeviceState,
  ShellNavItem,
} from "./control-center-types";

type ControlCenterShellProps = {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  children: ReactNode;
  companionEndpoint?: string;
  companionStatus: CompanionStatus;
  deviceState: DeviceState;
  device: DeviceInfo | null;
};

const NAV_ITEMS: ShellNavItem[] = [
  {
    id: "overview",
    label: "Overview",
    detail: "State first",
    icon: <Activity size={17} aria-hidden />,
  },
  {
    id: "settings",
    label: "Settings",
    detail: "Device controls",
    icon: <Settings size={17} aria-hidden />,
  },
  {
    id: "theme-library",
    label: "Theme Library",
    detail: "Install surface",
    icon: <Library size={17} aria-hidden />,
  },
  {
    id: "updates",
    label: "Updates",
    detail: "Read-only",
    icon: <RefreshCw size={17} aria-hidden />,
  },
  {
    id: "logs",
    label: "Logs",
    detail: "Session events",
    icon: <FileText size={17} aria-hidden />,
  },
];

export function ControlCenterShell({
  activeTab,
  onTabChange,
  children,
  companionEndpoint = "127.0.0.1:47832",
  companionStatus,
  deviceState,
  device,
}: ControlCenterShellProps) {
  const connected = Boolean(device?.connected);

  return (
    <main className="min-h-screen bg-[#F9F9F9] text-[#444933]">
      <div className="grid min-h-screen lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="hidden border-r border-[#747A60] bg-[#1B1B1B] text-[#EDEDED] lg:flex lg:flex-col">
          <div className="border-b border-[#747A60] px-5 py-6">
            <div className="flex items-center gap-3">
              <div className="grid size-11 place-items-center border border-[#CCFF00] bg-[#CCFF00] text-[#1B1B1B]">
                <Monitor size={22} aria-hidden />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl font-semibold tracking-normal">
                  VibeTV Control Center
                </h1>
                <p className="mt-1 text-sm text-[#EDEDED]">
                  Know where you stand.
                </p>
              </div>
            </div>
            <div className="mt-5 border border-[#747A60] px-3 py-2 font-mono text-xs text-[#EDEDED]">
              {companionEndpoint}
            </div>
          </div>

          <nav aria-label="Control Center" className="flex-1 px-3 py-4">
            <div className="grid gap-1">
              {NAV_ITEMS.map((item) => (
                <ShellNavButton
                  active={item.id === activeTab}
                  item={item}
                  key={item.id}
                  onClick={() => onTabChange(item.id)}
                />
              ))}
            </div>
          </nav>

          <div className="border-t border-[#747A60] px-5 py-4 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span>Bridge</span>
              <span className="font-semibold">
                {labelForCompanion(companionStatus)}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span>Device</span>
              <span className="font-semibold">
                {labelForDevice(deviceState, connected)}
              </span>
            </div>
          </div>
        </aside>

        <section className="min-w-0">
          <header className="border-b border-[#747A60] bg-[#F9F9F9] px-4 py-4 lg:hidden">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h1 className="truncate text-xl font-semibold text-[#1B1B1B]">
                  VibeTV Control Center
                </h1>
                <p className="mt-1 truncate text-sm">Know where you stand.</p>
              </div>
              <div className="grid size-10 shrink-0 place-items-center bg-[#1B1B1B] text-[#EDEDED]">
                <Monitor size={20} aria-hidden />
              </div>
            </div>
            <div className="mt-4 overflow-x-auto">
              <div className="inline-grid min-w-max grid-cols-5 border border-[#747A60] bg-[#EEEEEE] p-1">
                {NAV_ITEMS.map((item) => (
                  <button
                    aria-current={item.id === activeTab ? "page" : undefined}
                    className={`inline-flex h-10 items-center justify-center gap-2 px-3 text-sm font-semibold transition ${
                      item.id === activeTab
                        ? "bg-[#1B1B1B] text-[#EDEDED]"
                        : "bg-[#EEEEEE] text-[#444933] hover:bg-[#F9F9F9]"
                    }`}
                    key={item.id}
                    onClick={() => onTabChange(item.id)}
                    type="button"
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </header>

          <div className="px-4 py-5 sm:px-6 lg:px-8 lg:py-7">{children}</div>
        </section>
      </div>
    </main>
  );
}

function ShellNavButton({
  active,
  item,
  onClick,
}: {
  active: boolean;
  item: ShellNavItem;
  onClick: () => void;
}) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={`grid w-full grid-cols-[24px_minmax(0,1fr)] items-center gap-3 px-3 py-3 text-left transition ${
        active
          ? "bg-[#CCFF00] text-[#1B1B1B]"
          : "bg-[#1B1B1B] text-[#EDEDED] hover:bg-[#444933]"
      }`}
      onClick={onClick}
      type="button"
    >
      <span className="grid place-items-center">{item.icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">
          {item.label}
        </span>
        {item.detail ? (
          <span className="mt-0.5 block truncate text-xs">{item.detail}</span>
        ) : null}
      </span>
    </button>
  );
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

function labelForDevice(state: DeviceState, connected: boolean): string {
  if (connected || state === "paired") {
    return "Connected";
  }
  if (state === "offline") {
    return "Offline";
  }
  return "Unknown";
}
