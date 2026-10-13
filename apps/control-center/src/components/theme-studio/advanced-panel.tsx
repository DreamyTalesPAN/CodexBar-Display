"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type ThemeStudioAdvancedTab = "assets" | "device" | "json" | "project";

const TABS: Array<{ id: ThemeStudioAdvancedTab; label: string }> = [
  { id: "project", label: "Project" },
  { id: "assets", label: "Assets" },
  { id: "json", label: "JSON" },
  { id: "device", label: "Device" },
];

export function AdvancedPanel({
  activeTab,
  onTabChange,
  panels,
}: {
  activeTab: ThemeStudioAdvancedTab;
  onTabChange: (tab: ThemeStudioAdvancedTab) => void;
  panels: Record<ThemeStudioAdvancedTab, ReactNode>;
}) {
  return (
    <Collapsible className="min-w-0 w-full">
      <CollapsibleTrigger asChild>
        <Button className="group w-full justify-between" type="button" variant="outline">
          <span>Advanced</span>
          <ChevronDown
            className="transition-transform group-data-[state=open]:rotate-180"
            data-icon="inline-end"
            aria-hidden
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="min-w-0 pt-3">
        <Tabs
          activationMode="automatic"
          className="flex min-w-0 w-full flex-col gap-3"
          onValueChange={(value) =>
            onTabChange(value as ThemeStudioAdvancedTab)
          }
          value={activeTab}
        >
          <TabsList
            aria-label="Advanced editor sections"
            className="grid h-auto w-full grid-cols-2"
          >
            {TABS.map((tab) => (
              <TabsTrigger
                id={`theme-studio-tab-${tab.id}`}
                key={tab.id}
                value={tab.id}
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent className="grid min-w-0 gap-4" value={activeTab}>
            {panels[activeTab]}
          </TabsContent>
        </Tabs>
      </CollapsibleContent>
    </Collapsible>
  );
}
