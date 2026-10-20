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
import { useLayoutEffect, type CSSProperties, type ReactNode } from "react";
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
  type ShellNavItem,
} from "./control-center-types";
import { cn } from "@/lib/utils";
import { ControlCenterBrand } from "./control-center-brand";

type ControlCenterShellProps = {
  activeTab: ActiveTab;
  activeAppearanceSection?: AppearanceSection;
  onAppearanceSectionChange?: (section: AppearanceSection) => void;
  onTabChange: (tab: ActiveTab) => void;
  children: ReactNode;
  disabledTabs?: ActiveTab[];
  hiddenTabs?: ActiveTab[];
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
  hiddenTabs = [],
  headerAction,
  updateAvailable = false,
}: ControlCenterShellProps) {
  const disabledTabSet = new Set(disabledTabs);
  const isTabDisabled = (tab: ActiveTab) => disabledTabSet.has(tab);
  // The window scrolls, not the tab. A link far down one tab that opens
  // another (Settings › Choose screensaver) would leave the new tab scrolled
  // past its heading (issue #558).
  useLayoutEffect(() => {
    document.documentElement.scrollTop = 0;
  }, [activeTab, activeAppearanceSection]);
  // Clicking the tab that is already open starts it over at the top.
  const selectTab = (tab: ActiveTab) => {
    if (tab === activeTab) {
      document.documentElement.scrollTop = 0;
    }
    onTabChange(tab);
  };
  // Usage: the page margin grows with the window (48 px up to 96 px), as in the
  // template's frames "Usage" and "Usage at 1920 x 1080".
  const growingMargin = activeTab === "usage";
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
            <BrandHomeButton onClick={() => selectTab("overview")}>
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
              hiddenTabs={hiddenTabs}
              onAppearanceSectionChange={onAppearanceSectionChange}
              onTabChange={selectTab}
              updateAvailable={updateAvailable}
            />
          </SidebarContent>
          <SidebarRail />
        </Sidebar>

        <SidebarInset className="control-center-shell control-center-shell__main min-w-0">
          <header className={cn(
              "control-center-shell__header flex min-h-[72px] items-center justify-between gap-4 bg-background px-4 py-3 md:h-[86px] md:px-6 lg:px-10 lg:py-0",
              growingMargin &&
                "md:px-[clamp(48px,4vw,96px)] lg:px-[clamp(48px,4vw,96px)]",
            )}>
            <div className="flex min-w-0 items-center gap-3">
              <SidebarTrigger aria-label="Open navigation" className="shrink-0" />
              <h1 className="truncate text-base font-semibold text-foreground md:text-xl">
                {NAV_ITEMS.find((item) => item.id === activeTab)?.label ||
                  "Overview"}
              </h1>
            </div>

            {headerAction}
          </header>

          <div
            className={cn(
              "control-center-shell__content px-5 py-0 sm:px-7 lg:px-10",
              growingMargin &&
                "md:px-[clamp(48px,4vw,96px)] lg:px-[clamp(48px,4vw,96px)]",
            )}
          >
            {children}
          </div>
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
  hiddenTabs,
  onAppearanceSectionChange,
  onTabChange,
  updateAvailable,
}: {
  activeTab: ActiveTab;
  activeAppearanceSection: AppearanceSection;
  isTabDisabled: (tab: ActiveTab) => boolean;
  hiddenTabs: ActiveTab[];
  onAppearanceSectionChange?: (section: AppearanceSection) => void;
  onTabChange: (tab: ActiveTab) => void;
  updateAvailable: boolean;
}) {
  const { isMobile } = useSidebar();
  const visibleNavItems = NAV_ITEMS.filter(
    (item) => !hiddenTabs.includes(item.id),
  );

  return (
    <SidebarGroup className="p-3 group-data-[collapsible=icon]:p-2">
      <SidebarGroupContent>
        <nav aria-label={isMobile ? "Control Center mobile" : "Control Center"}>
          <SidebarMenu className="gap-1">
            {visibleNavItems.map((item) => {
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
        // An open Appearance entry toggles its submenu and also starts over at
        // the top (Codex review of #677); the submenu itself stays a toggle.
        if (!collapsible || collapsedToIcons || active) {
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
          role="img"
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
