"use client";

/**
 * Recurring bills (docs/recurring-export-gstin.md), added to the billing module's Sell section after the sales documents:
 * nav item, routes, a quick action and messages. Kept apart from module.tsx like sales-docs.tsx.
 */
import * as React from "react";
import { RepeatIcon } from "lucide-react";
import type { NavSection, RouteDef, WebModule } from "@srirealtime/web";
import * as rc from "./lib/messages/recurring";

export const RECURRING_FEATURE = "invoices.recurring";
export const RECURRING_VIEW = "recurring.view";
export const RECURRING_MANAGE = "recurring.manage";

const F = RECURRING_FEATURE;
const page = (load: () => Promise<{ default: React.ComponentType }>) => React.lazy(load);

export const RECURRING_NAV = { href: "recurring", label: "billing.nav.recurring", icon: RepeatIcon, feature: F, permission: RECURRING_VIEW };

// Static segments ("new") before ":id".
export const RECURRING_ROUTES: RouteDef[] = [
  { path: "recurring", component: page(() => import("./pages/recurring")), feature: F, permission: RECURRING_VIEW },
  { path: "recurring/new", component: page(() => import("./pages/recurring-new")), feature: F, permission: RECURRING_MANAGE, immersive: true },
  { path: "recurring/:id", component: page(() => import("./pages/recurring-detail")), feature: F, permission: RECURRING_VIEW },
  { path: "recurring/:id/edit", component: page(() => import("./pages/recurring-edit")), feature: F, permission: RECURRING_MANAGE, immersive: true },
];

export const recurringMessages = { en: rc.en, ta: rc.ta };

/** Adds the nav item after the delivery challans (else quotations, else bills), the routes, an action and the messages. */
export function withRecurring(m: WebModule): WebModule {
  const nav: NavSection[] = m.nav.map((s) => {
    const find = (href: string) => s.items.findIndex((i) => i.href === href);
    const after = [find("challans"), find("quotations"), find("invoices")].find((i) => i >= 0);
    if (after === undefined) return s;
    const items = [...s.items];
    items.splice(after + 1, 0, RECURRING_NAV);
    return { ...s, items };
  });
  const messages = m.messages ? { en: { ...m.messages.en, ...rc.en }, ta: { ...m.messages.ta, ...rc.ta } } : recurringMessages;
  return {
    ...m,
    nav,
    routes: [...(m.routes ?? []), ...RECURRING_ROUTES],
    actions: [
      ...(m.actions ?? []),
      { id: "new-recurring", label: "billing.nav.newRecurring", href: "recurring/new", icon: RepeatIcon, feature: F, permission: RECURRING_MANAGE },
    ],
    messages,
  };
}
