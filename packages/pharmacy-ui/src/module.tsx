"use client";

import * as React from "react";
import { BookLockIcon, BoxesIcon, FileTextIcon, PackagePlusIcon, PillIcon } from "lucide-react";
import type { NavSection, QuickAction, RouteDef, WebModule, WidgetDef } from "@srirealtime/web";
import { PHARMACY_FEATURES, PHARMACY_PERMISSIONS, PHARMACY_VIEW } from "./lib/access";
import { pharmacyMessages } from "./lib/messages";

/** Module-relative routes (under `basePath`, default "/pharmacy"). */
export const PHARMACY_ROUTES = {
  batches: "",
  receive: "?receive=1",
  medicines: "medicines",
  prescriptions: "prescriptions",
  register: "register",
} as const;

export interface PharmacyModuleOptions {
  /** Where the pages live. Default "/pharmacy". */
  basePath?: string;
  /** Further restrict features on top of the server (grants like "medicines", "medicines.*"). */
  features?: string[];
  /** Leave out the dashboard widget. Default true. */
  widgets?: boolean;
}

const F = PHARMACY_FEATURES;
const P = PHARMACY_PERMISSIONS;

const page = (load: () => Promise<{ default: React.ComponentType }>) => React.lazy(load);
const widget = <K extends string>(name: K, load: () => Promise<Record<K, React.ComponentType>>) =>
  React.lazy(() => load().then((m) => ({ default: m[name] })));

/**
 * The pharmacy pages: batches with expiry (receive, count, write off), medicine details, prescriptions and the
 * Schedule H1 register, plus an expiry card on the dashboard. createWebApp({ modules: [billingModule(), posModule(),
 * pharmacyModule(), …] }). Every piece is gated by the medicines features and permissions.
 */
export function pharmacyModule(opts: PharmacyModuleOptions = {}): WebModule {
  const nav: NavSection[] = [
    {
      id: "pharmacy",
      title: "pharmacy.nav.section",
      feature: F.medicines,
      items: [
        { href: PHARMACY_ROUTES.batches, label: "pharmacy.nav.batches", tabLabel: "pharmacy.nav.batchesTab", icon: BoxesIcon, mobile: "tab", exact: true, feature: F.medicines, permission: PHARMACY_VIEW },
        { href: PHARMACY_ROUTES.medicines, label: "pharmacy.nav.medicines", icon: PillIcon, mobile: "more", feature: F.medicines, permission: PHARMACY_VIEW },
        { href: PHARMACY_ROUTES.prescriptions, label: "pharmacy.nav.prescriptions", icon: FileTextIcon, mobile: "more", feature: F.prescriptions, permission: PHARMACY_VIEW },
        { href: PHARMACY_ROUTES.register, label: "pharmacy.nav.register", icon: BookLockIcon, mobile: "more", feature: F.register, permission: PHARMACY_VIEW },
      ],
    },
  ];

  const routes: RouteDef[] = [
    { path: "", component: page(() => import("./pages/batches")), feature: F.medicines, permission: PHARMACY_VIEW },
    { path: "medicines", component: page(() => import("./pages/medicines")), feature: F.medicines, permission: PHARMACY_VIEW },
    { path: "prescriptions", component: page(() => import("./pages/prescriptions")), feature: F.prescriptions, permission: PHARMACY_VIEW },
    { path: "register", component: page(() => import("./pages/register")), feature: F.register, permission: PHARMACY_VIEW },
  ];

  const actions: QuickAction[] = [
    { id: "pharmacy-receive", label: "pharmacy.receive.title", href: PHARMACY_ROUTES.receive, icon: PackagePlusIcon, feature: F.medicines, permission: P.manage },
  ];

  const widgets: WidgetDef[] =
    opts.widgets === false
      ? []
      : [{ id: "pharmacy-expiry", zone: "attention", priority: 20, feature: F.medicines, permission: PHARMACY_VIEW, component: widget("ExpiryWidget", () => import("./widgets/expiry")) }];

  return {
    id: "pharmacy",
    basePath: opts.basePath ?? "/pharmacy",
    features: opts.features,
    messages: pharmacyMessages,
    nav,
    routes,
    actions,
    widgets,
  };
}
