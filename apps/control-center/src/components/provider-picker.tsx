"use client";

import { AlertTriangle, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { openCodexBarApp } from "./control-center-runtime";
import type {
  ApiError,
  PreferenceDescriptor,
  ProviderDisplaySelection,
} from "./control-center-types";

const commonProviderIds = ["codex", "claude", "cursor", "copilot"];
const collapsedProviderCount = 4;

export type ProviderPickerProps = {
  display: ProviderDisplaySelection | null;
  displayError?: ApiError | null;
  displayPendingProviderId?: string | null;
  items: PreferenceDescriptor[] | null;
  preferencesError?: ApiError | null;
  pendingCheckIds: Set<string>;
  pendingPreferenceIds: Set<string>;
  onCheck: (item: PreferenceDescriptor) => void | Promise<void>;
  onDisplayChange: (
    selection: Pick<ProviderDisplaySelection, "mode" | "providerIds">,
    providerId: string,
  ) => void | Promise<boolean | void>;
  onDisplayDraftChange?: (hasDraft: boolean) => void;
  /** The managed usage service is the broken part, not the provider's sign-in. */
  onRepairUsageService?: () => void;
  onPreferenceChange: (
    item: PreferenceDescriptor,
    value: boolean,
  ) => void | Promise<void>;
};

export type ProviderItem = PreferenceDescriptor & {
  type: "boolean";
  value: boolean;
  providerId: string;
  health: NonNullable<PreferenceDescriptor["health"]>;
};

export function ProviderPicker({
  display,
  displayError,
  displayPendingProviderId,
  items,
  preferencesError,
  pendingCheckIds,
  pendingPreferenceIds,
  onCheck,
  onDisplayChange,
  onDisplayDraftChange,
  onPreferenceChange,
  onRepairUsageService,
}: ProviderPickerProps) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [draftMode, setDraftMode] = useState<"automatic" | "fixed" | null>(
    null,
  );
  const allProviders = useMemo(
    () =>
      (items || []).filter(isProviderItem).sort((a, b) => {
        const priority =
          providerPopularityPriority(a) - providerPopularityPriority(b);
        return priority || a.label.localeCompare(b.label);
      }),
    [items],
  );
  const mode = draftMode || display?.mode || "automatic";
  const availableProviderIds = new Set(
    allProviders.map((item) => item.providerId),
  );
  const selected = new Set(
    (display?.providerIds || []).filter((providerId) =>
      availableProviderIds.has(providerId),
    ),
  );
  // Setup writes Always show one immediately instead of using a cancellable
  // draft (see chooseMode below), so returning to Automatic needs the last
  // known Automatic pool remembered separately: by the time the customer
  // switches back, `display` already only holds the single fixed provider.
  const lastAutomaticProviderIdsRef = useRef<string[] | null>(null);
  useEffect(() => {
    if (display?.mode === "automatic" && display.providerIds.length > 0) {
      lastAutomaticProviderIdsRef.current = display.providerIds;
    }
  }, [display]);
  // Finish an enable this picker started: switching a provider on and adding it
  // to the Automatic selection are two writes, and the second can fail or race.
  // That leaves a provider the customer switched on that VibeTV never shows,
  // with nothing on screen saying why, so it is repaired here.
  //
  // Only for enables made here. A saved selection that simply does not list an
  // enabled provider is not damage -- it is what `Include ... in Automatic`
  // writes when the customer leaves one out, and repairing that undid the
  // control they had just used. The two are indistinguishable in the loaded
  // state, so the difference has to be the action, and only this component
  // knows about the action. Cleared per provider once attempted so a failing
  // write does not retry in a tight loop.
  const enabledHereRef = useRef<Set<string>>(new Set());
  const selectedKey = [...selected].sort().join(",");
  useEffect(() => {
    if (
      !display ||
      display.mode !== "automatic" ||
      displayPendingProviderId
    ) {
      return;
    }
    const orphaned = allProviders.filter(
      (item) =>
        item.value &&
        !selected.has(item.providerId) &&
        !pendingPreferenceIds.has(item.id) &&
        enabledHereRef.current.has(item.providerId),
    );
    if (orphaned.length === 0) {
      return;
    }
    orphaned.forEach((item) => enabledHereRef.current.delete(item.providerId));
    const providerIds = [
      ...display.providerIds,
      ...orphaned.map((item) => item.providerId),
    ];
    void onDisplayChange(
      { mode: "automatic", providerIds },
      orphaned[0].providerId,
    );
    // `selected` is intentionally tracked via the stable `selectedKey`
    // string below instead of the Set instance, which would otherwise
    // re-run this effect on every render (a new Set is derived each
    // render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    allProviders,
    display,
    displayPendingProviderId,
    onDisplayChange,
    pendingPreferenceIds,
    selectedKey,
  ]);
  const normalizedQuery = query.trim().toLowerCase();
  const matchingProviders = allProviders.filter((item) =>
    providerMatchesQuery(item, normalizedQuery),
  );
  const collapsedIds = new Set(
    allProviders
      .slice(0, collapsedProviderCount)
      .map((item) => item.providerId),
  );
  const providers =
    normalizedQuery || showAll
      ? matchingProviders
      : matchingProviders.filter(
          (item) =>
            collapsedIds.has(item.providerId) ||
            item.value ||
            selected.has(item.providerId) ||
            pendingCheckIds.has(item.providerId) ||
            pendingPreferenceIds.has(item.id) ||
            displayPendingProviderId === item.providerId,
        );
  const hiddenProviderCount = matchingProviders.length - providers.length;
  const enabledProviders = allProviders.filter((item) => item.value);
  const displayControlsDisabled =
    display === null || Boolean(displayPendingProviderId);
  function chooseMode(nextMode: "automatic" | "fixed") {
    if (!display) {
      return;
    }
    if (nextMode === mode) {
      return;
    }
    if (nextMode === "fixed") {
      onDisplayDraftChange?.(true);
      setDraftMode("fixed");
      return;
    }
    if (display?.mode === "automatic") {
      onDisplayDraftChange?.(false);
      setDraftMode(null);
      return;
    }
    const seed = display?.providerIds[0] || enabledProviders[0]?.providerId;
    if (!seed) {
      return;
    }
    // The pool the customer had before they pinned one provider, minus anything
    // that has since been switched off -- the companion refuses a selection
    // naming a provider that is not on. Writing just the pinned provider
    // instead dropped the rest of their rotation without saying so.
    const remembered = (lastAutomaticProviderIdsRef.current || []).filter(
      (providerId) =>
        enabledProviders.some((item) => item.providerId === providerId),
    );
    // Nothing remembered means this picker never saw the Automatic pool -- it
    // is held for the visit, and the saved selection holds only the pinned
    // provider by then. Every provider that is on is what Automatic means and
    // what a fresh save writes; falling back to the pinned one alone handed
    // the customer an Automatic that rotates through nothing.
    const providerIds = remembered.length > 0
      ? remembered
      : enabledProviders.map((item) => item.providerId);
    onDisplayDraftChange?.(false);
    setDraftMode(null);
    void onDisplayChange({ mode: "automatic", providerIds }, seed);
  }

  function chooseProvider(item: ProviderItem, checked: boolean) {
    // A provider that is off cannot go into the selection -- the companion
    // refuses one naming it -- but it has to be able to come out, which is what
    // repairs a selection the customer invalidated by switching it off.
    if (!display || (!item.value && checked)) {
      return;
    }
    if (mode === "fixed") {
      onDisplayDraftChange?.(false);
      setDraftMode(null);
      void onDisplayChange(
        { mode: "fixed", providerIds: [item.providerId] },
        item.providerId,
      );
      return;
    }
    const providerIds = checked
      ? [...selected, item.providerId]
      : [...selected].filter((providerId) => providerId !== item.providerId);
    if (providerIds.length === 0) {
      return;
    }
    void onDisplayChange({ mode: "automatic", providerIds }, item.providerId);
  }

  return (
    <Card className="border-0">
      <CardHeader>
        <CardTitle>AI providers</CardTitle>
        <CardDescription>
          Choose providers, verify them, and decide what VibeTV can show. You
          can change this later in Settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {preferencesError || displayError ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>
              {(preferencesError || displayError)?.message}
            </AlertTitle>
            <AlertDescription>
              {(preferencesError || displayError)?.nextAction}
            </AlertDescription>
          </Alert>
        ) : null}

        <fieldset className="grid gap-3">
          <legend className="text-sm font-semibold">Display mode</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              aria-pressed={mode === "automatic"}
              className="min-h-12 justify-start"
              disabled={
                enabledProviders.length === 0 || displayControlsDisabled
              }
              onClick={() => chooseMode("automatic")}
              type="button"
              variant={mode === "automatic" ? "default" : "outline"}
            >
              Automatic
            </Button>
            <Button
              aria-pressed={mode === "fixed"}
              className="min-h-12 justify-start"
              disabled={
                enabledProviders.length === 0 || displayControlsDisabled
              }
              onClick={() => chooseMode("fixed")}
              type="button"
              variant={mode === "fixed" ? "default" : "outline"}
            >
              Always show one
            </Button>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            {mode === "automatic"
              ? "VibeTV chooses among the checked providers based on recent activity and usage."
              : "VibeTV only shows the selected provider and never switches silently."}
          </p>
        </fieldset>

        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search AI providers"
            className="min-h-11 pl-9"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search providers"
            type="search"
            value={query}
          />
        </div>

        {items === null && !preferencesError ? (
          <div
            aria-live="polite"
            className="flex min-h-24 items-center justify-center gap-2 text-sm text-muted-foreground"
          >
            <Spinner /> Checking providers
          </div>
        ) : providers.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {query
              ? "No providers match your search."
              : "No providers are available."}
          </p>
        ) : (
          <fieldset className="grid gap-3">
            <legend className="sr-only">Provider display selection</legend>
            {providers.map((item) => {
              const pendingPreference = pendingPreferenceIds.has(item.id);
              const pendingCheck = pendingCheckIds.has(item.providerId);
              const pendingDisplay =
                displayPendingProviderId === item.providerId;
              const isSelected = selected.has(item.providerId);
              return (
                <div
                  className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                  key={item.id}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="break-words font-semibold">
                        {item.label}
                      </h3>
                      <Badge variant={healthBadgeVariant(item.health.state)}>
                        {healthLabel(item.health.state)}
                      </Badge>
                      {item.health.service === "outage" &&
                      item.health.state !== "service_outage" ? (
                        <Badge variant="destructive">Service outage</Badge>
                      ) : item.health.service === "degraded" ? (
                        <Badge variant="secondary">Service degraded</Badge>
                      ) : null}
                    </div>
                    {item.description ? (
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        {item.description}
                      </p>
                    ) : null}
                    <p
                      aria-live={pendingCheck ? "polite" : undefined}
                      className="mt-2 text-sm leading-6"
                    >
                      {pendingCheck
                        ? "Checking provider."
                        : item.health.message}
                    </p>
                    {!pendingCheck && item.health.nextAction ? (
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        {item.health.nextAction}
                      </p>
                    ) : null}
                  </div>

                  <div className="grid min-w-44 gap-3 sm:justify-items-end">
                    <label className="flex min-h-11 items-center justify-between gap-3 text-sm sm:justify-end">
                      <span>
                        {mode === "fixed" ? "Always show" : "Include"}
                      </span>
                      {pendingDisplay ? (
                        <span
                          aria-label={`Saving display choice for ${item.label}`}
                          role="status"
                        >
                          <Spinner />
                        </span>
                      ) : mode === "fixed" ? (
                        <input
                          aria-label={`Always show ${item.label}`}
                          checked={isSelected && display?.mode === "fixed"}
                          className="size-5 accent-primary"
                          disabled={!item.value || displayControlsDisabled}
                          name="fixed-provider"
                          onChange={() => chooseProvider(item, true)}
                          type="radio"
                          value={item.providerId}
                        />
                      ) : (
                        <Checkbox
                          aria-label={`Include ${item.label} in Automatic`}
                          checked={isSelected}
                          disabled={
                            // A provider that is off cannot be put into the
                            // pool -- the companion refuses a selection naming
                            // one. Taking it back out is the opposite: it is
                            // what repairs a selection left naming a provider
                            // the customer has just switched off, and locking
                            // it left switching that provider back on as the
                            // only way to mend the choice.
                            (!item.value && !isSelected) ||
                            displayControlsDisabled ||
                            (isSelected && selected.size === 1)
                          }
                          onCheckedChange={(checked) =>
                            chooseProvider(item, checked === true)
                          }
                        />
                      )}
                    </label>
                    <label className="flex min-h-11 items-center justify-between gap-3 text-sm sm:justify-end">
                      <span>{item.value ? "Enabled" : "Disabled"}</span>
                      {pendingPreference ? (
                        <Spinner aria-label={`Updating ${item.label}`} />
                      ) : null}
                      <Switch
                        aria-label={`${item.value ? "Disable" : "Enable"} ${item.label}`}
                        checked={item.value}
                        // Being displayed is not a reason a provider cannot
                        // be switched off: docs/control-center-ui-principles.md
                        // rule 3, and the same rule the companion's own refusal
                        // was removed for in 5b76878. A selection left naming a
                        // provider that was turned off reports that itself.
                        disabled={pendingPreference}
                        onCheckedChange={(value) => {
                          // Only in Automatic, which is the mode whose enable
                          // is two writes and therefore the only one with a
                          // second write to finish. "Always show one" names a
                          // single provider and adds nothing, so a mark left
                          // here would only be read later, after a switch back
                          // to Automatic, and add a provider to the restored
                          // pool that the customer had kept out of it.
                          if (value && display?.mode === "automatic") {
                            enabledHereRef.current.add(item.providerId);
                          }
                          void onPreferenceChange(item, value);
                        }}
                      />
                    </label>
                    {!pendingCheck &&
                    (item.health.recoveryAction === "open_provider_setup" ||
                      item.health.recoveryAction === "repair_usage_service") ? (
                      <Button
                        className="min-h-11 w-full sm:w-auto"
                        // Two different failures, and the companion says
                        // which: a provider that needs the customer in its own
                        // app, and a managed usage service that needs
                        // restarting. Sending both to the provider app left the
                        // second one to meet the same broken service again.
                        onClick={() =>
                          item.health.recoveryAction === "repair_usage_service"
                            ? onRepairUsageService?.()
                            : openCodexBarApp()
                        }
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Open recovery
                      </Button>
                    ) : null}
                    <Button
                      className="min-h-11 w-full sm:w-auto"
                      disabled={!item.value || pendingCheck}
                      onClick={() => void onCheck(item)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {pendingCheck ? (
                        <Spinner data-icon="inline-start" />
                      ) : (
                        <RefreshCw data-icon="inline-start" aria-hidden />
                      )}
                      {pendingCheck ? "Checking" : "Check again"}
                    </Button>
                  </div>
                </div>
              );
            })}
            {!normalizedQuery && (hiddenProviderCount > 0 || showAll) ? (
              <Button
                aria-expanded={showAll}
                className="min-h-11 w-full"
                onClick={() => setShowAll((current) => !current)}
                type="button"
                variant="outline"
              >
                {showAll
                  ? "Show fewer providers"
                  : `Show all providers (${hiddenProviderCount} more)`}
              </Button>
            ) : null}
          </fieldset>
        )}
      </CardContent>
    </Card>
  );
}

export function providerMatchesQuery(
  item: Pick<PreferenceDescriptor, "label" | "description" | "providerId">,
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  return (
    !normalizedQuery ||
    item.label.toLowerCase().includes(normalizedQuery) ||
    Boolean(item.description?.toLowerCase().includes(normalizedQuery)) ||
    Boolean(item.providerId?.toLowerCase().includes(normalizedQuery))
  );
}

export function isProviderItem(
  item: PreferenceDescriptor,
): item is ProviderItem {
  return (
    item.section === "providers" &&
    item.type === "boolean" &&
    typeof item.value === "boolean" &&
    typeof item.providerId === "string" &&
    item.providerId.length > 0 &&
    Boolean(item.health)
  );
}

function providerPopularityPriority(item: ProviderItem): number {
  const index = commonProviderIds.indexOf(item.providerId);
  return index === -1 ? commonProviderIds.length : index;
}

function healthLabel(state: string): string {
  const labels: Record<string, string> = {
    healthy: "Ready",
    auth_required: "Sign-in needed",
    setup_required: "Setup needed",
    stale: "Stale",
    service_outage: "Service outage",
    unavailable: "Unavailable",
    permission_required: "Permission needed",
    no_usage_available: "No usage available",
    timeout: "Timed out",
    config_error: "Settings problem",
    engine_error: "Usage service problem",
    checking: "Checking",
    disabled: "Off",
  };
  return labels[state] || "Unknown";
}

function healthBadgeVariant(
  state: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (
    [
      "auth_required",
      "setup_required",
      "unavailable",
      "permission_required",
      "no_usage_available",
      "timeout",
      "config_error",
      "engine_error",
    ].includes(state)
  ) {
    return "destructive";
  }
  return state === "healthy" ? "default" : "secondary";
}
