"use client";

import {
  Activity,
  AlertTriangle,
  Clock,
  RefreshCw,
} from "lucide-react";

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
    <div className="mx-auto max-w-[1180px]">
      <section className="border-b border-[#747A60] py-10">
        <div className="mb-6 flex items-center justify-between gap-4">
          <h3 className="text-base font-bold text-[#1B1B1B]">Timeline</h3>
          {onRefresh ? (
            <button
              className="inline-flex h-11 items-center justify-center gap-2 border border-[#747A60] bg-[#F9F9F9] px-4 text-sm font-semibold text-[#1B1B1B] transition hover:bg-[#EEEEEE] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busyAction === "logs"}
              onClick={onRefresh}
              type="button"
            >
              {busyAction === "logs" ? (
                <RefreshCw className="animate-spin" size={18} />
              ) : (
                <RefreshCw size={18} aria-hidden />
              )}
              <span>{busyAction === "logs" ? "Refreshing..." : "Refresh"}</span>
            </button>
          ) : null}
        </div>

        {lastError ? (
          <div className="mb-6 border border-[#747A60] bg-[#EEEEEE] p-4 text-sm leading-6 text-[#444933]">
            <div className="mb-1 flex items-center gap-2 font-bold text-[#1B1B1B]">
              <AlertTriangle size={17} aria-hidden />
              {lastError.message}
            </div>
            {lastError.nextAction}
          </div>
        ) : null}

        {events.length ? (
          <ol className="grid gap-0 border-y border-[#747A60]">
            {events.map((event) => (
              <li
                className="grid gap-4 border-b border-[#747A60] py-5 last:border-b-0 md:grid-cols-[58px_minmax(0,1fr)_120px]"
                key={event.id}
              >
                <div className="grid size-12 place-items-center rounded-full bg-[#1B1B1B] text-[#CCFF00]">
                  <Activity size={23} aria-hidden />
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-[#1B1B1B]">{event.label}</div>
                  {event.detail ? (
                    <div className="mt-1 text-sm leading-6 text-[#444933]">
                      {event.detail}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 text-sm text-[#444933] md:justify-end">
                  <Clock size={15} aria-hidden />
                  {event.timestamp || "Session"}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="border border-[#747A60] p-6 text-sm text-[#444933]">
            Activity will appear after the next bridge check.
          </div>
        )}
      </section>
    </div>
  );
}
