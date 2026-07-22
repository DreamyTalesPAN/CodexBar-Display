"use client";

import {
  Activity,
  BarChart3,
  FileText,
  Grid2X2,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  type ActiveTab,
  type DeviceInfo,
  type ShellNavItem,
} from "./control-center-types";
import { ControlCenterBrand } from "./control-center-brand";
import { ShellConnectionStatus } from "./shell-connection-status";

type ControlCenterShellProps = {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  children: ReactNode;
  device: DeviceInfo | null;
  disabledTabs?: ActiveTab[];
  headerAction?: ReactNode;
  updateAvailable?: boolean;
};

const NAV_ITEMS: ShellNavItem[] = [
  {
    id: "overview",
    label: "Overview",
    icon: <Activity aria-hidden />,
  },
  {
    id: "usage",
    label: "Usage",
    icon: <BarChart3 aria-hidden />,
  },
  {
    id: "settings",
    label: "Settings",
    icon: <SlidersHorizontal aria-hidden />,
  },
  {
    id: "theme-library",
    label: "Theme Library",
    icon: <Grid2X2 aria-hidden />,
  },
  {
    id: "updates",
    label: "Updates",
    icon: <RefreshCw aria-hidden />,
  },
  {
    id: "logs",
    label: "Support",
    icon: <FileText aria-hidden />,
  },
];

export function ControlCenterShell({
  activeTab,
  onTabChange,
  children,
  device,
  disabledTabs = [],
  headerAction,
  updateAvailable = false,
}: ControlCenterShellProps) {
  const connected = Boolean(
    device?.connected && (device.deviceId || device.target),
  );
  const targetLabel = connected ? "VibeTV connected" : "VibeTV not connected";
  const mobileTargetLabel = connected ? "Connected" : "Not connected";
  const disabledTabSet = new Set(disabledTabs);
  const isTabDisabled = (tab: ActiveTab) => disabledTabSet.has(tab);
  return (
    <SidebarProvider
      className="control-center-shell overflow-x-hidden bg-background text-foreground"
      style={
        {
          "--sidebar-width": "16.625rem",
          "--sidebar-width-icon": "4rem",
        } as CSSProperties
      }
    >
      <div className="control-center-shell__layout flex min-h-svh w-full">
        <Sidebar className="control-center-shell__sidebar" collapsible="icon">
          <SidebarHeader className="border-b border-sidebar-border p-4 group-data-[collapsible=icon]:p-2">
            <BrandHomeButton onClick={() => onTabChange("overview")}>
              <ControlCenterBrand className="group-data-[collapsible=icon]:hidden" />
              <ControlCenterBrand
                className="hidden group-data-[collapsible=icon]:block"
                variant="compact"
              />
            </BrandHomeButton>
          </SidebarHeader>
          <SidebarContent>
            <ControlCenterNavigation
              activeTab={activeTab}
              isTabDisabled={isTabDisabled}
              onTabChange={onTabChange}
              updateAvailable={updateAvailable}
            />
          </SidebarContent>
          <SidebarRail />
        </Sidebar>

        <SidebarInset className="control-center-shell control-center-shell__main min-w-0">
          <header className="control-center-shell__header flex min-h-[72px] items-center justify-between gap-4 bg-background px-4 py-3 md:h-[86px] md:px-6 lg:px-10 lg:py-0">
            <div className="flex min-w-0 items-center gap-3">
              <SidebarTrigger aria-label="Open navigation" className="shrink-0" />
              <h1 className="truncate text-base font-semibold text-foreground md:text-xl">
                {NAV_ITEMS.find((item) => item.id === activeTab)?.label ||
                  "Overview"}
              </h1>
            </div>

            <div className="flex min-w-0 items-center gap-2">
              <ShellConnectionStatus
                compactLabel={mobileTargetLabel}
                label={targetLabel}
                ready={connected}
              />
              {headerAction}
            </div>
          </header>

          <div className="control-center-shell__content px-5 py-0 sm:px-7 lg:px-10">{children}</div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}

function BrandHomeButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <SidebarMenuButton
      aria-label="Go to Overview"
      className="h-14 w-full justify-start rounded-none px-2 hover:bg-sidebar-accent group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-11! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
      onClick={() => {
        onClick();
        if (isMobile) {
          setOpenMobile(false);
        }
      }}
      tooltip="Overview"
      type="button"
    >
      {children}
    </SidebarMenuButton>
  );
}

function ControlCenterNavigation({
  activeTab,
  isTabDisabled,
  onTabChange,
  updateAvailable,
}: {
  activeTab: ActiveTab;
  isTabDisabled: (tab: ActiveTab) => boolean;
  onTabChange: (tab: ActiveTab) => void;
  updateAvailable: boolean;
}) {
  const { isMobile } = useSidebar();

  return (
    <SidebarGroup className="p-3 group-data-[collapsible=icon]:p-2">
      <SidebarGroupContent>
        <nav aria-label={isMobile ? "Control Center mobile" : "Control Center"}>
          <SidebarMenu className="gap-1">
            {NAV_ITEMS.map((item) => (
              <SidebarMenuItem key={item.id}>
                <ShellNavButton
                  active={item.id === activeTab}
                  disabled={isTabDisabled(item.id)}
                  item={item}
                  notify={item.id === "updates" && updateAvailable}
                  onClick={() => onTabChange(item.id)}
                />
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </nav>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function ShellNavButton({
  active,
  disabled,
  item,
  notify,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  item: ShellNavItem;
  notify?: boolean;
  onClick: () => void;
}) {
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <>
      <SidebarMenuButton
        aria-current={active ? "page" : undefined}
        className="h-11 rounded-[var(--radius-control)] px-3 text-sm data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground data-active:[&_svg]:text-sidebar-primary group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-11! [&_svg]:size-5!"
        disabled={disabled}
        isActive={active}
        onClick={() => {
          onClick();
          if (isMobile) {
            setOpenMobile(false);
          }
        }}
        tooltip={item.label}
        type="button"
      >
        {item.icon}
        <span className="min-w-0 truncate">{item.label}</span>
      </SidebarMenuButton>
      {notify ? (
        <SidebarMenuBadge aria-label="Update available">
          <span className="size-2 rounded-full bg-sidebar-primary" />
        </SidebarMenuBadge>
      ) : null}
    </>
  );
}
