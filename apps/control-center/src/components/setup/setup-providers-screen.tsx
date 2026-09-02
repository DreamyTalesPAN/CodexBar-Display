"use client";

import type { SupportDiagnostics } from "../control-center-types";
import { Search, SearchX } from "lucide-react";
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
import { SetupProviderRow } from "./setup-provider-row";
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
};

/** How many provider rows are on screen before the customer asks for more. */
const PROVIDER_PAGE_SIZE = 10;
export const PROVIDER_LOADING_LOG_INTERVAL_MS = 20_000;

type ProviderListProps = {
  className?: string;
  onCheckAgain: (provider: ProviderItem) => void;
  onToggle: (provider: ProviderItem, enabled: boolean) => void;
  /** Providers whose exact check is queued or running. */
  pendingCheckIds: Set<string>;
  /** Preferences whose on/off write is in flight, by preference id. */
  pendingPreferenceIds: Set<string>;
  providers: ProviderItem[];
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
  onToggle,
  pendingCheckIds,
  pendingPreferenceIds,
  providers,
}: ProviderListProps) {
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PROVIDER_PAGE_SIZE);
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
            detail={provider.health.message}
            onCheckAgain={() => onCheckAgain(provider)}
            onToggle={(enabled) => onToggle(provider, enabled)}
            reportedMessage={provider.health.reported}
            saving={pendingPreferenceIds.has(provider.id)}
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
  onToggle,
  continuing = false,
  loading = false,
  pendingCheckIds,
  pendingPreferenceIds,
  providers,
}: SetupProvidersScreenProps) {
  if (loading) {
    return (
      <SetupProvidersLoadingScreen
        aiFixPrompt={aiFixPrompt}
        onBack={onBack}
        onCreateSupportReport={onCreateSupportReport}
      />
    );
  }

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
        disabled={continuing || !setupProvidersCanContinue(providers)}
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
}: Pick<
  SetupProvidersScreenProps,
  "aiFixPrompt" | "onBack" | "onCreateSupportReport"
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
      text: "reading provider usage on this Mac",
      tone: stillCheckingCount > 0 ? "done" : undefined,
    },
    ...Array.from({ length: stillCheckingCount }, (_, index) => ({
      id: `still-checking-${index + 1}`,
      text: "still checking, hang tight",
      tone:
        index < stillCheckingCount - 1 ? ("done" as const) : undefined,
    })),
  ];

  return (
    <SetupWizardScreen
      label="Choose AI providers"
      aiFixPrompt={aiFixPrompt}
      onBack={onBack}
      onCreateSupportReport={onCreateSupportReport}
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
 * Setup may continue once VibeTV has something real to show: one provider that
 * is switched on and has passed its check. That is the rule
 * docs/control-center-ui-principles.md has stated all along.
 *
 * Demanding every enabled provider instead was a trap, because CodexBar
 * switches providers on by itself: one of them merely not signed in closed
 * Continue on a Mac whose own provider was working. What the device shows is
 * unaffected -- the rotation already skips a provider it cannot read.
 *
 * The same provider descriptor drives this button and the companion's
 * completion gate. A manually requested check may keep running without
 * replacing an already healthy answer.
 */
export function setupProvidersCanContinue(providers: ProviderItem[]): boolean {
  return providers.some(
    (provider) => provider.value && provider.health.state === "healthy",
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
