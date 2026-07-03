"use client";

import { Check, ExternalLink, Monitor, ShieldCheck } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";
import type { CompanionStatus } from "./control-center-types";

type HostedSetupShellProps = {
  children: ReactNode;
  companionStatus: CompanionStatus;
  selectedThemeTitle?: string;
  setupComplete: boolean;
};

export function HostedSetupShell({
  children,
  companionStatus,
  selectedThemeTitle,
  setupComplete,
}: HostedSetupShellProps) {
  const statusText =
    companionStatus === "online" || setupComplete
      ? "Opening local Control Center"
      : "Mac App needed";

  return (
    <main className="min-h-screen bg-[#F9F9F9] text-[#1B1B1B]">
      <header className="border-b border-[#747A60] bg-[#F9F9F9]">
        <div className="mx-auto flex min-h-20 max-w-[1180px] items-center justify-between gap-5 px-5 md:px-8">
          <div>
            <div className="text-[32px] font-black uppercase leading-none tracking-normal">
              VIBE<span className="text-[#506600]">TV</span>
            </div>
            <div className="mt-1 text-xs font-black uppercase text-[#444933]">
              Setup
            </div>
          </div>
          <a
            className="inline-flex min-h-11 items-center gap-2 border border-[#747A60] px-4 text-sm font-black text-[#1B1B1B] transition hover:bg-[#EEEEEE]"
            href="https://vibetv.shop"
          >
            Shop
            <ExternalLink size={16} aria-hidden />
          </a>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-[#747A60] bg-[#1B1B1B] text-[#EDEDED]">
        <Image
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute bottom-[-52px] right-[-150px] hidden w-[min(58vw,680px)] opacity-95 md:block"
          height={510}
          src="/images/vibetv-device-overview-cutout.png"
          width={570}
        />
        <div className="relative mx-auto max-w-[1180px] px-5 py-10 md:px-8 md:py-14">
          <div className="max-w-[720px]">
            <div className="inline-flex min-h-9 items-center gap-2 border border-[#CCFF00] px-3 text-xs font-black uppercase text-[#CCFF00]">
              <span className="size-2 bg-[#CCFF00]" />
              {statusText}
            </div>
            <h1 className="mt-7 max-w-[760px] text-[clamp(3.2rem,11vw,8rem)] font-black leading-[0.9] tracking-normal">
              Set up VibeTV.
            </h1>
            <p className="mt-7 max-w-[560px] text-base leading-7 text-[#EDEDED] md:text-lg">
              Install the Mac App once. It opens the local Control Center on
              this Mac for daily use.
            </p>
            {selectedThemeTitle ? (
              <p className="mt-4 inline-flex min-h-10 items-center border border-[#CCFF00] bg-[#CCFF00] px-3 text-sm font-black text-[#1B1B1B]">
                Theme selected: {selectedThemeTitle}
              </p>
            ) : null}
          </div>

          <Image
            alt="VibeTV desk display showing a usage screen"
            className="mt-8 w-full max-w-[420px] md:hidden"
            height={510}
            priority
            src="/images/vibetv-device-overview-cutout.png"
            width={570}
          />

          <div className="mt-10 grid max-w-[760px] border-y border-[#747A60] md:grid-cols-3">
            <HostedStep
              icon={<Check size={18} aria-hidden />}
              label="Connect WiFi"
            />
            <HostedStep
              icon={<ShieldCheck size={18} aria-hidden />}
              label="Install Mac App"
            />
            <HostedStep
              icon={<Monitor size={18} aria-hidden />}
              label="Open locally"
            />
          </div>
        </div>
      </section>

      <section className="border-b border-[#747A60]">
        <div className="mx-auto max-w-[1180px] px-5 py-8 md:px-8 lg:py-10">
          <div className="mb-6 flex flex-col gap-2 border-b border-[#747A60] pb-5 md:flex-row md:items-end md:justify-between">
            <h2 className="text-3xl font-black tracking-normal md:text-5xl">
              Setup
            </h2>
            <p className="max-w-[520px] text-sm leading-6 text-[#444933]">
              Keep this page open until the local Control Center opens.
            </p>
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}

function HostedStep({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex min-h-16 items-center gap-3 border-b border-[#747A60] py-4 text-sm font-black uppercase text-[#EDEDED] last:border-b-0 md:border-b-0 md:border-r md:px-4 md:last:border-r-0">
      <span className="grid size-9 shrink-0 place-items-center bg-[#CCFF00] text-[#1B1B1B]">
        {icon}
      </span>
      <span>{label}</span>
    </div>
  );
}
