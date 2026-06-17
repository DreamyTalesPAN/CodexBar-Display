"use client";

import { Activity, Clock, RefreshCw, ScrollText } from "lucide-react";
import type { ReactNode } from "react";

export type LogEvent = {
  id: string;
  label: string;
  detail?: string;
  timestamp?: string;
};

export type LogsScreenProps = {
  events?: LogEvent[];
  lastError?: {
    code: string;
    message: string;
    nextAction: string;
  } | null;
  onRefresh?: () => void;
  busyAction?: string | null;
};

export function LogsScreen({
  events = [],
  lastError,
  onRefresh,
  busyAction,
}: LogsScreenProps) {
  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="border border-[#747A60] bg-[#F9F9F9]">
        <SectionHeader
          detail="Local session only"
          icon={<ScrollText size={17} aria-hidden />}
          title="Logs"
        />
        <div className="space-y-4 p-4">
          <div className="border border-[#747A60] bg-[#EEEEEE] p-4">
            <h2 className="text-lg font-semibold text-[#1B1B1B]">
              Persistente Logs sind noch nicht verfügbar
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#444933]">
              Dieser Screen kann lokale Session-Events anzeigen. Ein Companion
              Event-History-Endpoint existiert im MVP noch nicht.
            </p>
          </div>

          {onRefresh ? (
            <button
              className="inline-flex h-10 items-center gap-2 border border-[#747A60] bg-[#F9F9F9] px-3 text-sm font-semibold text-[#1B1B1B] transition hover:bg-[#EEEEEE] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busyAction === "logs"}
              onClick={onRefresh}
              type="button"
            >
              {busyAction === "logs" ? (
                <RefreshCw className="animate-spin" size={16} />
              ) : (
                <RefreshCw size={16} aria-hidden />
              )}
              <span>{busyAction === "logs" ? "Lädt..." : "Aktualisieren"}</span>
            </button>
          ) : null}

          <div className="divide-y divide-[#747A60] border border-[#747A60]">
            {events.length ? (
              events.map((event) => (
                <article
                  className="grid gap-2 bg-[#F9F9F9] p-3 sm:grid-cols-[150px_minmax(0,1fr)]"
                  key={event.id}
                >
                  <div className="flex items-center gap-2 text-xs text-[#747A60]">
                    <Clock size={14} aria-hidden />
                    <span>{event.timestamp || "Session"}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[#1B1B1B]">
                      {event.label}
                    </div>
                    {event.detail ? (
                      <div className="mt-1 text-sm leading-6 text-[#444933]">
                        {event.detail}
                      </div>
                    ) : null}
                  </div>
                </article>
              ))
            ) : (
              <div className="bg-[#F9F9F9] p-4 text-sm leading-6 text-[#444933]">
                Noch keine lokalen Session-Events übergeben.
              </div>
            )}
          </div>
        </div>
      </section>

      <aside className="grid content-start gap-4">
        <section className="border border-[#747A60] bg-[#F9F9F9]">
          <SectionHeader
            detail="fehlt noch"
            icon={<Activity size={17} aria-hidden />}
            title="Benötigte API"
          />
          <div className="space-y-3 p-4 text-sm leading-6 text-[#444933]">
            <MissingItem label="Persistent Companion event history endpoint" />
            <MissingItem label="Severity und event type model" />
            <MissingItem label="Timestamped device/write/read events" />
          </div>
        </section>

        {lastError ? (
          <section className="border border-[#747A60] bg-[#F9F9F9]">
            <SectionHeader
              detail={lastError.code}
              icon={<ScrollText size={17} aria-hidden />}
              title="Letzter Fehler"
            />
            <div className="p-4">
              <div className="border border-[#747A60] bg-[#EEEEEE] p-3 text-sm leading-6 text-[#444933]">
                <div className="font-semibold text-[#1B1B1B]">
                  {lastError.message}
                </div>
                <div className="mt-1">{lastError.nextAction}</div>
              </div>
            </div>
          </section>
        ) : null}
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

function MissingItem({ label }: { label: string }) {
  return (
    <div className="border border-[#747A60] bg-[#EEEEEE] p-3">
      <div className="font-semibold text-[#1B1B1B]">{label}</div>
      <div className="mt-1 text-[#444933]">Noch nicht implementiert.</div>
    </div>
  );
}
