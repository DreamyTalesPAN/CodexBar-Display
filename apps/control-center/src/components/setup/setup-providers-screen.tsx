"use client";

import type { SupportDiagnostics } from "../control-center-types";
import { Search, SearchX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  /** Providers whose exact check is queued or running. */
  pendingCheckIds: Set<string>;
  /** Preferences whose on/off write is in flight, by preference id. */
  pendingPreferenceIds: Set<string>;
  providers: ProviderItem[];
};

const SIGN_IN_WAIT_MS = 45_000;

export function SetupProvidersScreen({
  aiFixPrompt,
  onBack,
  onCheckAgain,
  onContinue,
  onCreateSupportReport,
  onRecover,
  onToggle,
  pendingCheckIds,
  pendingPreferenceIds,
  providers,
}: SetupProvidersScreenProps) {
  const [query, setQuery] = useState("");
  // Nothing tells us that a recovery is under way -- a sign-in, a macOS
  // permission, a usage service being restarted -- so this is our own guess
  // after handing the customer over. It is bounded so one they abandoned
  // cannot leave the row spinning with nothing to press.
  const [recoveringIds, setRecoveringIds] = useState<string[]>([]);
  const waitTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(
    () => () => waitTimers.current.forEach(clearTimeout),
    [],
  );
  const matching = providers.filter((provider) =>
    setupProviderMatchesQuery(provider, query),
  );

  return (
    <SetupWizardScreen
      label="Choose AI providers"
      aiFixPrompt={aiFixPrompt}
      onBack={onBack}
      onCreateSupportReport={onCreateSupportReport}
    >
      <SetupWizardTitle>Choose AI providers</SetupWizardTitle>

      <div className="relative mt-4 w-full">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label="Search providers"
          className="pl-9"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search providers"
          type="search"
          value={query}
        />
      </div>

      <ItemGroup className="mt-3 gap-2">
        {matching.map((provider) => (
          <SetupProviderRow
            checking={pendingCheckIds.has(provider.providerId)}
            enabled={provider.value}
            health={provider.health.state}
            key={provider.id}
            label={provider.label}
            onCheckAgain={() => onCheckAgain(provider)}
            onRecover={() => {
              const providerId = provider.providerId;
              setRecoveringIds((ids) => [...ids, providerId]);
              waitTimers.current.push(
                setTimeout(() => {
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
            onToggle={(enabled) => onToggle(provider, enabled)}
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

      <Button
        className="mt-4 w-full"
        disabled={!setupProvidersCanContinue(providers, pendingCheckIds)}
        onClick={onContinue}
        type="button"
      >
        <span>Continue</span>
      </Button>
    </SetupWizardScreen>
  );
}

/**
 * Setup may only continue once VibeTV has something to show, and once nothing
 * that is switched on is still broken. Every other state needs the customer --
 * sign in, allow access, or turn the provider off -- so the button stays
 * closed. This is the same gate the companion applies before it writes setup
 * complete; asking for less here only produced a Continue that answered and
 * did nothing.
 *
 * A check still queued or running is one of those states. The companion asks
 * for an exact check of its own, and the health a provider reports before that
 * check has answered is not it -- so a row could read healthy while the answer
 * the companion wants was still on its way, and Continue was open on a gate
 * that refuses it.
 */
export function setupProvidersCanContinue(
  providers: ProviderItem[],
  pendingCheckIds: Set<string>,
): boolean {
  const enabled = providers.filter((provider) => provider.value);
  return (
    enabled.length > 0 &&
    enabled.every(
      (provider) =>
        provider.health.state === "healthy" &&
        !pendingCheckIds.has(provider.providerId),
    )
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
