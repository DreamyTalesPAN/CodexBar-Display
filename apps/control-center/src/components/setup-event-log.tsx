"use client";

import {
  ArrowDown,
  CircleCheck,
  CircleDot,
  CircleMinus,
  CircleX,
  RotateCw,
} from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SetupEvent, SetupLog } from "./control-center-types";
import { formatCustomerSupportText, humanize } from "./customer-support-text";

export const SETUP_EVENTS_POLL_MS = 2000;

export type LoadSetupEvents = () => Promise<SetupLog | null>;

/**
 * The app's reader for GET /v1/setup/events. A context rather than a prop so
 * the Help menu on every setup screen gets the same log without each screen
 * passing it along.
 */
export const SetupEventsContext = createContext<LoadSetupEvents | null>(null);

const STAGE_LABELS: Record<string, string> = {
  device_search: "VibeTV search",
  device_select: "VibeTV choice",
  device_pair: "Pairing",
  connection_mode: "Connection",
  wifi_setup: "WiFi setup",
  usage_engine: "Usage engine",
  provider_choice: "AI provider choice",
  provider_check: "AI provider check",
  provider_setup: "AI providers",
  display_mode: "Display mode",
  firmware_update: "Firmware update",
  theme_install: "Theme install",
  setup_reset: "New setup",
};

const STATUS: Record<
  string,
  { icon: typeof CircleCheck; text: string; className?: string }
> = {
  started: { icon: CircleDot, text: "Started" },
  succeeded: { icon: CircleCheck, text: "Done" },
  skipped: { icon: CircleMinus, text: "Skipped", className: "text-muted-foreground" },
  retry: { icon: RotateCw, text: "Retrying" },
  failed: { icon: CircleX, text: "Failed", className: "text-destructive" },
};

/**
 * Polls the setup log while the window is visible. Any failed read -- an
 * older Mac App without the log answers 404 -- keeps what was last read.
 */
export function useSetupEvents(): SetupLog | null {
  const load = useContext(SetupEventsContext);
  const [log, setLog] = useState<SetupLog | null>(null);

  useEffect(() => {
    if (!load) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      timer = null;
      if (windowHidden()) {
        return;
      }
      try {
        const next = await load!();
        if (!cancelled && next) {
          setLog(next);
        }
      } catch {
        // Nothing new to show; the next poll tries again.
      }
      if (!cancelled && !windowHidden()) {
        timer = setTimeout(() => void poll(), SETUP_EVENTS_POLL_MS);
      }
    }

    function onVisibilityChange() {
      if (!windowHidden() && timer === null) {
        void poll();
      }
    }

    void poll();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [load]);

  return log;
}

function windowHidden() {
  return document.visibilityState === "hidden";
}

export function SetupEventLog({ className }: { className?: string }) {
  const log = useSetupEvents();
  return <SetupEventList className={className} log={log} />;
}

export function SetupEventList({
  className,
  log,
}: {
  className?: string;
  log: SetupLog | null;
}) {
  const scrollRef = useRef<HTMLOListElement | null>(null);
  const [following, setFollowing] = useState(true);
  const events = log?.events ?? [];
  const newest = events.at(-1);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (node && following) {
      node.scrollTop = node.scrollHeight;
    }
  }, [following, newest?.seq, newest?.count]);

  if (!events.length) {
    return (
      <p className={cn("rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground", className)}>
        No setup activity recorded yet.
      </p>
    );
  }

  return (
    <div className={cn("relative", className)}>
      <ol
        aria-label="Setup log"
        aria-live="polite"
        className="max-h-[280px] overflow-y-auto rounded-lg border font-mono text-xs"
        onScroll={(event) => {
          const node = event.currentTarget;
          setFollowing(node.scrollHeight - node.scrollTop - node.clientHeight < 8);
        }}
        ref={scrollRef}
        tabIndex={0}
      >
        {log?.truncated ? (
          <li className="px-3 py-2 text-muted-foreground">
            Older entries were removed.
          </li>
        ) : null}
        {events.map((event) => (
          <SetupEventRow event={event} key={event.seq} />
        ))}
      </ol>
      {following ? null : (
        <Button
          className="absolute right-2 bottom-2"
          onClick={() => setFollowing(true)}
          size="sm"
          type="button"
          variant="secondary"
        >
          <ArrowDown data-icon="inline-start" aria-hidden />
          <span>Jump to latest</span>
        </Button>
      )}
    </div>
  );
}

function SetupEventRow({ event }: { event: SetupEvent }) {
  const status = STATUS[event.status] ?? STATUS.started;
  const Icon = status.icon;
  return (
    <li className="grid gap-0.5 border-b px-3 py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <time className="text-muted-foreground tabular-nums" dateTime={event.at}>
          {formatClock(event.at)}
        </time>
        <span className="font-semibold">
          {STAGE_LABELS[event.stage] ?? humanize(event.stage)}
        </span>
        <span className={cn("flex items-center gap-1", status.className)}>
          <Icon aria-hidden className="size-3.5 shrink-0" />
          <span>{status.text}</span>
        </span>
        {event.count && event.count > 1 ? (
          <span
            aria-label={"Repeated " + event.count + " times"}
            className="text-muted-foreground"
          >
            {event.count + " times"}
          </span>
        ) : null}
      </div>
      <p className="break-words">{formatCustomerSupportText(event.message)}</p>
      {event.status === "failed" && event.nextAction ? (
        <p className="break-words text-muted-foreground">
          {formatCustomerSupportText(event.nextAction)}
        </p>
      ) : null}
    </li>
  );
}

function formatClock(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--:--";
  }
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
