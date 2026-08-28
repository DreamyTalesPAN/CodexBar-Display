"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const [signingInIds, setSigningInIds] = useState<string[]>([]);
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

      <div className="mt-3 flex w-full flex-col gap-2">
        {matching.map((provider) => (
          <SetupProviderRow
            enabled={provider.value}
            health={provider.health.state}
            key={provider.id}
            label={provider.label}
            onCheckAgain={() => onCheckAgain(provider)}
            onRecover={() => {
              setSigningInIds((ids) => [...ids, provider.providerId]);
              onRecover(provider);
            }}
            onToggle={(enabled) => onToggle(provider, enabled)}
            signingIn={signingInIds.includes(provider.providerId)}
          />
        ))}
      </div>

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
