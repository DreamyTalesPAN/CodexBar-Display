"use client";

import { CircleCheck, CircleX, RefreshCw, TriangleAlert, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { copyForHost } from "@/lib/customer-platform";
import type { SupportDiagnostics, UsageEngineInfo } from "./control-center-types";
import {
  formatCustomerSupportText,
  humanize,
} from "./customer-support-text";

/** The frame around one object on Support: a card with a hairline ring. */
export const SUPPORT_FRAME =
  "overflow-hidden rounded-[var(--radius-card)] bg-card ring-1 ring-foreground/10";

type Check = NonNullable<SupportDiagnostics["checks"]>[number];

const CHECK_LABELS: Record<string, string> = {
  companion_api: "App",
  usage_engine: "Usage engine",
  provider_setup: "AI provider",
  network_discovery: "WiFi search",
  device_target: "VibeTV address",
  device_hello: "VibeTV reachable",
  device_health: "VibeTV health",
  display_render: "Display image",
  display_stream: "Display updates",
  firmware_update: "Firmware update",
  theme_install_gate: "Theme install",
};

type Props = {
  /** The same snapshot the support report downloads. */
  diagnostics?: SupportDiagnostics | null;
  running?: boolean;
  onRun?: () => void;
  /** The app's usage engine repair; offered for an unusable engine. */
  onRepairUsageEngine?: () => void;
  repairing?: boolean;
  /** The app runs on Windows, where "Mac App" reads "App". */
  windowsHost?: boolean;
};

export function DiagnosticsPanel({
  diagnostics,
  running = false,
  onRun,
  onRepairUsageEngine,
  repairing = false,
  windowsHost = false,
}: Props) {
  const engine = diagnosticsEngine(diagnostics);
  const engineBlock = engine?.status === "engine_incompatible";
  const checks = diagnostics?.checks ?? [];
  const passed = checks.filter((check) => check.status === "pass").length;
  const partial =
    Boolean(diagnostics?.collectionErrors?.length) ||
    diagnostics?.reportType === "control_center_fallback";

  return (
    <section className="grid gap-3" data-testid="diagnostics-panel">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h2 className="text-[15px] leading-5 font-semibold">Diagnostics</h2>
        <div className="flex flex-wrap items-center gap-3.5">
          {checks.length ? (
            <span className="text-muted-foreground">
              {`${passed} of ${checks.length} passed`}
            </span>
          ) : null}
          <Button
            className="gap-2 px-3.5 text-sm has-data-[icon=inline-start]:pl-3.5 [&_svg:not([class*='size-'])]:size-4"
            disabled={running || !onRun}
            onClick={onRun}
            size="sm"
            type="button"
          >
            {running ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RefreshCw data-icon="inline-start" aria-hidden />
            )}
            <span>{running ? "Running diagnostics" : "Run diagnostics"}</span>
          </Button>
        </div>
      </div>
      <p aria-live="polite" className="sr-only" role="status">
        {running ? "Running diagnostics" : diagnostics ? "Diagnostics ready" : ""}
      </p>

      {diagnostics ? (
        <>
          {partial ? (
            <StatusLine icon="attention" text="Some checks could not run." />
          ) : null}
          {engineBlock ? (
            <UsageEngineBlock
              engine={engine}
              onRepair={onRepairUsageEngine}
              repairing={repairing}
            />
          ) : null}
          {checks.length ? (
            <ul aria-label="Diagnostic checks" className={SUPPORT_FRAME}>
              {checks.map((check, index) => (
                // Match the Companion's engineUnusable rule; restarting cannot
                // repair config errors. The engine block already offers repair.
                <CheckRow
                  check={check}
                  key={check.name + "-" + index}
                  onRepair={
                    check.name === "usage_engine" &&
                    !engineBlock &&
                    (check.errorCode === "engine_error" ||
                      check.errorCode === "engine_incompatible")
                      ? onRepairUsageEngine
                      : undefined
                  }
                  repairing={repairing}
                  windowsHost={windowsHost}
                />
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/** providerSetup.engine is authoritative; usageEngine fills what it lacks. */
function diagnosticsEngine(
  diagnostics?: SupportDiagnostics | null,
): UsageEngineInfo | null {
  const engine = {
    ...diagnostics?.usageEngine,
    ...diagnostics?.providerSetup?.engine,
  };
  if (!engine.status && !engine.version && !engine.path) {
    return null;
  }
  return {
    status: engine.status,
    version: engine.version,
    minimumVersion: engine.minimumVersion,
    path: engine.path,
    source: engine.source,
  };
}

function usageEngineTooOldText(engine: UsageEngineInfo): string {
  const installed = engine.version ? "Usage engine " + engine.version : "The usage engine";
  const required = engine.minimumVersion
    ? " Version " + engine.minimumVersion + " or newer is required."
    : "";
  return installed + " is too old." + required;
}

function UsageEngineBlock({
  engine,
  onRepair,
  repairing,
}: {
  engine: UsageEngineInfo;
  onRepair?: () => void;
  repairing: boolean;
}) {
  return (
    <section aria-label="Usage engine" className="grid gap-2">
      <StatusLine icon="fail" text={usageEngineTooOldText(engine)} />
      {onRepair ? (
        <div>
          <Button
            className="text-sm"
            disabled={repairing}
            onClick={onRepair}
            size="sm"
            type="button"
          >
            {repairing ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Wrench data-icon="inline-start" aria-hidden />
            )}
            <span>{repairing ? "Repairing" : "Repair"}</span>
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Repair the usage engine, then check again.
        </p>
      )}
    </section>
  );
}

function CheckRow({
  check,
  onRepair,
  repairing,
  windowsHost,
}: {
  check: Check;
  onRepair?: () => void;
  repairing: boolean;
  windowsHost: boolean;
}) {
  const state = checkState(check.status);
  const hostText = (value: string) => copyForHost(value, windowsHost);
  // A VibeTV on the cable has no address; the report keeps "cable://vibetv".
  const cable =
    check.name === "device_target" && /^cable:/i.test(check.detail ?? "");
  const Icon =
    state === "pass" ? CircleCheck : state === "fail" ? CircleX : TriangleAlert;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3.5 gap-y-0.5 border-t border-foreground/10 px-5 py-3 first:border-t-0 sm:grid-cols-[auto_160px_minmax(0,1fr)]">
      <Icon
        aria-hidden
        className={
          "size-[18px] shrink-0 " +
          (state === "pass"
            ? "text-[oklch(0.68_0.15_150)]"
            : state === "fail"
              ? "text-destructive"
              : "text-[oklch(0.75_0.16_70)]")
        }
      />
      <span className="font-semibold">
        {cable
          ? "Connection"
          : hostText(CHECK_LABELS[check.name] ?? humanize(check.name))}
      </span>
      <div className="col-start-2 grid min-w-0 gap-1 text-muted-foreground sm:col-start-3">
        {check.detail ? (
          <p className="break-words">
            {cable ? "USB-C cable" : hostText(formatCustomerSupportText(check.detail))}
          </p>
        ) : null}
        {state !== "pass" && check.nextAction ? (
          <p className="break-words">
            {hostText(formatCustomerSupportText(check.nextAction))}
          </p>
        ) : null}
      </div>
      {state === "fail" && onRepair ? (
        <Button
          className="col-start-2 h-auto justify-self-start px-0 font-semibold sm:col-start-4 sm:row-start-1 sm:justify-self-end"
          disabled={repairing}
          onClick={onRepair}
          size="sm"
          type="button"
          variant="link"
        >
          Fix
        </Button>
      ) : null}
      <span className="sr-only">{CHECK_STATE_TEXT[state]}</span>
    </li>
  );
}

type CheckState = "pass" | "attention" | "fail";

const CHECK_STATE_TEXT: Record<CheckState, string> = {
  pass: "Pass",
  attention: "Needs attention",
  fail: "Failed",
};

function checkState(status: string): CheckState {
  if (status === "pass") return "pass";
  if (status === "fail") return "fail";
  return "attention";
}

function StatusLine({ icon, text }: { icon: CheckState; text: string }) {
  const Icon = icon === "pass" ? CircleCheck : icon === "fail" ? CircleX : TriangleAlert;
  return (
    <span
      className={
        "flex items-center gap-1.5 text-sm " +
        (icon === "fail" ? "text-destructive" : icon === "pass" ? "" : "text-muted-foreground")
      }
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <span>{text}</span>
    </span>
  );
}
