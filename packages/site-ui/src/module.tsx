"use client";

import * as React from "react";
import { BadgeCheckIcon, BarChart3Icon, FileTextIcon, GlobeIcon, HomeIcon, MenuIcon, NewspaperIcon, PaletteIcon, StarIcon, StoreIcon } from "lucide-react";
import type { NavSection, RouteDef, SettingsPage, WebModule, WidgetDef } from "@srirealtime/web";
import { PERMS } from "./lib/access";
import { siteMessages } from "./lib/messages";

/** Feature keys the site UI uses (declared by @srirealtime/cms, reviews, analytics, storefront and tenancy). */
export const SITE_FEATURES = {
  cms: "cms",
  blog: "cms.blog",
  reviews: "reviews",
  analytics: "analytics",
  storefront: "storefront",
  customDomain: "custom-domain",
} as const;

const F = SITE_FEATURES;

export interface SiteModuleOptions {
  /** Where the host mounts the module. Default "/" (apps/shop). */
  basePath?: string;
  /** Further restrict features on top of the server (grants like "cms", "cms.*"). */
  features?: string[];
}

const page = (load: () => Promise<{ default: React.ComponentType }>) => React.lazy(load);
const widgets = () => import("./widgets/site");

/** Routes the module serves (relative). Static segments before ":id". */
export const SITE_PATHS = {
  home: "home-page",
  pages: "pages",
  blog: "blog",
  menus: "menus",
  reviews: "reviews",
  analytics: "analytics",
} as const;

/**
 * The online store's website: home page editor, pages, blog, menus, reviews, store analytics, plus the Store
 * settings and Domain settings pages and three dashboard widgets. Mount with createWebApp({ modules: [siteModule()] }).
 */
export function siteModule(opts: SiteModuleOptions = {}): WebModule {
  const nav: NavSection[] = [
    {
      id: "site",
      title: "site.nav.section",
      items: [
        { href: SITE_PATHS.home, label: "site.nav.home", icon: HomeIcon, feature: F.cms, permission: PERMS.cms },
        { href: SITE_PATHS.pages, label: "site.nav.pages", icon: FileTextIcon, feature: F.cms, permission: PERMS.cms, exact: false },
        { href: SITE_PATHS.blog, label: "site.nav.blog", icon: NewspaperIcon, feature: F.blog, permission: PERMS.cms, exact: false },
        { href: SITE_PATHS.menus, label: "site.nav.menus", icon: MenuIcon, feature: F.cms, permission: PERMS.cms },
        { href: SITE_PATHS.reviews, label: "site.nav.reviews", icon: StarIcon, feature: F.reviews, permission: PERMS.reviews },
        { href: SITE_PATHS.analytics, label: "site.nav.analytics", tabLabel: "site.nav.analyticsShort", icon: BarChart3Icon, feature: F.analytics, permission: PERMS.reports },
      ],
    },
  ];

  const routes: RouteDef[] = [
    { path: SITE_PATHS.home, component: page(() => import("./pages/home")), feature: F.cms, permission: PERMS.cms, immersive: true },
    { path: "pages", component: page(() => import("./pages/pages")), feature: F.cms, permission: PERMS.cms },
    { path: "pages/new", component: page(() => import("./pages/page-new")), feature: F.cms, permission: PERMS.cms, immersive: true },
    { path: "pages/:id", component: page(() => import("./pages/page-edit")), feature: F.cms, permission: PERMS.cms, immersive: true },
    { path: "blog", component: page(() => import("./pages/posts")), feature: F.blog, permission: PERMS.cms },
    { path: "blog/new", component: page(() => import("./pages/post-new")), feature: F.blog, permission: PERMS.cms, immersive: true },
    { path: "blog/:id", component: page(() => import("./pages/post-edit")), feature: F.blog, permission: PERMS.cms, immersive: true },
    { path: "menus", component: page(() => import("./pages/menus")), feature: F.cms, permission: PERMS.cms, immersive: true },
    { path: "reviews", component: page(() => import("./pages/reviews")), feature: F.reviews, permission: PERMS.reviews },
    { path: "analytics", component: page(() => import("./pages/analytics")), feature: F.analytics, permission: PERMS.reports },
  ];

  const settings: SettingsPage[] = [
    { path: "store", label: "site.nav.storeSettings", icon: StoreIcon, feature: F.storefront, component: page(() => import("./pages/settings-store")) },
    // Branding: the shop's identity (store, bills, emails, this app); Appearance is the store's layout.
    { path: "branding", label: "site.nav.branding", icon: BadgeCheckIcon, feature: F.storefront, roles: ["owner", "admin"], component: page(() => import("./pages/settings-branding")) },
    {
      path: "appearance",
      label: "site.nav.appearance",
      icon: PaletteIcon,
      feature: F.storefront,
      roles: ["owner", "admin"],
      component: page(() => import("./pages/settings-appearance")),
    },
    { path: "domain", label: "site.nav.domain", icon: GlobeIcon, feature: F.customDomain, roles: ["owner", "admin"], component: page(() => import("./pages/settings-domain")) },
  ];

  const widgetDefs: WidgetDef[] = [
    { id: "site-store", zone: "secondary", priority: 10, feature: F.cms, component: React.lazy(() => widgets().then((m) => ({ default: m.StoreWidget }))) },
    { id: "site-visitors", zone: "kpi", priority: 30, feature: F.analytics, permission: PERMS.reports, component: React.lazy(() => widgets().then((m) => ({ default: m.VisitorsKpiWidget }))) },
    { id: "site-reviews", zone: "attention", priority: 40, feature: F.reviews, permission: PERMS.reviews, component: React.lazy(() => widgets().then((m) => ({ default: m.ReviewsAttentionWidget }))) },
  ];

  return {
    id: "site",
    basePath: opts.basePath ?? "/",
    features: opts.features,
    messages: siteMessages,
    nav,
    routes,
    widgets: widgetDefs,
    settings,
  };
}
