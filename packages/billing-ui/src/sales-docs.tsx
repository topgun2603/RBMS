"use client";

/**
 * Proforma invoices, sale orders and delivery challans (docs/sales-documents.md), added to the billing module's Sell
 * section after Quotations: nav items, routes, the settings page, the public share page, quick actions and messages. Kept
 * apart from module.tsx (like accounting Part B) so these screens can be switched on, tested and reviewed on their own.
 */
import * as React from "react";
import { ClipboardListIcon, FileBadgeIcon, TruckIcon } from "lucide-react";
import type { NavSection, RouteDef, WebModule } from "@srirealtime/web";
import * as sd from "./lib/messages/sales-docs";

export const SALES_DOCS_FEATURE = "invoices.sales-docs";
export const SALES_DOCS_VIEW = "sales-docs.view";
export const SALES_DOCS_MANAGE = "sales-docs.manage";

const F = SALES_DOCS_FEATURE;
const page = (load: () => Promise<{ default: React.ComponentType }>) => React.lazy(load);

export const SALES_DOCS_NAV = [
  { href: "proformas", label: "billing.nav.proformas", icon: FileBadgeIcon, feature: F, permission: SALES_DOCS_VIEW },
  { href: "sale-orders", label: "billing.nav.saleOrders", icon: ClipboardListIcon, feature: F, permission: SALES_DOCS_VIEW },
  { href: "challans", label: "billing.nav.challans", icon: TruckIcon, feature: F, permission: SALES_DOCS_VIEW },
];

// Static segments ("new") before ":id".
export const SALES_DOCS_ROUTES: RouteDef[] = [
  { path: "proformas", component: page(() => import("./pages/proformas")), feature: F, permission: SALES_DOCS_VIEW },
  { path: "proformas/new", component: page(() => import("./pages/proforma-new")), feature: F, permission: SALES_DOCS_MANAGE, immersive: true },
  { path: "proformas/:id", component: page(() => import("./pages/proforma-detail")), feature: F, permission: SALES_DOCS_VIEW },
  { path: "proformas/:id/edit", component: page(() => import("./pages/proforma-edit")), feature: F, permission: SALES_DOCS_MANAGE, immersive: true },
  { path: "sale-orders", component: page(() => import("./pages/sale-orders")), feature: F, permission: SALES_DOCS_VIEW },
  { path: "sale-orders/new", component: page(() => import("./pages/sale-order-new")), feature: F, permission: SALES_DOCS_MANAGE, immersive: true },
  { path: "sale-orders/:id", component: page(() => import("./pages/sale-order-detail")), feature: F, permission: SALES_DOCS_VIEW },
  { path: "sale-orders/:id/edit", component: page(() => import("./pages/sale-order-edit")), feature: F, permission: SALES_DOCS_MANAGE, immersive: true },
  { path: "challans", component: page(() => import("./pages/challans")), feature: F, permission: SALES_DOCS_VIEW },
  { path: "challans/new", component: page(() => import("./pages/challan-new")), feature: F, permission: SALES_DOCS_MANAGE, immersive: true },
  { path: "challans/:id", component: page(() => import("./pages/challan-detail")), feature: F, permission: SALES_DOCS_VIEW },
];

export const salesDocsMessages = { en: sd.en, ta: sd.ta };

/** Adds the nav items after Quotations (else after Bills), the routes, settings, public page, actions and messages. */
export function withSalesDocs(m: WebModule): WebModule {
  const nav: NavSection[] = m.nav.map((s) => {
    const at = s.items.findIndex((i) => i.href === "quotations");
    const after = at >= 0 ? at : s.items.findIndex((i) => i.href === "invoices");
    if (after < 0) return s;
    const items = [...s.items];
    items.splice(after + 1, 0, ...SALES_DOCS_NAV);
    return { ...s, items };
  });
  const messages = m.messages ? { en: { ...m.messages.en, ...sd.en }, ta: { ...m.messages.ta, ...sd.ta } } : salesDocsMessages;
  return {
    ...m,
    nav,
    routes: [...(m.routes ?? []), ...SALES_DOCS_ROUTES],
    publicRoutes: [...(m.publicRoutes ?? []), { path: "d/:token", component: page(() => import("./pages/public-sales-doc")), feature: F }],
    actions: [
      ...(m.actions ?? []),
      { id: "new-sale-order", label: "billing.nav.newSaleOrder", href: "sale-orders/new", icon: ClipboardListIcon, feature: F, permission: SALES_DOCS_MANAGE },
      { id: "new-challan", label: "billing.nav.newChallan", href: "challans/new", icon: TruckIcon, feature: F, permission: SALES_DOCS_MANAGE },
    ],
    settings: [
      ...(m.settings ?? []),
      { path: "sales-docs", label: "billing.nav.salesDocSettings", icon: FileBadgeIcon, feature: F, component: page(() => import("./pages/settings-sales-docs")) },
    ],
  };
}
