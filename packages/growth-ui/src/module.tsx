"use client";

import * as React from "react";
import { BadgeCheckIcon, BarChart3Icon, CodeXmlIcon, GiftIcon, NetworkIcon, ReceiptTextIcon } from "lucide-react";
import type { NavSection, RouteDef, SettingsPage, WebModule, WidgetDef } from "@rbms/web";
import { growthMessages } from "./lib/messages";

/** Feature keys the growth UI uses (declared by @rbms/loyalty, kyc, einvoice, branches, developer, reports). */
export const GROWTH_FEATURES = {
  loyalty: "loyalty",
  kyc: "kyc",
  einvoice: "gst-einvoice",
  ewaybill: "gst-ewaybill",
  branches: "multi-branch",
  developer: "developer",
  reports: "reports.advanced",
} as const;

/** Permissions of those modules. Owners and admins hold all of them. */
export const GROWTH_PERMISSIONS = {
  loyalty: "loyalty.manage",
  kyc: "kyc.manage",
  einvoice: "einvoice.manage",
  branches: "branches.manage",
  developer: "developer.manage",
  reportsView: "reports.view",
  reportsManage: "reports.manage",
} as const;

/** Settings paths the module claims under the app's /settings. */
export const GROWTH_SETTINGS_PATHS = { kyc: "kyc", einvoice: "einvoice", branches: "branches", developer: "developer" } as const;

/** Module-relative routes (under `basePath`, default "/grow"). */
export const GROWTH_ROUTES = {
  loyalty: "loyalty",
  member: (id: string) => `loyalty/members/${id}`,
  reports: "reports",
  newReport: (dataset?: string) => (dataset ? `reports/new?dataset=${encodeURIComponent(dataset)}` : "reports/new"),
  report: (id: string) => `reports/${id}`,
} as const;

export interface GrowthModuleOptions {
  /**
   * Where the module's own pages (loyalty, report builder) live. Default "/grow", so it never collides with a
   * module mounted at "/" (billing has its own "reports" page). Settings pages always live under the app's /settings.
   */
  basePath?: string;
  /** Further restrict features on top of the server (grants like "loyalty", "reports.*"). */
  features?: string[];
  /** Leave out the dashboard widgets. Default true. */
  widgets?: boolean;
}

const F = GROWTH_FEATURES;
const P = GROWTH_PERMISSIONS;

const page = (load: () => Promise<{ default: React.ComponentType }>) => React.lazy(load);
const widget = <K extends string>(name: K, load: () => Promise<Record<K, React.ComponentType>>) =>
  React.lazy(() => load().then((m) => ({ default: m[name] })));

/**
 * Loyalty, report builder, KYC, e-invoice settings, branches and developer tools (API keys + webhooks) for any
 * srikit app: createWebApp({ modules: [billingModule(), growthModule(), workspaceModule()] }). A "Grow" nav section
 * (Loyalty, Reports) plus four settings pages, every piece gated by its feature and permission.
 */
export function growthModule(opts: GrowthModuleOptions = {}): WebModule {
  const nav: NavSection[] = [
    {
      id: "grow",
      title: "growth.nav.grow",
      items: [
        { href: GROWTH_ROUTES.loyalty, label: "growth.nav.loyalty", icon: GiftIcon, feature: F.loyalty, permission: P.loyalty, exact: false },
        {
          href: GROWTH_ROUTES.reports,
          label: "growth.nav.reports",
          tabLabel: "growth.nav.reportsTab",
          icon: BarChart3Icon,
          feature: F.reports,
          permission: P.reportsView,
          exact: false,
        },
      ],
    },
  ];

  // Static segments before ":id".
  const routes: RouteDef[] = [
    { path: "loyalty", component: page(() => import("./pages/loyalty")), feature: F.loyalty, permission: P.loyalty },
    { path: "loyalty/members/:id", component: page(() => import("./pages/loyalty-member")), feature: F.loyalty, permission: P.loyalty },
    { path: "reports", component: page(() => import("./pages/reports")), feature: F.reports, permission: P.reportsView },
    { path: "reports/new", component: page(() => import("./pages/report-builder")), feature: F.reports, permission: P.reportsView },
    { path: "reports/:id", component: page(() => import("./pages/report-builder")), feature: F.reports, permission: P.reportsView },
  ];

  const settings: SettingsPage[] = [
    { path: GROWTH_SETTINGS_PATHS.branches, label: "growth.nav.branches", icon: NetworkIcon, feature: F.branches, permission: P.branches, component: page(() => import("./pages/settings-branches")) },
    { path: GROWTH_SETTINGS_PATHS.einvoice, label: "growth.nav.einvoice", icon: ReceiptTextIcon, feature: F.einvoice, permission: P.einvoice, component: page(() => import("./pages/settings-einvoice")) },
    { path: GROWTH_SETTINGS_PATHS.kyc, label: "growth.nav.kyc", icon: BadgeCheckIcon, feature: F.kyc, permission: P.kyc, component: page(() => import("./pages/settings-kyc")) },
    { path: GROWTH_SETTINGS_PATHS.developer, label: "growth.nav.developer", icon: CodeXmlIcon, feature: F.developer, permission: P.developer, component: page(() => import("./pages/settings-developer")) },
  ];

  const widgets: WidgetDef[] =
    opts.widgets === false
      ? []
      : [
          { id: "loyalty-summary", zone: "secondary", priority: 40, feature: F.loyalty, permission: P.loyalty, component: widget("LoyaltyWidget", () => import("./widgets/loyalty")) },
          { id: "report-schedules", zone: "secondary", priority: 50, feature: F.reports, permission: P.reportsManage, component: widget("ScheduledReportsWidget", () => import("./widgets/reports")) },
        ];

  return {
    id: "growth",
    basePath: opts.basePath ?? "/grow",
    features: opts.features,
    messages: growthMessages,
    nav,
    routes,
    widgets,
    settings,
  };
}
