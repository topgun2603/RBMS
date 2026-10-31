"use client";

import * as React from "react";
import { InboxIcon } from "lucide-react";
import type { NavSection, RouteDef, WebModule, WidgetDef } from "@rbms/web";
import { ENQUIRIES_FEATURES, ENQUIRIES_PERMISSIONS } from "./lib/access";
import { enquiriesMessages } from "./lib/messages";

/** Module-relative routes (under `basePath`, default "/enquiries"). */
export const ENQUIRIES_ROUTES = {
  list: "",
  newOnes: "?status=new",
  enquiry: (id: string) => id,
} as const;

export interface EnquiriesModuleOptions {
  /** Where the pages live. Default "/enquiries". */
  basePath?: string;
  /** Further restrict features on top of the server (grants like "enquiries"). */
  features?: string[];
  /** Leave out the dashboard widget. Default true. */
  widgets?: boolean;
}

const F = ENQUIRIES_FEATURES;
const P = ENQUIRIES_PERMISSIONS;

const page = (load: () => Promise<{ default: React.ComponentType }>) => React.lazy(load);
const widget = <K extends string>(name: K, load: () => Promise<Record<K, React.ComponentType>>) =>
  React.lazy(() => load().then((m) => ({ default: m[name] })));

/**
 * Website enquiries (admission enquiries for a school, call-back requests for any shop) sent from the store's
 * enquiry form: the list with status tabs, the enquiry page (call, WhatsApp, status, note, erase) and a
 * "Website enquiries" tile on the dashboard. createWebApp({ modules: [siteModule(), enquiriesModule(), ...] }).
 */
export function enquiriesModule(opts: EnquiriesModuleOptions = {}): WebModule {
  const nav: NavSection[] = [
    {
      id: "enquiries",
      title: "enquiries.nav.section",
      feature: F.enquiries,
      items: [{ href: ENQUIRIES_ROUTES.list, label: "enquiries.nav.enquiries", icon: InboxIcon, mobile: "tab", exact: true, feature: F.enquiries, permission: P.manage }],
    },
  ];

  const routes: RouteDef[] = [
    { path: "", component: page(() => import("./pages/enquiries")), feature: F.enquiries, permission: P.manage },
    { path: ":id", component: page(() => import("./pages/enquiry")), feature: F.enquiries, permission: P.manage },
  ];

  const widgets: WidgetDef[] =
    opts.widgets === false
      ? []
      : [{ id: "enquiries-open", zone: "kpi", priority: 18, feature: F.enquiries, permission: P.manage, component: widget("EnquiriesWidget", () => import("./widgets/website-enquiries")) }];

  return {
    id: "enquiries",
    basePath: opts.basePath ?? "/enquiries",
    features: opts.features,
    messages: enquiriesMessages,
    nav,
    routes,
    widgets,
  };
}
