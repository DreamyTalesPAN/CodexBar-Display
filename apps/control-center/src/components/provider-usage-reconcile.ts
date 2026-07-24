import type {
  PreferenceDescriptor,
  UsageSnapshot,
} from "./control-center-types";

export const PROVIDER_RECONCILE_WINDOW_MS = 30_000;
export const PROVIDER_RECONCILE_POLL_MS = 1_500;

function providerIDFromPreference(id: string) {
  return id
    .replace(/^codexbar\.providers\./, "")
    .replace(/\.enabled$/, "");
}

export function providerUsageNeedsReconcile(
  preferences: PreferenceDescriptor[] | null,
  usage: UsageSnapshot | null,
) {
  const usageByProvider = new Map(
    (usage?.providers || []).map((provider) => [provider.id, provider]),
  );
  return (preferences || [])
    .filter((item) => item.section === "providers" && item.value === true)
    .some((item) => {
      if (item.health?.state === "checking") {
        return true;
      }
      if (item.health?.state !== "healthy") {
        return false;
      }
      const provider = usageByProvider.get(providerIDFromPreference(item.id));
      return !provider || provider.stale || provider.usageUnavailable;
    });
}

export function scheduleProviderUsageReconcile({
  deadline,
  preferences,
  refresh,
  usage,
}: {
  deadline: number;
  preferences: PreferenceDescriptor[] | null;
  refresh: () => void;
  usage: UsageSnapshot | null;
}) {
  const remaining = deadline - Date.now();
  if (
    remaining < PROVIDER_RECONCILE_POLL_MS ||
    !providerUsageNeedsReconcile(preferences, usage)
  ) {
    return undefined;
  }
  const timer = globalThis.setTimeout(refresh, PROVIDER_RECONCILE_POLL_MS);
  return () => globalThis.clearTimeout(timer);
}
