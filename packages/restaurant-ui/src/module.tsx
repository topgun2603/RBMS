"use client";

import * as React from "react";
import { ChefHatIcon, LayoutGridIcon, UtensilsIcon } from "lucide-react";
import type { NavSection, QuickAction, RouteDef, SettingsPage, WebModule, WidgetDef } from "@srirealtime/web";
import { FLOOR_ACCESS, KITCHEN_ACCESS, RESTAURANT_FEATURES, RESTAURANT_PERMISSIONS } from "./lib/access";
import { setRestaurantConfig } from "./lib/config";
import { restaurantMessages } from "./lib/messages";

export interface RestaurantModuleOptions {
  /** Where the pages live. Default "/dine". */
  basePath?: string;
  /** Further restrict features on top of the server (grants like "dining", "dining.*"). */
  features?: string[];
  /** App path of a bill (payment is taken there). Default `/billing/invoices/<id>`. */
  invoiceHref?: (id: string) => string;
  /** The shop's online store, `{slug}` = shop subdomain (e.g. "http://{slug}.localhost:3003"); enables table QR links. */
  storeUrl?: string | null;
  /** Leave out the dashboard widget. Default true. */
  widgets?: boolean;
}

const F = RESTAURANT_FEATURES;
const P = RESTAURANT_PERMISSIONS;

const page = (load: () => Promise<{ default: React.ComponentType }>) => React.lazy(load);
const widget = <K extends string>(name: K, load: () => Promise<Record<K, React.ComponentType>>) =>
  React.lazy(() => load().then((m) => ({ default: m[name] })));

/**
 * Restaurant pages: the floor (tables with running orders, takeaway / delivery), the order screen (menu → KOT →
 * bill, split bills, move / merge tables), the full-screen kitchen display, and Settings → Restaurant (areas, tables,
 * QR links, kitchen stations, veg marks, sold-out items). createWebApp({ modules: [restaurantModule(), posModule(),
 * billingModule({ basePath: "/billing" }), …] }).
 */
export function restaurantModule(opts: RestaurantModuleOptions = {}): WebModule {
  setRestaurantConfig({ invoiceHref: opts.invoiceHref, storeUrl: opts.storeUrl });

  const nav: NavSection[] = [
    {
      id: "restaurant",
      title: "restaurant.nav.section",
      feature: F.dining,
      items: [
        { href: "", label: "restaurant.nav.floor", tabLabel: "restaurant.nav.floorTab", icon: LayoutGridIcon, mobile: "tab", exact: true, feature: F.dining, permission: FLOOR_ACCESS },
        { href: "kitchen", label: "restaurant.nav.kitchen", icon: ChefHatIcon, mobile: "more", feature: F.kitchen, permission: KITCHEN_ACCESS },
      ],
    },
  ];

  // Static segments before ":id".
  const routes: RouteDef[] = [
    { path: "", component: page(() => import("./pages/floor")), feature: F.dining, permission: FLOOR_ACCESS },
    { path: "kitchen", component: page(() => import("./pages/kitchen")), feature: F.kitchen, permission: KITCHEN_ACCESS, immersive: true },
    { path: "orders/:id", component: page(() => import("./pages/order")), feature: F.dining, permission: FLOOR_ACCESS },
  ];

  const settings: SettingsPage[] = [
    { path: "restaurant", label: "restaurant.nav.setup", icon: UtensilsIcon, feature: F.dining, permission: P.manage, component: page(() => import("./pages/setup")) },
  ];

  const actions: QuickAction[] = [
    { id: "restaurant-kitchen", label: "restaurant.nav.kitchen", href: "kitchen", icon: ChefHatIcon, feature: F.kitchen, permission: KITCHEN_ACCESS },
  ];

  const widgets: WidgetDef[] =
    opts.widgets === false
      ? []
      : [{ id: "restaurant-tables", zone: "kpi", priority: 5, feature: F.dining, permission: FLOOR_ACCESS, component: widget("TablesWidget", () => import("./widgets/tables")) }];

  return {
    id: "restaurant",
    basePath: opts.basePath ?? "/dine",
    features: opts.features,
    messages: restaurantMessages,
    nav,
    routes,
    actions,
    widgets,
    settings,
  };
}
