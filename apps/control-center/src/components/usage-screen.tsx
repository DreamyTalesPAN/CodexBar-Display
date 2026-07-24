"use client";

import {
  AlertTriangle,
  BarChart3,
  Info,
  RefreshCw,
  Search,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
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
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
  ApiError,
  CompanionStatus,
  PreferenceDescriptor,
  UsageCostDay,
  UsageProviderInfo,
  UsageSnapshot,
  UsageWindowInfo,
} from "./control-center-types";
import { PreferenceControl } from "./preference-control";

type UsageScreenProps = {
  busyAction?: string | null;
  companionStatus: CompanionStatus;
  usage: UsageSnapshot | null;
  usageError?: ApiError | null;
  onRefresh?: () => void;
  preferences: PreferenceDescriptor[] | null;
  preferencesError?: ApiError | null;
  pendingPreferenceIds: Set<string>;
  onPreferenceChange: (
    item: PreferenceDescriptor,
    value: boolean,
  ) => void | Promise<void>;
};

type ProviderPreferenceDescriptor = PreferenceDescriptor & {
  type: "boolean";
  value: boolean;
  health: NonNullable<PreferenceDescriptor["health"]>;
};

export function UsageScreen({
  busyAction,
  companionStatus,
  usage,
  usageError,
  onRefresh,
  preferences,
  preferencesError,
  pendingPreferenceIds,
  onPreferenceChange,
}: UsageScreenProps) {
  const refreshing = busyAction === "usage";
  const providers = filterVisibleProviders(
    usage?.providers || [],
    usage?.currentProvider,
  );
  const hasProviders = providers.length > 0;

  return (
    <div className="mx-auto max-w-[1180px]">
      <section className="py-10">
        {usageError ? (
          <Alert className="mb-6 bg-muted"><AlertTriangle /><AlertTitle>{usageError.message}</AlertTitle><AlertDescription>{usageError.nextAction}</AlertDescription></Alert>
        ) : null}

        {hasProviders ? (
          <TokenUsageOverTimePanel
            onRefresh={onRefresh}
            providers={providers}
            refreshing={refreshing}
          />
        ) : null}

        {hasProviders ? (
          <ol className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
            {providers.map((provider) => (
              <li className="min-w-0" key={provider.id}>
                <UsageProviderTile provider={provider} />
              </li>
            ))}
          </ol>
        ) : usageError ? null : (
          <UsageEmptyState
            companionStatus={companionStatus}
            refreshing={refreshing}
          />
        )}

        <ProviderPreferencesPanel
          error={preferencesError}
          items={preferences}
          pendingIds={pendingPreferenceIds}
          onChange={onPreferenceChange}
        />
      </section>
    </div>
  );
}

function ProviderPreferencesPanel({
  error,
  items,
  pendingIds,
  onChange,
}: {
  error?: ApiError | null;
  items: PreferenceDescriptor[] | null;
  pendingIds: Set<string>;
  onChange: (item: PreferenceDescriptor, value: boolean) => void | Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const providers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (items || [])
      .filter(isProviderPreference)
      .filter(
        (item) =>
          !normalizedQuery ||
            item.label.toLowerCase().includes(normalizedQuery) ||
            item.id.toLowerCase().includes(normalizedQuery),
      )
      .sort((a, b) => {
        const priority = providerHealthPriority(a) - providerHealthPriority(b);
        return priority || a.label.localeCompare(b.label);
      });
  }, [items, query]);

  return (
    <Card className="mt-6" aria-labelledby="provider-settings-title">
      <CardHeader>
        <CardTitle id="provider-settings-title">AI providers</CardTitle>
        <CardDescription>
          Turn providers on or off and see when one needs attention.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <Alert className="mb-4" variant="destructive">
            <AlertTriangle />
            <AlertTitle>{error.message}</AlertTitle>
            <AlertDescription>{error.nextAction}</AlertDescription>
          </Alert>
        ) : null}

        <div className="relative mb-4">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search AI providers"
            className="pl-9"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search providers"
            type="search"
            value={query}
          />
        </div>

        {items === null && !error ? (
          <div className="flex min-h-24 items-center justify-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            <Spinner /> Checking providers
          </div>
        ) : providers.length > 0 ? (
          <ItemGroup className="gap-2" aria-live="polite">
            {providers.map((item) => {
              const pending = pendingIds.has(item.id);
              const checked = item.value === true;
              const attentionExplanation = providerAttentionExplanation(item);
              return (
                <Item key={item.id} variant="outline" className="min-h-16 flex-nowrap">
                  <ItemContent className="min-w-0">
                    <ItemTitle className="flex-wrap">
                      <span className="break-words">{item.label}</span>
                      <Badge variant={healthBadgeVariant(item.health.state)}>
                        {healthLabel(item.health.state)}
                      </Badge>
                      {item.health.service === "outage" &&
                      item.health.state !== "service_outage" ? (
                        <Badge variant="destructive">Service outage</Badge>
                      ) : item.health.service === "degraded" ? (
                        <Badge variant="secondary">Service degraded</Badge>
                      ) : null}
                      {attentionExplanation ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              aria-label={`Explain status for ${item.label}`}
                              className="-my-2 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              type="button"
                            >
                              <Info className="size-4" aria-hidden />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-72 leading-relaxed">
                            {attentionExplanation}
                          </TooltipContent>
                        </Tooltip>
                      ) : null}
                    </ItemTitle>
                    <ItemDescription>{item.health.message}</ItemDescription>
                  </ItemContent>
                  <ItemActions className="min-w-12 justify-end">
                    {pending ? <Spinner aria-label={`Updating ${item.label}`} /> : null}
                    <PreferenceControl
                      booleanLabel={`${checked ? "Disable" : "Enable"} ${item.label}`}
                      descriptor={item}
                      disabled={pending}
                      onChange={(value) => {
                        if (typeof value === "boolean") {
                          void onChange(item, value);
                        }
                      }}
                    />
                  </ItemActions>
                </Item>
              );
            })}
          </ItemGroup>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {query ? "No providers match your search." : "No providers are available."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function providerHealthPriority(item: ProviderPreferenceDescriptor): number {
  if (["auth_required", "setup_required", "stale", "unavailable"].includes(item.health.state)) {
    return 0;
  }
  return item.value === true ? 1 : 2;
}

function isProviderPreference(
  item: PreferenceDescriptor,
): item is ProviderPreferenceDescriptor {
  return (
    item.section === "providers" &&
    item.type === "boolean" &&
    typeof item.value === "boolean" &&
    Boolean(item.health)
  );
}

function providerAttentionExplanation(
  item: ProviderPreferenceDescriptor,
): string | null {
  const provider = item.label;
  switch (item.health.state) {
    case "auth_required":
      return `${provider} is enabled, but its sign-in is no longer valid. Open ${provider}, sign in again, then use it once.`;
    case "setup_required":
      return `${provider} is enabled, but the VibeTV Mac App cannot read usage yet. Open ${provider}, finish setup or sign in if asked, then use it once.`;
    case "stale":
      return `VibeTV is showing the last saved ${provider} usage because live usage cannot be read. Open ${provider} and check that you are still signed in.`;
    case "unavailable":
      return `The VibeTV Mac App cannot read ${provider} right now. This can be temporary; open ${provider} and check that it is working and signed in.`;
  }
  if (item.health.service === "outage") {
    return `${provider} is reporting an outage. Your setup may be fine; try again when the service is back online.`;
  }
  if (item.health.service === "degraded") {
    return `${provider} is reporting a service problem. Usage updates may be delayed until the service recovers.`;
  }
  return null;
}

function healthLabel(state: string): string {
  const labels: Record<string, string> = {
    healthy: "Ready",
    auth_required: "Sign-in needed",
    setup_required: "Setup needed",
    stale: "Stale",
    service_outage: "Service outage",
    unavailable: "Unavailable",
    checking: "Checking",
    disabled: "Off",
  };
  return labels[state] || "Unknown";
}

function healthBadgeVariant(state: string): "default" | "secondary" | "destructive" | "outline" {
  if (["auth_required", "setup_required", "unavailable"].includes(state)) {
    return "destructive";
  }
  if (state === "healthy") {
    return "default";
  }
  return "secondary";
}

function TokenUsageOverTimePanel({
  onRefresh,
  providers,
  refreshing,
}: {
  onRefresh?: () => void;
  providers: UsageProviderInfo[];
  refreshing: boolean;
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
  const last30DaysTokens = getLast30DaysTokenTotal(providers);

  return (
    <>
      <section
        aria-labelledby="total-tokens-heading"
        className="mb-6 px-4 text-center"
      >
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

function UsageProviderTile({
  provider,
}: {
  provider: UsageProviderInfo;
}) {
  return (
    <Card
      className={cn(
        "h-full min-h-[248px] [--card-spacing:--spacing(5)]",
        provider.stale && "opacity-65",
      )}
    >
      <CardHeader>
        <CardTitle className="break-words text-xl font-black">
          {provider.label || provider.id}
        </CardTitle>
        {provider.stale || provider.status ? (
          <CardDescription className="flex flex-wrap items-center gap-2">
            {provider.stale ? <StatusPill>Stale</StatusPill> : null}
            {provider.status ? (
              <StatusPill>{providerStatusLabel(provider.status.description)}</StatusPill>
            ) : null}
          </CardDescription>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-1 flex-col">
        <ProviderUsageBars provider={provider} />

        <UsageMetaGrid provider={provider} />
        <TokenRow provider={provider} />
      </CardContent>
    </Card>
  );
}

function ProviderUsageBars({ provider }: { provider: UsageProviderInfo }) {
  if (provider.windows?.length) {
    return (
      <div className="grid gap-4">
        {provider.windows.map((window) => (
          <UsageWindowBar
            key={window.id}
            mode={provider.usageMode}
            unavailable={provider.usageUnavailable}
            window={window}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <UsageBar
        label="Session"
        mode={provider.usageMode}
        resetSecs={provider.resetSecs}
        unavailable={
          provider.usageUnavailable || provider.sessionUnavailable
        }
        value={provider.session}
      />
      <UsageBar
        label="Weekly"
        mode={provider.usageMode}
        resetSecs={provider.resetSecs}
        unavailable={provider.usageUnavailable || provider.weeklyUnavailable}
        value={provider.weekly}
      />
    </div>
  );
}

function UsageBar({
  label,
  mode,
  resetSecs,
  unavailable,
  value,
}: {
  label: string;
  mode?: string;
  resetSecs?: number;
  unavailable?: boolean;
  value: number;
}) {
  const percent = clampPercent(value);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <span className="font-bold text-[#1B1B1B]">
          {label}: {unavailable ? "??" : `${percent}% ${usageModeShortLabel(mode)}`}
        </span>
        {!unavailable && resetSecs ? (
          <span className="ml-auto shrink-0 text-right font-semibold text-[#444933]">
            {formatReset(resetSecs)}
          </span>
        ) : null}
      </div>
      <Progress
        aria-label={
          unavailable
            ? `${label}: usage unavailable`
            : `${label}: ${percent}% ${usageModeShortLabel(mode)}`
        }
        className="h-2"
        value={unavailable ? 0 : percent}
      />
    </div>
  );
}

function TokenRow({ provider }: { provider: UsageProviderInfo }) {
  const items = [
    ["Session", provider.sessionTokens],
    ["Week", provider.weekTokens],
    ["Total", provider.totalTokens],
  ].filter(([, value]) => typeof value === "number" && value > 0);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="mt-auto pt-5">
      <h4 className="mb-3 text-sm font-bold text-foreground">Token usage</h4>
      <dl className="grid gap-3 sm:grid-cols-3">
        {items.map(([label, value]) => (
          <div className="min-w-0" key={label}>
            <dt className="text-xs font-bold uppercase text-[#506600]">
              {label}
            </dt>
            <dd className="mt-1 break-words text-sm font-semibold text-[#1B1B1B]">
              {formatTokenCount(value as number)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
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
          <dt className="text-xs font-bold uppercase text-[#506600]">
            {label}
          </dt>
          <dd className="mt-1 break-words text-sm font-semibold text-[#1B1B1B]">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function UsageWindowBar({
  mode,
  unavailable,
  window,
}: {
  mode?: string;
  unavailable?: boolean;
  window: UsageWindowInfo;
}) {
  const percent = clampPercent(window.usedPercent);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <span className="font-bold text-[#1B1B1B]">
          {window.label}: {unavailable ? "??" : `${percent}% ${usageModeShortLabel(mode)}`}
        </span>
        {!unavailable && window.resetSecs ? (
          <span className="ml-auto shrink-0 text-right font-semibold text-[#444933]">
            {formatReset(window.resetSecs)}
          </span>
        ) : null}
      </div>
      <Progress
        aria-label={
          unavailable
            ? `${window.label}: usage unavailable`
            : `${window.label}: ${percent}% ${usageModeShortLabel(mode)}`
        }
        className="h-2"
        value={unavailable ? 0 : percent}
      />
    </div>
  );
}

function UsageEmptyState({
  companionStatus,
  refreshing,
}: {
  companionStatus: CompanionStatus;
  refreshing: boolean;
}) {
  const message =
    companionStatus === "online"
      ? refreshing
        ? "Loading provider usage."
        : "No provider usage is available yet."
      : "Mac App needs setup.";
  const action =
    companionStatus === "online"
      ? "Enable a provider below to start seeing usage."
      : "Run setup again, then refresh usage.";

  return (
    <Empty className="bg-muted/50 py-10 ring-1 ring-foreground/10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {refreshing ? (
            <RefreshCw className="animate-spin" size={17} aria-hidden />
          ) : (
            <BarChart3 size={17} aria-hidden />
          )}
        </EmptyMedia>
        <EmptyTitle>{message}</EmptyTitle>
        <EmptyDescription>{action}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
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

function StatusPill({ children }: { children: ReactNode }) {
  return (
    <Badge className="min-h-6 uppercase" variant="secondary">
      {children}
    </Badge>
  );
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

function formatReset(seconds?: number): string {
  if (!seconds || seconds <= 0) {
    return "Reset unknown";
  }
  const totalMinutes = Math.ceil(seconds / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return `Reset in ${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `Reset in ${hours}h ${minutes}m`;
  }
  return `Reset in ${minutes}m`;
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
