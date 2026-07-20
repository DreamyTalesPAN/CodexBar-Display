"use client";

import {
  AlertTriangle,
  BarChart3,
  RefreshCw,
} from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";
import type {
  ApiError,
  CompanionStatus,
  UsageCostDay,
  UsageProviderInfo,
  UsageSnapshot,
  UsageWindowInfo,
} from "./control-center-types";

type UsageScreenProps = {
  busyAction?: string | null;
  companionStatus: CompanionStatus;
  usage: UsageSnapshot | null;
  usageError?: ApiError | null;
};

export function UsageScreen({
  busyAction,
  companionStatus,
  usage,
  usageError,
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
          <TokenUsageOverTimePanel providers={providers} />
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
      </section>
    </div>
  );
}

function TokenUsageOverTimePanel({
  providers,
}: {
  providers: UsageProviderInfo[];
}) {
  const lastAvailableHistories = useRef<ProviderTokenHistory[]>([]);
  const currentProviderHistories = getProviderTokenHistories(providers);
  const hasCurrentData = currentProviderHistories.length > 0;

  useEffect(() => {
    const nextHistories = getProviderTokenHistories(providers);
    if (nextHistories.length > 0) {
      lastAvailableHistories.current = nextHistories;
    }
  }, [providers]);

  const providerHistories = hasCurrentData
    ? currentProviderHistories
    : lastAvailableHistories.current;
  const hasLastAvailableData = providerHistories.length > 0;
  const displayedHistories = hasLastAvailableData
    ? providerHistories
    : providers.map((provider) => ({ days: [], provider }));

  const { chartConfig, chartData, series } =
    buildProviderTokenChart(displayedHistories);
  const providerNames = displayedHistories.map(
    ({ provider }) => provider.label || provider.id,
  );

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Tokens used over time</CardTitle>
        <CardDescription>
          {hasCurrentData ? (
            <>
              Daily tokens by provider{" · "}
              {formatProviderHistorySummary(
                currentProviderHistories.length,
                providers.length,
              )}{" · "}
              {chartData.length} days
            </>
          ) : (
            "Daily tokens by provider · No current data"
          )}
        </CardDescription>
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
                  {hasLastAvailableData
                    ? "Showing the last available token history."
                    : "Token history is temporarily unavailable."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}
        </div>
      </CardContent>
    </Card>
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
        <CardAction className="shrink-0 text-right text-sm font-semibold">
          {formatReset(provider.resetSecs)}
        </CardAction>
      </CardHeader>

      <CardContent>
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
          <UsageWindowBar key={window.id} mode={provider.usageMode} window={window} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <UsageBar label="Session" mode={provider.usageMode} value={provider.session} />
      <UsageBar label="Weekly" mode={provider.usageMode} value={provider.weekly} />
    </div>
  );
}

function UsageBar({
  label,
  mode,
  value,
}: {
  label: string;
  mode?: string;
  value: number;
}) {
  const percent = clampPercent(value);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-4 text-sm">
        <span className="font-bold text-[#1B1B1B]">{label}</span>
        <span className="font-semibold text-[#444933]">
          {percent}% {usageModeShortLabel(mode)}
        </span>
      </div>
      <Progress
        aria-label={`${label}: ${percent}% ${usageModeShortLabel(mode)}`}
        className="h-2"
        value={percent}
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
    <div className="mt-5">
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
  window,
}: {
  mode?: string;
  window: UsageWindowInfo;
}) {
  const percent = clampPercent(window.usedPercent);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-4 text-sm">
        <span className="font-bold text-[#1B1B1B]">{window.label}</span>
        <span className="text-right font-semibold text-[#444933]">
          {percent}% {usageModeShortLabel(mode)}
          {window.resetSecs ? ` · ${formatReset(window.resetSecs)}` : ""}
        </span>
      </div>
      <Progress
        aria-label={`${window.label}: ${percent}% ${usageModeShortLabel(mode)}`}
        className="h-2"
        value={percent}
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
      ? "Open CodexBar and make sure at least one provider is enabled."
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

function formatProviderHistorySummary(
  historyCount: number,
  providerCount: number,
): string {
  if (historyCount === providerCount) {
    return `${historyCount} ${historyCount === 1 ? "provider" : "providers"}`;
  }
  return `${historyCount} of ${providerCount} providers with history`;
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
