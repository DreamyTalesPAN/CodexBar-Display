"use client";

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
import type { ProviderItem } from "../provider-picker";
import { SetupProviderRow } from "./setup-provider-row";
import { SetupWizardScreen, SetupWizardTitle } from "./setup-wizard-screen";

type SetupProvidersScreenProps = {
  onAskAiToFix?: () => boolean | Promise<boolean>;
  onBack?: () => void;
  onCheckAgain: (provider: ProviderItem) => void;
  onContinue: () => void;
  onCreateSupportReport?: () => void;
  onRecover: (provider: ProviderItem) => void;
  onToggle: (provider: ProviderItem, enabled: boolean) => void;
  providers: ProviderItem[];
};

const SIGN_IN_WAIT_MS = 45_000;

export function SetupProvidersScreen({
  onAskAiToFix,
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
      onAskAiToFix={onAskAiToFix}
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
          <Empty className="bg-muted/50 py-8 ring-1 ring-foreground/10">
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
 * Setup may only continue once VibeTV has something to show: one provider that
 * is switched on and answered the check. Every other state still needs the
 * customer, so the button stays closed.
 */
export function setupProvidersCanContinue(providers: ProviderItem[]): boolean {
  return providers.some(
    (provider) => provider.value && provider.health.state === "healthy",
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
