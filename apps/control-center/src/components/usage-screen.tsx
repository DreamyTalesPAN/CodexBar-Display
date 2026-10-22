"use client";

import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Info,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { XAxisTickContentProps, YAxisTickContentProps } from "recharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { copyForHost } from "@/lib/customer-platform";
import {
  formatResetCountdown,
  remainingResetSecs,
} from "@/lib/reset-countdown";
import { isProviderItem, type ProviderItem } from "./provider-picker";
import { SetupDialog } from "./setup/setup-dialog";
import {
  providerRowHealthState,
  setupProviderOffersSignIn,
} from "./setup/setup-providers-screen";
import type {
  ApiError,
  CompanionStatus,
  PreferenceDescriptor,
  UsageCostDay,
  UsageProviderInfo,
  UsageSnapshot,
  UsageWindowInfo,
  UsageSpendInfo,
} from "./control-center-types";

/** A provider whose customer must act first; keyed by provider id. */
export type UsageProviderAction = {
  name: string;
  /** The health state that asks for the action (after the setup row's rule). */
  state: string;
  /** The action opens Settings, so nothing is left to finish here. */
  inSettings?: boolean;
  label: string;
  onAction: () => void;
};

type UsageActionView = Omit<UsageProviderAction, "state">;

type UsageScreenProps = {
  busyAction?: string | null;
  companionStatus: CompanionStatus;
  usage: UsageSnapshot | null;
  usageError?: ApiError | null;
  onRefresh?: () => void;
  /** The app runs on Windows, where "Mac App" reads "app". */
  windowsHost?: boolean;
  providerActions?: Record<string, UsageProviderAction>;
  /** Providers that get no tile: switched off, unsupported, or without usage data. */
  hiddenProviderIds?: string[];
  /** The owner keeps the token history notice closed until it clears (see the dialog below). */
  tokenHistoryDismissed?: boolean;
  onDismissTokenHistory?: () => void;
  /** The owner keeps the usage error closed until it clears (see the dialog below). */
  usageErrorDismissed?: boolean;
  onDismissUsageError?: () => void;
  /** Another centred dialog is open: the notice and the error wait for it. */
  centredDialogOpen?: boolean;
};

export function UsageScreen({
  busyAction,
  companionStatus,
  usage,
  usageError,
  onRefresh,
  windowsHost = false,
  providerActions = {},
  hiddenProviderIds = [],
  tokenHistoryDismissed = false,
  onDismissTokenHistory,
  usageErrorDismissed = false,
  onDismissUsageError,
  centredDialogOpen = false,
}: UsageScreenProps) {
  const refreshing = busyAction === "usage";
  const providers = filterVisibleProviders(
    usage?.providers || [],
    usage?.currentProvider,
  );
  const hasProviders = providers.length > 0;
  // Action tiles stand in for a provider's numbers; one with no usage entry
  // still gets its tile, after the others. With no Companion there is no
  // provider to act on, so the Mac App message stands alone.
  const actions = companionStatus === "online" ? providerActions : {};
  // Off, unsupported and without usage data: no tile, even with an entry.
  const tiles = [
    ...providers
      .filter((provider) => !hiddenProviderIds.includes(provider.id))
      .map((provider) => ({
      id: provider.id,
      node: actions[provider.id] ? (
        <UsageActionTile {...actions[provider.id]} />
      ) : (
        <UsageProviderTile provider={provider} />
      ),
    })),
    ...Object.entries(actions)
      .filter(([id]) => !providers.some((provider) => provider.id === id))
      .map(([id, action]) => ({
        id,
        node: <UsageActionTile {...action} />,
      })),
  ];
  const tokenUsageReady =
    usage?.tokenUsageReady === true || usageProvidersHaveTokenResult(providers);
  // The Mac App owns this decision; the browser does not re-derive freshness.
  const tokenUsageUpdating = usage?.tokenUsageUpdating === true;
  // The same providers as the tiles: a hidden one must not make the history look missing.
  const shownProviders = providers.filter(
    (provider) => !hiddenProviderIds.includes(provider.id),
  );
  const tokenHistoryUnavailable = usageTokenHistoryNotice(usage, hiddenProviderIds);
  // A usage error is told first: the token history notice waits until it is closed.
  const usageErrorDialogOpen =
    Boolean(usageError) && !usageErrorDismissed && !centredDialogOpen;
  const tokenHistoryDialogOpen =
    tokenHistoryUnavailable &&
    !tokenHistoryDismissed &&
    !centredDialogOpen &&
    !usageErrorDialogOpen;
  const hasUsableVisibleUsageContent =
    hasProviders || usageProvidersHaveTokenResult(providers);
  // An action tile is content: no loading state beside it.
  const usageLoading =
    companionStatus === "online" &&
    !usageError &&
    !usage &&
    !hasProviders &&
    Object.keys(providerActions).length === 0;
  const tokenUsagePending =
    companionStatus === "online" &&
    !usageError &&
    shownProviders.length > 0 &&
    !tokenUsageReady;
  // A requested refresh that still waits for its reading: a small spinner by
  // the token total, not a notice above the page (Paul, 2026-10-09).
  const refreshPending = usage?.refresh?.state === "refreshing";
  // An action tile is content too: no "still loading" notice beside it.
  const refreshNotice = usageRefreshNotice(usage?.refresh, {
    companionStatus,
    hasUsableVisibleUsageContent:
      hasUsableVisibleUsageContent || Object.keys(providerActions).length > 0,
    usageError,
  });

  return (
    <div>
      <section className="pt-4 pb-8">
        {refreshNotice ? (
          <Alert className="mb-6 bg-muted">
            {refreshNotice.tone === "attention" ? <AlertTriangle /> : <Info />}
            <AlertTitle>{refreshNotice.title}</AlertTitle>
            <AlertDescription>{refreshNotice.description}</AlertDescription>
          </Alert>
        ) : null}

        {usageLoading ? (
          <UsageEmptyState
            companionStatus={companionStatus}
            loading
            windowsHost={windowsHost}
          />
        ) : // The notice is a dialog over this page (below), not a box in it.
        tokenHistoryUnavailable ? (
          <div className="mb-6 flex justify-end">
            <UsageRefreshButton onRefresh={onRefresh} refreshing={refreshing || refreshPending} />
          </div>
        ) : tokenUsageReady && shownProviders.length > 0 ? (
          <TokenUsageOverTimePanel
            onRefresh={onRefresh}
            providers={shownProviders}
            refreshPending={refreshPending}
            refreshing={refreshing || refreshPending}
            updating={tokenUsageUpdating}
          />
        ) : tokenUsagePending ? (
          <TokenUsageSkeleton providerCount={shownProviders.length} />
        ) : null}

        {tiles.length > 0 ? (
          <ol
            className="grid max-w-[1316px] justify-start gap-4"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 428px), 428px))" }}
          >
            {tiles.map((tile) => (
              <li className="min-w-0" key={tile.id}>
                {tile.node}
              </li>
            ))}
          </ol>
        ) : !usageLoading && (!usageError || usageErrorDismissed) ? (
          <UsageEmptyState
            companionStatus={companionStatus}
            loading={false}
            windowsHost={windowsHost}
          />
        ) : null}
      </section>
      {/* A page's own dialogs, not announcements: they do not use data-announcement. */}
      {usageErrorDialogOpen && usageError ? (
        <SetupDialog
          description={usageError.nextAction}
          onOpenChange={(open) => {
            if (!open) onDismissUsageError?.();
          }}
          open
          primaryAction={{
            label: "OK",
            onSelect: () => onDismissUsageError?.(),
          }}
          secondaryAction={
            onRefresh
              ? {
                  busy: refreshing,
                  disabled: refreshing,
                  label: refreshing ? "Trying again" : "Try again",
                  onSelect: onRefresh,
                }
              : undefined
          }
          title={usageError.message}

        />
      ) : null}
      {tokenHistoryDialogOpen ? (
        <SetupDialog
          description={
            /* With one provider on there is no "every" (issue #558). */
            shownProviders.length === 1
              ? copyForHost(
                  `No token history was found for ${shownProviders[0].label || shownProviders[0].id} on this Mac. Your usage limits are shown below.`,
                  windowsHost,
                )
              : "Complete local token history is not available for every selected provider. Available usage limits are shown below."
          }
          onOpenChange={(open) => {
            if (!open) onDismissTokenHistory?.();
          }}
          open
          primaryAction={{
            label: "OK",
            onSelect: () => onDismissTokenHistory?.(),
          }}
          secondaryAction={
            onRefresh
              ? {
                  busy: refreshing || refreshPending,
                  disabled: refreshing || refreshPending,
                  label: refreshing || refreshPending ? "Refreshing" : "Refresh",
                  onSelect: onRefresh,
                }
              : undefined
          }
          title="Token history is unavailable"

        />
      ) : null}
    </div>
  );
}

// The same looks as the provider rows (states overview 644): 3 sign in, 4 allow access.
const usageActionLabels: Record<string, string> = {
  auth_required: "Sign in needed",
  browser_sign_in_required: "Sign in needed",
  setup_required: "Sign in needed",
  permission_required: "Allow access",
};

/** Action tiles for the enabled providers whose health needs the customer. */
export function usageProviderActionsFor(
  preferences: PreferenceDescriptor[] | null,
  {
    onOpenSettings,
    onSignIn,
  }: {
    onOpenSettings: () => void;
    /** Absent where the Companion cannot start a sign-in: every action opens Settings. */
    onSignIn?: (item: PreferenceDescriptor) => void;
  },
): Record<string, UsageProviderAction> {
  return Object.fromEntries(
    (preferences || [])
      .filter(isProviderItem)
      .flatMap((item: ProviderItem): Array<[string, UsageProviderAction]> => {
        const label = usageActionLabels[providerRowHealthState(item.health)];
        if (!label || item.value !== true) {
          return [];
        }
        // The setup row's own rule: a sign-in the Companion can start, else Settings.
        const signIn = Boolean(onSignIn) && setupProviderOffersSignIn(item);
        return [
          [
            item.providerId,
            {
              name: item.label,
              state: providerRowHealthState(item.health),
              inSettings: !signIn,
              label,
              onAction: signIn && onSignIn ? () => onSignIn(item) : onOpenSettings,
            },
          ],
        ];
      }),
  );
}

function usageRefreshNotice(
  refresh: UsageSnapshot["refresh"] | undefined,
  {
    companionStatus,
    hasUsableVisibleUsageContent,
    usageError,
  }: {
    companionStatus: CompanionStatus;
    hasUsableVisibleUsageContent: boolean;
    usageError?: ApiError | null;
  },
) {
  switch (refresh?.state) {
    case "unavailable":
      if (
        companionStatus !== "online" ||
        usageError ||
        hasUsableVisibleUsageContent
      ) {
        return null;
      }
      return {
        tone: "attention" as const,
        title: "Usage is still loading",
        description:
          "Keep this page open. VibeTV updates automatically when usage is ready.",
      };
    default:
      return null;
  }
}

// Stands in for TokenUsageOverTimePanel while its token history loads (issue
// #598): the same blocks at the same heights, grey and without figures, so the
// tiles below do not move when the graph arrives. One legend chip per provider,
// below the chart as the chart will show. Under reduced motion the blocks stand still.
function TokenUsageSkeleton({ providerCount }: { providerCount: number }) {
  return (
    <div aria-live="polite" data-testid="token-history-loading" role="status">
      {/* A heading keeps the provider tiles below in order for assistive tech. */}
      <h2 className="sr-only">Token history is loading</h2>
      <div aria-hidden>
        <section>
          <div className="flex h-8 items-center justify-between gap-4">
            <Skeleton className="h-3.5 w-20" />
            {/* The Refresh button's place. */}
            <div className="size-8 shrink-0" />
          </div>
          <div className="mt-1.5">
            {/* The hero size's line box: 48 px at line height 1.05. */}
            <div className="flex h-[50.4px] items-center">
              <Skeleton className="h-9 w-56 max-w-full" />
            </div>
            <div className="mt-1.5 flex h-[21.75px] items-center">
              <Skeleton className="h-3.5 w-52 max-w-full" />
            </div>
          </div>
        </section>
        <div className="relative mt-12 min-h-56">
          <Skeleton className="h-56 w-full" />
        </div>
        <div className="mt-1.5 mb-14 flex flex-wrap items-center gap-x-[18px] gap-y-1">
          {/* Each chip reserves the legend's line box (21.75 px), so a wrapped row is as tall as the loaded one. */}
          {Array.from({ length: providerCount }, (_, index) => (
            <div className="flex h-[21.75px] items-center" key={index}>
              <Skeleton className="h-3.5 w-14" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function UsageRefreshButton({
  onRefresh,
  refreshing,
}: {
  onRefresh?: () => void;
  refreshing: boolean;
}) {
  return (
    <Button
      aria-busy={refreshing}
      aria-label="Refresh"
      className="size-8 shrink-0 text-muted-foreground"
      disabled={refreshing || !onRefresh}
      onClick={() => onRefresh?.()}
      size="icon"
      type="button"
      variant="ghost"
    >
      {refreshing ? <Spinner /> : <RefreshCw aria-hidden />}
    </Button>
  );
}

function TokenUsageOverTimePanel({
  onRefresh,
  providers,
  refreshPending,
  refreshing,
  updating,
}: {
  onRefresh?: () => void;
  providers: UsageProviderInfo[];
  refreshPending: boolean;
  refreshing: boolean;
  updating: boolean;
}) {
  const currentProviderHistories = getProviderTokenHistories(providers);
  const hasCurrentData = currentProviderHistories.length > 0;
  const displayedHistories = hasCurrentData
    ? currentProviderHistories
    : providers.map((provider) => ({ days: [], provider }));

  const { chartConfig, chartData, series } =
    buildProviderTokenChart(displayedHistories);
  const providerNames = displayedHistories.map(
    ({ provider }) => provider.label || provider.id,
  );
  const last30DaysTokens = getLast30DaysTokenTotal(providers) ?? 0;

  return (
    <>
      <section aria-labelledby="total-tokens-heading">
        <div className="flex h-8 items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2">
            <h2
              className="text-[14.5px] font-normal text-muted-foreground"
              id="total-tokens-heading"
            >
              Last 30 days
            </h2>
            {updating ? (
              <Badge
                aria-live="polite"
                data-testid="token-history-updating"
                variant="secondary"
              >
                <Spinner className="size-3" data-icon="inline-start" />
                Still counting
              </Badge>
            ) : refreshPending ? (
              <Badge
                aria-live="polite"
                data-testid="usage-refresh-pending"
                variant="secondary"
              >
                <Spinner className="size-3" data-icon="inline-start" />
                Refreshing
              </Badge>
            ) : null}
          </div>
          <UsageRefreshButton onRefresh={onRefresh} refreshing={refreshing} />
        </div>
        <div className="mt-1.5">
          <p className="text-hero break-words font-semibold text-foreground tabular-nums">
            <span>{formatFullTokenCount(last30DaysTokens)}</span>
            <span className="ml-2.5 text-[14.5px] font-normal tracking-normal text-muted-foreground">
              tokens
            </span>
          </p>
          <p className="mt-1.5 text-[14.5px] leading-normal text-muted-foreground">
            {formatTokenCountInWords(last30DaysTokens)}
          </p>
        </div>
      </section>

      <div className="relative mt-12 min-h-56">
        <ChartContainer
          aria-hidden={!hasCurrentData}
          aria-label={`Daily tokens used over time for ${providerNames.join(", ")}`}
          className={cn(
            "h-56 w-full overflow-hidden transition-opacity",
            !hasCurrentData && "pointer-events-none opacity-25 grayscale",
          )}
          config={chartConfig}
          role="img"
        >
          <AreaChart
            accessibilityLayer
            data={chartData}
            margin={{ top: 16, right: 0, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              stroke="var(--foreground)"
              strokeOpacity={0.09}
              vertical={false}
            />
            <XAxis
              axisLine={{ stroke: "var(--foreground)", strokeOpacity: 0.22 }}
              dataKey="day"
              height={48}
              interval={0}
              ticks={weeklyDayTicks(chartData.map((row) => String(row.day)))}
              tick={WeekTick}
              tickLine={false}
              tickMargin={5}
            />
            <YAxis
              axisLine={false}
              tick={ValueTick}
              tickCount={3}
              tickFormatter={formatTokenCount}
              tickLine={false}
              tickMargin={8}
              width={44}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => formatDayLabel(String(value))}
                />
              }
              cursor={false}
            />
            {series.map((item) => (
              <Area
                activeDot={{ r: 4 }}
                connectNulls={false}
                dataKey={item.dataKey}
                fill={`var(--color-${item.dataKey})`}
                fillOpacity={0.05}
                isAnimationActive={false}
                key={item.dataKey}
                stroke={`var(--color-${item.dataKey})`}
                strokeWidth={2.5}
                type="monotone"
              />
            ))}
          </AreaChart>
        </ChartContainer>

        {!hasCurrentData ? (
          <Empty
            aria-live="polite"
            className="absolute inset-0 min-h-0 bg-transparent p-4"
            role="status"
          >
            <EmptyHeader>
              <EmptyTitle>
                <Badge variant="secondary">No data</Badge>
              </EmptyTitle>
              <EmptyDescription>
                Token history is temporarily unavailable.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
      </div>
      <div
        className="mt-1.5 mb-14 flex flex-wrap items-center gap-x-[18px] gap-y-1 text-[14.5px] text-muted-foreground"
        data-testid="usage-legend"
      >
        {series.map((item) => (
          <span className="inline-flex items-center" key={item.dataKey}>
            <i
              aria-hidden
              className="mr-[7px] inline-block size-2 rounded-full"
              style={{ background: item.color }}
            />
            {item.label}
          </span>
        ))}
      </div>
    </>
  );
}

const RESET_COUNTDOWN_TICK_MS = 15_000;

function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

// One tile per provider: the numbers the Mac App delivers, nothing computed here.
function UsageProviderTile({ provider }: { provider: UsageProviderInfo }) {
  // The countdown shows whole minutes; its own tick moves it between usage polls.
  const now = useNow(RESET_COUNTDOWN_TICK_MS);
  // Stale or unavailable is decided by the Mac App; the tile only shows the flags.
  const quiet = Boolean(provider.stale || provider.usageUnavailable);
  const lines = usageLines(provider, now, quiet);
  // The Updating spinner takes the place of the first line's reset, on that line.
  const spinner = quiet ? (
    <Loader2
      aria-label="Updating"
      className="size-3.5 animate-spin text-muted-foreground"
      role="img"
    />
  ) : null;
  return (
    <UsageTileFrame name={provider.label || provider.id} plan={provider.plan}>
      {usageHasNumbers(provider) ? (
        <div className="grid gap-[22px]">
          {lines.map((line, index) => (
            <UsageLineView
              index={index}
              key={line.key}
              line={line}
              mode={provider.usageMode}
              status={index === 0 ? spinner : null}
            />
          ))}
        </div>
      ) : (
        <UsageSkeleton status={spinner} />
      )}
      <UsageMetaGrid provider={provider} />
      <TokenRow provider={provider} />
    </UsageTileFrame>
  );
}

// The tile for a provider where the customer must act first. No numbers.
function UsageActionTile({ label, name, onAction }: UsageActionView) {
  return (
    <UsageTileFrame
      action={<UsageActionLink label={label} name={name} onAction={onAction} />}
      name={name}
    >
      <UsageSkeleton />
    </UsageTileFrame>
  );
}

function UsageActionLink({ label, name, onAction }: UsageActionView) {
  return (
    <button
      aria-label={`${label} for ${name}`}
      className="inline-flex items-center gap-1 font-semibold text-destructive hover:underline"
      onClick={onAction}
      type="button"
    >
      {label}
      <ArrowUpRight aria-hidden className="size-3.5" />
    </button>
  );
}

// A stale reading keeps its last good numbers. The Companion says which lanes
// are such a retained reading, a real 0 included; a cleared or never-read lane
// is not, so it never shows as "0% used".
function usageRetainedNumbers(provider: UsageProviderInfo): boolean {
  return Boolean(
    provider.sessionRetained ||
      provider.weeklyRetained ||
      provider.windowsRetained,
  );
}

function usageHasNumbers(provider: UsageProviderInfo): boolean {
  return !provider.usageUnavailable || usageRetainedNumbers(provider);
}

function UsageTileFrame({
  action,
  children,
  name,
  plan,
}: {
  action?: ReactNode;
  children: ReactNode;
  name: string;
  plan?: string;
}) {
  return (
    <Card className="h-full min-h-[196px] [--card-spacing:22px]">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline gap-x-2 break-words text-[15px] font-semibold">
          <span>
            {name}
            {plan ? (
              <span className="font-normal text-muted-foreground">{` · ${plan}`}</span>
            ) : null}
          </span>
          {action}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-[22px]">{children}</CardContent>
    </Card>
  );
}

// Stands in for numbers that are not there. Shape only, no text.
function UsageSkeleton({ status }: { status?: ReactNode }) {
  return (
    <div className="grid gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <Skeleton aria-hidden className="h-7 w-24" />
        {status}
      </div>
      <div aria-hidden className="grid gap-3">
        <Skeleton className="h-3 w-full rounded-[4px]" />
        <div className="flex justify-between">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="h-3 w-full rounded-[4px]" />
        <Skeleton className="h-3 w-40" />
      </div>
    </div>
  );
}

type UsageLine = {
  key: string;
  label: string;
  percent: number;
  resetText: string | null;
  runsOutText: string | null;
  unavailable: boolean;
};

// Shown only when CodexBar says the window will not last to its reset.
function runsOutText(window: UsageWindowInfo, etaLeft: number): string | null {
  return window.willLastToReset === false && etaLeft > 0
    ? `Runs out in ${formatResetCountdown(etaLeft)}`
    : null;
}

// The two generic lanes keep their lowercase wording; any other window shows
// the label CodexBar delivered, as it is ("Fable only" stays "Fable only").
function windowLabel(label: string): string {
  const generic = label.trim().toLowerCase();
  return generic === "session" || generic === "weekly" ? generic : label;
}

function usageLines(
  provider: UsageProviderInfo,
  now: Date,
  quiet: boolean,
): UsageLine[] {
  const resetText = (resetSecs?: number) => {
    const left = remainingResetSecs(resetSecs, provider.collectedAt, now);
    return !quiet && left ? formatReset(left) : null;
  };
  // A stale reading is flagged unavailable on every lane. Only a lane the
  // Companion marks as retained shows its number; any other lane is a
  // placeholder.
  const laneUnavailable = (retained?: boolean, flag?: boolean) =>
    provider.stale ? !retained : Boolean(flag);
  if (provider.windows?.length) {
    return provider.windows.map((window) => ({
      key: window.id,
      label: windowLabel(window.label),
      percent: clampPercent(window.usedPercent),
      resetText: resetText(window.resetSecs),
      runsOutText: quiet
        ? null
        : runsOutText(
            window,
            remainingResetSecs(window.etaSeconds, provider.collectedAt, now),
          ),
      unavailable: laneUnavailable(provider.windowsRetained),
    }));
  }
  const session = laneUnavailable(
    provider.sessionRetained,
    provider.sessionUnavailable,
  );
  const weekly = laneUnavailable(
    provider.weeklyRetained,
    provider.weeklyUnavailable,
  );
  return [
    {
      key: "session",
      label: "session",
      percent: clampPercent(provider.session),
      resetText: session ? null : resetText(provider.resetSecs),
      runsOutText: null,
      unavailable: session,
    },
    {
      key: "weekly",
      label: "weekly",
      percent: clampPercent(provider.weekly),
      resetText: weekly ? null : resetText(provider.resetSecs),
      runsOutText: null,
      unavailable: weekly,
    },
  ];
}

// Each lane's reset sits right-aligned on its own line. The first line (the big
// number) also takes the Updating spinner in that place while the tile is quiet.
function UsageLineView({
  index,
  line,
  mode,
  status,
}: {
  index: number;
  line: UsageLine;
  mode?: string;
  status?: ReactNode;
}) {
  const right = line.resetText ? (
    <span className="ml-auto shrink-0 text-muted-foreground">{line.resetText}</span>
  ) : (
    status
  );
  if (line.unavailable) {
    return (
      <div className="grid gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <span className="sr-only">{`${line.label} usage unavailable`}</span>
          <Skeleton aria-hidden className="h-3 w-24" />
          {right}
        </div>
        <Skeleton aria-hidden className="h-3 w-full rounded-[4px]" />
      </div>
    );
  }
  const modeLabel = usageModeShortLabel(mode);
  const text = `${line.percent}% ${line.label} ${modeLabel}`;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[14.5px] text-foreground">
        {index === 0 ? (
          <span className="whitespace-nowrap leading-none text-muted-foreground">
            <span className="text-[32px] leading-none font-semibold text-foreground">
              {line.percent}%
            </span>{" "}
            {line.label} {modeLabel}
          </span>
        ) : (
          <span className="whitespace-nowrap">
            {line.percent}%{" "}
            <span className="text-muted-foreground">
              {line.label} {modeLabel}
            </span>
          </span>
        )}
        {right}
      </div>
      <Progress
        aria-label={text}
        className="h-3 rounded-[4px] [&_[data-slot=progress-indicator]]:rounded-[4px]"
        value={line.percent}
      />
      {line.runsOutText ? (
        <p className="text-[13px] text-destructive">{line.runsOutText}</p>
      ) : null}
    </div>
  );
}

// CodexBar's extra-usage cap in its own currency. Nothing without a usable cap.
function spendText(spend: UsageSpendInfo | undefined): string | null {
  if (
    !spend ||
    !finiteNumber(spend.limit) ||
    spend.limit <= 0 ||
    !finiteNumber(spend.used) ||
    !/^[A-Za-z]{3}$/.test(spend.currency)
  ) {
    return null;
  }
  const money = (value: number) =>
    new Intl.NumberFormat("en-US", {
      currency: spend.currency,
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
      style: "currency",
    }).format(value);
  const period = /^monthly\b/i.test(spend.period ?? "") ? " this month" : "";
  return `Extra usage ${money(spend.used)} of ${money(spend.limit)}${period}`;
}

function TokenRow({ provider }: { provider: UsageProviderInfo }) {
  const parts = [
    provider.totalTokens ? `${formatTokenCount(provider.totalTokens)} total` : null,
    provider.weekTokens ? `${formatTokenCount(provider.weekTokens)} this week` : null,
  ].filter(Boolean);
  const spend = spendText(provider.spend);

  if (parts.length === 0 && !spend) {
    return null;
  }

  return (
    <div className="mt-auto grid gap-1 text-[14.5px] text-muted-foreground">
      {parts.length > 0 ? <p>Tokens: {parts.join(" · ")}</p> : null}
      {spend ? <p>{spend}</p> : null}
    </div>
  );
}

function UsageMetaGrid({ provider }: { provider: UsageProviderInfo }) {
  const items = [
    provider.status?.description
      ? ["Status", providerStatusLabel(provider.status.description)]
      : null,
  ].filter(Boolean) as Array<[string, string]>;

  if (items.length === 0) {
    return null;
  }

  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      {items.map(([label, value]) => (
        <div className="min-w-0" key={label}>
          <dt className="text-[14.5px] text-muted-foreground">{label}</dt>
          <dd className="mt-1 break-words text-[14.5px] text-muted-foreground">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function UsageEmptyState({
  companionStatus,
  loading,
  windowsHost,
}: {
  companionStatus: CompanionStatus;
  loading: boolean;
  windowsHost: boolean;
}) {
  const message =
    companionStatus === "online"
      ? loading
        ? "Loading usage"
        : "No provider usage is available yet."
      : copyForHost("Mac App needs setup.", windowsHost);
  const action =
    companionStatus === "online"
      ? loading
        ? null
        : "Manage providers in Settings, then refresh usage."
      : "Run setup again, then refresh usage.";

  return (
    <Empty
      aria-live="polite"
      className="bg-muted/50 py-10 ring-1 ring-foreground/10"
      role="status"
    >
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {loading ? (
            <Spinner />
          ) : (
            <BarChart3 size={17} aria-hidden />
          )}
        </EmptyMedia>
        <EmptyTitle>{message}</EmptyTitle>
        {action ? <EmptyDescription>{action}</EmptyDescription> : null}
      </EmptyHeader>
    </Empty>
  );
}

// Token history was read and at least one shown provider has none.
export function usageTokenHistoryUnavailable(usage: UsageSnapshot | null): boolean {
  const providers = filterVisibleProviders(
    usage?.providers || [],
    usage?.currentProvider,
  );
  return (
    (usage?.tokenUsageReady === true || usageProvidersHaveTokenResult(providers)) &&
    providers.some((provider) => provider.cost == null)
  );
}

// The Usage notice: a provider that is shown and has no token history. Hidden
// providers do not count, so the notice and the tiles agree.
export function usageTokenHistoryNotice(
  usage: UsageSnapshot | null,
  hiddenProviderIds: string[] = [],
): boolean {
  return usageTokenHistoryUnavailable(
    usage && {
      ...usage,
      providers: usage.providers.filter(
        (provider) => !hiddenProviderIds.includes(provider.id),
      ),
    },
  );
}

// Themes asks for a theme that draws token numbers. VibeTV draws those of one
// provider, so only that one counts; without one, all shown must have none.
export function usageTokenHistoryUnavailableOnVibeTV(usage: UsageSnapshot | null): boolean {
  if (!usage || !usageTokenHistoryUnavailable(usage)) return false;
  const providers = filterVisibleProviders(usage.providers || [], usage.currentProvider);
  const current = providers.find((provider) => provider.id === usage.currentProvider);
  return current ? current.cost == null : !usageProvidersHaveTokenResult(providers);
}

function filterVisibleProviders(
  providers: UsageProviderInfo[],
  currentProvider?: string,
): UsageProviderInfo[] {
  return providers.filter((provider) =>
    shouldShowProvider(provider, currentProvider),
  );
}

function shouldShowProvider(
  provider: UsageProviderInfo,
  currentProvider?: string,
): boolean {
  if (provider.id === currentProvider) {
    return true;
  }
  if (providerHasUsage(provider)) {
    return true;
  }
  if (providerHasTokens(provider)) {
    return true;
  }
  if (providerHasCost(provider)) {
    return true;
  }
  if (providerHasPlanOrSpend(provider)) {
    return true;
  }
  return (provider.usageOverTime || []).some(
    (point) => point.totalCreditsUsed > 0,
  );
}

function providerHasUsage(provider: UsageProviderInfo): boolean {
  if (usageRetainedNumbers(provider)) {
    return true;
  }
  if (provider.usageMode === "remaining") {
    return provider.session < 100 || provider.weekly < 100;
  }
  if (provider.session > 0 || provider.weekly > 0) {
    return true;
  }
  return (provider.windows || []).some((window) => window.usedPercent > 0);
}

function providerHasTokens(provider: UsageProviderInfo): boolean {
  return (
    (provider.sessionTokens || 0) > 0 ||
    (provider.weekTokens || 0) > 0 ||
    (provider.totalTokens || 0) > 0
  );
}

function usageProvidersHaveTokenResult(
  providers: UsageProviderInfo[],
): boolean {
  return providers.some((provider) => provider.cost != null);
}

function providerHasCost(provider: UsageProviderInfo): boolean {
  const cost = provider.cost;
  if (!cost) {
    return false;
  }
  return (
    (cost.daily || []).length > 0 ||
    (cost.todayCostUSD || 0) > 0 ||
    (cost.last30DaysCostUSD || 0) > 0 ||
    (cost.last30DaysTokens || 0) > 0 ||
    (cost.latestTokens || 0) > 0 ||
    Boolean(cost.topModel?.trim())
  );
}

function providerHasPlanOrSpend(provider: UsageProviderInfo): boolean {
  return Boolean(provider.plan?.trim()) || spendText(provider.spend) !== null;
}

function normalizeTokenHistory(days: UsageCostDay[]) {
  return days
    .filter(
      (day) =>
        Boolean(day.day) &&
        finiteNumber(day.totalTokens) &&
        day.totalTokens >= 0,
    )
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-30);
}

type ProviderTokenHistory = {
  days: UsageCostDay[];
  provider: UsageProviderInfo;
};

function getProviderTokenHistories(
  providers: UsageProviderInfo[],
): ProviderTokenHistory[] {
  return providers.flatMap((provider) => {
    const days = normalizeTokenHistory(provider.cost?.daily || []);
    return days.some((day) => (day.totalTokens || 0) > 0)
      ? [{ days, provider }]
      : [];
  });
}

function getLast30DaysTokenTotal(
  providers: UsageProviderInfo[],
): number | null {
  const providerTotals = providers.flatMap((provider) => {
    const reportedTotal = provider.cost?.last30DaysTokens;
    if (finiteNumber(reportedTotal) && reportedTotal >= 0) {
      return [reportedTotal];
    }

    const days = normalizeTokenHistory(provider.cost?.daily || []);
    if (days.length === 0) {
      return [];
    }
    return [days.reduce((sum, day) => sum + (day.totalTokens || 0), 0)];
  });

  return providerTotals.length > 0
    ? providerTotals.reduce((sum, total) => sum + total, 0)
    : null;
}

const usageProviderChartColors = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

export function buildProviderTokenChart(
  providerHistories: Array<{
    days: UsageCostDay[];
    provider: UsageProviderInfo;
  }>,
) {
  // Claude keeps the ink and Codex the olive, whatever order the response lists them in.
  // Any other provider takes one of the three colours left, so it never looks like them.
  const colorById: Record<string, string> = {
    claude: usageProviderChartColors[0],
    codex: usageProviderChartColors[1],
  };
  const otherColors = usageProviderChartColors.slice(2);
  let otherCount = 0;
  const series = providerHistories.map(({ provider }, index) => ({
    color:
      colorById[provider.id] ?? otherColors[otherCount++ % otherColors.length],
    dataKey: `provider${index + 1}`,
    label: provider.label || provider.id,
  }));
  const rowsByDay = new Map<string, Record<string, number | string>>();

  providerHistories.forEach(({ days }, index) => {
    const dataKey = series[index].dataKey;
    for (const day of days) {
      const row = rowsByDay.get(day.day) || { day: day.day };
      row[dataKey] = day.totalTokens || 0;
      rowsByDay.set(day.day, row);
    }
  });

  // Only a settled history establishes that a missing day had no tokens
  // (#579). While counting, leave those days unknown, including internal gaps.
  const settledZeros = Object.fromEntries(
    providerHistories.flatMap(({ provider }, index) =>
      provider.costSettled === true ? [[series[index].dataKey, 0]] : [],
    ),
  );
  const days = [...rowsByDay.keys()].sort();
  const chartData = (calendarDays(days[0], days[days.length - 1]) ?? days).map((day) => ({
    ...settledZeros,
    ...(rowsByDay.get(day) || { day }),
  }));
  const chartConfig: ChartConfig = Object.fromEntries(
    series.map((item) => [
      item.dataKey,
      {
        color: item.color,
        label: item.label,
      },
    ]),
  );

  return { chartConfig, chartData, series };
}

/**
 * Every calendar day from first to last (`YYYY-MM-DD`), both included, or
 * null when the days cannot be read or lie further apart than a history can
 * hold; the chart then keeps the reported days as they are.
 */
function calendarDays(first: string | undefined, last: string | undefined): string[] | null {
  const start = Date.parse(`${first}T00:00:00Z`);
  const end = Date.parse(`${last}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end - start > 400 * 86_400_000) {
    return null;
  }
  const days: string[] = [];
  for (let time = start; time <= end; time += 86_400_000) {
    days.push(new Date(time).toISOString().slice(0, 10));
  }
  return days;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function usageModeShortLabel(mode?: string): string {
  return mode === "remaining" ? "remaining" : "used";
}

/** Customer-facing reset wording, shared with the setup display-mode step. */
export function formatReset(secondsLeft: number): string {
  return secondsLeft > 0
    ? `Reset in ${formatResetCountdown(secondsLeft)}`
    : "Reset unknown";
}

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
    notation: value >= 10_000 ? "compact" : "standard",
    }).format(value);
}

function formatFullTokenCount(value: number | null): string {
  if (!finiteNumber(value)) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

const tokenNumberOnes = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
] as const;

const tokenNumberTens = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
] as const;

const tokenNumberScales = [
  "",
  "thousand",
  "million",
  "billion",
  "trillion",
  "quadrillion",
] as const;

function formatTokenCountInWords(value: number): string {
  const roundedValue = Math.round(value);
  if (!Number.isSafeInteger(roundedValue) || roundedValue < 0) {
    return "unavailable";
  }
  if (roundedValue === 0) {
    return tokenNumberOnes[0];
  }

  const groups: string[] = [];
  let remaining = roundedValue;
  let scaleIndex = 0;
  while (remaining > 0) {
    const chunk = remaining % 1000;
    if (chunk > 0) {
      const scale = tokenNumberScales[scaleIndex];
      groups.unshift(
        [formatTokenNumberChunk(chunk), scale].filter(Boolean).join(" "),
      );
    }
    remaining = Math.floor(remaining / 1000);
    scaleIndex += 1;
  }
  return groups.join(" ");
}

function formatTokenNumberChunk(value: number): string {
  const words: string[] = [];
  const hundreds = Math.floor(value / 100);
  const remainder = value % 100;

  if (hundreds > 0) {
    words.push(`${tokenNumberOnes[hundreds]} hundred`);
  }
  if (remainder > 0 && remainder < 20) {
    words.push(tokenNumberOnes[remainder]);
  } else if (remainder >= 20) {
    const tens = tokenNumberTens[Math.floor(remainder / 10)];
    const ones = remainder % 10;
    words.push(ones > 0 ? `${tens}-${tokenNumberOnes[ones]}` : tens);
  }

  return words.join(" ");
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function providerStatusLabel(description?: string): string {
  const value = (description || "").trim();
  if (!value) {
    return "Status ready";
  }
  return value;
}

// The value labels start at the left edge of the chart, as in the master (the plot begins 44 px further right).
function ValueTick({ payload, y }: YAxisTickContentProps) {
  return (
    <text dy="0.32em" fill="var(--muted-foreground)" fontSize={14.5} textAnchor="start" x={0} y={y}>
      {formatTokenCount(Number(payload.value))}
    </text>
  );
}

// The first label starts at the axis and the last one ends at its right edge, as in the master.
function WeekTick({
  index,
  payload,
  visibleTicksCount,
  x,
  y,
}: XAxisTickContentProps) {
  return (
    <text
      dy="0.71em"
      fill="var(--muted-foreground)"
      fontSize={14.5}
      textAnchor={
        index === 0
          ? "start"
          : index === visibleTicksCount - 1
            ? "end"
            : "middle"
      }
      x={x}
      y={y}
    >
      {formatDayLabel(String(payload.value))}
    </text>
  );
}

// The master's week axis: the first day, then every seventh day, and the last
// day, left out only where it would crowd the last one.
export function weeklyDayTicks(days: string[]): string[] {
  const dayMs = 86_400_000;
  const first = days[0];
  const last = days[days.length - 1];
  if (first === undefined || last === undefined) {
    return [];
  }
  const start = Date.parse(`${first}T00:00:00Z`);
  const end = Date.parse(`${last}T00:00:00Z`);
  const weekly = days.filter((day) => {
    const offset = (Date.parse(`${day}T00:00:00Z`) - start) / dayMs;
    return day !== first && offset % 7 === 0 && (end - Date.parse(`${day}T00:00:00Z`)) / dayMs >= 4;
  });
  // The first day is always labelled, also in a short history; a set drops it twice when it is the last day too.
  return [...new Set([first, ...weekly, last])];
}

function formatDayLabel(day: string): string {
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return day;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}
