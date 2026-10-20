"use client";

import * as React from "react";
import { BarcodeIcon, WeightIcon } from "lucide-react";
import type { NavSection, RouteDef, SettingsPage, WebModule, WidgetDef } from "@srirealtime/web";
import { SCALES_FEATURES, SCALES_PERMISSIONS } from "./lib/access";
import { scalesMessages } from "./lib/messages";

/** Module-relative routes (under `basePath`, default "/weighing"). */
export const SCALES_ROUTES = {
  items: "",
} as const;

export interface ScalesModuleOptions {
  /** Where the pages live. Default "/weighing". */
  basePath?: string;
  /** Further restrict features on top of the server (grants like "scales"). */
  features?: string[];
  /** Leave out the dashboard widget. Default true. */
  widgets?: boolean;
}

const F = SCALES_FEATURES;
const P = SCALES_PERMISSIONS;

const page = (load: () => Promise<{ default: React.ComponentType }>) => React.lazy(load);
const widget = <K extends string>(name: K, load: () => Promise<Record<K, React.ComponentType>>) =>
  React.lazy(() => load().then((m) => ({ default: m[name] })));

/**
 * Selling by weight: the weighed items with their scale PLU and today's prices (edited inline, saved together), the
 * PLU file for the scale software, label previews, and Settings → Weighing scales (barcode format with a live decode).
 * createWebApp({ modules: [billingModule(), posModule(), scalesModule(), …] }). Gated by feature `scales` and
 * permission `scales.manage`.
 */
export function scalesModule(opts: ScalesModuleOptions = {}): WebModule {
  const nav: NavSection[] = [
    {
      id: "scales",
      title: "scales.nav.section",
      feature: F.scales,
      items: [
        { href: SCALES_ROUTES.items, label: "scales.nav.items", tabLabel: "scales.nav.itemsTab", icon: WeightIcon, mobile: "more", exact: true, feature: F.scales, permission: P.manage },
      ],
    },
  ];

  const routes: RouteDef[] = [{ path: "", component: page(() => import("./pages/items")), feature: F.scales, permission: P.manage }];

  const settings: SettingsPage[] = [
    { path: "weighing", label: "scales.nav.settings", icon: BarcodeIcon, feature: F.scales, permission: P.manage, component: page(() => import("./pages/settings")) },
  ];

  const widgets: WidgetDef[] =
    opts.widgets === false
      ? []
      : [{ id: "scales-prices", zone: "attention", priority: 30, feature: F.scales, permission: P.manage, component: widget("PricesWidget", () => import("./widgets/prices")) }];

  return {
    id: "scales",
    basePath: opts.basePath ?? "/weighing",
    features: opts.features,
    messages: scalesMessages,
    nav,
    routes,
    widgets,
    settings,
  };
}
