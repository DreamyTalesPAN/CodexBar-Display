"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Item, ItemSeparator } from "@/components/ui/item";
import { PreferenceControl } from "./preference-control";
import { SetupStepFailedDialog } from "./setup/setup-provider-dialogs";
import type {
  PreferenceDescriptor,
  PreferenceValue,
} from "./control-center-types";

export type AgentSettingsRequest = <T>(
  path: string,
  init?: RequestInit,
) => Promise<T>;

export function AgentActivitySettings({
  request,
}: {
  request: AgentSettingsRequest;
}) {
  const [items, setItems] = useState<PreferenceDescriptor[] | null>(null);
  const [error, setError] = useState("");
  const [errorDismissed, setErrorDismissed] = useState(false);
  const [pending, setPending] = useState(false);
  const writing = useRef(false);
  const revision = useRef(0);
  const load = useCallback(() => {
    const current = ++revision.current;
    return request<{ items: PreferenceDescriptor[] }>(
      "/v1/preferences?section=agents",
    ).then((result) => {
      if (current !== revision.current) return;
      setItems(result.items);
      setError("");
    }).catch(() => {
      if (current === revision.current) {
        setErrorDismissed(false);
        setError("Agent activity settings could not be loaded. Try again.");
      }
    });
  }, [request]);
  useEffect(() => {
    void load();
    return () => {
      revision.current += 1;
    };
  }, [load]);
  const save = async (id: string, value: PreferenceValue) => {
    if (writing.current) return;
    writing.current = true;
    revision.current += 1;
    setPending(true);
    setError("");
    setErrorDismissed(false);
    try {
      const result = await request<{ item: PreferenceDescriptor }>(
        `/v1/preferences/${id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ value }),
        },
      );
      setItems(
        (current) =>
          current?.map((item) => (item.id === id ? result.item : item)) ?? null,
      );
    } catch {
      setError(
        "This setting could not be confirmed. Reload settings to check.",
      );
    } finally {
      writing.current = false;
      setPending(false);
    }
  };
  const enabled =
    items?.find((item) => item.id === "vibetv.agents.enabled")?.value === true;
  const blink =
    items?.find((item) => item.id === "vibetv.agents.blink")?.value === true;
  return (
    <div
      className="flex max-w-[520px] flex-col gap-4"
      aria-busy={pending || (!items && !error)}
    >
      <SetupStepFailedDialog
        error={error && !errorDismissed ? { code: "AGENT_SETTINGS_FAILED", message: "Check agent activity settings", nextAction: error } : null}
        onOpenChange={(open) => !open && setErrorDismissed(true)}
        onRetry={() => void load()}
        retryLabel={items ? "Reload settings" : "Try again"}
      />
      {error && errorDismissed ? <Button variant="outline" onClick={() => void load()}>Reload settings</Button> : null}
      {!items && !error ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading agent activity settings…
        </p>
      ) : null}
      {items ? (
        <div className="overflow-hidden rounded-xl border bg-card">
          {items.map((item, index) => (
            <div key={item.id}>
              {index > 0 ? <ItemSeparator className="mx-0" /> : null}
              <Item className="flex-wrap gap-4 rounded-none px-4 py-3 sm:flex-nowrap">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {item.description}
                  </p>
                </div>
                <div
                  className={
                    item.type === "enum" ? "w-[170px] shrink-0" : "shrink-0"
                  }
                >
                  <PreferenceControl
                    descriptor={item}
                    disabled={
                      pending ||
                      (item.id !== "vibetv.agents.enabled" && !enabled) ||
                      ([
                        "vibetv.agents.reminder",
                        "vibetv.agents.quiet",
                      ].includes(item.id) &&
                        !blink)
                    }
                    onChange={(value) => save(item.id, value)}
                  />
                </div>
              </Item>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
