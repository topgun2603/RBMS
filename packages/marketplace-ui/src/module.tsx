"use client";

import * as React from "react";
import { SettingsIcon, StoreIcon, WalletIcon } from "lucide-react";
import type { NavSection, RouteDef, SettingsPage, WebModule, WidgetDef } from "@srirealtime/web";
import { marketplaceMessages } from "./lib/messages";

/** Feature keys and permission the marketplace UI uses (declared by @srirealtime/marketplace and kyc). */
export const MARKETPLACE_FEATURES = {
  marketplace: "marketplace",
  payouts: "marketplace.payouts",
  kyc: "kyc",
} as const;
export const MARKETPLACE_MANAGE = "marketplace.manage";

const F = MARKETPLACE_FEATURES;

export interface MarketplaceModuleOptions {
  /**
   * "admin" (default): staff screens for the shop (sellers, payouts, settings), gated by `marketplace.manage`.
   * "vendor": the seller portal for signed-in seller users (apps/seller).
   */
  portal?: "admin" | "vendor";
  /** Where the host mounts it. Default "/marketplace" for admin, "/" for the vendor portal. */
  basePath?: string;
  /** Further restrict features on top of the server. */
  features?: string[];
}

/**
 * Seller portal pages, relative to the module base. Static segments before ":id". Every vendor route renders the
 * same `VendorPortal` component, which keeps its frame mounted and picks the page itself (see portal/root.tsx).
 */
export const VENDOR_PAGES = ["", "onboarding", "products", "products/new", "products/:id", "orders", "payouts", "profile"] as const;

const page = (load: () => Promise<{ default: React.ComponentType }>) => React.lazy(load);
const adminWidgets = () => import("./widgets/admin");
const VendorPortal = page(() => import("./portal/root"));

const ADMIN: { feature: string; permission: string } = { feature: F.marketplace, permission: MARKETPLACE_MANAGE };

export function marketplaceModule(opts: MarketplaceModuleOptions = {}): WebModule {
  if (opts.portal === "vendor") return vendorModule(opts);

  const nav: NavSection[] = [
    {
      id: "marketplace",
      title: "marketplace.nav.section",
      ...ADMIN,
      items: [
        { href: "vendors", label: "marketplace.nav.vendors", icon: StoreIcon, exact: false, ...ADMIN },
        { href: "payouts", label: "marketplace.nav.payouts", icon: WalletIcon, ...ADMIN, feature: [F.marketplace, F.payouts] },
        { href: "settings", label: "marketplace.nav.settings", icon: SettingsIcon, ...ADMIN, roles: ["owner", "admin"] },
      ],
    },
  ];

  const settingsPage = page(() => import("./admin/settings"));
  const vendorsPage = page(() => import("./admin/vendors"));
  const routes: RouteDef[] = [
    { path: "", component: vendorsPage, ...ADMIN },
    { path: "vendors", component: vendorsPage, ...ADMIN },
    { path: "vendors/:id", component: page(() => import("./admin/vendor-detail")), ...ADMIN },
    { path: "payouts", component: page(() => import("./admin/payouts")), ...ADMIN, feature: [F.marketplace, F.payouts] },
    { path: "settings", component: settingsPage, ...ADMIN, roles: ["owner", "admin"] },
  ];

  const settings: SettingsPage[] = [
    { path: "marketplace", label: "marketplace.nav.settings", icon: StoreIcon, component: settingsPage, ...ADMIN, roles: ["owner", "admin"] },
  ];

  const widgets: WidgetDef[] = [
    {
      id: "marketplace-applications",
      size: "sm",
      ...ADMIN,
      component: React.lazy(() => adminWidgets().then((m) => ({ default: m.ApplicationsWidget }))),
    },
    {
      id: "marketplace-payable",
      size: "sm",
      ...ADMIN,
      feature: [F.marketplace, F.payouts],
      component: React.lazy(() => adminWidgets().then((m) => ({ default: m.PayableWidget }))),
    },
  ];

  return {
    id: "marketplace",
    basePath: opts.basePath ?? "/marketplace",
    features: opts.features,
    messages: marketplaceMessages,
    nav,
    routes,
    settings,
    widgets,
  };
}

/**
 * The seller portal. Seller users usually hold no shop role, so the kit's staff shell would turn them away: the
 * portal's pages are `publicRoutes` (no shop role needed) and the portal brings its own frame, which sends signed-out
 * visitors to the kit's /login (OTP) and shows the apply screen to signed-in users who aren't sellers yet.
 */
function vendorModule(opts: MarketplaceModuleOptions): WebModule {
  const publicRoutes: RouteDef[] = VENDOR_PAGES.map((path) => ({ path, component: VendorPortal, feature: F.marketplace }));
  return {
    id: "marketplace",
    basePath: opts.basePath ?? "/",
    features: opts.features,
    messages: marketplaceMessages,
    nav: [],
    routes: [],
    publicRoutes,
  };
}
