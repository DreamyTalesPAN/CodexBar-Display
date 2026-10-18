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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
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
  const tokenHistoryUnavailable = usageTokenHistoryUnavailable(
    usage && {
      ...usage,
      providers: usage.providers.filter(
        (provider) => !hiddenProviderIds.includes(provider.id),
      ),
    },
  );
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
    hasProviders &&
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
    <div className="mx-auto max-w-[1180px]">
      <section className="py-10">
        {usageError ? (
          <Alert className="mb-6 bg-muted">
            <AlertTriangle />
            <AlertTitle>{usageError.message}</AlertTitle>
            <AlertDescription className="grid justify-items-start gap-3">
              <span>{usageError.nextAction}</span>
              {onRefresh ? (
                <Button
                  aria-busy={refreshing}
                  disabled={refreshing}
                  onClick={onRefresh}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {refreshing ? <Spinner /> : <RefreshCw aria-hidden />}
                  {refreshing ? "Trying again" : "Try again"}
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
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
        ) : tokenHistoryUnavailable ? (
          <Alert className="mb-6 bg-muted">
            <Info />
            <AlertTitle>Token history is unavailable</AlertTitle>
            <AlertDescription className="grid justify-items-start gap-3">
              <span>
                {/* With one provider on there is no "every" (issue #558). */}
                {shownProviders.length === 1
                  ? copyForHost(
                      `No token history was found for ${shownProviders[0].label || shownProviders[0].id} on this Mac. Your usage limits are shown below.`,
                      windowsHost,
                    )
                  : "Complete local token history is not available for every selected provider. Available usage limits are shown below."}
              </span>
              {onRefresh ? (
                <Button
                  aria-label="Refresh token usage"
                  aria-busy={refreshing || refreshPending}
                  disabled={refreshing || refreshPending}
                  onClick={onRefresh}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {refreshing || refreshPending ? (
                    <Spinner />
                  ) : (
                    <RefreshCw aria-hidden />
                  )}
                  {refreshing || refreshPending ? "Refreshing" : "Refresh"}
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : tokenUsageReady && hasProviders ? (
          <TokenUsageOverTimePanel
            onRefresh={onRefresh}
            providers={providers}
            refreshPending={refreshPending}
            refreshing={refreshing || refreshPending}
            updating={tokenUsageUpdating}
          />
        ) : tokenUsagePending ? (
          <Card
            aria-live="polite"
            className="mb-6 min-h-[294px] items-center justify-center"
            data-testid="token-history-loading"
            role="status"
          >
            <Spinner className="size-6" />
            <span className="sr-only">Token history is loading</span>
          </Card>
        ) : null}

        {tiles.length > 0 ? (
          <ol className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
            {tiles.map((tile) => (
              <li className="min-w-0" key={tile.id}>
                {tile.node}
              </li>
            ))}
          </ol>
        ) : !usageLoading && !usageError ? (
          <UsageEmptyState
            companionStatus={companionStatus}
            loading={false}
            windowsHost={windowsHost}
          />
        ) : null}
      </section>
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
      <section
        aria-labelledby="total-tokens-heading"
        className="mb-6 px-4 text-center"
      >
        {updating ? (
          <Badge
            aria-live="polite"
            className="mb-3"
            data-testid="token-history-updating"
            variant="secondary"
          >
            <Spinner className="size-3" data-icon="inline-start" />
            Still counting
          </Badge>
        ) : refreshPending ? (
          <Badge
            aria-live="polite"
            className="mb-3"
            data-testid="usage-refresh-pending"
            variant="secondary"
          >
            <Spinner className="size-3" data-icon="inline-start" />
            Refreshing
          </Badge>
        ) : null}
        <h2
          className="text-sm font-bold uppercase tracking-wide text-muted-foreground"
          id="total-tokens-heading"
        >
          Total tokens in the last 30 days
        </h2>
        <p className="mt-2 break-words text-3xl font-black tracking-tight tabular-nums sm:text-5xl">
          {formatFullTokenCount(last30DaysTokens)}
        </p>
        {last30DaysTokens !== null ? (
          <p className="mx-auto mt-2 max-w-3xl text-sm font-semibold leading-relaxed text-muted-foreground">
            {formatTokenCountInWords(last30DaysTokens)} tokens
          </p>
        ) : null}
      </section>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Tokens used over time</CardTitle>
          <CardAction>
            <Button
              aria-busy={refreshing}
              aria-label="Refresh token usage"
              disabled={refreshing || !onRefresh}
              onClick={() => onRefresh?.()}
              size="sm"
              type="button"
              variant="outline"
            >
              {refreshing ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RefreshCw data-icon="inline-start" aria-hidden />
              )}
              {refreshing ? "Refreshing" : "Refresh"}
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent>
          <div className="relative min-h-52">
            <ChartContainer
              aria-hidden={!hasCurrentData}
              aria-label={`Daily tokens used over time for ${providerNames.join(", ")}`}
              className={cn(
                "h-52 w-full overflow-hidden px-2 pt-3 transition-opacity",
                !hasCurrentData && "pointer-events-none opacity-25 grayscale",
              )}
              config={chartConfig}
              role="img"
            >
              <AreaChart
                accessibilityLayer
                data={chartData}
                margin={{ top: 8, right: 10, bottom: 0, left: 10 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  axisLine={false}
                  dataKey="day"
                  interval="preserveStartEnd"
                  minTickGap={28}
                  tickFormatter={formatDayLabel}
                  tickLine={false}
                  tickMargin={8}
                />
                <YAxis
                  axisLine={false}
                  tickFormatter={formatTokenCount}
                  tickLine={false}
                  tickMargin={8}
                  width={48}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(value) => formatDayLabel(String(value))}
                    />
                  }
                  cursor={false}
                />
                <ChartLegend
                  content={
                    <ChartLegendContent className="flex-wrap gap-x-4 gap-y-2 pb-1" />
                  }
                />
                {series.map((item) => (
                  <Area
                    activeDot={{ r: 4 }}
                    connectNulls={false}
                    dataKey={item.dataKey}
                    fill={`var(--color-${item.dataKey})`}
                    fillOpacity={0.12}
                    isAnimationActive={false}
                    key={item.dataKey}
                    stroke={`var(--color-${item.dataKey})`}
                    strokeWidth={2}
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
        </CardContent>
      </Card>
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
    <UsageTileFrame name={provider.label || provider.id}>
      {usageHasNumbers(provider) ? (
        <div className="grid gap-4">
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

// A stale reading keeps its last good numbers, and the API flags its lanes
// unavailable too. A cleared or never-read stale provider is all zeros and
// must not show as "0% used", so only a non-zero stale reading counts.
function usageRetainedNumbers(provider: UsageProviderInfo): boolean {
  return (
    Boolean(provider.stale) &&
    (provider.session > 0 ||
      provider.weekly > 0 ||
      (provider.windows || []).some((window) => window.usedPercent > 0))
  );
}

function usageHasNumbers(provider: UsageProviderInfo): boolean {
  return !provider.usageUnavailable || usageRetainedNumbers(provider);
}

function UsageTileFrame({
  action,
  children,
  name,
}: {
  action?: ReactNode;
  children: ReactNode;
  name: string;
}) {
  return (
    <Card className="h-full min-h-[248px] [--card-spacing:--spacing(5)]">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline gap-x-2 break-words text-[13px] font-semibold">
          {name}
          {action}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">{children}</CardContent>
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
        <Skeleton className="h-1.5 w-full" />
        <div className="flex justify-between">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="h-1.5 w-full" />
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
  unavailable: boolean;
};

function usageLines(
  provider: UsageProviderInfo,
  now: Date,
  quiet: boolean,
): UsageLine[] {
  const resetText = (resetSecs?: number) => {
    const left = remainingResetSecs(resetSecs, provider.collectedAt, now);
    return !quiet && left ? formatReset(left) : null;
  };
  // A stale reading is flagged unavailable on every lane, yet keeps its last
  // good numbers. A zero there may be a cleared reading, so it is never shown
  // as "0% used": the lane shows the placeholder instead.
  const laneUnavailable = (value: number, flag?: boolean) =>
    provider.stale ? value === 0 : Boolean(flag);
  if (provider.windows?.length) {
    return provider.windows.map((window) => ({
      key: window.id,
      label: window.label.toLowerCase(),
      percent: clampPercent(window.usedPercent),
      resetText: resetText(window.resetSecs),
      unavailable: laneUnavailable(window.usedPercent),
    }));
  }
  const session = laneUnavailable(provider.session, provider.sessionUnavailable);
  const weekly = laneUnavailable(provider.weekly, provider.weeklyUnavailable);
  return [
    {
      key: "session",
      label: "session",
      percent: clampPercent(provider.session),
      resetText: session ? null : resetText(provider.resetSecs),
      unavailable: session,
    },
    {
      key: "weekly",
      label: "weekly",
      percent: clampPercent(provider.weekly),
      resetText: weekly ? null : resetText(provider.resetSecs),
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
        <Skeleton aria-hidden className="h-1.5 w-full" />
      </div>
    );
  }
  const modeLabel = usageModeShortLabel(mode);
  const text = `${line.percent}% ${line.label} ${modeLabel}`;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[13px] text-foreground">
        {index === 0 ? (
          <span className="whitespace-nowrap text-muted-foreground">
            <span className="text-[28px] leading-none font-semibold text-foreground">
              {line.percent}%
            </span>{" "}
            {line.label} {modeLabel}
          </span>
        ) : (
          <span className="whitespace-nowrap">{text}</span>
        )}
        {right}
      </div>
      <Progress aria-label={text} className="h-1.5" value={line.percent} />
    </div>
  );
}

function TokenRow({ provider }: { provider: UsageProviderInfo }) {
  const parts = [
    provider.totalTokens ? `${formatTokenCount(provider.totalTokens)} total` : null,
    provider.weekTokens ? `${formatTokenCount(provider.weekTokens)} this week` : null,
  ].filter(Boolean);

  if (parts.length === 0) {
    return null;
  }

  return (
    <p className="mt-auto pt-5 text-[13px] text-muted-foreground">
      Tokens: {parts.join(" · ")}
    </p>
  );
}

function UsageMetaGrid({ provider }: { provider: UsageProviderInfo }) {
  const items = [
    provider.status?.description
      ? ["Status", providerStatusLabel(provider.status.description)]
      : null,
    provider.activity ? ["Activity", provider.activity] : null,
  ].filter(Boolean) as Array<[string, string]>;

  if (items.length === 0) {
    return null;
  }

  return (
    <dl className="mt-5 grid gap-3 sm:grid-cols-3">
      {items.map(([label, value]) => (
        <div className="min-w-0" key={label}>
          <dt className="text-[13px] text-muted-foreground">{label}</dt>
          <dd className="mt-1 break-words text-[13px] text-muted-foreground">
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
  return (provider.usageOverTime || []).some(
    (point) => point.totalCreditsUsed > 0,
  );
}

function providerHasUsage(provider: UsageProviderInfo): boolean {
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

function buildProviderTokenChart(
  providerHistories: Array<{
    days: UsageCostDay[];
    provider: UsageProviderInfo;
  }>,
) {
  const series = providerHistories.map(({ provider }, index) => ({
    color: usageProviderChartColors[index % usageProviderChartColors.length],
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

  const chartData = [...rowsByDay.values()].sort((a, b) =>
    String(a.day).localeCompare(String(b.day)),
  );
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
