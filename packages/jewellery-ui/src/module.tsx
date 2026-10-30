"use client";

import * as React from "react";
import { CoinsIcon, GemIcon, PlusIcon, RecycleIcon } from "lucide-react";
import type { NavSection, QuickAction, RouteDef, SettingsPage, WebModule, WidgetDef } from "@rbms/web";
import { JEWELLERY_FEATURES, JEWELLERY_PERMISSIONS, JEWELLERY_VIEW } from "./lib/access";
import { setJewelleryConfig } from "./lib/config";
import { jewelleryMessages } from "./lib/messages";

/** Module-relative routes (under `basePath`, default "/jewellery"). */
export const JEWELLERY_ROUTES = {
  rates: "",
  pieces: "pieces",
  addPiece: "pieces?add=1",
  exchanges: "exchange",
  newExchange: "exchange?new=1",
  exchange: (id: string) => `exchange/${id}`,
} as const;

export interface JewelleryModuleOptions {
  /** Where the pages live. Default "/jewellery". */
  basePath?: string;
  /** Further restrict features on top of the server (grants like "jewellery", "jewellery.*"). */
  features?: string[];
  /** App path of a bill (an applied exchange links there). Default `/invoices/<id>`. */
  invoiceHref?: (id: string) => string;
  /** Leave out the dashboard widgets. Default true. */
  widgets?: boolean;
}

const F = JEWELLERY_FEATURES;
const P = JEWELLERY_PERMISSIONS;

const page = (load: () => Promise<{ default: React.ComponentType }>) => React.lazy(load);
const widget = <K extends string>(name: K, load: () => Promise<Record<K, React.ComponentType>>) =>
  React.lazy(() => load().then((m) => ({ default: m[name] })));

/**
 * Jewellery shop pages: today's metal rates (save & reprice every piece), pieces with weight, purity, making, wastage,
 * stones and HUID (live price breakdown), old-gold exchange applied to bills, Settings → Jewellery, and the 22K / 24K
 * gold rate tiles on the dashboard. createWebApp({ modules: [billingModule(), posModule(), jewelleryModule(), …] }).
 */
export function jewelleryModule(opts: JewelleryModuleOptions = {}): WebModule {
  setJewelleryConfig({ invoiceHref: opts.invoiceHref });

  const nav: NavSection[] = [
    {
      id: "jewellery",
      title: "jewellery.nav.section",
      feature: F.jewellery,
      items: [
        { href: JEWELLERY_ROUTES.rates, label: "jewellery.nav.rates", tabLabel: "jewellery.nav.ratesTab", icon: CoinsIcon, mobile: "tab", exact: true, feature: F.jewellery, permission: JEWELLERY_VIEW },
        { href: JEWELLERY_ROUTES.pieces, label: "jewellery.nav.pieces", icon: GemIcon, mobile: "more", feature: F.jewellery, permission: JEWELLERY_VIEW },
        { href: JEWELLERY_ROUTES.exchanges, label: "jewellery.nav.exchange", icon: RecycleIcon, mobile: "more", feature: F.exchange, permission: P.exchange },
      ],
    },
  ];

  // Static segments before ":id".
  const routes: RouteDef[] = [
    { path: "", component: page(() => import("./pages/rates")), feature: F.jewellery, permission: JEWELLERY_VIEW },
    { path: "pieces", component: page(() => import("./pages/pieces")), feature: F.jewellery, permission: JEWELLERY_VIEW },
    { path: "exchange", component: page(() => import("./pages/exchanges")), feature: F.exchange, permission: P.exchange },
    { path: "exchange/:id", component: page(() => import("./pages/exchange")), feature: F.exchange, permission: P.exchange },
  ];

  const settings: SettingsPage[] = [
    { path: "jewellery", label: "jewellery.nav.settings", icon: GemIcon, feature: F.jewellery, permission: JEWELLERY_VIEW, component: page(() => import("./pages/settings")) },
  ];

  const actions: QuickAction[] = [
    { id: "jewellery-rates", label: "jewellery.actions.rates", href: JEWELLERY_ROUTES.rates, icon: CoinsIcon, feature: F.jewellery, permission: P.rates },
    { id: "jewellery-add-piece", label: "jewellery.piece.addTitle", href: JEWELLERY_ROUTES.addPiece, icon: PlusIcon, feature: F.jewellery, permission: P.manage },
    { id: "jewellery-exchange", label: "jewellery.exchange.newTitle", href: JEWELLERY_ROUTES.newExchange, icon: RecycleIcon, feature: F.exchange, permission: P.exchange },
  ];

  const widgets: WidgetDef[] =
    opts.widgets === false
      ? []
      : [
          { id: "jewellery-gold-22", zone: "kpi", priority: 5, feature: F.jewellery, permission: JEWELLERY_VIEW, component: widget("Gold22Widget", () => import("./widgets/rates")) },
          { id: "jewellery-gold-24", zone: "kpi", priority: 6, feature: F.jewellery, permission: JEWELLERY_VIEW, component: widget("Gold24Widget", () => import("./widgets/rates")) },
          { id: "jewellery-rates-missing", zone: "attention", priority: 5, feature: F.jewellery, permission: P.rates, component: widget("RatesMissingWidget", () => import("./widgets/rates")) },
        ];

  return {
    id: "jewellery",
    basePath: opts.basePath ?? "/jewellery",
    features: opts.features,
    messages: jewelleryMessages,
    nav,
    routes,
    actions,
    widgets,
    settings,
  };
}
