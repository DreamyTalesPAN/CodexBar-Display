"use client";

import type {
  SupportDiagnostics,
  UsageSnapshot,
} from "../control-center-types";
import { Search, SearchX, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Item, ItemGroup } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SETUP_REVEAL } from "./setup-reveal";
import type { ProviderItem } from "../provider-picker";
import { SetupLog, type SetupLogLine } from "./setup-log";
import { SetupProviderRow, setupProviderIssueMessage } from "./setup-provider-row";
import { SetupDialog } from "./setup-dialog";
import { displayPreviewFor } from "./setup-display-previews";
import {
  SetupWizardScreen,
  SetupWizardSubtitle,
  SetupWizardTitle,
} from "./setup-wizard-screen";

type SetupProvidersScreenProps = {
  aiFixPrompt?: () => string;
  onBack?: () => void;
  onCheckAgain: (provider: ProviderItem) => void;
  onContinue: () => void;
  onCreateSupportReport?: () => Promise<SupportDiagnostics | null>;
  onOpenSignIn?: (provider: ProviderItem) => void;
  onOpenSetupGuide?: () => void;
  onToggle: (provider: ProviderItem, enabled: boolean) => void;
  /** The completion this step asked for has not answered yet. */
  continuing?: boolean;
  /** The Companion is still collecting the first provider inventory. */
  loading?: boolean;
  /** Providers whose exact check is queued or running. */
  pendingCheckIds: Set<string>;
  /** Preferences whose on/off write is in flight, by preference id. */
  pendingPreferenceIds: Set<string>;
  providers: ProviderItem[];
  usage: UsageSnapshot | null;
  /** The app runs on Windows, where "this Mac" reads "this computer". */
  windowsHost?: boolean;
};

/** How many provider rows are on screen before the customer asks for more. */
const PROVIDER_PAGE_SIZE = 10;
export const PROVIDER_LOADING_LOG_INTERVAL_MS = 20_000;

/**
 * The providers whose sign-in the Companion can start (provider_sign_in_launch.go).
 * Every other provider in CodexBar's inventory is listed too; its row keeps
 * the switch, the provider's own message and "Check again".
 */
export const SIGN_IN_PROVIDER_IDS = [
  "codex",
  "claude",
  "cursor",
  "antigravity",
];

/**
 * Health states in which the row offers to start the provider's sign-in.
 *
 * Only the four in SIGN_IN_PROVIDER_IDS have a sign-in the Companion can
 * start. Any other provider would get an action that can only fail, so its
 * row keeps the switch and "Check again", and the provider's own message
 * says what to do.
 */
export function setupProviderOffersSignIn(
  provider: Pick<ProviderItem, "health" | "providerId">,
): boolean {
  const { state, signInUrl } = provider.health;
  // The account lost access to this provider: its own message carries the
  // migration path, and every sign-in here ends on the same refusal.
  if (state === "unsupported") {
    return false;
  }
  if (state === "browser_sign_in_required") {
    // CodexBar named the page itself, so this works for any provider.
    return Boolean(signInUrl);
  }
  if (
    !SIGN_IN_PROVIDER_IDS.includes(provider.providerId.trim().toLowerCase())
  ) {
    return false;
  }
  return state === "auth_required" || state === "setup_required";
}

/**
 * The prerequisite notice for a signed-out provider the app cannot sign in
 * itself: CodexBar reads its usage from the provider's own app, so that app
 * has to be installed and signed in on this computer.
 */
export function setupProviderNeedsOwnApp(
  provider: Pick<ProviderItem, "health" | "providerId">,
): boolean {
  const { state } = provider.health;
  return (
    (state === "auth_required" || state === "setup_required") &&
    !SIGN_IN_PROVIDER_IDS.includes(provider.providerId.trim().toLowerCase())
  );
}

export function setupProviderOwnAppNotice(label: string): string {
  return `VibeTV reads ${label} usage from ${label}'s own app on this computer. Make sure it is installed and signed in, then click Check again.`;
}

/**
 * The message the customer acknowledged, per provider, while the window is
 * open. Outside the list because the list unmounts when the customer leaves
 * Settings: kept in its state alone, the same message opened again on every
 * visit. Only an acknowledgement is kept here; a message the customer asked
 * for (warning icon, Check again, the switch) stays in the list's state.
 */
export const acknowledgedProviderIssues = new Map<string, string>();

type ProviderListProps = {
  className?: string;
  onCheckAgain: (provider: ProviderItem) => void;
  onOpenSignIn?: (provider: ProviderItem) => void;
  /** Present where the provider notice may link the setup guide (Windows). */
  onOpenSetupGuide?: () => void;
  onToggle: (provider: ProviderItem, enabled: boolean) => void;
  /** Providers whose exact check is queued or running. */
  pendingCheckIds: Set<string>;
  /** Preferences whose on/off write is in flight, by preference id. */
  pendingPreferenceIds: Set<string>;
  providers: ProviderItem[];
  usage: UsageSnapshot | null;
};

/**
 * Search plus one row per provider.
 *
 * Outside the wizard screen because Settings shows the same list. It used to
 * show a different one -- its own cards, badges and inclusion checkboxes --
 * and the two drifted apart in copy and in behaviour.
 */
export function ProviderList({
  className,
  onCheckAgain,
  onOpenSignIn,
  onOpenSetupGuide,
  onToggle,
  pendingCheckIds,
  pendingPreferenceIds,
  providers,
  usage,
}: ProviderListProps) {
  // One acknowledged message per provider: polling must not reopen a dismissed
  // popup, while a new message or an explicit retry may show it again.
  const [dismissedIssues, setDismissedIssues] = useState<Record<string, string>>(
    () => Object.fromEntries(acknowledgedProviderIssues),
  );
  const issue = providers.flatMap((provider) => {
    if (!provider.value || pendingCheckIds.has(provider.providerId) ||
        pendingPreferenceIds.has(provider.id)) return [];
    const message = setupProviderIssueMessage({
      health: provider.health.state, label: provider.label,
      detail: provider.health.message, reportedMessage: provider.health.reported,
    });
    // A stale row still shows its last reading and recovers by itself, e.g.
    // while CodexBar starts after the runtime restarted. Nothing for the
    // customer to do, so its message opens only from the row's warning icon.
    if (provider.health.state === "stale" && dismissedIssues[provider.id] !== "") return [];
    return message && dismissedIssues[provider.id] !== message
      ? [{ provider, message }] : [];
  })[0];
  const dismissIssue = () => {
    if (!issue) return;
    acknowledgedProviderIssues.set(issue.provider.id, issue.message);
    setDismissedIssues((current) => ({ ...current, [issue.provider.id]: issue.message }));
  };
  const resetIssue = (provider: ProviderItem) => {
    acknowledgedProviderIssues.delete(provider.id);
    setDismissedIssues((current) => ({ ...current, [provider.id]: "" }));
  };
  // The message whose copy reached the clipboard; the button then says so,
  // like Copy on Support. Another provider or a new message starts over.
  const [copied, setCopied] = useState("");
  const copyKey = issue ? `${issue.provider.id}\n${issue.provider.health.reported}` : "";
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PROVIDER_PAGE_SIZE);
  const matching = setupProvidersEnabledFirst(
    providers.filter((provider) => setupProviderMatchesQuery(provider, query)),
  );
  // CodexBar's inventory is 65 providers deep and almost all of it is off, so
  // the whole list buried the customer's own few under a page of names they
  // have never heard of. Search reaches any of them directly; this is for
  // everyone who does not know what to search for.
  const visible = matching.slice(0, shown);
  const remaining = matching.length - visible.length;
  const ownAppNotice =
    issue && onOpenSetupGuide && setupProviderNeedsOwnApp(issue.provider);

  return (
    <div className={cn("flex w-full flex-col", className)}>
      {issue ? (
        <SetupDialog
          open
          title={issue.provider.label}
          description={
            ownAppNotice
              ? setupProviderOwnAppNotice(issue.provider.label)
              : issue.message
          }
          icon={TriangleAlert}
          onOpenChange={(open) => { if (!open) dismissIssue(); }}
          primaryAction={{ label: "OK", onSelect: dismissIssue }}
          secondaryAction={issue.provider.health.reported ? {
            label: copied === copyKey
              ? "Copied"
              : `Copy provider message for ${issue.provider.label}`,
            onSelect: () => {
              void navigator.clipboard?.writeText(issue.provider.health.reported!)
                .then(() => setCopied(copyKey), () => undefined);
            },
          } : undefined}
        >
          {ownAppNotice ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm text-muted-foreground">{issue.message}</p>
              <Button
                className="h-auto px-0"
                onClick={onOpenSetupGuide}
                type="button"
                variant="link"
              >
                Open setup guide
              </Button>
            </div>
          ) : null}
        </SetupDialog>
      ) : null}
      <div className="relative w-full">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label="Search providers"
          className="pl-9"
          onChange={(event) => {
            setQuery(event.target.value);
            setShown(PROVIDER_PAGE_SIZE);
          }}
          placeholder="Search providers"
          type="search"
          value={query}
        />
      </div>

      <ItemGroup className="mt-3 gap-2">
        {visible.map((provider) => (
          <SetupProviderRow
            checking={pendingCheckIds.has(provider.providerId)}
            enabled={provider.value}
            health={
              provider.value && provider.health.state === "healthy" &&
              !setupProviderCanDisplay(provider, usage)
                ? "checking"
                : provider.health.state
            }
            key={provider.id}
            label={provider.label}
            onShowIssue={() => resetIssue(provider)}
            onCheckAgain={() => {
              resetIssue(provider);
              onCheckAgain(provider);
            }}
            onOpenSignIn={
              onOpenSignIn && setupProviderOffersSignIn(provider)
                ? () => {
                    onOpenSignIn(provider);
                  }
                : undefined
            }
            onToggle={(enabled) => {
              resetIssue(provider);
              onToggle(provider, enabled);
            }}
            saving={pendingPreferenceIds.has(provider.id)}
          />
        ))}
      </ItemGroup>
      {/* After the list, not in it: a list may only hold list items. */}
      {matching.length === 0 ? (
        <Empty
          className={cn(
            "bg-muted/50 py-8 ring-1 ring-foreground/10",
            SETUP_REVEAL,
          )}
        >
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchX size={17} aria-hidden />
            </EmptyMedia>
            <EmptyTitle>No AI providers match your search.</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : null}

      {remaining > 0 ? (
        <Button
          className="mt-3 self-center"
          onClick={() => setShown((count) => count + PROVIDER_PAGE_SIZE)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <span>{`Show more providers (${remaining} left)`}</span>
        </Button>
      ) : null}
    </div>
  );
}

export function SetupProvidersScreen({
  aiFixPrompt,
  onBack,
  onCheckAgain,
  onContinue,
  onCreateSupportReport,
  onOpenSignIn,
  onOpenSetupGuide,
  onToggle,
  continuing = false,
  loading = false,
  pendingCheckIds,
  pendingPreferenceIds,
  providers,
  usage,
  windowsHost = false,
}: SetupProvidersScreenProps) {
  if (loading) {
    return (
      <SetupProvidersLoadingScreen
        aiFixPrompt={aiFixPrompt}
        onBack={onBack}
        onCreateSupportReport={onCreateSupportReport}
        windowsHost={windowsHost}
      />
    );
  }

  return (
    <SetupWizardScreen
      label="Choose AI providers"
      aiFixPrompt={aiFixPrompt}
      onBack={onBack}
      onCreateSupportReport={onCreateSupportReport}
      windowsHost={windowsHost}
    >
      <SetupWizardTitle>Choose AI providers</SetupWizardTitle>

      <ProviderList
        className="mt-4"
        onCheckAgain={onCheckAgain}
        onOpenSignIn={onOpenSignIn}
        onOpenSetupGuide={onOpenSetupGuide}
        onToggle={onToggle}
        pendingCheckIds={pendingCheckIds}
        pendingPreferenceIds={pendingPreferenceIds}
        providers={providers}
        usage={usage}
      />

      <Button
        className="mt-4 w-full"
        // Closed while the completion is on its way. A second press starts a
        // second one, and each of those forces a live provider read before it
        // writes anything -- so the customer paid for the same slow check twice
        // and either answer could move the step or raise a refusal on its own.
        // Also closed while a switch is still saving: Continue derives the
        // display choice from the switches, and a refused write rolls one back
        // after that choice was made.
        disabled={
          continuing ||
          pendingPreferenceIds.size > 0 ||
          !setupProvidersCanContinue(providers, usage)
        }
        onClick={onContinue}
        type="button"
      >
        <span>Continue</span>
      </Button>
    </SetupWizardScreen>
  );
}

function SetupProvidersLoadingScreen({
  aiFixPrompt,
  onBack,
  onCreateSupportReport,
  windowsHost,
}: Pick<
  SetupProvidersScreenProps,
  "aiFixPrompt" | "onBack" | "onCreateSupportReport" | "windowsHost"
>) {
  const [stillCheckingCount, setStillCheckingCount] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(
      () => setStillCheckingCount((count) => count + 1),
      PROVIDER_LOADING_LOG_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, []);

  const lines: SetupLogLine[] = [
    {
      id: "provider-usage",
      text: windowsHost
        ? "reading provider usage on this computer"
        : "reading provider usage on this Mac",
      tone: stillCheckingCount > 0 ? "done" : undefined,
    },
    ...Array.from({ length: stillCheckingCount }, (_, index) => ({
      id: `still-checking-${index + 1}`,
      text: "still checking, hang tight",
      tone: index < stillCheckingCount - 1 ? ("done" as const) : undefined,
    })),
  ];

  return (
    <SetupWizardScreen
      label="Choose AI providers"
      aiFixPrompt={aiFixPrompt}
      onBack={onBack}
      onCreateSupportReport={onCreateSupportReport}
      windowsHost={windowsHost}
    >
      <SetupWizardTitle>Choose AI providers</SetupWizardTitle>
      <SetupWizardSubtitle>
        This can take up to 5 minutes. We&apos;re sorry.
      </SetupWizardSubtitle>

      <SetupLog className="mt-4" lines={lines} running />

      <div className="relative w-full">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label="Search providers"
          className="pl-9"
          disabled
          placeholder="Search providers"
          type="search"
        />
      </div>

      <ItemGroup aria-hidden className="mt-2 gap-2">
        {Array.from({ length: 3 }, (_, index) => (
          <Item
            className="min-h-14 rounded-[var(--radius-card)] p-4"
            key={index}
            variant="outline"
          >
            <Skeleton className="h-3 w-24" />
            <Skeleton className="ml-auto h-7 w-12 rounded-full" />
          </Item>
        ))}
      </ItemGroup>

      <Button className="mt-4 w-full" disabled type="button">
        <span>Continue</span>
      </Button>
    </SetupWizardScreen>
  );
}

/** One enabled provider with a real reading is enough, including 0%. */
export function setupProvidersCanContinue(
  providers: ProviderItem[],
  usage: UsageSnapshot | null,
): boolean {
  return providers.some((provider) => setupProviderCanDisplay(provider, usage));
}

/** Keep CodexBar's order inside the on and off groups. */
function setupProvidersEnabledFirst(providers: ProviderItem[]): ProviderItem[] {
  return [
    ...providers.filter((provider) => provider.value === true),
    ...providers.filter((provider) => provider.value !== true),
  ];
}

/** Use the preview's actual values, not health alone, to admit a provider. */
export function setupProviderCanDisplay(
  provider: ProviderItem,
  usage: UsageSnapshot | null,
): boolean {
  if (!provider.value ||
      (provider.health.state !== "healthy" && provider.health.state !== "stale")) {
    return false;
  }
  const preview = displayPreviewFor(
    usage?.providers.find((reading) => reading.id === provider.providerId),
  );
  return preview?.windows.some((window) =>
    typeof window.percent === "number" && Number.isFinite(window.percent),
  ) ?? false;
}

export function setupProviderMatchesQuery(
  provider: ProviderItem,
  query: string,
): boolean {
  const normalized = query.trim().toLowerCase();
  return (
    !normalized ||
    provider.label.toLowerCase().includes(normalized) ||
    provider.health.message.toLowerCase().includes(normalized) ||
    provider.providerId.toLowerCase().includes(normalized)
  );
}
