"use client";

import {
  ArrowUpFromLine,
  Clock3,
  Monitor,
  RefreshCw,
  Server,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";

export type UpdatesCompanionStatus = "unknown" | "online" | "missing";

export type UpdatesDeviceInfo = {
  connected: boolean;
  board?: string;
  firmware?: string;
};

export type UpdatesScreenProps = {
  companionStatus: UpdatesCompanionStatus;
  device: UpdatesDeviceInfo | null;
  companionVersion?: string;
  onCheckBridge?: () => void;
  busyAction?: string | null;
};

export function UpdatesScreen({
  companionStatus,
  device,
  companionVersion,
  onCheckBridge,
  busyAction,
}: UpdatesScreenProps) {
  return (
    <div className="mx-auto max-w-[1180px]">
      <section className="grid min-h-[330px] items-center gap-10 border-b border-[#747A60] py-10 lg:grid-cols-[minmax(0,560px)_minmax(360px,1fr)]">
        <div className="min-w-0">
          <div className="flex items-start gap-5">
            <HeroIcon>
              <ArrowUpFromLine size={36} aria-hidden />
            </HeroIcon>
            <div className="min-w-0">
              <h2 className="max-w-[560px] text-[clamp(2.7rem,4.8vw,4.5rem)] font-black leading-[1.05] tracking-normal text-[#1B1B1B]">
                Updates are not available yet
              </h2>
              <p className="mt-5 text-xl leading-8 text-[#444933]">
                This MVP shows known local versions only. It does not start a
                firmware update flow.
              </p>
            </div>
          </div>
        </div>

        <dl className="grid gap-0 border-y border-[#747A60]">
          <StatusRow
            icon={<Server size={18} aria-hidden />}
            label="Bridge"
            value={companionStatus === "online" ? "Online" : "Check"}
          />
          <StatusRow
            icon={<RefreshCw size={18} aria-hidden />}
            label="Companion"
            value={companionVersion || "Unknown"}
          />
          <StatusRow
            icon={<Monitor size={18} aria-hidden />}
            label="Firmware"
            value={device?.firmware || "Unknown"}
          />
        </dl>
      </section>

      <section className="grid gap-8 border-b border-[#747A60] py-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          <h3 className="mb-5 text-base font-bold text-[#1B1B1B]">
            Current state
          </h3>
          <dl className="grid gap-5 md:grid-cols-3">
            <Fact
              icon={<Server size={28} aria-hidden />}
              label="Companion"
              value={companionVersion || "Unknown"}
            />
            <Fact
              icon={<Monitor size={28} aria-hidden />}
              label="Device firmware"
              value={device?.firmware || "Unknown"}
            />
            <Fact
              icon={<ShieldCheck size={28} aria-hidden />}
              label="Board"
              value={device?.board || "Unknown"}
            />
          </dl>
        </div>

        <aside className="border border-[#747A60] p-5">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-base font-bold text-[#1B1B1B]">Action</h3>
            <span className="text-sm text-[#506600]">Read-only</span>
          </div>
          <p className="mt-4 text-sm leading-6 text-[#444933]">
            The only live action here is checking the local bridge. Firmware
            update writes stay out of scope for this screen.
          </p>
          {onCheckBridge ? (
            <button
              className="mt-5 inline-flex h-12 items-center justify-center gap-2 border border-[#747A60] bg-[#F9F9F9] px-4 text-sm font-semibold text-[#1B1B1B] transition hover:bg-[#EEEEEE] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busyAction === "status"}
              onClick={onCheckBridge}
              type="button"
            >
              {busyAction === "status" ? (
                <RefreshCw className="animate-spin" size={18} />
              ) : (
                <RefreshCw size={18} aria-hidden />
              )}
              <span>{busyAction === "status" ? "Checking..." : "Check bridge"}</span>
            </button>
          ) : null}
        </aside>
      </section>

      <section className="py-8">
        <h3 className="mb-5 text-base font-bold text-[#1B1B1B]">
          Future update readiness
        </h3>
        <dl className="grid gap-5 md:grid-cols-3">
          <MissingItem label="Update endpoint" value="Not implemented" />
          <MissingItem label="Version channel" value="Not implemented" />
          <MissingItem label="Customer-safe flow" value="Not implemented" />
        </dl>
      </section>
    </div>
  );
}

function HeroIcon({ children }: { children: ReactNode }) {
  return (
    <div className="grid size-16 shrink-0 place-items-center rounded-full border border-[#747A60] bg-[#EEEEEE] text-[#1B1B1B]">
      {children}
    </div>
  );
}

function StatusRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="grid min-h-[54px] grid-cols-[28px_1fr_150px] items-start gap-3 border-b border-[#747A60] py-3 last:border-b-0">
      <div className="pt-0.5 text-[#506600]">{icon}</div>
      <dt className="font-medium text-[#1B1B1B]">{label}</dt>
      <dd className="min-w-0 text-[#1B1B1B]">{value}</dd>
    </div>
  );
}

function Fact({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="grid grid-cols-[38px_minmax(0,1fr)] gap-3 border-r border-[#747A60] pr-5 last:border-r-0">
      <div className="text-[#506600]">{icon}</div>
      <div>
        <dt className="font-bold text-[#1B1B1B]">{label}</dt>
        <dd className="mt-1 truncate text-sm text-[#444933]">{value}</dd>
      </div>
    </div>
  );
}

function MissingItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[34px_minmax(0,1fr)] gap-3 border-r border-[#747A60] pr-5 last:border-r-0">
      <Clock3 size={28} className="text-[#506600]" aria-hidden />
      <div>
        <dt className="font-bold text-[#1B1B1B]">{label}</dt>
        <dd className="mt-1 text-sm text-[#444933]">{value}</dd>
      </div>
    </div>
  );
}
