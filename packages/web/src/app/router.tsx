"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { LockIcon, LogOutIcon } from "lucide-react";
import { AuthLayout, Button, FadeIn, Skeleton } from "@srirealtime/ui";
import { BrandMark } from "../components/brand-mark";
import { Page } from "../components/page";
import { WebProviders } from "../components/providers";
import { QueryError } from "../components/query-state";
import { Splash } from "../components/splash";
import { displayName, hasShopAccess, roleAllows, useMe, useSignOut } from "../lib/auth";
import { useShop } from "../lib/branding";
import { useFeatures, type FeatureCheck } from "../lib/features";
import { useI18n } from "../lib/i18n";
import { useHydrated, useToken } from "../lib/session";
import { BUILT_IN_SETTINGS } from "./builtins";
import { Dashboard } from "./dashboard";
import { FeatureGatePage, NotFound, RoleGatePage } from "./gate";
import { LoginScreen } from "./login";
import { matchRoute, relativeTo, type RouteMatch } from "./model";
import { ModuleScope, RouteParamsProvider, WebAppContext } from "./navigation";
import { allSettingsPages, SessionProvider, useSession, type MountedSettingsPage } from "./session";
import { AppFrame } from "./shell";
import { ShopGate } from "./shop-gate";
import type { MountedModule, RouteDef, WebApp } from "./types";

/**
 * Renders a WebApp for the current URL. Mount it from one optional catch-all page:
 * `app/[[...slug]]/page.tsx` → `"use client"; export default function Page() { return <WebAppRouter app={webApp} />; }`
 */
export function WebAppRouter({ app }: { app: WebApp }) {
  return (
    <WebAppContext.Provider value={app}>
      <WebProviders bundles={app.bundles} namespaces={app.namespaces}>
        <React.Suspense fallback={<Splash />}>
          <RouterRoot app={app} />
        </React.Suspense>
      </WebProviders>
    </WebAppContext.Provider>
  );
}

const cleanPath = (p: string | null) => {
  const s = (p ?? "/").replace(/\/+$/, "");
  return s === "" ? "/" : s;
};

function RouterRoot({ app }: { app: WebApp }) {
  const hydrated = useHydrated();
  const path = cleanPath(usePathname());
  // Everything depends on localStorage (token, locale, stored shop): render after hydration only.
  if (!hydrated) return <Splash />;

  const pub = matchRoute(app, path, (m) => m.publicRoutes);
  if (pub) return <PublicRoute match={pub} />;

  return (
    <ShopGate appName={app.name}>
      {path === app.loginPath ? <LoginScreen home="/" /> : <SignedIn app={app} path={path} />}
    </ShopGate>
  );
}

function PublicRoute({ match }: { match: RouteMatch }) {
  const features = useFeatures();
  const C = match.route.component;
  // Visitors never see the owner-facing gate: a feature that is off is just "not found" (the API agrees).
  if (features.ready && !features.check(match.route.feature, match.module.features).ok) return <NotFound standalone />;
  return (
    <ModuleScope module={match.module}>
      <RouteParamsProvider value={match.params}>
        <React.Suspense fallback={<Splash />}>
          <C />
        </React.Suspense>
      </RouteParamsProvider>
    </ModuleScope>
  );
}

/** Signed-in area: requires a token and one of the app's roles in this shop. */
function SignedIn({ app, path }: { app: WebApp; path: string }) {
  const router = useRouter();
  const token = useToken();
  const me = useMe();
  const features = useFeatures();

  React.useEffect(() => {
    if (!token) router.replace(app.loginPath);
  }, [token, router, app.loginPath]);

  if (!token || me.isPending || !features.ready) return <Splash />;
  if (me.isError) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <div className="w-full max-w-md">
          <QueryError error={me.error} onRetry={() => void me.refetch()} />
        </div>
      </div>
    );
  }
  if (!hasShopAccess(me.data, app.roles)) return <NoAccess name={displayName(me.data.user)} />;
  return (
    <SessionProvider me={me.data}>
      <Screen app={app} path={path} />
    </SessionProvider>
  );
}

type Resolved =
  | { kind: "dashboard" }
  | { kind: "settings"; page: MountedSettingsPage }
  | { kind: "route"; match: RouteMatch }
  | { kind: "notFound" };

function resolve(app: WebApp, path: string): Resolved {
  if (path === "/" && app.home === "dashboard") return { kind: "dashboard" };
  const rel = relativeTo(app.settingsPath, path);
  if (rel !== null) {
    const pages = allSettingsPages(app, BUILT_IN_SETTINGS);
    const page = pages.find((p) => p.path === rel);
    if (page) return { kind: "settings", page };
    if (rel === "" && pages[0]) return { kind: "settings", page: pages[0] };
  }
  const match = matchRoute(app, path, (m) => m.routes);
  return match ? { kind: "route", match } : { kind: "notFound" };
}

function Screen({ app, path }: { app: WebApp; path: string }) {
  const features = useFeatures();
  const { roles } = useSession();
  const r = resolve(app, path);

  const gate = (g: { feature?: RouteDef["feature"]; roles?: readonly string[] }, module?: MountedModule): React.ReactNode | null => {
    if (!roleAllows(roles, g.roles)) return <RoleGatePage />;
    const check: FeatureCheck = features.check(g.feature, module?.features);
    return check.ok ? null : <FeatureGatePage check={check} />;
  };

  let body: React.ReactNode;
  let immersive = false;
  if (r.kind === "dashboard") body = <Dashboard />;
  else if (r.kind === "notFound") body = <NotFound />;
  else if (r.kind === "settings") {
    const C = r.page.component;
    const content = (
      <React.Suspense fallback={<PageSkeleton />}>
        <C />
      </React.Suspense>
    );
    body = gate(r.page, r.page.module ?? undefined) ?? (r.page.module ? <ModuleScope module={r.page.module}>{content}</ModuleScope> : content);
  } else {
    const { module, route, params } = r.match;
    const C = route.component;
    immersive = !!route.immersive;
    body = gate(route, module) ?? (
      <ModuleScope module={module}>
        <RouteParamsProvider value={params}>
          <React.Suspense fallback={<PageSkeleton />}>
            <C />
          </React.Suspense>
        </RouteParamsProvider>
      </ModuleScope>
    );
  }
  return <AppFrame immersive={immersive}>{body}</AppFrame>;
}

function PageSkeleton() {
  return (
    <Page>
      <div className="mb-5 flex items-center gap-3">
        <Skeleton className="size-10 rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      <Skeleton className="h-72 w-full rounded-2xl" />
    </Page>
  );
}

function NoAccess({ name }: { name: string }) {
  const { t } = useI18n();
  const { shopName } = useShop();
  const signOut = useSignOut();
  return (
    <AuthLayout logo={<BrandMark size="lg" />}>
      <FadeIn className="grid gap-4 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <LockIcon className="size-6" />
        </div>
        <h1 className="font-heading text-xl font-semibold">{t("web.access.title", { shop: shopName })}</h1>
        <p className="text-sm text-muted-foreground">{t("web.access.body", { shop: shopName, name })}</p>
        <Button variant="outline" size="lg" onClick={() => void signOut()}>
          <LogOutIcon /> {t("web.user.signOut")}
        </Button>
      </FadeIn>
    </AuthLayout>
  );
}
