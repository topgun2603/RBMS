"use client";

import * as React from "react";
import { ScanLineIcon, TicketIcon, UserPlusIcon, UsersIcon } from "lucide-react";
import type { NavSection, QuickAction, RouteDef, SettingsPage, WebModule, WidgetDef } from "@srirealtime/web";
import { DESK_ACCESS, MEMBERS_VIEW, MEMBERSHIPS_FEATURES, MEMBERSHIPS_PERMISSIONS } from "./lib/access";
import { setMembershipsConfig } from "./lib/config";
import { membershipsMessages } from "./lib/messages";

/** Module-relative routes (under `basePath`, default "/members"). */
export const MEMBERSHIPS_ROUTES = {
  members: "",
  add: "?add=1",
  checkin: "checkin",
  member: (id: string) => `m/${id}`,
} as const;

export interface MembershipsModuleOptions {
  /** Where the pages live. Default "/members". */
  basePath?: string;
  /** Further restrict features on top of the server (grants like "memberships", "memberships.*"). */
  features?: string[];
  /** App path of a bill (payment is taken there). Default `/invoices/<id>`. */
  invoiceHref?: (id: string) => string;
  /** Leave out the dashboard widgets. Default true. */
  widgets?: boolean;
}

const F = MEMBERSHIPS_FEATURES;
const P = MEMBERSHIPS_PERMISSIONS;

const page = (load: () => Promise<{ default: React.ComponentType }>) => React.lazy(load);
const widget = <K extends string>(name: K, load: () => Promise<Record<K, React.ComponentType>>) =>
  React.lazy(() => load().then((m) => ({ default: m[name] })));

/**
 * Memberships and packages a shop sells (gym memberships, PT packs, salon packages): members with their plan and
 * days left, the member page (renew, freeze, cancel, bill, visits), the full-screen front-desk check-in, and Settings →
 * Memberships (plans and check-in rules), plus "expiring this week" and "check-ins today" on the dashboard.
 * createWebApp({ modules: [billingModule(), membershipsModule(), …] }).
 */
export function membershipsModule(opts: MembershipsModuleOptions = {}): WebModule {
  setMembershipsConfig({ invoiceHref: opts.invoiceHref });

  const nav: NavSection[] = [
    {
      id: "memberships",
      title: "memberships.nav.section",
      feature: F.memberships,
      items: [
        { href: MEMBERSHIPS_ROUTES.members, label: "memberships.nav.members", tabLabel: "memberships.nav.membersTab", icon: UsersIcon, mobile: "tab", exact: true, feature: F.memberships, permission: MEMBERS_VIEW },
        { href: MEMBERSHIPS_ROUTES.checkin, label: "memberships.nav.checkin", icon: ScanLineIcon, mobile: "tab", feature: F.checkin, permission: DESK_ACCESS },
      ],
    },
  ];

  // Static segments before ":id".
  const routes: RouteDef[] = [
    { path: "", component: page(() => import("./pages/members")), feature: F.memberships, permission: MEMBERS_VIEW },
    { path: "checkin", component: page(() => import("./pages/checkin")), feature: F.checkin, permission: DESK_ACCESS, immersive: true },
    { path: "m/:id", component: page(() => import("./pages/member")), feature: F.memberships, permission: MEMBERS_VIEW },
  ];

  const settings: SettingsPage[] = [
    { path: "memberships", label: "memberships.nav.settings", icon: TicketIcon, feature: F.memberships, permission: P.manage, component: page(() => import("./pages/settings")) },
  ];

  const actions: QuickAction[] = [
    { id: "memberships-checkin", label: "memberships.nav.checkin", href: MEMBERSHIPS_ROUTES.checkin, icon: ScanLineIcon, feature: F.checkin, permission: DESK_ACCESS },
    { id: "memberships-add", label: "memberships.member.addTitle", href: MEMBERSHIPS_ROUTES.add, icon: UserPlusIcon, feature: F.memberships, permission: P.manage },
  ];

  const widgets: WidgetDef[] =
    opts.widgets === false
      ? []
      : [
          { id: "memberships-expiring", zone: "attention", priority: 30, feature: F.memberships, permission: MEMBERS_VIEW, component: widget("ExpiringWidget", () => import("./widgets/expiring")) },
          { id: "memberships-checkins", zone: "kpi", priority: 15, feature: F.checkin, permission: MEMBERS_VIEW, component: widget("CheckinsTodayWidget", () => import("./widgets/checkins")) },
        ];

  return {
    id: "memberships",
    basePath: opts.basePath ?? "/members",
    features: opts.features,
    messages: membershipsMessages,
    nav,
    routes,
    actions,
    widgets,
    settings,
  };
}
