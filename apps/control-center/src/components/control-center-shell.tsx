"use client";

import {
  Activity,
  BarChart3,
  ChevronRight,
  FileText,
  Grid2X2,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  type ActiveTab,
  type AppearanceSection,
  type DeviceInfo,
  type ShellNavItem,
} from "./control-center-types";
import { ControlCenterBrand } from "./control-center-brand";

type ControlCenterShellProps = {
  activeTab: ActiveTab;
  activeAppearanceSection?: AppearanceSection;
  onAppearanceSectionChange?: (section: AppearanceSection) => void;
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
    label: "Appearance",
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
  activeAppearanceSection = "themes",
  onAppearanceSectionChange,
  onTabChange,
  children,
  disabledTabs = [],
  headerAction,
  updateAvailable = false,
}: ControlCenterShellProps) {
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
              activeAppearanceSection={activeAppearanceSection}
              isTabDisabled={isTabDisabled}
              onAppearanceSectionChange={onAppearanceSectionChange}
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

            {headerAction}
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
  activeAppearanceSection,
  isTabDisabled,
  onAppearanceSectionChange,
  onTabChange,
  updateAvailable,
}: {
  activeTab: ActiveTab;
  activeAppearanceSection: AppearanceSection;
  isTabDisabled: (tab: ActiveTab) => boolean;
  onAppearanceSectionChange?: (section: AppearanceSection) => void;
  onTabChange: (tab: ActiveTab) => void;
  updateAvailable: boolean;
}) {
  const { isMobile } = useSidebar();

  return (
    <SidebarGroup className="p-3 group-data-[collapsible=icon]:p-2">
      <SidebarGroupContent>
        <nav aria-label={isMobile ? "Control Center mobile" : "Control Center"}>
          <SidebarMenu className="gap-1">
            {NAV_ITEMS.map((item) => {
              const appearance = item.id === "theme-library";
              const disabled = isTabDisabled(item.id);
              const menuItem = (
                <SidebarMenuItem key={item.id}>
                  <ShellNavButton
                    active={item.id === activeTab}
                    collapsible={appearance}
                    current={!appearance}
                    disabled={disabled}
                    item={item}
                    notify={item.id === "updates" && updateAvailable}
                    onClick={() => onTabChange(item.id)}
                  />
                  {appearance ? (
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {(["themes", "screensavers"] as const).map(
                          (section) => (
                            <SidebarMenuSubItem key={section}>
                              <AppearanceNavButton
                                active={
                                  activeTab === "theme-library" &&
                                  activeAppearanceSection === section
                                }
                                disabled={disabled}
                                label={
                                  section === "themes"
                                    ? "Themes"
                                    : "Screensavers"
                                }
                                onClick={() => {
                                  onAppearanceSectionChange?.(section);
                                  onTabChange("theme-library");
                                }}
                              />
                            </SidebarMenuSubItem>
                          ),
                        )}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  ) : null}
                </SidebarMenuItem>
              );
              return appearance ? (
                <Collapsible
                  key={item.id}
                  asChild
                  className="group/collapsible"
                >
                  {menuItem}
                </Collapsible>
              ) : (
                menuItem
              );
            })}
          </SidebarMenu>
        </nav>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function ShellNavButton({
  active,
  collapsible = false,
  current = true,
  disabled,
  item,
  notify,
  onClick,
}: {
  active: boolean;
  collapsible?: boolean;
  current?: boolean;
  disabled?: boolean;
  item: ShellNavItem;
  notify?: boolean;
  onClick: () => void;
}) {
  const { isMobile, setOpenMobile, state } = useSidebar();
  // In the icon-collapsed sidebar the Appearance submenu is hidden, so the
  // collapsed click must navigate directly instead of toggling an invisible
  // Collapsible.
  const collapsedToIcons = !isMobile && state === "collapsed";

  const button = (
    <SidebarMenuButton
      aria-current={active && current ? "page" : undefined}
      className="h-11 rounded-[var(--radius-control)] px-3 text-sm data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground data-active:[&_svg]:text-sidebar-primary group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-11! [&_svg]:size-5!"
      disabled={disabled}
      isActive={active}
      onClick={() => {
        if (!collapsible || collapsedToIcons) {
          onClick();
        }
        if (isMobile && !collapsible) {
          setOpenMobile(false);
        }
      }}
      tooltip={item.label}
      type="button"
    >
      {item.icon}
      <span className="min-w-0 truncate">{item.label}</span>
      {collapsible ? (
        <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
      ) : null}
    </SidebarMenuButton>
  );

  return (
    <>
      {collapsible ? (
        <CollapsibleTrigger asChild>{button}</CollapsibleTrigger>
      ) : (
        button
      )}
      {notify ? (
        <SidebarMenuBadge
          aria-label="Update available"
          className="top-1/2! -translate-y-1/2"
        >
          <span className="size-2 rounded-full bg-sidebar-primary" />
        </SidebarMenuBadge>
      ) : null}
    </>
  );
}

function AppearanceNavButton({
  active,
  disabled,
  label,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <SidebarMenuSubButton
      asChild
      className="h-11 w-full data-active:bg-transparent! data-active:font-semibold data-active:text-sidebar-accent-foreground"
      isActive={active}
    >
      <button
        aria-current={active ? "page" : undefined}
        disabled={disabled}
        onClick={() => {
          onClick();
          if (isMobile) {
            setOpenMobile(false);
          }
        }}
        type="button"
      >
        <span>{label}</span>
      </button>
    </SidebarMenuSubButton>
  );
}
