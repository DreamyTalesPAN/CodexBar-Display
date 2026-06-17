"use client";

import {
  Activity,
  ChevronDown,
  CircleHelp,
  ExternalLink,
  FileText,
  Grid2X2,
  RefreshCw,
  Settings,
  SlidersHorizontal,
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
    icon: <Activity size={22} aria-hidden />,
  },
  {
    id: "settings",
    label: "Settings",
    icon: <SlidersHorizontal size={22} aria-hidden />,
  },
  {
    id: "theme-library",
    label: "Theme Library",
    icon: <Grid2X2 size={22} aria-hidden />,
  },
  {
    id: "updates",
    label: "Updates",
    icon: <RefreshCw size={22} aria-hidden />,
  },
  {
    id: "logs",
    label: "Logs",
    icon: <FileText size={22} aria-hidden />,
  },
];

export function ControlCenterShell({
  activeTab,
  onTabChange,
  children,
  companionEndpoint = "127.0.0.1:47832",
  companionStatus,
  device,
}: ControlCenterShellProps) {
  const targetLabel = device?.target?.replace(/^https?:\/\//, "") || "vibetv.local";

  return (
    <main className="min-h-screen bg-[#F9F9F9] text-[#1B1B1B]">
      <div className="grid min-h-screen lg:grid-cols-[266px_minmax(0,1fr)]">
        <aside className="hidden bg-[#1B1B1B] text-[#EDEDED] lg:flex lg:flex-col">
          <div className="px-9 pb-9 pt-8">
            <div className="text-[32px] font-black uppercase leading-none tracking-normal">
              VIBE<span className="text-[#CCFF00]">TV</span>
            </div>
            <div className="mt-1 text-sm font-semibold uppercase tracking-normal">
              Control Center
            </div>
          </div>

          <nav aria-label="Control Center" className="flex-1">
            {NAV_ITEMS.map((item) => (
              <ShellNavButton
                active={item.id === activeTab}
                item={item}
                key={item.id}
                onClick={() => onTabChange(item.id)}
              />
            ))}
          </nav>

          <div className="grid gap-12 px-5 pb-8">
            <div className="border border-[#444933] px-8 py-6">
              <div className="flex items-start gap-4">
                <span className="mt-1 size-3 rounded-full bg-[#CCFF00]" />
                <div>
                  <div className="text-lg font-bold text-[#EDEDED]">Bridge</div>
                  <div className="mt-1 text-lg text-[#CCFF00]">
                    {labelForCompanion(companionStatus)}
                  </div>
                </div>
              </div>
              <div className="mt-6 leading-6 text-[#EDEDED]">
                <div>{targetLabel}</div>
                <div>{companionEndpoint}</div>
              </div>
            </div>

            <button
              className="flex h-16 items-center justify-between border border-[#444933] px-5 text-left text-[#EDEDED] transition hover:border-[#747A60]"
              type="button"
            >
              <span className="flex items-center gap-4">
                <CircleHelp size={26} aria-hidden />
                <span>Help & Support</span>
              </span>
              <ExternalLink size={18} aria-hidden />
            </button>
          </div>
        </aside>

        <section className="min-w-0">
          <header className="flex h-[86px] items-center justify-between border-b border-[#747A60] bg-[#F9F9F9] px-7 lg:px-10">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold text-[#1B1B1B]">
                {NAV_ITEMS.find((item) => item.id === activeTab)?.label ||
                  "Overview"}
              </h1>
            </div>

            <div className="hidden items-center gap-8 md:flex">
              <div className="inline-flex items-center gap-3 text-base text-[#1B1B1B]">
                <span className="size-2 rounded-full bg-[#CCFF00]" />
                <span>{targetLabel}</span>
              </div>
              <div className="h-8 w-px bg-[#747A60]" />
              <button
                className="inline-flex items-center gap-4 text-base text-[#1B1B1B]"
                type="button"
              >
                <Settings size={22} aria-hidden />
                <span>Control Center 1.0.34</span>
                <ChevronDown size={18} aria-hidden />
              </button>
            </div>

            <div className="flex items-center gap-2 overflow-x-auto md:hidden">
              {NAV_ITEMS.map((item) => (
                <button
                  aria-current={item.id === activeTab ? "page" : undefined}
                  className={`inline-flex h-11 shrink-0 items-center gap-2 px-3 text-sm font-semibold transition ${
                    item.id === activeTab
                      ? "bg-[#CCFF00] text-[#1B1B1B]"
                      : "border border-[#747A60] bg-[#F9F9F9] text-[#1B1B1B]"
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
          </header>

          <div className="px-7 py-0 lg:px-10">{children}</div>
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
      className={`flex h-[72px] w-full items-center gap-5 border-b border-[#444933] px-9 text-left text-lg transition ${
        active
          ? "bg-[#CCFF00] text-[#1B1B1B]"
          : "bg-[#1B1B1B] text-[#EDEDED] hover:bg-[#444933]"
      }`}
      onClick={onClick}
      type="button"
    >
      <span className="grid size-7 place-items-center">{item.icon}</span>
      <span className="min-w-0 truncate">{item.label}</span>
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
  return "Check required";
}
