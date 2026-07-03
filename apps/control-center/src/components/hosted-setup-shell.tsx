"use client";

import { ListChecks } from "lucide-react";
import type { ReactNode } from "react";
import type { CompanionStatus } from "./control-center-types";

type HostedSetupShellProps = {
  children: ReactNode;
  companionStatus: CompanionStatus;
  setupComplete: boolean;
};

export function HostedSetupShell({
  children,
  companionStatus,
  setupComplete,
}: HostedSetupShellProps) {
  const ready = companionStatus === "online" || setupComplete;
  const statusLabel = ready ? "Opening local Control Center" : "Setup needed";
  const statusDotClass = ready ? "bg-[#CCFF00]" : "bg-[#747A60]";

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
            <button
              aria-current="page"
              className="flex h-[72px] w-full items-center gap-5 border-b border-[#444933] bg-[#CCFF00] px-9 text-left text-lg text-[#1B1B1B] transition"
              type="button"
            >
              <span className="grid size-7 place-items-center">
                <ListChecks size={22} aria-hidden />
              </span>
              <span className="min-w-0 truncate">Setup</span>
            </button>
          </nav>
        </aside>

        <section className="min-w-0">
          <header className="flex h-[86px] items-center justify-between border-b border-[#747A60] bg-[#F9F9F9] px-7 lg:px-10">
            <div className="hidden min-w-0 lg:block">
              <h1 className="truncate text-xl font-semibold text-[#1B1B1B]">
                Setup
              </h1>
            </div>

            <div className="hidden items-center gap-8 lg:flex">
              <div className="inline-flex items-center gap-3 text-base text-[#1B1B1B]">
                <span className={`size-2 rounded-full ${statusDotClass}`} />
                <span>{statusLabel}</span>
              </div>
            </div>

            <div className="flex w-full min-w-0 items-center gap-2 overflow-x-auto lg:hidden">
              <button
                aria-current="page"
                aria-label="Setup"
                className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 bg-[#CCFF00] px-3 text-sm font-semibold text-[#1B1B1B]"
                type="button"
              >
                <ListChecks size={22} aria-hidden />
                <span className="sr-only min-[560px]:not-sr-only">Setup</span>
              </button>
              <div className="ml-auto inline-flex shrink-0 items-center gap-3 text-sm text-[#1B1B1B]">
                <span className={`size-2 rounded-full ${statusDotClass}`} />
                <span>{statusLabel}</span>
              </div>
            </div>
          </header>

          <div className="px-7 py-0 lg:px-10">{children}</div>
        </section>
      </div>
    </main>
  );
}
