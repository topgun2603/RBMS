"use client";

import * as React from "react";
import {
  ArrowLeftRightIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  HomeIcon,
  LogOutIcon,
  PackageIcon,
  ReceiptTextIcon,
  StoreIcon,
  WalletIcon,
} from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  AppShell,
  AuthLayout,
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
  FadeIn,
  motion,
  PageTransition,
  Skeleton,
  type AppShellLinkComponent,
} from "@rbms/ui";
import {
  BrandMark,
  displayName,
  LocaleSwitcher,
  ModuleLink,
  Page,
  QueryError,
  ShopGate,
  Splash,
  ThemeToggle,
  useAppNavigate,
  useCurrentPath,
  useI18n,
  useMe,
  useModule,
  useModuleHref,
  useSignOut,
  useToken,
  useWebApp,
} from "@rbms/web";
import { VendorLogo } from "../components/bits";
import { pickMembership, setStoredVendor, useMemberships, useStoredVendor, useVendor, useVendorSelf, VendorProvider } from "../lib/vendor";
import type { VendorMembership } from "../lib/types";
import { portalPageOf, PORTAL_NAV, relativePath, type PortalPage } from "./pages";

const lazy = (load: () => Promise<{ default: React.ComponentType }>) => React.lazy(load);
const PAGES: Record<PortalPage, React.ComponentType> = {
  dashboard: lazy(() => import("./dashboard")),
  onboarding: lazy(() => import("./onboarding")),
  products: lazy(() => import("./products")),
  "product-new": lazy(() => import("./product-editor")),
  "product-edit": lazy(() => import("./product-editor")),
  orders: lazy(() => import("./orders")),
  payouts: lazy(() => import("./payouts")),
  profile: lazy(() => import("./profile")),
};
const ApplyScreen = lazy(() => import("./apply"));

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: HomeIcon,
  products: PackageIcon,
  orders: ReceiptTextIcon,
  payouts: WalletIcon,
  profile: StoreIcon,
};

/**
 * The seller portal: one component for every portal path (so the frame stays mounted between pages). Resolves the
 * shop, sends signed-out visitors to the kit's OTP login, shows the apply screen to non-sellers, a seller picker to
 * users of several sellers, then the page inside the portal frame.
 */
export default function VendorPortal() {
  const app = useWebApp();
  return (
    <ShopGate appName={app.name}>
      <SignedIn />
    </ShopGate>
  );
}

function SignedIn() {
  const token = useToken();
  const navigate = useAppNavigate();
  const app = useWebApp();
  React.useEffect(() => {
    if (!token) navigate(app.loginPath, { replace: true });
  }, [token, navigate, app.loginPath]);
  if (!token) return <Splash />;
  return <Memberships />;
}

function Memberships() {
  const me = useMe();
  const mine = useMemberships(!!me.data);
  const stored = useStoredVendor();
  if (me.isError || mine.isError) return <FullPageError error={me.error ?? mine.error} retry={() => void (me.refetch(), mine.refetch())} />;
  if (me.isPending || mine.isPending) return <Splash />;
  if (mine.data.length === 0) {
    return (
      <React.Suspense fallback={<Splash />}>
        <ApplyScreen />
      </React.Suspense>
    );
  }
  const pick = pickMembership(mine.data, stored);
  if (!pick) return <VendorPicker memberships={mine.data} />;
  return <Scoped membership={pick} memberships={mine.data} />;
}

function FullPageError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-page p-4">
      <div className="w-full max-w-md">
        <QueryError error={error} onRetry={retry} />
      </div>
    </div>
  );
}

function VendorPicker({ memberships }: { memberships: VendorMembership[] }) {
  const { t } = useI18n();
  return (
    <AuthLayout logo={<BrandMark size="lg" />}>
      <FadeIn className="grid gap-4">
        <div className="text-center">
          <h1 className="font-heading text-xl font-semibold">{t("marketplace.portal.pickTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("marketplace.portal.pickBody")}</p>
        </div>
        <div className="grid gap-2">
          {memberships.map((m, i) => (
            <motion.button
              key={m.vendorId}
              type="button"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setStoredVendor(m.vendorId)}
              className="flex items-center gap-3 rounded-2xl border bg-card p-3 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              <VendorLogo name={m.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{m.name}</span>
                <span className="text-xs text-muted-foreground">{t(`marketplace.role.${m.role}`)}</span>
              </span>
            </motion.button>
          ))}
        </div>
      </FadeIn>
    </AuthLayout>
  );
}

function Scoped({ membership, memberships }: { membership: VendorMembership; memberships: VendorMembership[] }) {
  const self = useVendorSelf(membership.vendorId);
  const value = React.useMemo(
    () => ({ vendorId: membership.vendorId, membership, memberships, self: self.data ?? null, switchTo: setStoredVendor }),
    [membership, memberships, self.data],
  );
  if (self.isError) return <FullPageError error={self.error} retry={() => void self.refetch()} />;
  return (
    <VendorProvider value={value}>
      <Frame loading={self.isPending} />
    </VendorProvider>
  );
}

function Frame({ loading }: { loading: boolean }) {
  const { t } = useI18n();
  const path = useCurrentPath();
  const { basePath } = useModule();
  const href = useModuleHref();
  const { self } = useVendor();
  const rel = relativePath(basePath, path);
  const match = rel === null ? null : portalPageOf(rel);
  // A seller waiting for approval lands on the onboarding checklist.
  const page: PortalPage | null = match ? (match.page === "dashboard" && self?.status === "pending" ? "onboarding" : match.page) : null;
  const C = page ? PAGES[page] : null;

  const sections = [
    {
      id: "seller",
      title: t("marketplace.portal.nav.section"),
      items: PORTAL_NAV.map((n) => ({ href: href(n.href), label: t(n.label), icon: ICONS[n.page], exact: n.href === "" })),
    },
  ];

  return (
    <AppShell
      brand={<BrandMark size="lg" nameClassName="text-base" />}
      brandCollapsed={<BrandMark showName={false} />}
      sections={sections}
      currentPath={path}
      LinkComponent={NavLink}
      showMobileMenu={false}
      topbarStart={<VendorSwitcher />}
      topbarEnd={
        <>
          <LocaleSwitcher />
          <ThemeToggle />
          <UserMenu />
        </>
      }
      labels={{
        toggleSidebar: t("web.shell.toggleSidebar"),
        openNavigation: t("web.shell.openNavigation"),
        navigation: t("web.shell.navigation"),
        close: t("web.common.close"),
      }}
    >
      <div className="pb-24 md:pb-0">
        {self?.status === "suspended" && (
          <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
            <Alert variant="destructive">
              <AlertTitle>{t("marketplace.portal.suspendedTitle")}</AlertTitle>
              <AlertDescription>{t("marketplace.portal.suspendedBody")}</AlertDescription>
            </Alert>
          </div>
        )}
        <PageTransition routeKey={path}>
          {loading ? (
            <PortalSkeleton />
          ) : C ? (
            <React.Suspense fallback={<PortalSkeleton />}>
              <C />
            </React.Suspense>
          ) : (
            <NotFoundPage />
          )}
        </PageTransition>
      </div>
      <BottomTabs path={path} />
    </AppShell>
  );
}

const NavLink: AppShellLinkComponent = ({ href, children, ...props }) => (
  <ModuleLink href={href} {...props}>
    {children}
  </ModuleLink>
);

function PortalSkeleton() {
  return (
    <Page>
      <div className="mb-5 flex items-center gap-3">
        <Skeleton className="size-10 rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
      </div>
      <Skeleton className="mt-4 h-64 w-full rounded-2xl" />
    </Page>
  );
}

function NotFoundPage() {
  const { t } = useI18n();
  return (
    <Page className="flex min-h-[50dvh] flex-col items-center justify-center gap-3 text-center">
      <h1 className="font-heading text-2xl font-semibold">{t("marketplace.portal.notFound")}</h1>
      <Button asChild variant="outline">
        <ModuleLink to="">{t("marketplace.portal.goHome")}</ModuleLink>
      </Button>
    </Page>
  );
}

function VendorSwitcher() {
  const { t } = useI18n();
  const { membership, memberships, self, switchTo } = useVendor();
  const label = (
    <span className="flex min-w-0 items-center gap-2">
      <VendorLogo name={membership.name} url={self?.logoUrl} className="size-7 rounded-lg text-[0.625rem]" />
      <span className="max-w-[10rem] truncate text-sm font-medium sm:max-w-[16rem]">{self?.name ?? membership.name}</span>
    </span>
  );
  if (memberships.length < 2) return <div className="flex items-center">{label}</div>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 px-2" aria-label={t("marketplace.portal.switch")}>
          {label}
          <ChevronsUpDownIcon className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{t("marketplace.portal.switch")}</DropdownMenuLabel>
        {memberships.map((m) => (
          <DropdownMenuItem key={m.vendorId} className="h-10" onSelect={() => switchTo(m.vendorId)}>
            <VendorLogo name={m.name} className="size-6 rounded-md text-[0.5625rem]" />
            <span className="flex-1 truncate">{m.name}</span>
            {m.vendorId === membership.vendorId && <CheckIcon className="text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const { t } = useI18n();
  const app = useWebApp();
  const me = useMe();
  const signOut = useSignOut(app.loginPath);
  const { memberships, membership, switchTo } = useVendor();
  const name = displayName(me.data?.user);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label={t("web.user.menu")}>
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary/12 text-xs font-semibold text-primary">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
          <span className="truncate text-sm font-medium">{name}</span>
          <span className="truncate text-xs text-muted-foreground">{me.data?.user.email ?? me.data?.user.phone}</span>
          <span className="text-xs text-primary">{t(`marketplace.role.${membership.role}`)}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {memberships.length > 1 && (
          <DropdownMenuItem className="h-10" onSelect={() => switchTo(null)}>
            <ArrowLeftRightIcon /> {t("marketplace.portal.switch")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem variant="destructive" className="h-10" onSelect={() => void signOut()}>
          <LogOutIcon /> {t("web.user.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BottomTabs({ path }: { path: string }) {
  const { t } = useI18n();
  const href = useModuleHref();
  const tabs = PORTAL_NAV.map((n) => ({ ...n, abs: href(n.href) }));
  const active = tabs.reduce<string | null>((best, n) => {
    const on = n.href === "" ? path === n.abs : path === n.abs || path.startsWith(`${n.abs}/`);
    return on && (best === null || n.abs.length > best.length) ? n.abs : best;
  }, null);
  return (
    <nav
      aria-label={t("web.shell.navigation")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-card/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md supports-[backdrop-filter]:bg-card/75 md:hidden"
    >
      <ul className="mx-auto grid h-16 max-w-lg grid-cols-5">
        {tabs.map((n) => {
          const Icon = ICONS[n.page]!;
          const on = n.abs === active;
          return (
            <li key={n.page} className="flex">
              <ModuleLink
                href={n.abs}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  on ? "text-primary" : "text-muted-foreground",
                )}
              >
                {on && (
                  <motion.span layoutId="mp-bottom-tab" className="absolute top-0 h-[3px] w-10 rounded-b-full bg-primary" transition={{ type: "spring", stiffness: 500, damping: 40 }} />
                )}
                <Icon className="size-5" />
                <span className="max-w-full truncate px-0.5">{t(n.label)}</span>
              </ModuleLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
