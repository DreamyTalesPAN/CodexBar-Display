"use client";

import type {
  SupportDiagnostics,
  UsageSnapshot,
} from "../control-center-types";
import { Search, SearchX, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { SetupProviderRow, setupProviderRowVariant } from "./setup-provider-row";
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
 * How long after "Sign in to <Provider>" the app keeps re-checking that
 * provider (control-center-app.tsx), and the provider list keeps its popup
 * closed: the row recovers by itself while the customer signs in.
 */
export const PROVIDER_SIGN_IN_FOLLOW_UP_WINDOW_MS = 180_000;

/**
 * The providers whose sign-in the Companion can start (provider_sign_in_launch.go).
 * Every other provider in CodexBar's inventory is listed too; its row keeps
 * the switch, its warning and "Check again".
 */
export const SIGN_IN_PROVIDER_IDS = [
  "codex",
  "claude",
  "cursor",
  "antigravity",
];

/**
 * The state the row acts on. A stale row keeps its saved reading, but when
 * its live check only waits for a sign-in it offers the same sign-in
 * as a signed-out row: a cookie that expires while a reading is
 * still saved must not leave the customer with nothing to click.
 */
export function providerRowHealthState(
  health: Pick<ProviderItem["health"], "state" | "signInState">,
): string {
  return health.state === "stale" && health.signInState
    ? health.signInState
    : health.state;
}

/**
 * Health states in which the row offers to start the provider's sign-in.
 *
 * Only the four in SIGN_IN_PROVIDER_IDS have a sign-in the Companion can
 * start. Any other provider would get an action that can only fail, so its
 * row keeps the switch and "Check again", and its popup says what to do.
 */
export function setupProviderOffersSignIn(
  provider: Pick<ProviderItem, "health" | "providerId">,
): boolean {
  const state = providerRowHealthState(provider.health);
  const { signInUrl } = provider.health;
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
 * has to be installed and signed in on this computer. Not for "setup_required"
 * (#860): an API-key provider has no app to install, only a key to finish.
 */
function setupProviderNeedsOwnApp(
  provider: Pick<ProviderItem, "health" | "providerId">,
): boolean {
  const state = providerRowHealthState(provider.health);
  return (
    state === "auth_required" &&
    !SIGN_IN_PROVIDER_IDS.includes(provider.providerId.trim().toLowerCase())
  );
}

/**
 * The one sentence the provider dialog says, fixed per state the row shows
 * (Paul, 16.10.). Never the engine's own text and no status line beside it:
 * a customer cannot act on "No available fetch strategy". No "Check again"
 * either: the open window reads provider health again every 30 s by itself.
 */
export function setupProviderDialogSentence(
  provider: Pick<ProviderItem, "health" | "label" | "providerId">,
): string | null {
  const { label } = provider;
  const state = providerRowHealthState(provider.health);
  const variant = setupProviderRowVariant(state);
  if (variant === "toggle" || variant === "checking") return null;
  if (variant === "sign_in") {
    if (setupProviderNeedsOwnApp(provider)) {
      return `VibeTV reads ${label} usage from ${label}'s own app, so make sure it is installed and signed in on this computer.`;
    }
    // #860: "setup_required" without a sign-in the app can start (API key
    // missing) gets the generic setup line, never the app install.
    if (state === "setup_required" && !SIGN_IN_PROVIDER_IDS.includes(provider.providerId.trim().toLowerCase())) {
      return "Finish setup for this provider.";
    }
    return `Sign in to ${label} so VibeTV can read its usage.`;
  }
  if (variant === "browser_sign_in") {
    return `Sign in to ${label} in your browser, then close the browser.`;
  }
  if (variant === "permission") {
    return `Allow access on this computer so VibeTV can read ${label} usage.`;
  }
  if (variant === "unsupported") {
    return `${label} no longer works with this account, so switch it off and use another provider.`;
  }
  if (variant === "no_usage") return `This ${label} account has no usage yet.`;
  if (variant === "outage") {
    return `${label} has a service outage, and VibeTV tries again by itself.`;
  }
  if (variant === "stale") {
    return `VibeTV shows the last ${label} reading until a new one arrives.`;
  }
  if (state === "engine_incompatible") {
    return "The usage engine is too old and needs a repair.";
  }
  if (state === "rate_limited") {
    return `Nothing to fix: ${label} is busy right now, and VibeTV tries again by itself.`;
  }
  if (state === "timeout") {
    return `${label} did not answer in time, and VibeTV tries again by itself.`;
  }
  return `VibeTV could not read ${label} usage right now and tries again by itself.`;
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
  /** Present where the provider notice may link the setup guide. */
  onOpenSetupGuide?: () => void;
  onToggle: (provider: ProviderItem, enabled: boolean) => void;
  /** Providers whose exact check is queued or running. */
  pendingCheckIds: Set<string>;
  /** Preferences whose on/off write is in flight, by preference id. */
  pendingPreferenceIds: Set<string>;
  providers: ProviderItem[];
  /** Settings shows the list without the setup intro above it. */
  showIntro?: boolean;
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
  showIntro = true,
  usage,
}: ProviderListProps) {
  // One acknowledged message per provider: polling must not reopen a dismissed
  // popup, while a new message or an explicit retry may show it again.
  const [dismissedIssues, setDismissedIssues] = useState<Record<string, string>>(
    () => Object.fromEntries(acknowledgedProviderIssues),
  );
  // The provider whose warning icon the customer clicked. Its message opens
  // whatever the rules below say about popups opening by themselves.
  const [requestedIssueId, setRequestedIssueId] = useState<string | null>(null);
  // Providers whose sign-in started less than PROVIDER_SIGN_IN_FOLLOW_UP_WINDOW_MS
  // ago. Their row checks again by itself and passes through states such as
  // "stale" while the usage service restarts; none of that is news.
  const [signingIn, setSigningIn] = useState<Set<string>>(() => new Set());
  const signInTimers = useRef(new Map<string, number>());
  useEffect(() => {
    const timers = signInTimers.current;
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);
  const offersSignIn = (provider: ProviderItem) =>
    Boolean(onOpenSignIn) && setupProviderOffersSignIn(provider);
  const startSignIn = (provider: ProviderItem) => {
    const id = provider.providerId;
    const timers = signInTimers.current;
    const running = timers.get(id);
    if (running !== undefined) window.clearTimeout(running);
    timers.set(id, window.setTimeout(() => {
      timers.delete(id);
      setSigningIn((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }, PROVIDER_SIGN_IN_FOLLOW_UP_WINDOW_MS));
    setSigningIn((current) => new Set(current).add(id));
    setRequestedIssueId(null);
    onOpenSignIn?.(provider);
  };
  type ProviderIssue = { provider: ProviderItem; message: string; requested: boolean };
  const issues = providers.flatMap((provider): ProviderIssue[] => {
    if (!provider.value || pendingCheckIds.has(provider.providerId) ||
        pendingPreferenceIds.has(provider.id)) return [];
    const message = setupProviderDialogSentence(provider);
    if (!message) return [];
    const requested = requestedIssueId === provider.id;
    if (requested) return [{ provider, message, requested }];
    // A row with "Sign in to <Provider>" already shows the one thing to do;
    // a popup on top of it hid that button behind a provider message
    // (bench Mac, 09.10.). Sign-in rows need no duplicate warning.
    if (offersSignIn(provider) || signingIn.has(provider.providerId)) return [];
    // A stale row still shows its last reading and recovers by itself, e.g.
    // while CodexBar starts after the runtime restarted. Nothing for the
    // customer to do, so its message opens only from the row's warning icon.
    if (provider.health.state === "stale" && dismissedIssues[provider.id] !== "") return [];
    return dismissedIssues[provider.id] !== message
      ? [{ provider, message, requested }] : [];
  });
  const issue = issues.find((candidate) => candidate.requested) ?? issues[0];
  const dismissIssue = () => {
    if (!issue) return;
    acknowledgedProviderIssues.set(issue.provider.id, issue.message);
    setDismissedIssues((current) => ({ ...current, [issue.provider.id]: issue.message }));
    setRequestedIssueId(null);
  };
  const resetIssue = (provider: ProviderItem) => {
    acknowledgedProviderIssues.delete(provider.id);
    setDismissedIssues((current) => ({ ...current, [provider.id]: "" }));
  };
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PROVIDER_PAGE_SIZE);
  const matching = setupProvidersInOrder(
    providers.filter((provider) => setupProviderMatchesQuery(provider, query)),
  );
  // CodexBar's inventory is 65 providers deep and almost all of it is off, so
  // the whole list buried the customer's own few under a page of names they
  // have never heard of. Search reaches any of them directly; this is for
  // everyone who does not know what to search for.
  const visible = matching.slice(0, shown);
  const remaining = matching.length - visible.length;
  const setupGuide =
    issue && setupProviderNeedsOwnApp(issue.provider) ? onOpenSetupGuide : undefined;
  const issueSignIn = issue && offersSignIn(issue.provider) ? issue.provider : null;

  return (
    <div className={cn("flex w-full flex-col", className)}>
      {issue ? (
        // One sentence and at most two actions: the sign-in, or the setup
        // guide beside OK, or OK alone (Paul, 16.10.).
        <SetupDialog
          open
          title={issue.provider.label}
          description={issue.message}
          icon={TriangleAlert}
          onOpenChange={(open) => { if (!open) dismissIssue(); }}
          primaryAction={issueSignIn ? {
            label: `Sign in to ${issueSignIn.label}`,
            onSelect: () => {
              dismissIssue();
              startSignIn(issueSignIn);
            },
          } : setupGuide ? {
            label: "Open setup guide",
            onSelect: () => {
              dismissIssue();
              setupGuide();
            },
          } : { label: "OK", onSelect: dismissIssue }}
          secondaryAction={!issueSignIn && setupGuide
            ? { label: "OK", onSelect: dismissIssue }
            : undefined}
        />
      ) : null}
      {showIntro ? (
      <p className="mb-3 text-sm text-muted-foreground">
        VibeTV reads your AI usage with CodexBar, a helper app installed with VibeTV. Turn on the providers you use below.
      </p>
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
                : providerRowHealthState(provider.health)
            }
            key={provider.id}
            label={provider.label}
            onShowIssue={() => {
              resetIssue(provider);
              setRequestedIssueId(provider.id);
            }}
            onCheckAgain={() => {
              resetIssue(provider);
              setRequestedIssueId(null);
              onCheckAgain(provider);
            }}
            onOpenSignIn={
              onOpenSignIn && setupProviderOffersSignIn(provider)
                ? () => startSignIn(provider)
                : undefined
            }
            onToggle={(enabled) => {
              resetIssue(provider);
              setRequestedIssueId(null);
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

/**
 * One enabled provider with a real reading, including 0%, and none still on
 * its first reading. Continuing earlier opened Display Mode without a provider
 * switched on a moment before: Automatic had nothing to rotate to and Manual
 * could not offer it (#627).
 */
export function setupProvidersCanContinue(
  providers: ProviderItem[],
  usage: UsageSnapshot | null,
): boolean {
  return (
    providers.some((provider) => setupProviderCanDisplay(provider, usage)) &&
    !providers.some((provider) => setupProviderAwaitsFirstReading(provider, usage))
  );
}

/**
 * Switched on and its row shows the spinner: still checking, or healthy
 * without a reading the display can show. Exactly the row's spinner, so
 * Continue never opens beside a spinning row. A checking provider waits
 * whatever usage says, because Display Mode leaves it out until its row turns
 * healthy. A reading without percentages does not end the wait: the Companion
 * also reports one before the first real reading and once a reading expired.
 * A sign-in or other problem the row asks about is a definite answer and does
 * not hold the step; switching a provider off always does.
 */
export function setupProviderAwaitsFirstReading(
  provider: ProviderItem,
  usage: UsageSnapshot | null,
): boolean {
  if (provider.value !== true) return false;
  if (provider.health.state === "checking") return true;
  return (
    provider.health.state === "healthy" &&
    !setupProviderCanDisplay(provider, usage)
  );
}

/**
 * The subscription tools most customers use, then the API providers that
 * come right after them, in this order.
 */
const PRIORITY_PROVIDER_IDS = [
  "codex",
  "claude",
  "cursor",
  "antigravity",
  "openai",
  // Win-CodexBar names the same API provider "openaiapi".
  "openaiapi",
  "azureopenai",
];

/**
 * Priority providers first, then every other provider: switched-on ones
 * before switched-off ones. Each group keeps CodexBar's order.
 */
function setupProvidersInOrder(providers: ProviderItem[]): ProviderItem[] {
  const idOf = (provider: ProviderItem) =>
    provider.providerId.trim().toLowerCase();
  const priority = PRIORITY_PROVIDER_IDS.flatMap((id) =>
    providers.filter((provider) => idOf(provider) === id),
  );
  const others = providers.filter(
    (provider) => !PRIORITY_PROVIDER_IDS.includes(idOf(provider)),
  );
  return [
    ...priority,
    ...others.filter((provider) => provider.value === true),
    ...others.filter((provider) => provider.value !== true),
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
