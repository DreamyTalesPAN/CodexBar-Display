"use client";

import { CircleCheck, CircleX, Stethoscope, TriangleAlert, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { SupportDiagnostics, UsageEngineInfo } from "./control-center-types";
import {
  formatCustomerPath,
  formatCustomerSupportText,
  humanize,
} from "./customer-support-text";

type Check = NonNullable<SupportDiagnostics["checks"]>[number];

const CHECK_LABELS: Record<string, string> = {
  companion_api: "Mac App",
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

const ENGINE_SOURCES: Record<string, string> = {
  bundled: "Built into VibeTV",
  app_managed: "Managed by VibeTV",
  override: "Custom location",
  system: "Installed app",
  path: "Command line install",
};

const ENGINE_STATUS: Record<string, string> = {
  ready: "Ready",
  not_configured: "Not installed",
  config_error: "Settings need attention",
  engine_error: "Not working",
  engine_incompatible: "Too old",
};

type Props = {
  /** The same snapshot the support report downloads. */
  diagnostics?: SupportDiagnostics | null;
  running?: boolean;
  onRun?: () => void;
  /** The app's usage engine repair; offered for an engine that is too old. */
  onRepairUsageEngine?: () => void;
  repairing?: boolean;
};

export function DiagnosticsPanel({
  diagnostics,
  running = false,
  onRun,
  onRepairUsageEngine,
  repairing = false,
}: Props) {
  const engine = diagnosticsEngine(diagnostics);
  const checks = diagnostics?.checks ?? [];
  const partial =
    Boolean(diagnostics?.collectionErrors?.length) ||
    diagnostics?.reportType === "control_center_fallback";

  return (
    <div className="grid gap-4" data-testid="diagnostics-panel">
      <div>
        <Button
          className="w-full sm:w-auto"
          disabled={running || !onRun}
          onClick={onRun}
          type="button"
          variant="outline"
        >
          {running ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <Stethoscope data-icon="inline-start" aria-hidden />
          )}
          <span>{running ? "Running diagnostics" : "Run diagnostics"}</span>
        </Button>
      </div>
      <p aria-live="polite" className="sr-only" role="status">
        {running ? "Running diagnostics" : diagnostics ? "Diagnostics ready" : ""}
      </p>

      {diagnostics ? (
        <>
          {partial ? (
            <StatusLine icon="attention" text="Some checks could not run." />
          ) : null}
          {engine ? (
            <UsageEngineBlock
              engine={engine}
              onRepair={onRepairUsageEngine}
              repairing={repairing}
            />
          ) : null}
          {checks.length ? (
            <ul aria-label="Diagnostic checks" className="grid gap-2">
              {checks.map((check, index) => (
                <CheckRow check={check} key={check.name + "-" + index} />
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** providerSetup.engine is authoritative; usageEngine fills what it lacks. */
export function diagnosticsEngine(
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

export function usageEngineTooOldText(engine: UsageEngineInfo): string {
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
  const tooOld = engine.status === "engine_incompatible";
  return (
    <section aria-label="Usage engine" className="grid gap-3 rounded-lg border p-3">
      <h3 className="text-sm font-semibold">Usage engine</h3>
      {tooOld ? (
        <div className="grid gap-2">
          <StatusLine icon="fail" text={usageEngineTooOldText(engine)} />
          {onRepair ? (
            <div>
              <Button
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
        </div>
      ) : null}
      <dl className="grid gap-2 sm:grid-cols-2">
        <Fact label="Status" value={ENGINE_STATUS[engine.status ?? ""] ?? humanize(engine.status)} />
        <Fact label="Version" value={engine.version} />
        <Fact label="Required version" value={engine.minimumVersion} />
        <Fact label="Source" value={ENGINE_SOURCES[engine.source ?? ""] ?? humanize(engine.source)} />
        <div className="min-w-0 sm:col-span-2">
          <Fact label="Location" value={engine.path ? formatCustomerPath(engine.path) : undefined} />
        </div>
      </dl>
    </section>
  );
}

function CheckRow({ check }: { check: Check }) {
  const state = checkState(check.status);
  return (
    <li className="grid gap-1 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {CHECK_LABELS[check.name] ?? humanize(check.name)}
        </span>
        <StatusLine icon={state} text={CHECK_STATE_TEXT[state]} />
      </div>
      {check.detail ? (
        <p className="break-words text-sm text-muted-foreground">
          {formatCustomerSupportText(check.detail)}
        </p>
      ) : null}
      {state !== "pass" && check.nextAction ? (
        <p className="break-words text-sm">
          {formatCustomerSupportText(check.nextAction)}
        </p>
      ) : null}
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

function Fact({ label, value }: { label: string; value?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/50 p-3">
      <dt className="text-xs font-semibold uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium">{value || "Not available"}</dd>
    </div>
  );
}
