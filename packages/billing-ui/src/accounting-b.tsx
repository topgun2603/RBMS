"use client";

/**
 * Accounting Part B screens (bank reconciliation, cheques, TDS/TCS, fixed assets, year-end close), added to the billing
 * module's Accounts section: nav items after "Chart of accounts", their routes and their messages. Kept apart from
 * module.tsx so the Part B screens can be switched on, tested and reviewed on their own.
 */
import * as React from "react";
import { ArmchairIcon, CalendarCheck2Icon, LandmarkIcon, PercentIcon } from "lucide-react";
import type { NavSection, RouteDef, WebModule } from "@rbms/web";
import { ACC_VIEW } from "./lib/accounting";
import { ACC_BANK } from "./lib/accounting-b";
import * as partB from "./lib/messages/accounting-b";

const FEATURE = "accounting";
const page = (load: () => Promise<{ default: React.ComponentType }>) => React.lazy(load);

export const PART_B_NAV = [
  { href: "accounting/bank", label: "billing.acctb.nav.bank", icon: LandmarkIcon, feature: FEATURE, permission: ACC_VIEW },
  { href: "accounting/tds", label: "billing.acctb.nav.tds", icon: PercentIcon, feature: FEATURE, permission: ACC_VIEW },
  { href: "accounting/assets", label: "billing.acctb.nav.assets", icon: ArmchairIcon, feature: FEATURE, permission: ACC_VIEW },
  { href: "accounting/year-end", label: "billing.acctb.nav.yearEnd", icon: CalendarCheck2Icon, feature: FEATURE, permission: ACC_VIEW },
];

export const PART_B_ROUTES: RouteDef[] = [
  // Static segments only (no :id), listed before nothing that could swallow them.
  { path: "accounting/bank", component: page(() => import("./pages/acctb-bank")), feature: FEATURE, permission: ACC_VIEW },
  { path: "accounting/bank/import", component: page(() => import("./pages/acctb-bank-import")), feature: FEATURE, permission: ACC_BANK },
  { path: "accounting/bank/reconcile", component: page(() => import("./pages/acctb-bank-reconcile")), feature: FEATURE, permission: ACC_VIEW },
  { path: "accounting/bank/statement", component: page(() => import("./pages/acctb-bank-statement")), feature: FEATURE, permission: ACC_VIEW },
  { path: "accounting/cheques", component: page(() => import("./pages/acctb-cheques")), feature: FEATURE, permission: ACC_VIEW },
  { path: "accounting/tds", component: page(() => import("./pages/acctb-tds")), feature: FEATURE, permission: ACC_VIEW },
  { path: "accounting/tds/settings", component: page(() => import("./pages/acctb-tds-settings")), feature: FEATURE, permission: ACC_VIEW },
  { path: "accounting/assets", component: page(() => import("./pages/acctb-assets")), feature: FEATURE, permission: ACC_VIEW },
  { path: "accounting/year-end", component: page(() => import("./pages/acctb-year-end")), feature: FEATURE, permission: ACC_VIEW },
];

export const partBMessages = { en: partB.en, ta: partB.ta };

/** Adds the Part B nav items to the section holding the accounting pages, the routes and the messages. */
export function withAccountingPartB(m: WebModule): WebModule {
  const nav: NavSection[] = m.nav.map((s) => {
    const at = s.items.findIndex((i) => i.href === "accounting/accounts");
    if (at < 0) return s;
    const items = [...s.items];
    items.splice(at + 1, 0, ...PART_B_NAV);
    return { ...s, items };
  });
  const messages = m.messages ? { en: { ...m.messages.en, ...partB.en }, ta: { ...m.messages.ta, ...partB.ta } } : partBMessages;
  return { ...m, nav, routes: [...(m.routes ?? []), ...PART_B_ROUTES], messages };
}

