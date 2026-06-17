"use client";

import { RefreshCw, ShieldCheck, Wrench } from "lucide-react";
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
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="border border-[#747A60] bg-[#F9F9F9]">
        <SectionHeader
          detail="MVP Placeholder"
          icon={<Wrench size={17} aria-hidden />}
          title="Updates"
        />
        <div className="space-y-4 p-4">
          <div className="border border-[#747A60] bg-[#EEEEEE] p-4">
            <h2 className="text-lg font-semibold text-[#1B1B1B]">
              Update-Daten sind noch nicht als API verfügbar
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#444933]">
              Dieser Screen zeigt im MVP nur bekannte lokale Werte. Er behauptet
              keine verfügbare neue Firmware und startet keinen Update-Flow.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Fact
              label="Bridge"
              value={companionStatus === "online" ? "Online" : "Nicht bereit"}
            />
            <Fact
              label="Companion"
              value={companionVersion || "Version nicht geladen"}
            />
            <Fact
              label="Firmware"
              value={device?.firmware || "unbekannt"}
            />
            <Fact label="Board" value={device?.board || "unbekannt"} />
            <Fact
              label="Device"
              value={device?.connected ? "Verbunden" : "Nicht verbunden"}
            />
            <Fact label="Update-Status" value="Noch kein Endpoint" />
          </div>

          {onCheckBridge ? (
            <button
              className="inline-flex h-10 items-center gap-2 border border-[#747A60] bg-[#F9F9F9] px-3 text-sm font-semibold text-[#1B1B1B] transition hover:bg-[#EEEEEE] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busyAction === "status"}
              onClick={onCheckBridge}
              type="button"
            >
              {busyAction === "status" ? (
                <RefreshCw className="animate-spin" size={16} />
              ) : (
                <RefreshCw size={16} aria-hidden />
              )}
              <span>
                {busyAction === "status" ? "Prüft..." : "Bridge prüfen"}
              </span>
            </button>
          ) : null}
        </div>
      </section>

      <aside className="border border-[#747A60] bg-[#F9F9F9]">
        <SectionHeader
          detail="fehlt noch"
          icon={<ShieldCheck size={17} aria-hidden />}
          title="Benötigte API"
        />
        <div className="space-y-3 p-4 text-sm leading-6 text-[#444933]">
          <MissingItem label="Update availability endpoint" />
          <MissingItem label="Update channel, current und latest versions" />
          <MissingItem label="Customer-safe update flow" />
        </div>
      </aside>
    </section>
  );
}

function SectionHeader({
  detail,
  icon,
  title,
}: {
  detail: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-[#747A60] px-4 py-3">
      <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[#1B1B1B]">
        {icon}
        <span className="truncate">{title}</span>
      </div>
      <div className="truncate text-xs text-[#747A60]">{detail}</div>
    </header>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border border-[#747A60] bg-[#EEEEEE] px-3 py-2">
      <div className="text-xs text-[#747A60]">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-[#1B1B1B]">
        {value}
      </div>
    </div>
  );
}

function MissingItem({ label }: { label: string }) {
  return (
    <div className="border border-[#747A60] bg-[#EEEEEE] p-3">
      <div className="font-semibold text-[#1B1B1B]">{label}</div>
      <div className="mt-1 text-[#444933]">Noch nicht implementiert.</div>
    </div>
  );
}
