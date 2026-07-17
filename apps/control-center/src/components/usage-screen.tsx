"use client";

import {
  AlertTriangle,
  BarChart3,
  Clock,
  RefreshCw,
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  ApiError,
  CompanionStatus,
  UsageCostDay,
  UsagePaceInfo,
  UsageProviderInfo,
  UsageOverTimePoint,
  UsageSnapshot,
  UsageWindowInfo,
} from "./control-center-types";

type UsageScreenProps = {
  busyAction?: string | null;
  companionStatus: CompanionStatus;
  usage: UsageSnapshot | null;
  usageError?: ApiError | null;
  onRefresh?: () => void;
  onDiscoverProviders?: () => void;
};

export function UsageScreen({
  busyAction,
  companionStatus,
  usage,
  usageError,
  onRefresh,
  onDiscoverProviders,
}: UsageScreenProps) {
  const refreshing = busyAction === "usage";
  const providerSetupRequired = usageError?.code === "provider_setup_required";
  const providers = filterVisibleProviders(
    usage?.providers || [],
    usage?.currentProvider,
  );
  const hasProviders = providers.length > 0;
  const overTimeProvider = pickUsageOverTimeProvider(
    providers,
    usage?.currentProvider,
  );
  const costProvider = pickCodexCostProvider(providers, usage?.currentProvider);

  return (
    <div className="mx-auto max-w-[1180px]">
      <section className="border-b border-[#747A60] py-10">
        <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-[#1B1B1B]">Provider usage</h3>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[#444933]">
              <UsageMeta
                icon={<Clock size={16} aria-hidden />}
                label={formatUsageTime(usage?.generatedAt)}
              />
            </div>
          </div>

          {onRefresh ? (
            <button
              className="inline-flex h-11 items-center justify-center gap-2 border border-[#747A60] bg-[#F9F9F9] px-4 text-sm font-semibold text-[#1B1B1B] transition hover:bg-[#EEEEEE] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={refreshing || busyAction === "provider-discovery"}
              onClick={
                providerSetupRequired && onDiscoverProviders
                  ? onDiscoverProviders
                  : onRefresh
              }
              type="button"
            >
              {refreshing || busyAction === "provider-discovery" ? (
                <RefreshCw className="animate-spin" size={18} aria-hidden />
              ) : (
                <RefreshCw size={18} aria-hidden />
              )}
              <span>
                {refreshing || busyAction === "provider-discovery"
                  ? "Checking"
                  : providerSetupRequired
                    ? "Check again"
                    : "Refresh"}
              </span>
            </button>
          ) : null}
        </div>

        {usageError ? (
          <div className="mb-6 border border-[#747A60] bg-[#EEEEEE] p-4 text-sm leading-6 text-[#444933]">
            <div className="mb-1 flex items-center gap-2 font-bold text-[#1B1B1B]">
              <AlertTriangle size={17} aria-hidden />
              {usageError.message}
            </div>
            {usageError.nextAction}
          </div>
        ) : null}

        {costProvider ? (
          <CodexCostPanel provider={costProvider} />
        ) : overTimeProvider ? (
          <UsageOverTimePanel provider={overTimeProvider} />
        ) : null}

        {hasProviders ? (
          <ol className="grid gap-5 lg:grid-cols-2">
            {providers.map((provider) => (
              <li key={provider.id}>
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

function CodexCostPanel({ provider }: { provider: UsageProviderInfo }) {
  const cost = provider.cost;
  if (!cost) {
    return null;
  }

  const days = normalizeCostDays(cost.daily || []);
  const maxCost = Math.max(...days.map((day) => day.totalCostUSD || 0), 0);
  const todayCost = finiteNumber(cost.todayCostUSD)
    ? cost.todayCostUSD
    : latestCostDay(days)?.totalCostUSD;
  const last30DaysCost = finiteNumber(cost.last30DaysCostUSD)
    ? cost.last30DaysCostUSD
    : days.reduce((sum, day) => sum + (day.totalCostUSD || 0), 0);
  const last30DaysTokens = finiteNumber(cost.last30DaysTokens)
    ? cost.last30DaysTokens
    : days.reduce((sum, day) => sum + (day.totalTokens || 0), 0);
  const latestTokens = finiteNumber(cost.latestTokens)
    ? cost.latestTokens
    : provider.sessionTokens || 0;
  const resetCredits = provider.resetCredits;
  const topModel = cost.topModel?.trim();

  return (
    <section className="mb-6 border border-[#747A60] bg-[#F9F9F9] p-5 text-[#1B1B1B]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="break-words text-base font-black text-[#1B1B1B]">
            Limit Reset Credits
          </h4>
          {resetCredits?.nextExpiresAt ? (
            <p className="mt-1 text-sm font-semibold text-[#444933]">
              Manual resets expire {formatExpiryDate(resetCredits.nextExpiresAt)}
            </p>
          ) : null}
        </div>
        <div className="inline-flex min-h-6 max-w-full items-center border border-[#747A60] bg-[#EEEEEE] px-2 text-right text-xs font-bold uppercase text-[#1B1B1B]">
          {formatResetCreditCount(resetCredits?.availableCount)}
        </div>
      </div>

      <dl className="mt-5 grid gap-4 border-t border-[#747A60] pt-4 sm:grid-cols-2 lg:grid-cols-4">
        <UsageCostMetric label="Today" value={formatCurrency(todayCost, cost.currencyCode)} />
        <UsageCostMetric
          label="30d cost"
          value={formatCurrency(last30DaysCost, cost.currencyCode)}
        />
        <UsageCostMetric label="30d tokens" value={formatTokenCount(last30DaysTokens)} />
        <UsageCostMetric label="Latest tokens" value={formatTokenCount(latestTokens)} />
      </dl>

      {days.length > 0 ? (
        <div
          aria-label={`Codex cost over time for ${provider.label || provider.id}`}
          className="mt-6"
          role="img"
        >
          <div className="flex h-32 items-end gap-1 border-b border-[#747A60] pb-1">
            {days.map((day) => (
              <CostHistoryBar
                currencyCode={cost.currencyCode}
                day={day}
                key={day.day}
                maxCost={maxCost}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-between gap-3 text-xs font-semibold text-[#444933]">
            <span>{formatDayLabel(days[0].day)}</span>
            <span>{formatDayLabel(days[days.length - 1].day)}</span>
          </div>
        </div>
      ) : null}

      <div className="mt-5 border-t border-[#747A60] pt-4 text-sm font-semibold text-[#444933]">
        {topModel ? (
          <div className="break-words">
            Top model: <span className="font-bold text-[#1B1B1B]">{topModel}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function UsageCostMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-bold uppercase text-[#506600]">{label}</dt>
      <dd className="mt-1 break-words text-xl font-black text-[#1B1B1B]">
        {value}
      </dd>
    </div>
  );
}

function CostHistoryBar({
  currencyCode,
  day,
  maxCost,
}: {
  currencyCode?: string;
  day: UsageCostDay;
  maxCost: number;
}) {
  const value = day.totalCostUSD || 0;
  const height = maxCost > 0 ? Math.max((value / maxCost) * 100, 5) : 0;
  const tooltip = `${formatDayLabel(day.day)} · ${formatCurrency(
    value,
    currencyCode,
  )} · ${formatTokenCount(day.totalTokens || 0)}`;

  return (
    <div
      aria-label={tooltip}
      className="group relative flex h-full min-w-0 flex-1 items-end"
      tabIndex={0}
    >
      <span
        className="block w-full min-w-[5px] border border-[#747A60] bg-[#CCFF00]"
        style={{ height: `${height}%` }}
      />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap border border-[#747A60] bg-[#F9F9F9] px-2 py-1 text-xs font-bold text-[#1B1B1B] shadow-[3px_3px_0_#CCFF00] group-focus:block group-hover:block">
        {tooltip}
      </span>
    </div>
  );
}

function UsageOverTimePanel({ provider }: { provider: UsageProviderInfo }) {
  const points = normalizeUsageOverTime(provider.usageOverTime || []);
  if (points.length === 0) {
    return null;
  }

  const totalCredits = points.reduce(
    (sum, point) => sum + point.totalCreditsUsed,
    0,
  );
  const peak = points.reduce(
    (current, point) =>
      point.totalCreditsUsed > current.totalCreditsUsed ? point : current,
    points[0],
  );
  const maxCredits = Math.max(...points.map((point) => point.totalCreditsUsed));
  const services = usageOverTimeServices(points);

  return (
    <section className="mb-6 border border-[#747A60] bg-[#F9F9F9] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h4 className="text-base font-black text-[#1B1B1B]">
            Usage over time
          </h4>
          <p className="mt-1 text-sm text-[#444933]">
            {provider.label || provider.id} · {points.length} days
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:text-right">
          <div>
            <dt className="text-xs font-bold uppercase text-[#506600]">
              Total
            </dt>
            <dd className="mt-1 font-semibold text-[#1B1B1B]">
              {formatCreditsUsed(totalCredits)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-bold uppercase text-[#506600]">
              Peak
            </dt>
            <dd className="mt-1 font-semibold text-[#1B1B1B]">
              {formatCreditsUsed(peak.totalCreditsUsed)}
            </dd>
          </div>
        </dl>
      </div>

      <div
        aria-label={`Usage over time for ${provider.label || provider.id}`}
        className="mt-5"
        role="img"
      >
        <div className="flex h-32 items-end gap-1 border-b border-[#747A60] pb-1">
          {points.map((point) => (
            <UsageOverTimeBar
              key={point.day}
              maxCredits={maxCredits}
              point={point}
            />
          ))}
        </div>
        <div className="mt-2 flex justify-between gap-3 text-xs font-semibold text-[#444933]">
          <span>{formatDayLabel(points[0].day)}</span>
          <span>{formatDayLabel(points[points.length - 1].day)}</span>
        </div>
      </div>

      {services.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
          {services.map((service) => (
            <span
              className="inline-flex min-h-6 items-center gap-2 text-xs font-semibold text-[#444933]"
              key={service}
            >
              <span
                className="size-2.5 border border-[#747A60]"
                style={{ backgroundColor: usageServiceColor(service) }}
              />
              {service}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function UsageOverTimeBar({
  maxCredits,
  point,
}: {
  maxCredits: number;
  point: UsageOverTimePoint;
}) {
  const total = point.totalCreditsUsed;
  const services = (point.services || []).filter(
    (service) => service.creditsUsed > 0,
  );
  const stackTotal =
    total > 0
      ? total
      : services.reduce((sum, service) => sum + service.creditsUsed, 0);
  const height = maxCredits > 0 ? Math.max((stackTotal / maxCredits) * 100, 4) : 0;

  return (
    <div
      aria-label={`${formatDayLabel(point.day)}: ${formatCreditsUsed(total)}`}
      className="flex h-full min-w-0 flex-1 items-end"
      title={`${formatDayLabel(point.day)}: ${formatCreditsUsed(total)}`}
    >
      <div
        className="flex w-full min-w-[5px] flex-col-reverse border border-[#747A60] bg-[#EEEEEE]"
        style={{ height: `${height}%` }}
      >
        {services.length > 0 ? (
          services.map((service) => (
            <span
              key={service.service}
              style={{
                backgroundColor: usageServiceColor(service.service),
                height: `${(service.creditsUsed / stackTotal) * 100}%`,
              }}
            />
          ))
        ) : (
          <span className="h-full bg-[#CCFF00]" />
        )}
      </div>
    </div>
  );
}

function UsageProviderTile({
  provider,
}: {
  provider: UsageProviderInfo;
}) {
  return (
    <article
      className={`min-h-[248px] border border-[#747A60] bg-[#F9F9F9] p-5 ${
        provider.stale ? "opacity-65" : ""
      }`}
    >
      <div className="mb-5 flex min-h-10 items-start justify-between gap-4">
        <div className="min-w-0">
          <h4 className="break-words text-xl font-black text-[#1B1B1B]">
            {provider.label || provider.id}
          </h4>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[#444933]">
            {provider.stale ? <StatusPill>Stale</StatusPill> : null}
            {provider.status ? (
              <StatusPill>{providerStatusLabel(provider.status.description)}</StatusPill>
            ) : null}
          </div>
        </div>
        <div className="shrink-0 text-right text-sm font-semibold text-[#1B1B1B]">
          {formatReset(provider.resetSecs)}
        </div>
      </div>

      <div className="grid gap-4">
        <UsageBar
          label="Session"
          mode={provider.usageMode}
          value={provider.session}
        />
        <UsageBar
          label="Weekly"
          mode={provider.usageMode}
          value={provider.weekly}
        />
      </div>

      <UsageMetaGrid provider={provider} />
      <ExtraWindows provider={provider} />
      <PaceRows pace={provider.pace || []} />
      <TokenRow provider={provider} />
    </article>
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
      <div className="h-4 border border-[#747A60] bg-[#EEEEEE]">
        <div
          className="h-full bg-[#CCFF00]"
          style={{ width: `${percent}%` }}
        />
      </div>
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
    return (
      <div className="mt-5 border-t border-[#747A60] pt-4 text-sm text-[#444933]">
        Token totals not available.
      </div>
    );
  }

  return (
    <dl className="mt-5 grid gap-3 border-t border-[#747A60] pt-4 sm:grid-cols-3">
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
  );
}

function UsageMetaGrid({ provider }: { provider: UsageProviderInfo }) {
  const items = [
    provider.status?.description
      ? ["Status", providerStatusLabel(provider.status.description)]
      : null,
    provider.credits ? ["Credits", formatCredits(provider.credits.remaining)] : null,
    provider.activity ? ["Activity", provider.activity] : null,
  ].filter(Boolean) as Array<[string, string]>;

  if (items.length === 0) {
    return null;
  }

  return (
    <dl className="mt-5 grid gap-3 border-t border-[#747A60] pt-4 sm:grid-cols-3">
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

function ExtraWindows({ provider }: { provider: UsageProviderInfo }) {
  const extra = (provider.windows || []).filter(
    (window) => window.id !== "primary" && window.id !== "secondary",
  );
  if (extra.length === 0) {
    return null;
  }

  return (
    <div className="mt-5 border-t border-[#747A60] pt-4">
      <div className="mb-3 text-xs font-bold uppercase text-[#506600]">
        More windows
      </div>
      <div className="grid gap-4">
        {extra.map((window) => (
          <UsageWindowBar key={window.id} mode={provider.usageMode} window={window} />
        ))}
      </div>
    </div>
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
      <div className="h-3 border border-[#747A60] bg-[#EEEEEE]">
        <div
          className="h-full bg-[#CCFF00]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function PaceRows({ pace }: { pace: UsagePaceInfo[] }) {
  const visible = pace.filter((item) => item.summary || item.stage);
  if (visible.length === 0) {
    return null;
  }

  return (
    <div className="mt-5 border-t border-[#747A60] pt-4">
      <div className="mb-3 text-xs font-bold uppercase text-[#506600]">
        Pace
      </div>
      <div className="grid gap-2">
        {visible.map((item) => (
          <div
            className="grid gap-2 text-sm text-[#444933] sm:grid-cols-[88px_minmax(0,1fr)]"
            key={item.window}
          >
            <span className="font-bold text-[#1B1B1B]">
              {paceWindowLabel(item.window)}
            </span>
            <span className="break-words">
              {item.summary || paceFallbackSummary(item)}
            </span>
          </div>
        ))}
      </div>
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
    <div className="border border-[#747A60] bg-[#EEEEEE] p-6 text-sm leading-6 text-[#444933]">
      <div className="mb-1 flex items-center gap-2 font-bold text-[#1B1B1B]">
        {refreshing ? (
          <RefreshCw className="animate-spin" size={17} aria-hidden />
        ) : (
          <BarChart3 size={17} aria-hidden />
        )}
        {message}
      </div>
      {action}
    </div>
  );
}

function pickUsageOverTimeProvider(
  providers: UsageProviderInfo[],
  currentProvider?: string,
): UsageProviderInfo | null {
  const current = providers.find(
    (provider) =>
      provider.id === currentProvider && (provider.usageOverTime || []).length > 0,
  );
  if (current) {
    return current;
  }
  return (
    providers.find((provider) => (provider.usageOverTime || []).length > 0) ||
    null
  );
}

function pickCodexCostProvider(
  providers: UsageProviderInfo[],
  currentProvider?: string,
): UsageProviderInfo | null {
  const current = providers.find(
    (provider) => provider.id === currentProvider && providerHasCost(provider),
  );
  if (current) {
    return current;
  }
  return (
    providers.find(
      (provider) => provider.id === "codex" && providerHasCost(provider),
    ) ||
    providers.find((provider) => providerHasCost(provider)) ||
    null
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

function normalizeUsageOverTime(points: UsageOverTimePoint[]) {
  return points
    .filter(
      (point) =>
        Boolean(point.day) &&
        Number.isFinite(point.totalCreditsUsed) &&
        point.totalCreditsUsed >= 0,
    )
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-30);
}

function usageOverTimeServices(points: UsageOverTimePoint[]): string[] {
  const totals = new Map<string, number>();
  for (const point of points) {
    for (const service of point.services || []) {
      const name = service.service.trim();
      if (!name || service.creditsUsed <= 0) {
        continue;
      }
      totals.set(name, (totals.get(name) || 0) + service.creditsUsed);
    }
  }
  return [...totals.entries()]
    .sort((a, b) => {
      if (b[1] === a[1]) {
        return a[0].localeCompare(b[0]);
      }
      return b[1] - a[1];
    })
    .slice(0, 6)
    .map(([service]) => service);
}

function normalizeCostDays(days: UsageCostDay[]) {
  return days
    .filter(
      (day) =>
        Boolean(day.day) &&
        (finiteNumber(day.totalCostUSD) || finiteNumber(day.totalTokens)),
    )
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-30);
}

function latestCostDay(days: UsageCostDay[]): UsageCostDay | undefined {
  if (days.length === 0) {
    return undefined;
  }
  return days[days.length - 1];
}

function UsageMeta({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex min-h-6 items-center gap-2">
      {icon}
      <span>{label}</span>
    </span>
  );
}

function StatusPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex min-h-6 items-center border border-[#747A60] bg-[#EEEEEE] px-2 text-xs font-bold uppercase text-[#1B1B1B]">
      {children}
    </span>
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

function formatUsageTime(value?: string): string {
  if (!value) {
    return "Waiting for usage";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Usage time unknown";
  }
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
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

function formatCurrency(value?: number, currencyCode?: string): string {
  if (!finiteNumber(value)) {
    return "Not available";
  }
  return new Intl.NumberFormat("en-US", {
    currency: currencyCode || "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function formatResetCreditCount(value?: number): string {
  const count = finiteNumber(value) ? Math.max(0, Math.round(value)) : 0;
  if (count === 1) {
    return "1 manual reset available";
  }
  if (count === 0) {
    return "No manual resets available";
  }
  return `${count} manual resets available`;
}

function formatExpiryDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "date unknown";
  }
  const day = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  return `${day} at ${time}`;
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

function formatCredits(value: number): string {
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(value)} left`;
}

function formatCreditsUsed(value: number): string {
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value)} credits`;
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

function usageServiceColor(service: string): string {
  const lower = service.toLowerCase();
  if (lower === "cli") {
    return "#428CF5";
  }
  if (lower.includes("github") || lower.includes("review")) {
    return "#EF862E";
  }
  const palette = ["#75BF5C", "#CC74EA", "#42C7DB", "#EFC044", "#CCFF00"];
  const index = Math.abs(hashString(lower)) % palette.length;
  return palette[index];
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash;
}

function paceWindowLabel(window: string): string {
  if (window === "primary") {
    return "Session";
  }
  if (window === "secondary") {
    return "Weekly";
  }
  return window ? window[0].toUpperCase() + window.slice(1) : "Window";
}

function paceFallbackSummary(item: UsagePaceInfo): string {
  const stage = item.stage || "Pace";
  if (typeof item.expectedUsedPercent === "number") {
    return `${stage} · expected ${item.expectedUsedPercent}% used`;
  }
  return stage;
}
