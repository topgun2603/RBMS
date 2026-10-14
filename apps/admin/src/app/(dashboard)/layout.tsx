"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BellIcon,
  Building2Icon,
  CircleUserIcon,
  FileLockIcon,
  FolderOpenIcon,
  GaugeIcon,
  LanguagesIcon,
  LayersIcon,
  LayoutDashboardIcon,
  PaletteIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  UsersIcon,
  UsersRoundIcon,
} from "lucide-react";
import {
  AppShell,
  Badge,
  PageTransition,
  Skeleton,
  type AppShellLinkComponent,
  type AppShellNavSection,
} from "@srirealtime/ui";
import { BrandMark } from "@/components/brand-mark";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { QueryError } from "@/components/query-state";
import { TenantSwitcher } from "@/components/tenant-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import { isSuperAdmin, useMe } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { readStored, SIDEBAR_KEY, useHydrated, useTenantSlug, useToken, writeStored } from "@/lib/session";

const NextLink: AppShellLinkComponent = ({ href, children, ...props }) => (
  <Link href={href} {...props}>
    {children}
  </Link>
);

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const hydrated = useHydrated();
  const token = useToken();
  const tenant = useTenantSlug();
  const me = useMe();
  const superadmin = isSuperAdmin(me.data?.user);
  const isPlatformRoute = pathname.startsWith("/platform");

  const [collapsed, setCollapsed] = React.useState(false);
  React.useEffect(() => setCollapsed(readStored(SIDEBAR_KEY) === "1"), []);

  // Guards: signed in, and a workspace chosen (platform pages work without one).
  React.useEffect(() => {
    if (!hydrated) return;
    if (!token) router.replace("/login");
    else if (!tenant && !isPlatformRoute) router.replace(superadmin ? "/platform/tenants" : "/select-tenant");
  }, [hydrated, token, tenant, isPlatformRoute, superadmin, router]);

  const sections = React.useMemo<AppShellNavSection[]>(() => {
    const s: AppShellNavSection[] = [];
    if (tenant) {
      s.push({
        id: "workspace",
        title: t("admin.nav.workspace"),
        items: [
          { href: "/", label: t("admin.nav.overview"), icon: LayoutDashboardIcon },
          { href: "/members", label: t("admin.nav.members"), icon: UsersIcon },
          { href: "/branding", label: t("admin.nav.branding"), icon: PaletteIcon },
          { href: "/plans", label: t("admin.nav.plans"), icon: GaugeIcon },
          { href: "/settings", label: t("admin.nav.settings"), icon: SlidersHorizontalIcon },
          { href: "/notifications", label: t("admin.nav.notifications"), icon: BellIcon },
          { href: "/files", label: t("admin.nav.files"), icon: FolderOpenIcon },
          { href: "/translations", label: t("admin.nav.translations"), icon: LanguagesIcon },
        ],
      });
    }
    s.push({
      id: "you",
      title: t("admin.nav.you"),
      items: [
        { href: "/account", label: t("admin.nav.account"), icon: CircleUserIcon },
        { href: "/privacy", label: t("admin.nav.privacy"), icon: ShieldCheckIcon },
      ],
    });
    if (superadmin) {
      s.push({
        id: "platform",
        title: t("admin.nav.platform"),
        items: [
          { href: "/platform/tenants", label: t("admin.nav.tenants"), icon: Building2Icon },
          { href: "/platform/users", label: t("admin.nav.users"), icon: UsersRoundIcon },
          { href: "/platform/plans", label: t("admin.nav.platformPlans"), icon: LayersIcon },
          { href: "/platform/privacy-requests", label: t("admin.nav.privacyRequests"), icon: FileLockIcon },
        ],
      });
    }
    return s;
  }, [t, tenant, superadmin]);

  if (hydrated && token && me.isError) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <div className="w-full max-w-md">
          <QueryError error={me.error} onRetry={() => void me.refetch()} />
        </div>
      </div>
    );
  }

  if (!hydrated || !token || (!tenant && !isPlatformRoute) || !me.data) {
    return <ShellSkeleton />;
  }

  return (
    <AppShell
      brand={<BrandMark />}
      brandCollapsed={<BrandMark showName={false} />}
      sections={sections}
      currentPath={pathname}
      LinkComponent={NextLink}
      collapsed={collapsed}
      onCollapsedChange={(c) => {
        setCollapsed(c);
        writeStored(SIDEBAR_KEY, c ? "1" : "0");
      }}
      topbarStart={<TenantSwitcher />}
      topbarEnd={
        <>
          <LocaleSwitcher />
          <ThemeToggle />
          <UserMenu user={me.data.user} />
        </>
      }
      sidebarFooter={
        superadmin ? (
          <Badge variant="secondary" className="w-full justify-center py-1">
            <ShieldCheckIcon /> {t("admin.user.superadmin")}
          </Badge>
        ) : undefined
      }
      labels={{
        toggleSidebar: t("admin.shell.toggleSidebar"),
        openNavigation: t("admin.shell.openNavigation"),
        navigation: t("admin.shell.navigation"),
        close: t("admin.common.close"),
      }}
    >
      <PageTransition routeKey={pathname}>{children}</PageTransition>
    </AppShell>
  );
}

function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh" aria-busy="true">
      <div className="hidden w-64 shrink-0 flex-col gap-2 border-r bg-sidebar p-3 md:flex">
        <Skeleton className="mb-3 h-8 w-32" />
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
      <div className="flex flex-1 flex-col">
        <div className="flex h-14 items-center gap-3 border-b px-4">
          <Skeleton className="h-8 w-40" />
          <div className="ml-auto flex gap-2">
            <Skeleton className="size-8 rounded-full" />
          </div>
        </div>
        <div className="mx-auto w-full max-w-7xl space-y-6 p-6 lg:p-8">
          <Skeleton className="h-8 w-56" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      </div>
    </div>
  );
}
