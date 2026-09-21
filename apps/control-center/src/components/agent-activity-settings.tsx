"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Item, ItemSeparator } from "@/components/ui/item";
import { PreferenceControl } from "./preference-control";
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
  const [pending, setPending] = useState(false);
  const writing = useRef(false);
  const revision = useRef(0);
  const load = useCallback(async () => {
    const current = ++revision.current;
    try {
      const result = await request<{ items: PreferenceDescriptor[] }>(
        "/v1/preferences?section=agents",
      );
      if (current !== revision.current) return;
      setItems(result.items);
      setError("");
    } catch {
      if (current === revision.current)
        setError("Agent activity settings could not be loaded. Try again.");
    }
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
        "This setting could not be saved. Your previous setting is still active.",
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
      aria-busy={pending || !items}
    >
      {error ? (
        <div role="alert" className="text-sm text-destructive">
          {error}
          {!items ? (
            <Button
              variant="outline"
              className="ml-3"
              onClick={() => void load()}
            >
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}
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
