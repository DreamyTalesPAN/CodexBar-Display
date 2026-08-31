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
  providers,
}: SetupProvidersScreenProps) {
  const [query, setQuery] = useState("");
  // A provider never tells us that a sign-in is under way; this is our own
  // guess after opening the provider's app. It is bounded so a sign-in the
  // customer abandoned cannot leave the row spinning with nothing to press.
  const [signingInIds, setSigningInIds] = useState<string[]>([]);
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
            enabled={provider.value}
            health={provider.health.state}
            key={provider.id}
            label={provider.label}
            onCheckAgain={() => onCheckAgain(provider)}
            onRecover={() => {
              const providerId = provider.providerId;
              setSigningInIds((ids) => [...ids, providerId]);
              waitTimers.current.push(
                setTimeout(
                  () =>
                    setSigningInIds((ids) =>
                      ids.filter((id) => id !== providerId),
                    ),
                  SIGN_IN_WAIT_MS,
                ),
              );
              onRecover(provider);
            }}
            onToggle={(enabled) => onToggle(provider, enabled)}
            signingIn={signingInIds.includes(provider.providerId)}
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
        disabled={!setupProvidersCanContinue(providers)}
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
 */
export function setupProvidersCanContinue(providers: ProviderItem[]): boolean {
  const enabled = providers.filter((provider) => provider.value);
  return (
    enabled.length > 0 &&
    enabled.every((provider) => provider.health.state === "healthy")
  );
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
