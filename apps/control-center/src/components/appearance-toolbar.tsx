"use client";

import { ListFilter, Search, X } from "lucide-react";
import type { RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import type { FilterGroup } from "@/lib/appearance-filters";
import type { ThemeStudioUsage } from "@/lib/theme-studio";

/** Which rows the Appearance page lists: everything, or one type. */
export type ThemeLibraryUsage = "all" | ThemeStudioUsage;

export type AppearanceToolbarGroup = FilterGroup & {
  /** Rows of the current type that carry each option, by option id. */
  counts: Record<string, number>;
};

const SEGMENTS: { id: ThemeLibraryUsage; label: string }[] = [
  { id: "all", label: "All" },
  { id: "live", label: "Themes" },
  { id: "screensaver", label: "Screensavers" },
];

const TEXT_LINK = "text-[13px] font-semibold underline underline-offset-4";

export function AppearanceToolbar({
  counts,
  filtersRef,
  groups,
  onClearFilters,
  onQueryChange,
  onToggleFilter,
  onUsageChange,
  query,
  resultCount,
  selected,
  usage,
}: {
  counts: Record<ThemeLibraryUsage, number>;
  filtersRef?: RefObject<HTMLButtonElement | null>;
  groups: AppearanceToolbarGroup[];
  onClearFilters: () => void;
  onQueryChange: (query: string) => void;
  onToggleFilter: (optionId: string) => void;
  onUsageChange?: (usage: ThemeLibraryUsage) => void;
  query: string;
  resultCount: number;
  /** Only options that belong to a shown group. */
  selected: string[];
  usage: ThemeLibraryUsage;
}) {
  const labels = new Map(
    groups.flatMap((group) =>
      group.options.map((option) => [option.id, option.label] as const),
    ),
  );
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup
          aria-label="Show"
          className="rounded-[10px] bg-muted p-[3px]"
          onValueChange={(value) => {
            // Pressing the chosen segment again would clear the group.
            if (value) onUsageChange?.(value as ThemeLibraryUsage);
          }}
          spacing={0.5}
          type="single"
          value={usage}
        >
          {SEGMENTS.map((segment) => (
            <ToggleGroupItem
              className="h-[30px] gap-1.5 rounded-[7px] px-3 text-[13px] font-normal text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-card data-[state=on]:font-semibold data-[state=on]:text-foreground data-[state=on]:shadow-[0_0_0_1px_color-mix(in_srgb,var(--foreground)_10%,transparent),0_1px_2px_rgb(0_0_0/0.06)] data-[state=on]:hover:bg-card aria-pressed:bg-transparent"
              key={segment.id}
              value={segment.id}
            >
              {segment.label}{" "}
              <span className="font-normal opacity-60">{counts[segment.id]}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="hidden flex-1 sm:block" />
        <div className="relative w-[220px]">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search"
            className="h-9 border-foreground/15 pr-3 pl-9 text-[13px] [&::-webkit-search-cancel-button]:hidden"
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onQueryChange("");
            }}
            placeholder="Search"
            type="search"
            value={query}
          />
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              className={cn(
                "h-9 gap-2 px-3.5 text-[14px]",
                selected.length > 0 &&
                  "border-foreground bg-foreground text-background hover:bg-foreground hover:text-background aria-expanded:bg-foreground aria-expanded:text-background",
              )}
              ref={filtersRef}
              variant="outline"
              type="button"
            >
              <ListFilter aria-hidden />
              Filters
              {selected.length > 0 ? (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-background px-1.5 text-[12px] font-semibold text-foreground">
                  {selected.length}
                </span>
              ) : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-[300px] gap-0 rounded-xl p-0 shadow-[0_12px_32px_rgb(0_0_0/0.14)]"
            sideOffset={8}
          >
            {groups.map((group) => (
              <div
                className="border-t border-foreground/10 px-4 py-3 first:border-t-0"
                key={group.id}
                role="group"
                aria-label={group.title}
              >
                <div className="mb-1 text-[12px] font-semibold text-muted-foreground">
                  {group.title}
                </div>
                {group.options.map((option) => (
                  <label
                    className="flex h-8 items-center gap-2.5 text-[14px]"
                    key={option.id}
                  >
                    <Checkbox
                      aria-label={option.label}
                      className="data-checked:border-foreground data-checked:bg-foreground data-checked:text-background dark:data-checked:bg-foreground"
                      checked={selected.includes(option.id)}
                      onCheckedChange={() => onToggleFilter(option.id)}
                    />
                    <span className="flex-1">{option.label}</span>
                    <span className="text-[13px] text-muted-foreground">
                      {group.counts[option.id] ?? 0}
                    </span>
                  </label>
                ))}
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-foreground/10 px-4 py-3">
              <button className={TEXT_LINK} onClick={onClearFilters} type="button">
                Clear all
              </button>
              <span aria-live="polite" className="text-[13px] text-muted-foreground">
                {resultCount} {resultCount === 1 ? "result" : "results"}
              </span>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {selected.length > 0 ? (
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          {selected.map((id) => (
            <span
              className="inline-flex h-7 items-center gap-1.5 rounded-full bg-muted pr-2 pl-3 text-[13px]"
              key={id}
            >
              {labels.get(id)}
              <button
                aria-label={`Remove filter ${labels.get(id)}`}
                className="inline-flex size-4 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onToggleFilter(id)}
                type="button"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </span>
          ))}
          <button className={`${TEXT_LINK} ml-1`} onClick={onClearFilters} type="button">
            Clear all
          </button>
        </div>
      ) : null}
    </div>
  );
}
