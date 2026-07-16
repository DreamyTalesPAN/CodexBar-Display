"use client";

import type { ReactNode } from "react";

export type ThemeStudioAdvancedTab = "assets" | "device" | "json" | "project";

const TABS: Array<{ id: ThemeStudioAdvancedTab; label: string }> = [
  { id: "project", label: "Project" },
  { id: "assets", label: "Assets" },
  { id: "json", label: "JSON" },
  { id: "device", label: "Device" },
];

export function AdvancedPanel({
  activeTab,
  onTabChange,
  panels,
}: {
  activeTab: ThemeStudioAdvancedTab;
  onTabChange: (tab: ThemeStudioAdvancedTab) => void;
  panels: Record<ThemeStudioAdvancedTab, ReactNode>;
}) {
  return (
    <details className="border border-[#747A60] bg-[#EEEEEE] p-3">
      <summary className="cursor-pointer text-xs font-black uppercase tracking-normal text-[#1B1B1B]">
        Advanced
      </summary>
      <div
        aria-label="Advanced editor sections"
        className="mt-3 grid grid-cols-4 gap-1"
        role="tablist"
      >
        {TABS.map((tab) => (
          <AdvancedTabButton
            active={activeTab === tab.id}
            key={tab.id}
            label={tab.label}
            onClick={() => onTabChange(tab.id)}
            tab={tab.id}
          />
        ))}
      </div>
      <div className="mt-4 grid gap-4">{panels[activeTab]}</div>
    </details>
  );
}

function AdvancedTabButton({
  active,
  label,
  onClick,
  tab,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  tab: ThemeStudioAdvancedTab;
}) {
  return (
    <button
      aria-controls={`theme-studio-panel-${tab}`}
      aria-selected={active}
      className={`min-h-9 border px-1 text-[11px] font-black outline-none transition focus-visible:border-[#5E7200] ${
        active
          ? "border-[#1B1B1B] bg-[#CCFF00] text-[#1B1B1B]"
          : "border-[#747A60] bg-[#F9F9F9] text-[#444933] hover:bg-[#EEEEEE]"
      }`}
      id={`theme-studio-tab-${tab}`}
      onClick={onClick}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          return;
        }
        event.preventDefault();
        const tabs = Array.from(
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
            '[role="tab"]',
          ) || [],
        );
        const current = tabs.indexOf(event.currentTarget);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
                tabs.length;
        tabs[next]?.focus();
        tabs[next]?.click();
      }}
      role="tab"
      tabIndex={active ? 0 : -1}
      type="button"
    >
      {label}
    </button>
  );
}
