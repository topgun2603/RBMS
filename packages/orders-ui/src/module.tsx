"use client";

import * as React from "react";
import { PlusIcon, SettingsIcon, ShoppingBagIcon, SparklesIcon, TicketPercentIcon, TruckIcon } from "lucide-react";
import type { NavSection, RouteDef, SettingsPage, WebModule, WidgetDef } from "@rbms/web";
import { PERMS } from "./lib/access";
import { ordersMessages } from "./lib/messages";

/** Feature keys the orders UI uses (declared by @rbms/orders, coupons and delivery; docs/features.md). */
export const ORDERS_FEATURES = {
  orders: "orders",
  returns: "orders.returns",
  coupons: "coupons",
  delivery: "delivery",
  carriers: "delivery.carriers",
} as const;

const F = ORDERS_FEATURES;

export interface OrdersModuleOptions {
  /** Where the host mounts the module: "/" (apps/shop) or e.g. "/sales". Default "/". */
  basePath?: string;
  /** Further restrict features on top of the server (grants like "orders", "coupons", "delivery.*"). */
  features?: string[];
}

const page = (load: () => Promise<{ default: React.ComponentType }>) => React.lazy(load);
const widgets = () => import("./widgets/orders");

/** The store-admin UI module for orders, coupons and delivery. Mount it with createWebApp({ modules: [ordersModule()] }). */
export function ordersModule(opts: OrdersModuleOptions = {}): WebModule {
  const nav: NavSection[] = [
    {
      id: "sales",
      title: "orders.nav.sales",
      feature: F.orders,
      items: [
        { href: "orders", label: "orders.nav.orders", icon: ShoppingBagIcon, feature: F.orders, mobile: "tab", exact: false },
        { href: "coupons", label: "orders.nav.coupons", icon: TicketPercentIcon, feature: F.coupons, exact: false },
        { href: "offers", label: "orders.nav.offers", icon: SparklesIcon, feature: F.coupons, exact: false },
      ],
    },
  ];

  // Static segments before ":id" so "orders/new" isn't read as an order id.
  const routes: RouteDef[] = [
    { path: "orders", component: page(() => import("./pages/orders")), feature: F.orders },
    { path: "orders/new", component: page(() => import("./pages/order-new")), feature: F.orders, immersive: true },
    { path: "orders/:id", component: page(() => import("./pages/order-detail")), feature: F.orders },
    { path: "coupons", component: page(() => import("./pages/coupons")), feature: F.coupons },
    // Creating is a pure write; the list and an existing coupon stay readable (the editor is read-only without coupons.manage).
    { path: "coupons/new", component: page(() => import("./pages/coupon-edit")), feature: F.coupons, permission: PERMS.coupons, immersive: true },
    { path: "coupons/:id", component: page(() => import("./pages/coupon-edit")), feature: F.coupons, immersive: true },
    // Automatic offers (buy X get Y, tiers, free gifts) and combos; "offers/new/bundle" starts a combo.
    { path: "offers", component: page(() => import("./pages/offers")), feature: F.coupons },
    { path: "offers/new", component: page(() => import("./pages/offer-edit")), feature: F.coupons, permission: PERMS.coupons, immersive: true },
    { path: "offers/new/:kind", component: page(() => import("./pages/offer-edit")), feature: F.coupons, permission: PERMS.coupons, immersive: true },
    { path: "offers/:id", component: page(() => import("./pages/offer-edit")), feature: F.coupons, immersive: true },
  ];

  const settings: SettingsPage[] = [
    { path: "delivery", label: "orders.nav.delivery", icon: TruckIcon, feature: F.delivery, permission: PERMS.settings, component: page(() => import("./pages/settings-delivery")) },
    { path: "orders", label: "orders.nav.orderSettings", icon: SettingsIcon, feature: F.orders, component: page(() => import("./pages/settings-orders")) },
  ];

  const widgetDefs: WidgetDef[] = [
    { id: "orders-today", zone: "kpi", priority: 20, feature: F.orders, component: React.lazy(() => widgets().then((m) => ({ default: m.OrdersTodayKpiWidget }))) },
    { id: "orders-needs-action", zone: "attention", priority: 20, feature: F.orders, component: React.lazy(() => widgets().then((m) => ({ default: m.OrdersAttentionWidget }))) },
    { id: "recent-orders", zone: "main", priority: 20, feature: F.orders, component: React.lazy(() => widgets().then((m) => ({ default: m.RecentOrdersWidget }))) },
  ];

  return {
    id: "orders",
    basePath: opts.basePath ?? "/",
    features: opts.features,
    messages: ordersMessages,
    nav,
    routes,
    widgets: widgetDefs,
    actions: [{ id: "new-order", label: "orders.nav.newOrder", href: "orders/new", icon: PlusIcon, feature: F.orders, primary: true }],
    settings,
  };
}
