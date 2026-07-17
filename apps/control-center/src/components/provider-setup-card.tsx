"use client";

import {
  AlertTriangle,
  Check,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { ControlCenterButton } from "./control-center-button";
import type {
  ProviderReadinessInfo,
  ProviderReadinessStatus,
  ProviderSetupInfo,
} from "./control-center-types";

type ProviderSetupCardProps = {
  busyAction?: string | null;
  providerSetup: ProviderSetupInfo;
  onOpenCodexBar?: () => void;
  onRetry?: () => void;
};

export function ProviderSetupCard({
  busyAction,
  providerSetup,
  onOpenCodexBar,
  onRetry,
}: ProviderSetupCardProps) {
  const checking =
    providerSetup.status === "checking" || busyAction === "providers-retry";
  const issues = providerIssues(providerSetup);
  const ready = providerSetupIsReady(providerSetup);

  if (ready) {
    return (
      <div
        className="inline-flex min-h-12 items-center gap-2 border border-[#747A60] bg-[#F9F9F9] px-4 py-2 text-sm font-semibold text-[#444933]"
        role="status"
      >
        <Check size={16} aria-hidden />
        <span>{providerReadyLabel(providerSetup)}</span>
      </div>
    );
  }

  return (
    <section
      aria-labelledby="provider-setup-title"
      className="grid gap-5 border border-[#747A60] bg-[#F9F9F9] p-5"
    >
      <div className="flex items-start gap-3">
        {checking ? (
          <Loader2
            className="mt-0.5 shrink-0 animate-spin text-[#506600]"
            size={20}
            aria-hidden
          />
        ) : (
          <AlertTriangle
            className="mt-0.5 shrink-0 text-[#506600]"
            size={20}
            aria-hidden
          />
        )}
        <div className="min-w-0">
          <h4
            className="text-xl font-black text-[#1B1B1B]"
            id="provider-setup-title"
          >
            {checking ? "Checking AI providers" : "Connect an AI provider"}
          </h4>
          <p className="mt-1 text-sm leading-6 text-[#444933]">
            {checking
              ? "CodexBar is checking your provider sign-ins and usage limits."
              : providerSetupSummary(providerSetup)}
          </p>
        </div>
      </div>

      {!checking && issues.length > 0 ? (
        <ul className="grid gap-0 border-y border-[#747A60]">
          {issues.map((provider) => (
            <li
              className="grid gap-1 border-b border-[#747A60] py-3 last:border-b-0 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-4"
              key={`${provider.id}-${provider.status}`}
            >
              <span className="break-words text-sm font-black text-[#1B1B1B]">
                {provider.label || providerName(provider.id)}
              </span>
              <span className="break-words text-sm leading-6 text-[#444933]">
                {providerIssueDetail(provider)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {onOpenCodexBar ? (
          <ControlCenterButton
            busy={busyAction === "providers-open"}
            busyLabel="Opening CodexBar"
            disabled={checking}
            fullWidth
            icon={<ExternalLink size={18} aria-hidden />}
            label="Open CodexBar"
            onClick={onOpenCodexBar}
            size="large"
            variant="primary"
          />
        ) : null}
        {onRetry ? (
          <ControlCenterButton
            busy={busyAction === "providers-retry"}
            busyLabel="Checking"
            disabled={checking}
            fullWidth
            icon={<RefreshCw size={18} aria-hidden />}
            label="Check again"
            onClick={onRetry}
            size="large"
            variant="secondary"
          />
        ) : null}
      </div>
    </section>
  );
}

export function providerSetupIsReady(
  providerSetup: ProviderSetupInfo | null | undefined,
): boolean {
  if (!providerSetup) {
    return false;
  }
  if (normalizeStatus(providerSetup.status) === "ready") {
    return true;
  }
  if (providerSetup.status) {
    return false;
  }
  return Boolean(
    providerSetup.providers?.some(
      (provider) => normalizeStatus(provider.status) === "ready",
    ),
  );
}

export function providerSetupNeedsAction(
  providerSetup: ProviderSetupInfo | null | undefined,
): boolean {
  if (!providerSetup || providerSetupIsReady(providerSetup)) {
    return false;
  }
  const status = normalizeStatus(providerSetup.status);
  if (status === "checking") {
    return false;
  }
  if (status) {
    return true;
  }
  return Boolean(
    providerSetup.engine || (providerSetup.providers?.length || 0) > 0,
  );
}

export function providerSetupStatusLabel(
  providerSetup: ProviderSetupInfo | null | undefined,
): string {
  if (!providerSetup) {
    return "Checking";
  }
  if (providerSetupIsReady(providerSetup)) {
    const readyProvider = providerSetup.providers?.find(
      (provider) => normalizeStatus(provider.status) === "ready",
    );
    return readyProvider?.label || providerName(readyProvider?.id) || "Ready";
  }
  if (normalizeStatus(providerSetup.status) === "checking") {
    return "Checking";
  }
  const issue = providerIssues(providerSetup)[0];
  if (issue) {
    return providerStatusLabel(issue.status);
  }
  const engineStatus = normalizeStatus(providerSetup.engine?.status);
  if (engineStatus === "not_configured") {
    return "CodexBar setup needed";
  }
  if (engineStatus === "config_error") {
    return "CodexBar settings need attention";
  }
  return "Setup needed";
}

export function providerSetupStatusDetail(
  providerSetup: ProviderSetupInfo | null | undefined,
): string | undefined {
  if (!providerSetup || providerSetupIsReady(providerSetup)) {
    return undefined;
  }
  const issue = providerIssues(providerSetup)[0];
  if (issue) {
    return providerIssueDetail(issue);
  }
  return (
    providerSetup.detail?.trim() ||
    providerSetup.engine?.detail?.trim() ||
    providerSetup.nextAction?.trim() ||
    providerSetup.engine?.nextAction?.trim() ||
    "Open CodexBar and connect a provider that exposes usage limits."
  );
}

function providerIssues(providerSetup: ProviderSetupInfo) {
  const providers = (providerSetup.providers || []).filter(
    (provider) => normalizeStatus(provider.status) !== "ready",
  );
  const currentProvider = providerSetup.currentProvider?.trim();
  if (!currentProvider) {
    return providers;
  }
  return providers.sort((left, right) => {
    if (left.id === currentProvider) {
      return -1;
    }
    if (right.id === currentProvider) {
      return 1;
    }
    return 0;
  });
}

function providerSetupSummary(providerSetup: ProviderSetupInfo): string {
  const issue = providerIssues(providerSetup)[0];
  if (issue) {
    return providerIssueDetail(issue);
  }
  return (
    providerSetup.detail?.trim() ||
    providerSetup.engine?.detail?.trim() ||
    providerSetup.nextAction?.trim() ||
    providerSetup.engine?.nextAction?.trim() ||
    "Open CodexBar and connect a provider that exposes usage limits."
  );
}

function providerReadyLabel(providerSetup: ProviderSetupInfo): string {
  const readyProvider = providerSetup.providers?.find(
    (provider) => normalizeStatus(provider.status) === "ready",
  );
  const name = readyProvider?.label || providerName(readyProvider?.id);
  return name ? `${name} is ready.` : "AI provider is ready.";
}

function providerIssueDetail(provider: ProviderReadinessInfo): string {
  const detail = provider.detail?.trim() || provider.nextAction?.trim();
  if (detail) {
    return detail;
  }
  const name = provider.label || providerName(provider.id) || "This provider";
  switch (normalizeStatus(provider.status)) {
    case "auth_required":
      return `Sign in to ${name} in CodexBar, then check again.`;
    case "permission_required":
      return `${name} needs permission to read your sign-in. Open CodexBar and allow access, then check again.`;
    case "no_usage_available":
      return `${name} is connected, but this account does not expose usage limits. Choose another provider.`;
    case "timeout":
      return `${name} did not answer in time. Open CodexBar, confirm the sign-in, then check again.`;
    case "config_error":
      return "CodexBar could not save its provider settings. Open CodexBar and finish provider setup there.";
    case "engine_error":
      return "CodexBar needs attention before VibeTV can read provider usage.";
    case "not_configured":
      return `Open CodexBar and connect ${name}, then check again.`;
    default:
      return `Open CodexBar and finish setting up ${name}.`;
  }
}

function providerStatusLabel(status: ProviderReadinessStatus): string {
  switch (normalizeStatus(status)) {
    case "auth_required":
      return "Sign-in needed";
    case "permission_required":
      return "Permission needed";
    case "no_usage_available":
      return "No usage limits";
    case "timeout":
      return "Check timed out";
    case "config_error":
      return "Settings need attention";
    case "engine_error":
      return "CodexBar needs attention";
    case "not_configured":
      return "Not configured";
    default:
      return "Setup needed";
  }
}

function providerName(id: string | undefined): string {
  if (!id) {
    return "";
  }
  const known: Record<string, string> = {
    claude: "Claude",
    codex: "Codex",
    copilot: "Copilot",
    cursor: "Cursor",
    gemini: "Gemini",
  };
  return (
    known[id.toLowerCase()] ||
    id.charAt(0).toUpperCase() + id.slice(1).replace(/[-_]+/g, " ")
  );
}

function normalizeStatus(value: string | undefined): string {
  return value?.trim().toLowerCase().replace(/^provider_/, "") || "";
}
