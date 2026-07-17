"use client";

import { ListChecks } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import type { CompanionStatus } from "./control-center-types";

type HostedSetupShellProps = {
  children: ReactNode;
  companionStatus: CompanionStatus;
  setupComplete: boolean;
};

export function HostedSetupShell({
  children,
  companionStatus,
  setupComplete,
}: HostedSetupShellProps) {
  const ready = companionStatus === "online" || setupComplete;
  const statusLabel = ready ? "Opening local Control Center" : "Setup needed";

  return (
    <SidebarProvider
      className="control-center-shell overflow-x-hidden bg-background text-foreground"
      style={{ "--sidebar-width": "16.625rem" } as CSSProperties}
    >
      <div className="flex min-h-svh w-full">
        <Sidebar collapsible="icon">
          <SidebarHeader className="border-b border-sidebar-border p-4 group-data-[collapsible=icon]:p-2">
            <div className="flex h-14 min-w-0 items-center px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
              <div className="min-w-0 group-data-[collapsible=icon]:hidden">
                <div className="text-2xl font-black uppercase leading-none">
                  VIBE<span className="text-sidebar-primary">TV</span>
                </div>
                <div className="mt-1 text-[0.7rem] font-semibold uppercase tracking-wide text-sidebar-foreground/65">
                  Control Center
                </div>
              </div>
              <div className="hidden text-sm font-black text-sidebar-primary group-data-[collapsible=icon]:block">
                VT
              </div>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup className="p-3 group-data-[collapsible=icon]:p-2">
              <SidebarGroupContent>
                <nav aria-label="Control Center">
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton isActive tooltip="Setup">
                        <ListChecks aria-hidden />
                        <span>Setup</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </nav>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarRail />
        </Sidebar>

        <SidebarInset className="min-w-0">
          <header className="flex min-h-[72px] items-center justify-between gap-4 bg-background px-4 py-3 md:h-[86px] md:px-6 lg:px-10 lg:py-0">
            <div className="flex min-w-0 items-center gap-3">
              <SidebarTrigger aria-label="Open navigation" className="shrink-0" />
              <h1 className="truncate text-base font-semibold md:text-xl">Setup</h1>
            </div>
            <div className="inline-flex min-w-0 items-center gap-2 text-xs text-muted-foreground md:gap-3 md:text-base md:text-foreground">
              <span className={cn("size-2 shrink-0 rounded-full", ready ? "bg-primary" : "bg-border")} />
              <span className="truncate">{statusLabel}</span>
            </div>
          </header>

          <div className="px-5 py-0 sm:px-7 lg:px-10">{children}</div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
