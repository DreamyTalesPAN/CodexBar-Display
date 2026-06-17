"use client";

import {
  Activity,
  AlertTriangle,
  Clock,
  RefreshCw,
  ScrollText,
  Server,
} from "lucide-react";
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
    <div className="mx-auto max-w-[1180px]">
      <section className="grid min-h-[330px] items-center gap-10 border-b border-[#747A60] py-10 lg:grid-cols-[minmax(0,560px)_minmax(360px,1fr)]">
        <div className="min-w-0">
          <div className="flex items-start gap-5">
            <HeroIcon>
              <ScrollText size={36} aria-hidden />
            </HeroIcon>
            <div className="min-w-0">
              <h2 className="max-w-[560px] text-[clamp(2.7rem,4.8vw,4.5rem)] font-black leading-[1.05] tracking-normal text-[#1B1B1B]">
                Session activity
              </h2>
              <p className="mt-5 text-xl leading-8 text-[#444933]">
                A clean view of what happened in this browser session.
                Persistent history comes later.
              </p>
            </div>
          </div>
        </div>

        <dl className="grid gap-0 border-y border-[#747A60]">
          <StatusRow
            icon={<Activity size={18} aria-hidden />}
            label="Events"
            value={`${events.length}`}
          />
          <StatusRow
            icon={<Server size={18} aria-hidden />}
            label="Source"
            value="Local session"
          />
          <StatusRow
            icon={<AlertTriangle size={18} aria-hidden />}
            label="Last error"
            value={lastError ? lastError.code : "None"}
          />
        </dl>
      </section>

      <section className="border-b border-[#747A60] py-8">
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
            No events in this session yet.
          </div>
        )}
      </section>

      <section className="py-8">
        <h3 className="mb-5 text-base font-bold text-[#1B1B1B]">MVP note</h3>
        <p className="max-w-2xl text-sm leading-6 text-[#444933]">
          Persistent Companion event history is not available in this MVP. This
          screen intentionally shows only local browser-session activity.
        </p>
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
