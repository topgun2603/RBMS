"use client";

import * as React from "react";
import { PackagePlusIcon, ScanBarcodeIcon, ShieldCheckIcon, SlidersHorizontalIcon } from "lucide-react";
import type { NavSection, QuickAction, RouteDef, WebModule, WidgetDef } from "@rbms/web";
import { SERIALS_FEATURES, SERIALS_PERMISSIONS, SERIALS_VIEW } from "./lib/access";
import { withConfig, type SerialsConfig } from "./lib/config";
import { serialsMessages } from "./lib/messages";

/** Module-relative routes (under `basePath`, default "/serials"). */
export const SERIALS_ROUTES = {
  units: "",
  receive: "?receive=1",
  warranty: "warranty",
  items: "items",
} as const;

export interface SerialsModuleOptions {
  /** Where the pages live. Default "/serials". */
  basePath?: string;
  /** Further restrict features on top of the server (grants like "serials", "serials.*"). */
  features?: string[];
  /** App-absolute link to a bill. Default `/invoices/${id}`. */
  invoiceHref?: (id: string) => string;
  /** Leave out the dashboard widgets. Default true. */
  widgets?: boolean;
}

const F = SERIALS_FEATURES;
const P = SERIALS_PERMISSIONS;

/**
 * Serial number / IMEI pages: units (receive, defective, written off, back in stock, history), warranty lookup with
 * claims, and item settings (warranty months, two IMEIs), plus dashboard widgets. createWebApp({ modules: [billingModule(),
 * posModule(), serialsModule(), …] }). Every piece is gated by the serials features and permissions.
 */
export function serialsModule(opts: SerialsModuleOptions = {}): WebModule {
  const config: SerialsConfig = { invoiceHref: opts.invoiceHref ?? ((id) => `/invoices/${id}`) };
  const page = (load: () => Promise<{ default: React.ComponentType }>) => withConfig(React.lazy(load), config);
  const widget = <K extends string>(name: K, load: () => Promise<Record<K, React.ComponentType>>) =>
    withConfig(
      React.lazy(() => load().then((m) => ({ default: m[name] as React.ComponentType }))) as React.ComponentType,
      config,
    );

  const nav: NavSection[] = [
    {
      id: "serials",
      title: "serials.nav.section",
      feature: F.serials,
      items: [
        { href: SERIALS_ROUTES.units, label: "serials.nav.units", tabLabel: "serials.nav.unitsTab", icon: ScanBarcodeIcon, mobile: "tab", exact: true, feature: F.serials, permission: SERIALS_VIEW },
        { href: SERIALS_ROUTES.warranty, label: "serials.nav.warranty", icon: ShieldCheckIcon, mobile: "more", feature: F.warranty, permission: SERIALS_VIEW },
        { href: SERIALS_ROUTES.items, label: "serials.nav.items", icon: SlidersHorizontalIcon, mobile: "more", feature: F.serials, permission: SERIALS_VIEW },
      ],
    },
  ];

  const routes: RouteDef[] = [
    { path: "", component: page(() => import("./pages/units")), feature: F.serials, permission: SERIALS_VIEW },
    { path: "warranty", component: page(() => import("./pages/warranty")), feature: F.warranty, permission: SERIALS_VIEW },
    { path: "items", component: page(() => import("./pages/items")), feature: F.serials, permission: SERIALS_VIEW },
  ];

  const actions: QuickAction[] = [
    { id: "serials-receive", label: "serials.receive.title", href: SERIALS_ROUTES.receive, icon: PackagePlusIcon, feature: F.serials, permission: P.manage },
  ];

  const widgets: WidgetDef[] =
    opts.widgets === false
      ? []
      : [
          { id: "serials-stock", zone: "secondary", priority: 35, feature: F.serials, permission: SERIALS_VIEW, component: widget("SerialsStockWidget", () => import("./widgets/summary")) },
          { id: "serials-warranty-ending", zone: "attention", priority: 60, feature: F.warranty, permission: SERIALS_VIEW, component: widget("WarrantyEndingWidget", () => import("./widgets/summary")) },
        ];

  return {
    id: "serials",
    basePath: opts.basePath ?? "/serials",
    features: opts.features,
    messages: serialsMessages,
    nav,
    routes,
    actions,
    widgets,
  };
}
