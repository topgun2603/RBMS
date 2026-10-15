"use client";

import * as React from "react";
import { motion } from "motion/react";
import { MenuIcon, PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "../components/button";
import { ScrollArea } from "../components/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../components/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/tooltip";
import { useReducedMotionSafe } from "../motion/motion";

export interface AppShellNavItem {
  href: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  badge?: React.ReactNode;
  /** Only active on an exact path match (default true for "/"). */
  exact?: boolean;
}

export interface AppShellNavSection {
  id?: string;
  title?: string;
  items: AppShellNavItem[];
}

export interface AppShellLinkProps {
  href: string;
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
  "aria-current"?: "page";
  "aria-label"?: string;
}

/** Pass `next/link` (or any router link) so the shell stays framework-agnostic. */
export type AppShellLinkComponent = React.ComponentType<AppShellLinkProps>;

const DefaultLink: AppShellLinkComponent = ({ children, ...props }) => <a {...props}>{children}</a>;

export interface AppShellLabels {
  toggleSidebar: string;
  openNavigation: string;
  navigation: string;
  close: string;
}

const defaultLabels: AppShellLabels = {
  toggleSidebar: "Toggle sidebar",
  openNavigation: "Open navigation",
  navigation: "Navigation",
  close: "Close",
};

export interface AppShellProps {
  /** Logo + product name for the expanded sidebar. */
  brand: React.ReactNode;
  /** Compact mark for the collapsed sidebar (defaults to `brand`). */
  brandCollapsed?: React.ReactNode;
  sections: AppShellNavSection[];
  currentPath: string;
  LinkComponent?: AppShellLinkComponent;
  /** Left side of the top bar, e.g. a tenant switcher. */
  topbarStart?: React.ReactNode;
  /** Right side of the top bar, e.g. locale switcher, theme toggle, user menu. */
  topbarEnd?: React.ReactNode;
  /** Bottom of the sidebar (expanded only), e.g. plan badge or help link. */
  sidebarFooter?: React.ReactNode;
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  labels?: Partial<AppShellLabels>;
  /** Show the hamburger + slide-over nav on small screens (default true). Turn off when the app has its own mobile nav. */
  showMobileMenu?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function isNavItemActive(item: AppShellNavItem, path: string): boolean {
  const exact = item.exact ?? item.href === "/";
  if (exact) return path === item.href;
  return path === item.href || path.startsWith(item.href.endsWith("/") ? item.href : `${item.href}/`);
}

function AppShell({
  brand,
  brandCollapsed,
  sections,
  currentPath,
  LinkComponent = DefaultLink,
  topbarStart,
  topbarEnd,
  sidebarFooter,
  collapsed: collapsedProp,
  defaultCollapsed = false,
  onCollapsedChange,
  labels,
  showMobileMenu = true,
  children,
  className,
}: AppShellProps) {
  const l = { ...defaultLabels, ...labels };
  const [collapsedState, setCollapsedState] = React.useState(defaultCollapsed);
  const collapsed = collapsedProp ?? collapsedState;
  const setCollapsed = (v: boolean) => {
    setCollapsedState(v);
    onCollapsedChange?.(v);
  };
  const [mobileOpen, setMobileOpen] = React.useState(false);

  // Close the mobile sheet on navigation.
  React.useEffect(() => setMobileOpen(false), [currentPath]);

  return (
    <div data-slot="app-shell" className={cn("flex min-h-dvh w-full bg-page", className)}>
      {/* Desktop sidebar */}
      <aside
        data-collapsed={collapsed || undefined}
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out md:flex print:hidden",
          collapsed ? "w-[3.75rem]" : "w-64",
        )}
      >
        <div className={cn("flex h-16 shrink-0 items-center", collapsed ? "justify-center px-2" : "px-4")}>
          {collapsed ? (brandCollapsed ?? brand) : brand}
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <SidebarNav
            sections={sections}
            currentPath={currentPath}
            LinkComponent={LinkComponent}
            collapsed={collapsed}
            layoutGroup="desktop"
          />
        </ScrollArea>
        {sidebarFooter && !collapsed && <div className="shrink-0 border-t border-sidebar-border p-3">{sidebarFooter}</div>}
      </aside>

      {/* Mobile sidebar */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 gap-0 bg-sidebar p-0 text-sidebar-foreground" closeLabel={l.close}>
          <SheetTitle className="sr-only">{l.navigation}</SheetTitle>
          <SheetDescription className="sr-only">{l.navigation}</SheetDescription>
          <div className="flex h-16 shrink-0 items-center px-4">{brand}</div>
          <ScrollArea className="min-h-0 flex-1">
            <SidebarNav
              sections={sections}
              currentPath={currentPath}
              LinkComponent={LinkComponent}
              collapsed={false}
              layoutGroup="mobile"
              onNavigate={() => setMobileOpen(false)}
            />
          </ScrollArea>
          {sidebarFooter && <div className="shrink-0 border-t border-sidebar-border p-3">{sidebarFooter}</div>}
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border/60 bg-page/85 px-3 backdrop-blur-md supports-[backdrop-filter]:bg-page/70 sm:px-4">
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn("md:hidden", !showMobileMenu && "hidden")}
            aria-label={l.openNavigation}
            onClick={() => setMobileOpen(true)}
          >
            <MenuIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="hidden text-muted-foreground md:inline-flex"
            aria-label={l.toggleSidebar}
            aria-pressed={collapsed}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
          </Button>
          <div className="flex min-w-0 flex-1 items-center gap-2">{topbarStart}</div>
          <div className="flex shrink-0 items-center gap-1">{topbarEnd}</div>
        </header>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

function SidebarNav({
  sections,
  currentPath,
  LinkComponent,
  collapsed,
  layoutGroup,
  onNavigate,
}: {
  sections: AppShellNavSection[];
  currentPath: string;
  LinkComponent: AppShellLinkComponent;
  collapsed: boolean;
  layoutGroup: string;
  onNavigate?: () => void;
}) {
  const reduced = useReducedMotionSafe();
  // Longest matching href wins, so "/platform/tenants" doesn't also light up "/platform".
  const activeHref = React.useMemo(() => {
    let best: string | null = null;
    for (const s of sections)
      for (const item of s.items)
        if (isNavItemActive(item, currentPath) && (best === null || item.href.length > best.length)) best = item.href;
    return best;
  }, [sections, currentPath]);

  return (
    <nav className={cn("flex flex-col gap-4 py-3", collapsed ? "px-2" : "px-3")}>
      {sections.map((section, si) => (
        <div key={section.id ?? section.title ?? si} className="flex flex-col gap-0.5">
          {section.title &&
            (collapsed ? (
              si > 0 && <div className="mx-2 mb-1 h-px bg-sidebar-border" />
            ) : (
              <div className="px-2.5 pb-1.5 text-[0.6875rem] font-semibold tracking-wider text-muted-foreground/80 uppercase">
                {section.title}
              </div>
            ))}
          {section.items.map((item) => {
            const active = item.href === activeHref;
            const Icon = item.icon;
            const link = (
              <LinkComponent
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                aria-label={collapsed ? item.label : undefined}
                className={cn(
                  "group/nav relative flex h-10 items-center gap-3 rounded-lg text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                  collapsed ? "justify-center px-0" : "px-2.5",
                  active
                    ? "text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
              >
                {active && (
                  <motion.span
                    layoutId={`sr-nav-active-${layoutGroup}`}
                    transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 40 }}
                    className="absolute inset-0 rounded-lg bg-sidebar-accent shadow-xs ring-1 ring-primary/10"
                  >
                    <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-sidebar-primary" />
                  </motion.span>
                )}
                {Icon && (
                  <Icon
                    className={cn(
                      "relative size-4 shrink-0",
                      active ? "text-sidebar-primary" : "text-muted-foreground group-hover/nav:text-sidebar-accent-foreground",
                    )}
                  />
                )}
                {!collapsed && <span className="relative truncate">{item.label}</span>}
                {!collapsed && item.badge && <span className="relative ml-auto">{item.badge}</span>}
              </LinkComponent>
            );
            return collapsed ? (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>
                  <div>{link}</div>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {item.label}
                </TooltipContent>
              </Tooltip>
            ) : (
              <React.Fragment key={item.href}>{link}</React.Fragment>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export { AppShell };
