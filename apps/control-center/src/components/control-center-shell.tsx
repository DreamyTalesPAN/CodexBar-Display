"use client";

import {
  Activity,
  BarChart3,
  ChevronDown,
  FileText,
  Palette,
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
  /** The open Theme Studio draws its own header row, so the shell keeps only a hidden title. */
  themeStudioOpen?: boolean;
};

// Hover is a weaker tint than the active fill, so a hovered entry never
// reads as a second active one.
const WEAK_HOVER =
  "hover:bg-sidebar-accent/45 data-open:hover:bg-sidebar-accent/45";

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
    icon: <Palette aria-hidden />,
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
  themeStudioOpen = false,
}: ControlCenterShellProps) {
  // On Appearance the page title is the open sub-page (one title, no second
  // heading below it); the open Studio keeps the "Appearance" title, hidden.
  const pageTitle =
    activeTab === "theme-library" && !themeStudioOpen
      ? activeAppearanceSection === "screensavers"
        ? "Screensavers"
        : "Themes"
      : NAV_ITEMS.find((item) => item.id === activeTab)?.label || "Overview";
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
  return (
    <SidebarProvider
      className="control-center-shell overflow-x-hidden bg-background text-foreground"
      style={
        {
          "--sidebar-width": "14.5rem",
          "--sidebar-width-icon": "4rem",
        } as CSSProperties
      }
    >
      <div className="control-center-shell__layout flex min-h-svh w-full">
        <Sidebar className="control-center-shell__sidebar" collapsible="icon">
          <SidebarHeader className="px-3.5 pt-7 pb-7 group-data-[collapsible=icon]:p-2">
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
          {themeStudioOpen ? (
            // The Studio's own row (back arrow, design name, File, Save) is the header; the title stays for screen readers.
            <h1 className="sr-only">{pageTitle}</h1>
          ) : (
            <header className="control-center-shell__header mt-9 flex h-10 items-center justify-between gap-4 bg-background px-5 sm:px-7 lg:px-12">
              <div className="flex min-w-0 items-center gap-3">
                <SidebarTrigger
                  aria-label="Open navigation"
                  className={cn(
                    "-m-1 size-7 shrink-0 p-0 text-muted-foreground hover:bg-transparent hover:text-foreground [&_svg]:size-5",
                    // The template draws no toggle beside Updates and Support; a narrow window keeps it, it is the only way to the menu there.
                    (activeTab === "updates" || activeTab === "logs") && "md:hidden",
                  )}
                />
                <h1 className="truncate text-[28px] leading-none font-semibold tracking-[-0.01em] text-foreground">
                  {pageTitle}
                </h1>
              </div>

              {headerAction}
            </header>
          )}

          <div
            className={cn(
              "control-center-shell__content px-5 sm:px-7 lg:px-12",
              themeStudioOpen ? "pt-9" : "py-0",
              // Overview fills the window's height: its numbers sit at the bottom (#784 point 1).
              activeTab === "overview" && !themeStudioOpen && "flex flex-1 flex-col",
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
      className="h-auto w-full justify-start rounded-none px-2.5 py-0 hover:bg-transparent group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-11! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
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
    <SidebarGroup className="px-3.5 py-0 group-data-[collapsible=icon]:p-2">
      <SidebarGroupContent>
        <nav aria-label={isMobile ? "Control Center mobile" : "Control Center"}>
          <SidebarMenu className="gap-0.5">
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
  const { isMobile, setOpenMobile } = useSidebar();

  const button = (
    <SidebarMenuButton
      aria-current={active && current ? "page" : undefined}
      className={`h-[34px] gap-2.5 rounded-[var(--radius-control)] px-2.5 text-[13px] font-normal text-sidebar-foreground opacity-[.72] hover:opacity-100 ${active ? "" : WEAK_HOVER} data-active:bg-sidebar-accent data-active:font-normal data-active:text-sidebar-accent-foreground data-active:opacity-100 group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-11! group-data-[collapsible=icon]:justify-center [&_svg]:size-4!`}
      disabled={disabled}
      isActive={active}
      onClick={() => {
        // Opening the Appearance group also opens its tab, so only one entry
        // is highlighted (issue #579). The group still toggles beside it.
        onClick();
        if (isMobile && !collapsible) {
          setOpenMobile(false);
        }
      }}
      tooltip={item.label}
      type="button"
    >
      {item.icon}
      <span className="min-w-0 truncate group-data-[collapsible=icon]:sr-only">{item.label}</span>
      {collapsible ? (
        <ChevronDown className="ml-auto size-3.5! opacity-80 transition-transform duration-200 group-data-[collapsible=icon]:hidden group-data-[state=open]/collapsible:rotate-180" />
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
          <span className="size-2 rounded-full bg-sidebar-foreground" />
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
      className={`h-[34px] w-full text-[13px]! ${active ? "" : WEAK_HOVER} data-active:bg-transparent! data-active:font-semibold data-active:text-sidebar-accent-foreground`}
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
