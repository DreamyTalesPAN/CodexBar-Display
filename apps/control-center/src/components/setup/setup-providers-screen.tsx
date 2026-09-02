"use client";

import type { SupportDiagnostics } from "../control-center-types";
import { Search, SearchX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { ItemGroup } from "@/components/ui/item";
import { cn } from "@/lib/utils";
import { SETUP_REVEAL } from "./setup-reveal";
import type { ProviderItem } from "../provider-picker";
import { SetupProviderRow } from "./setup-provider-row";
import { SetupWizardScreen, SetupWizardTitle } from "./setup-wizard-screen";

type SetupProvidersScreenProps = {
  aiFixPrompt?: () => string;
  onBack?: () => void;
  onCheckAgain: (provider: ProviderItem) => void;
  onContinue: () => void;
  onCreateSupportReport?: () => Promise<SupportDiagnostics | null>;
  onRecover: (provider: ProviderItem) => void;
  onToggle: (provider: ProviderItem, enabled: boolean) => void;
  /** The completion this step asked for has not answered yet. */
  continuing?: boolean;
  /** Providers whose exact check is queued or running. */
  pendingCheckIds: Set<string>;
  /** Preferences whose on/off write is in flight, by preference id. */
  pendingPreferenceIds: Set<string>;
  providers: ProviderItem[];
};

const SIGN_IN_WAIT_MS = 45_000;

/** How many provider rows are on screen before the customer asks for more. */
const PROVIDER_PAGE_SIZE = 10;

type ProviderListProps = {
  className?: string;
  onCheckAgain: (provider: ProviderItem) => void;
  onRecover: (provider: ProviderItem) => void;
  onToggle: (provider: ProviderItem, enabled: boolean) => void;
  /** Providers whose exact check is queued or running. */
  pendingCheckIds: Set<string>;
  /** Preferences whose on/off write is in flight, by preference id. */
  pendingPreferenceIds: Set<string>;
  providers: ProviderItem[];
};

/**
 * Search plus one row per provider, and the bounded wait that follows a
 * recovery hand-off.
 *
 * Outside the wizard screen because Settings shows the same list. It used to
 * show a different one -- its own cards, badges and inclusion checkboxes --
 * and the two drifted apart in copy and in behaviour.
 */
export function ProviderList({
  className,
  onCheckAgain,
  onRecover,
  onToggle,
  pendingCheckIds,
  pendingPreferenceIds,
  providers,
}: ProviderListProps) {
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PROVIDER_PAGE_SIZE);
  // Nothing tells us that a recovery is under way -- a sign-in, a macOS
  // permission, a usage service being restarted -- so this is our own guess
  // after handing the customer over. It is bounded so one they abandoned
  // cannot leave the row spinning with nothing to press.
  const [recoveringIds, setRecoveringIds] = useState<string[]>([]);
  // Kept per provider so the wait for one can be called off on its own.
  const waitTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => () => waitTimers.current.forEach(clearTimeout), []);

  // Switching a provider off ends the recovery it was waiting for. The check
  // at the end of that wait is a real provider probe -- the companion asks
  // CodexBar for live usage -- and running one against a provider the customer
  // has just turned off is work they did not ask for.
  const endWait = useCallback((providerId: string) => {
    const timer = waitTimers.current.get(providerId);
    if (timer === undefined) {
      return;
    }
    clearTimeout(timer);
    waitTimers.current.delete(providerId);
    setRecoveringIds((ids) => ids.filter((id) => id !== providerId));
  }, []);
  const matching = providers.filter((provider) =>
    setupProviderMatchesQuery(provider, query),
  );
  // CodexBar's inventory is 65 providers deep and almost all of it is off, so
  // the whole list buried the customer's own few under a page of names they
  // have never heard of. Search reaches any of them directly; this is for
  // everyone who does not know what to search for.
  const visible = matching.slice(0, shown);
  const remaining = matching.length - visible.length;

  return (
    <div className={cn("flex w-full flex-col", className)}>
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
            health={provider.health.state}
            key={provider.id}
            label={provider.label}
            onCheckAgain={() => onCheckAgain(provider)}
            onRecover={() => {
              const providerId = provider.providerId;
              // A second press must not orphan the first timer: it would fire
              // against a wait the customer can no longer call off, and the
              // stale check it runs lands on a row that has moved on.
              endWait(providerId);
              setRecoveringIds((ids) => [...ids, providerId]);
              waitTimers.current.set(
                providerId,
                setTimeout(() => {
                  waitTimers.current.delete(providerId);
                  setRecoveringIds((ids) =>
                    ids.filter((id) => id !== providerId),
                  );
                  // The companion is still holding the failed check that sent
                  // the customer to sign in, and it holds it for five minutes.
                  // Coming back without asking again left them looking at the
                  // old answer with Continue closed.
                  onCheckAgain(provider);
                }, SIGN_IN_WAIT_MS),
              );
              onRecover(provider);
            }}
            onToggle={(enabled) => {
              if (!enabled) {
                endWait(provider.providerId);
              }
              onToggle(provider, enabled);
            }}
            providerId={provider.providerId}
            reportedMessage={provider.health.reported}
            saving={pendingPreferenceIds.has(provider.id)}
            recovering={recoveringIds.includes(provider.providerId)}
          />
        ))}
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
      </ItemGroup>

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
  onRecover,
  onToggle,
  continuing = false,
  pendingCheckIds,
  pendingPreferenceIds,
  providers,
}: SetupProvidersScreenProps) {
  return (
    <SetupWizardScreen
      label="Choose AI providers"
      aiFixPrompt={aiFixPrompt}
      onBack={onBack}
      onCreateSupportReport={onCreateSupportReport}
    >
      <SetupWizardTitle>Choose AI providers</SetupWizardTitle>

      <ProviderList
        className="mt-4"
        onCheckAgain={onCheckAgain}
        onRecover={onRecover}
        onToggle={onToggle}
        pendingCheckIds={pendingCheckIds}
        pendingPreferenceIds={pendingPreferenceIds}
        providers={providers}
      />

      <Button
        className="mt-4 w-full"
        // Closed while the completion is on its way. A second press starts a
        // second one, and each of those forces a live provider read before it
        // writes anything -- so the customer paid for the same slow check twice
        // and either answer could move the step or raise a refusal on its own.
        disabled={
          continuing || !setupProvidersCanContinue(providers, pendingCheckIds)
        }
        onClick={onContinue}
        type="button"
      >
        <span>Continue</span>
      </Button>
    </SetupWizardScreen>
  );
}

/**
 * Setup may continue once VibeTV has something real to show: one provider that
 * is switched on and has passed its check. That is the rule
 * docs/control-center-ui-principles.md has stated all along.
 *
 * Demanding every enabled provider instead was a trap, because CodexBar
 * switches providers on by itself: one of them merely not signed in closed
 * Continue on a Mac whose own provider was working, and this step offers no
 * Back and no Skip. What the device shows is unaffected -- the rotation
 * already skips a provider it cannot read.
 *
 * A check still queued or running does not count as passed. The companion asks
 * for an exact check of its own, and the health a provider reports before that
 * check has answered is not it -- so a row could read healthy while the answer
 * the companion wants was still on its way, and Continue was open on a gate
 * that refuses it. This is the same sentence the companion applies.
 */
export function setupProvidersCanContinue(
  providers: ProviderItem[],
  pendingCheckIds: Set<string>,
): boolean {
  return providers.some(
    (provider) =>
      provider.value &&
      provider.health.state === "healthy" &&
      !pendingCheckIds.has(provider.providerId),
  );
}

/**
 * How long the companion accepts an exact provider check for
 * (`providerReadinessFreshness` in `companion/internal/companionapi`).
 */
export const PROVIDER_READINESS_FRESHNESS_MS = 5 * 60 * 1000;

/**
 * Whether a check made at this time no longer counts.
 *
 * The same rule governs the check the companion holds and the one this app
 * last asked for: remembering our own request forever stopped the automatic
 * check re-arming exactly when the readiness it stood for expired, and the
 * customer was left with a Continue the companion refuses and a healthy row
 * offering no way to check again.
 */
export function setupProviderCheckIsStale(
  checkedAt: number | undefined,
  now: number,
): boolean {
  if (checkedAt === undefined || !Number.isFinite(checkedAt)) {
    return true;
  }
  const age = now - checkedAt;
  return age < 0 || age > PROVIDER_READINESS_FRESHNESS_MS;
}

/**
 * When the newest of these checks stops counting, or null if none of them still
 * does. Nothing changes on screen at that moment, so the step has to come back
 * for it on a clock rather than wait to be told.
 */
export function setupProviderCheckExpiresAt(
  checkedAt: (number | undefined)[],
  now: number,
): number | null {
  const held = checkedAt.filter(
    (at): at is number => !setupProviderCheckIsStale(at, now),
  );
  return held.length === 0
    ? null
    : Math.max(...held) + PROVIDER_READINESS_FRESHNESS_MS;
}

/**
 * Whether this provider can actually put a reading on the device. "stale"
 * counts: it produced a real one before and the saved value is still what the
 * customer sees. Everything else -- waiting for a sign-in, refused a macOS
 * permission, an account with no usage, an outage -- has nothing to show, so
 * offering it on the display step would let the customer pin VibeTV to a
 * permanently blank screen.
 */
export function setupProviderCanDisplay(provider: ProviderItem): boolean {
  return (
    provider.value &&
    (provider.health.state === "healthy" || provider.health.state === "stale")
  );
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
