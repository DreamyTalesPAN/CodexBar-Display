"use client";

import {
  Activity,
  FileText,
  Grid2X2,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  ActiveTab,
  DeviceInfo,
  ShellNavItem,
} from "./control-center-types";

type ControlCenterShellProps = {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  children: ReactNode;
  device: DeviceInfo | null;
  disabledTabs?: ActiveTab[];
  firmwareUpdateAvailable?: boolean;
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
    label: "Support",
    icon: <FileText size={22} aria-hidden />,
  },
];

export function ControlCenterShell({
  activeTab,
  onTabChange,
  children,
  device,
  disabledTabs = [],
  firmwareUpdateAvailable = false,
}: ControlCenterShellProps) {
  const setupConnected = Boolean(device?.connected && device.paired);
  const targetLabel = setupConnected
    ? device?.target?.replace(/^https?:\/\//, "") || "VibeTV connected"
    : "Setup needed";
  const targetDotClass = setupConnected ? "bg-[#CCFF00]" : "bg-[#747A60]";
  const disabledTabSet = new Set(disabledTabs);
  const isTabDisabled = (tab: ActiveTab) => disabledTabSet.has(tab);

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
                disabled={isTabDisabled(item.id)}
                item={item}
                key={item.id}
                notify={item.id === "updates" && firmwareUpdateAvailable}
                onClick={() => onTabChange(item.id)}
              />
            ))}
          </nav>
        </aside>

        <section className="min-w-0">
          <header className="flex h-[86px] items-center justify-between border-b border-[#747A60] bg-[#F9F9F9] px-7 lg:px-10">
            <div className="hidden min-w-0 lg:block">
              <h1 className="truncate text-xl font-semibold text-[#1B1B1B]">
                {NAV_ITEMS.find((item) => item.id === activeTab)?.label ||
                  "Overview"}
              </h1>
            </div>

            <div className="hidden items-center gap-8 lg:flex">
              <div className="inline-flex items-center gap-3 text-base text-[#1B1B1B]">
                <span className={`size-2 rounded-full ${targetDotClass}`} />
                <span>{targetLabel}</span>
              </div>
            </div>

            <div className="flex w-full min-w-0 items-center gap-2 overflow-x-auto lg:hidden">
              {NAV_ITEMS.map((item) => (
                <button
                  aria-label={item.label}
                  aria-current={item.id === activeTab ? "page" : undefined}
                  aria-disabled={
                    isTabDisabled(item.id) ? true : undefined
                  }
                  className={`inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 px-3 text-sm font-semibold transition ${
                    isTabDisabled(item.id)
                      ? "border border-[#747A60] bg-[#EEEEEE] text-[#444933] opacity-50"
                      : item.id === activeTab
                      ? "bg-[#CCFF00] text-[#1B1B1B]"
                      : "border border-[#747A60] bg-[#F9F9F9] text-[#1B1B1B]"
                  }`}
                  disabled={isTabDisabled(item.id)}
                  key={item.id}
                  onClick={() => onTabChange(item.id)}
                  title={item.label}
                  type="button"
                >
                  {item.icon}
                  <span className="sr-only min-[560px]:not-sr-only">
                    {item.label}
                  </span>
                  {item.id === "updates" && firmwareUpdateAvailable ? (
                    <span
                      aria-label="Update available"
                      className={`size-2.5 rounded-full ${
                        item.id === activeTab ? "bg-[#1B1B1B]" : "bg-[#CCFF00]"
                      }`}
                    />
                  ) : null}
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
  disabled,
  item,
  notify,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  item: ShellNavItem;
  notify?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      aria-disabled={disabled || undefined}
      className={`flex h-[72px] w-full items-center gap-5 border-b border-[#444933] px-9 text-left text-lg transition ${
        disabled
          ? "cursor-not-allowed bg-[#1B1B1B] text-[#747A60] opacity-50"
          : active
          ? "bg-[#CCFF00] text-[#1B1B1B]"
          : "bg-[#1B1B1B] text-[#EDEDED] hover:bg-[#444933]"
      }`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span className="grid size-7 place-items-center">{item.icon}</span>
      <span className="min-w-0 truncate">{item.label}</span>
      {notify ? (
        <span
          aria-label="Update available"
          className={`ml-auto size-3 rounded-full ${
            active ? "bg-[#1B1B1B]" : "bg-[#CCFF00]"
          }`}
        />
      ) : null}
    </button>
  );
}
