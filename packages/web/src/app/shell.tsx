"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftRightIcon, LogOutIcon, MenuIcon, PlusIcon, SettingsIcon } from "lucide-react";
import {
  AppShell,
  Avatar,
  AvatarFallback,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  initials,
  isNavItemActive,
  motion,
  PageTransition,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  type AppShellLinkComponent,
  type AppShellNavItem,
  type AppShellNavSection,
} from "@srirealtime/ui";
import { BrandMark } from "../components/brand-mark";
import { BranchSwitcher } from "../components/branch-switcher";
import { LocaleSwitcher } from "../components/locale-switcher";
import { ThemeToggle } from "../components/theme-toggle";
import { displayName, useSignOut } from "../lib/auth";
import { tOr, useI18n } from "../lib/i18n";
import { readStored, setStoredTenant, SIDEBAR_KEY, writeStored } from "../lib/session";
import { getTenantStrategy } from "../lib/tenant";
import { BUILT_IN_SETTINGS } from "./builtins";
import { buildNavModel, joinPath } from "./model";
import { useWebApp } from "./navigation";
import { useSession, useVisible, useVisibleSettings } from "./session";
import type { IconType, MountedModule, QuickAction } from "./types";

const NextLink: AppShellLinkComponent = ({ href, children, ...props }) => (
  <Link href={href} {...props}>
    {children}
  </Link>
);

interface ShellItem extends AppShellNavItem {
  tab: boolean;
  tabLabel: string;
}

interface ShellNav {
  sections: (AppShellNavSection & { items: ShellItem[] })[];
  primary: { href: string; label: string; icon: IconType } | null;
}

/** Sidebar sections from every module's nav (features + roles applied), then Settings; plus the primary action. */
export function useShellNav(): ShellNav {
  const app = useWebApp();
  const { t } = useI18n();
  const visible = useVisible();
  const settings = useVisibleSettings(BUILT_IN_SETTINGS);
  return React.useMemo(() => {
    const model = buildNavModel(app, visible, settings.map((p) => ({ href: p.href, label: p.label, icon: p.icon ?? SettingsIcon })));
    return {
      sections: model.sections.map((s) => ({
        id: s.id,
        title: t(s.title),
        items: s.items.map((i) => ({ href: i.href, label: t(i.label), icon: i.icon, exact: i.exact, tab: i.tab, tabLabel: t(i.tabLabel) })),
      })),
      primary: model.primary ? { href: model.primary.href, label: t(model.primary.label), icon: model.primary.icon ?? PlusIcon } : null,
    };
  }, [app, t, visible, settings]);
}

/** Every visible quick action of the app (dashboard shortcuts etc.). */
export function useQuickActions(): (QuickAction & { module: MountedModule; absHref: string })[] {
  const app = useWebApp();
  const visible = useVisible();
  return React.useMemo(
    () =>
      app.modules.flatMap((m) =>
        (m.actions ?? []).filter((a) => visible(a, m)).map((a) => ({ ...a, module: m, absHref: joinPath(m.basePath, a.href) })),
      ),
    [app, visible],
  );
}

/** Signed-in frame: sidebar (desktop), top bar, phone bottom bar with the primary action and a "More" sheet. */
export function AppFrame({ immersive, children }: { immersive?: boolean; children: React.ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname() ?? "/";
  const { sections, primary } = useShellNav();
  const [collapsed, setCollapsed] = React.useState(false);
  React.useEffect(() => setCollapsed(readStored(SIDEBAR_KEY) === "1"), []);

  return (
    <AppShell
      brand={<BrandMark size="lg" nameClassName="text-base" />}
      brandCollapsed={<BrandMark showName={false} />}
      sections={sections}
      currentPath={pathname}
      LinkComponent={NextLink}
      collapsed={collapsed}
      onCollapsedChange={(c) => {
        setCollapsed(c);
        writeStored(SIDEBAR_KEY, c ? "1" : "0");
      }}
      showMobileMenu={false}
      topbarStart={<BrandMark className="md:hidden" />}
      topbarEnd={
        <>
          {primary && (
            <Button asChild size="sm" className="mr-1 hidden rounded-full px-4 md:inline-flex">
              <Link href={primary.href}>
                <primary.icon /> {primary.label}
              </Link>
            </Button>
          )}
          <BranchSwitcher />
          <LocaleSwitcher />
          <ThemeToggle />
          <UserMenu />
        </>
      }
      sidebarFooter={<SidebarFooter />}
      labels={{
        toggleSidebar: t("web.shell.toggleSidebar"),
        openNavigation: t("web.shell.openNavigation"),
        navigation: t("web.shell.navigation"),
        close: t("web.common.close"),
      }}
    >
      <div className="pb-28 md:pb-0 print:pb-0" data-print-root>
        <PageTransition routeKey={pathname}>{children}</PageTransition>
      </div>
      {!immersive && <BottomTabs pathname={pathname} sections={sections} primary={primary} />}
    </AppShell>
  );
}

function SidebarFooter() {
  const { t } = useI18n();
  const { me } = useSession();
  const name = displayName(me.user);
  const role = me.tenantRoles[0];
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-sidebar-accent/60 p-2">
      <Avatar className="size-8">
        <AvatarFallback className="bg-primary text-xs text-primary-foreground">{initials(me.user.name ?? name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-sm font-medium">{name}</p>
        {role && <p className="truncate text-xs text-muted-foreground">{tOr(t, `web.roles.${role}`, role)}</p>}
      </div>
    </div>
  );
}

/** Longest matching href among `hrefs` (so "/billing" doesn't light up for "/billing/invoices"). */
function activeHref(items: AppShellNavItem[], pathname: string): string | null {
  let best: string | null = null;
  for (const item of items) if (isNavItemActive(item, pathname) && (best === null || item.href.length > best.length)) best = item.href;
  return best;
}

/** Phone navigation: up to three "tab" items around the raised primary action, then "More" (every page). */
function BottomTabs({ pathname, sections, primary }: { pathname: string; sections: ShellNav["sections"]; primary: ShellNav["primary"] }) {
  const { t } = useI18n();
  const [more, setMore] = React.useState(false);
  React.useEffect(() => setMore(false), [pathname]);

  const all = sections.flatMap((s) => s.items);
  const current = activeHref(primary ? [...all, { href: primary.href, label: primary.label, exact: true }] : all, pathname);
  const tabItems = all.filter((i) => i.tab).slice(0, 3);
  type Tab = { href: string; label: string; icon: IconType; primary?: boolean };
  const tabs: Tab[] = tabItems.map((i) => ({ href: i.href, label: i.tabLabel, icon: i.icon ?? SettingsIcon }));
  if (primary) tabs.splice(Math.min(2, tabs.length), 0, { href: primary.href, label: primary.label, icon: primary.icon, primary: true });
  const inMore = !tabs.some((tab) => tab.href === current);
  const cols = tabs.length + 1;

  const tabClass = (active: boolean) =>
    cn(
      "relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
      active ? "text-primary" : "text-muted-foreground",
    );

  return (
    <>
      <nav
        aria-label={t("web.shell.navigation")}
        data-print-hide
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-card/90 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-12px_oklch(0_0_0/0.15)] backdrop-blur-md supports-[backdrop-filter]:bg-card/75 md:hidden"
      >
        <ul className="mx-auto grid h-16 max-w-lg" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = tab.href === current;
            return (
              <li key={tab.href} className="flex">
                <Link href={tab.href} aria-current={active ? "page" : undefined} className={tabClass(active)}>
                  {tab.primary ? (
                    <motion.span
                      whileTap={{ scale: 0.9 }}
                      className="-mt-7 flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/35 ring-4 ring-page"
                    >
                      <Icon className="size-7" />
                    </motion.span>
                  ) : (
                    <>
                      {active && <ActiveBar />}
                      <Icon className="size-5" />
                    </>
                  )}
                  <span className="max-w-full truncate px-0.5">{tab.label}</span>
                </Link>
              </li>
            );
          })}
          <li className="flex">
            <button type="button" className={tabClass(inMore)} aria-haspopup="dialog" aria-expanded={more} onClick={() => setMore(true)}>
              {inMore && <ActiveBar />}
              <MenuIcon className="size-5" />
              <span>{t("web.nav.more")}</span>
            </button>
          </li>
        </ul>
      </nav>
      <Sheet open={more} onOpenChange={setMore}>
        <SheetContent side="bottom" className="max-h-[85dvh] gap-0 rounded-t-3xl pb-[calc(1rem+env(safe-area-inset-bottom))]" closeLabel={t("web.common.close")}>
          <SheetHeader className="pb-2">
            <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-muted" aria-hidden />
            <SheetTitle>{t("web.nav.moreTitle")}</SheetTitle>
            <SheetDescription className="sr-only">{t("web.shell.navigation")}</SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 overflow-y-auto px-4">
            {sections.map((s) => (
              <div key={s.id} className="grid gap-2">
                <p className="text-[0.6875rem] font-semibold tracking-wider text-muted-foreground uppercase">{s.title}</p>
                <div className="grid grid-cols-3 gap-2">
                  {s.items.map((item) => {
                    const Icon = item.icon ?? SettingsIcon;
                    const active = item.href === current;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-center text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]",
                          active ? "border-primary/40 bg-primary/10 text-primary" : "bg-card hover:bg-accent",
                        )}
                      >
                        <span className={cn("icon-chip size-10 rounded-xl", active ? "text-primary" : "text-foreground/80")}>
                          <Icon className="size-5" />
                        </span>
                        <span className="line-clamp-2">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function ActiveBar() {
  return (
    <motion.span
      layoutId="sr-bottom-tab"
      className="absolute top-0 h-[3px] w-10 rounded-b-full bg-primary"
      transition={{ type: "spring", stiffness: 500, damping: 40 }}
    />
  );
}

function UserMenu() {
  const { t } = useI18n();
  const app = useWebApp();
  const { me } = useSession();
  const signOut = useSignOut(app.loginPath);
  const settings = useVisibleSettings(BUILT_IN_SETTINGS);
  const name = displayName(me.user);
  const role = me.tenantRoles[0];
  const storage = getTenantStrategy().from === "storage";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label={t("web.user.menu")}>
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary/12 text-xs font-semibold text-primary">{initials(me.user.name ?? name)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
          <span className="truncate text-sm font-medium">{name}</span>
          <span className="truncate text-xs text-muted-foreground">{me.user.email ?? me.user.phone}</span>
          {role && <span className="text-xs text-primary">{tOr(t, `web.roles.${role}`, role)}</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {settings[0] && (
          <DropdownMenuItem asChild className="h-10">
            <Link href={settings[0].href}>
              <SettingsIcon /> {t("web.nav.settings")}
            </Link>
          </DropdownMenuItem>
        )}
        {storage && (
          <DropdownMenuItem className="h-10" onSelect={() => setStoredTenant(null)}>
            <ArrowLeftRightIcon /> {t("web.open.switchShop")}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" className="h-10" onSelect={() => void signOut()}>
          <LogOutIcon /> {t("web.user.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
