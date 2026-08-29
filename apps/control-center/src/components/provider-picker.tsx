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
import { cn } from "@/lib/utils";
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
  ) => void | Promise<void>;
  onDisplayDraftChange?: (hasDraft: boolean) => void;
  onPreferenceChange: (
    item: PreferenceDescriptor,
    value: boolean,
  ) => void | Promise<void>;
  setupMode?: boolean;
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
  setupMode = false,
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
  // Self-heal orphaned state: a provider can end up enabled (health-checked,
  // possibly healthy) while never making it into the Automatic display
  // selection, e.g. when the enable write and the display write raced, or
  // the display write failed after the enable write already succeeded. A
  // customer should never be stuck staring at a disabled Finish setup
  // button with no visible reason and no action that fixes it just by
  // waiting; reconcile the selection to include every enabled provider
  // automatically instead of requiring a manual toggle. Guarded by a
  // per-provider "already attempted" set so a failed reconcile write does
  // not retry forever in a tight loop.
  const attemptedReconcileIdsRef = useRef<Set<string>>(new Set());
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
        !attemptedReconcileIdsRef.current.has(item.providerId),
    );
    if (orphaned.length === 0) {
      return;
    }
    orphaned.forEach((item) =>
      attemptedReconcileIdsRef.current.add(item.providerId),
    );
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
      if (setupMode) {
        // Setup has no separate "save the fixed choice" step: switching to
        // Always show one must immediately leave exactly one provider
        // selected so the customer can never land on the two-selected
        // error state that blocks Finish setup.
        onDisplayDraftChange?.(false);
        setDraftMode(null);
        const seed = display?.providerIds[0] || enabledProviders[0]?.providerId;
        if (seed) {
          void onDisplayChange({ mode: "fixed", providerIds: [seed] }, seed);
        }
        return;
      }
      onDisplayDraftChange?.(true);
      setDraftMode("fixed");
      return;
    }
    if (display?.mode === "automatic") {
      onDisplayDraftChange?.(false);
      setDraftMode(null);
      return;
    }
    if (setupMode) {
      // Setup already wrote Always show one immediately (no draft), so
      // Automatic must restore the pool that was active before that
      // switch, not just seed a single provider.
      onDisplayDraftChange?.(false);
      setDraftMode(null);
      const restoredProviderIds =
        lastAutomaticProviderIdsRef.current?.filter((providerId) =>
          availableProviderIds.has(providerId),
        ) || [];
      const providerIds =
        restoredProviderIds.length > 0
          ? restoredProviderIds
          : [display?.providerIds[0] || enabledProviders[0]?.providerId].filter(
              (id): id is string => Boolean(id),
            );
      if (providerIds.length === 0) {
        return;
      }
      void onDisplayChange({ mode: "automatic", providerIds }, providerIds[0]);
      return;
    }
    const seed = display?.providerIds[0] || enabledProviders[0]?.providerId;
    if (!seed) {
      return;
    }
    onDisplayDraftChange?.(false);
    setDraftMode(null);
    void onDisplayChange({ mode: "automatic", providerIds: [seed] }, seed);
  }

  function chooseProvider(item: ProviderItem, checked: boolean) {
    if (!display || !item.value) {
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

  // Setup uses a single "I use this" toggle instead of separate Enabled and
  // Include controls: a customer setting up VibeTV for the first time has no
  // use for "collect usage but never show it" yet. Turning a provider on
  // enables it and includes it in Automatic in one step; turning it off does
  // the reverse. Settings keeps the two controls separate for that later,
  // more advanced choice.
  //
  // Always show one is exclusive: turning a provider on here always turns
  // the previously shown provider off in the same action, so the customer
  // can never end up with two providers marked on (the state that used to
  // block Finish setup with no visible explanation). Turning the current
  // provider off directly is intentionally not offered in fixed mode;
  // choosing a replacement is how the customer changes their mind.
  async function toggleProviderForSetup(
    item: ProviderItem,
    on: boolean,
    now: number,
  ) {
    if (!display) {
      return;
    }
    if (on) {
      if (mode === "fixed") {
        const previousProviderId = setupFixedReplacedProviderId(
          selected,
          item.providerId,
        );
        const previousItem = previousProviderId
          ? allProviders.find(
              (candidate) => candidate.providerId === previousProviderId,
            )
          : undefined;
        onDisplayDraftChange?.(false);
        setDraftMode(null);
        void onDisplayChange(
          { mode: "fixed", providerIds: [item.providerId] },
          item.providerId,
        );
        await maybeEnableProvider(item, now);
        if (previousItem) {
          void onPreferenceChange(previousItem, false);
        }
        return;
      }
      await maybeEnableProvider(item, now);
      onDisplayDraftChange?.(false);
      setDraftMode(null);
      const nextDisplay = setupToggleOnDisplay(mode, selected, item.providerId);
      if (nextDisplay) {
        void onDisplayChange(nextDisplay, item.providerId);
      }
      return;
    }
    const nextDisplay = setupToggleOffDisplay(mode, selected, item.providerId);
    if (nextDisplay) {
      await onDisplayChange(nextDisplay, item.providerId);
    }
    void onPreferenceChange(item, false);
  }

  // Skip the round trip through the server entirely when a provider is
  // already known-good: the backend always resets health to "checking" and
  // starts a fresh probe on every preference write, so re-enabling an
  // already-verified provider (e.g. after switching Always show one back
  // and forth) must not repeatedly re-check something that already passed.
  async function maybeEnableProvider(item: ProviderItem, now: number) {
    if (providerEnableIsRedundant(item, now)) {
      return;
    }
    await onPreferenceChange(item, true);
  }

  return (
    <Card className={cn(setupMode ? "border-border" : "border-0")}>
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
              const disableLocked = item.value && isSelected;
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
                    {!setupMode && disableLocked ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Remove this provider from the display selection before
                        turning it off.
                      </p>
                    ) : null}
                  </div>

                  <div className="grid min-w-44 gap-3 sm:justify-items-end">
                    {setupMode ? (
                      // In Automatic, "using this" means enabled (it always
                      // stays included). In Always show one, "using this"
                      // must mean this exact provider is the one currently
                      // shown, not merely enabled: a provider can stay
                      // enabled in the background after being replaced, and
                      // showing its switch as on would let two providers
                      // look active at once.
                      (() => {
                        const usingThis =
                          mode === "fixed" ? isSelected : item.value;
                        return (
                          <label className="flex min-h-11 items-center justify-between gap-3 text-sm sm:justify-end">
                            <span>{usingThis ? "Using this" : "Not used"}</span>
                            {pendingPreference || pendingDisplay ? (
                              <Spinner aria-label={`Updating ${item.label}`} />
                            ) : null}
                            <Switch
                              aria-label={`${usingThis ? "Stop using" : "Use"} ${item.label}`}
                              checked={usingThis}
                              disabled={
                                pendingPreference ||
                                pendingDisplay ||
                                displayControlsDisabled ||
                                (mode === "fixed"
                                  ? usingThis
                                  : item.value && enabledProviders.length === 1)
                              }
                              onCheckedChange={(value) =>
                                void toggleProviderForSetup(
                                  item,
                                  value,
                                  Date.now(),
                                )
                              }
                            />
                          </label>
                        );
                      })()
                    ) : (
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
                              !item.value ||
                              displayControlsDisabled ||
                              (isSelected && selected.size === 1)
                            }
                            onCheckedChange={(checked) =>
                              chooseProvider(item, checked === true)
                            }
                          />
                        )}
                      </label>
                    )}
                    {setupMode ? null : (
                      <label className="flex min-h-11 items-center justify-between gap-3 text-sm sm:justify-end">
                        <span>{item.value ? "Enabled" : "Disabled"}</span>
                        {pendingPreference ? (
                          <Spinner aria-label={`Updating ${item.label}`} />
                        ) : null}
                        <Switch
                          aria-label={`${item.value ? "Disable" : "Enable"} ${item.label}`}
                          checked={item.value}
                          disabled={disableLocked || pendingPreference}
                          onCheckedChange={(value) =>
                            void onPreferenceChange(item, value)
                          }
                        />
                      </label>
                    )}
                    {!pendingCheck &&
                    (item.health.recoveryAction === "open_provider_setup" ||
                      item.health.recoveryAction === "repair_usage_service") ? (
                      <Button
                        className="min-h-11 w-full sm:w-auto"
                        onClick={() => openCodexBarApp()}
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

// Pure display-selection helpers for the setup-mode combined toggle. Kept
// outside the component so they can be unit tested directly instead of only
// through rendered markup.
export function setupToggleOnDisplay(
  mode: "automatic" | "fixed",
  selected: Set<string>,
  providerId: string,
): Pick<ProviderDisplaySelection, "mode" | "providerIds"> | null {
  if (mode === "fixed") {
    return { mode: "fixed", providerIds: [providerId] };
  }
  if (selected.has(providerId)) {
    return null;
  }
  return { mode: "automatic", providerIds: [...selected, providerId] };
}

export function setupToggleOffDisplay(
  mode: "automatic" | "fixed",
  selected: Set<string>,
  providerId: string,
): Pick<ProviderDisplaySelection, "mode" | "providerIds"> | null {
  if (!selected.has(providerId)) {
    return null;
  }
  const providerIds = [...selected].filter((id) => id !== providerId);
  if (providerIds.length === 0) {
    // Never fully empty the display selection here: the combined switch is
    // already disabled for the last enabled provider, so this is a defensive
    // no-op rather than a state a customer can normally reach.
    return null;
  }
  return { mode, providerIds };
}

// Which currently-selected provider must be turned off when switching to a
// different provider in Always show one. Returns null when there is nothing
// to turn off (no other provider was selected).
export function setupFixedReplacedProviderId(
  selected: Set<string>,
  nextProviderId: string,
): string | null {
  const previous = [...selected].find((id) => id !== nextProviderId);
  return previous ?? null;
}

// A provider is already known-good when it is enabled, healthy, and its
// verification is still fresh: re-sending the enable write in that state
// would only make the server discard the passing result and start another
// probe for nothing.
export function providerEnableIsRedundant(
  item: Pick<PreferenceDescriptor, "value" | "health">,
  now: number,
): boolean {
  return Boolean(
    item.value &&
    item.health?.state === "healthy" &&
    providerVerificationIsFresh(item.health.verifiedAt, now),
  );
}

function providerVerificationIsFresh(
  verifiedAt: string | undefined,
  now: number,
): boolean {
  const verified = Date.parse(verifiedAt || "");
  const age = now - verified;
  return Number.isFinite(verified) && age >= 0 && age <= 5 * 60 * 1000;
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

export function isProviderItem(item: PreferenceDescriptor): item is ProviderItem {
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
