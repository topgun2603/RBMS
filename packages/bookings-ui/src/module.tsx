"use client";

import * as React from "react";
import { CalendarClockIcon, CalendarDaysIcon, CalendarPlusIcon, TrendingDownIcon } from "lucide-react";
import type { NavSection, QuickAction, RouteDef, SettingsPage, WebModule, WidgetDef } from "@rbms/web";
import { BOOKINGS_FEATURES, BOOKINGS_PERMISSIONS, CALENDAR_ACCESS } from "./lib/access";
import { setBookingsConfig } from "./lib/config";
import { bookingsMessages } from "./lib/messages";

/** Module-relative routes (under `basePath`, default "/appointments"). */
export const BOOKINGS_ROUTES = {
  calendar: "",
  list: "?view=list",
  new: "?new=1",
  atRisk: "at-risk",
} as const;

export interface BookingsModuleOptions {
  /** Where the pages live. Default "/appointments". */
  basePath?: string;
  /** Further restrict features on top of the server (grants like "bookings", "bookings.*"). */
  features?: string[];
  /** App path of a bill (payment is taken there). Default `/invoices/<id>`. */
  invoiceHref?: (id: string) => string;
  /** Leave out the dashboard widgets. Default true. */
  widgets?: boolean;
}

const F = BOOKINGS_FEATURES;
const P = BOOKINGS_PERMISSIONS;

const page = (load: () => Promise<{ default: React.ComponentType }>) => React.lazy(load);
const widget = <K extends string>(name: K, load: () => Promise<Record<K, React.ComponentType>>) =>
  React.lazy(() => load().then((m) => ({ default: m[name] })));

/**
 * Appointments (salons, spas, eye tests, personal training, clinics): the day calendar with a column per staff member,
 * the appointment list, booking / rescheduling / status / bill from a side sheet, and Settings → Appointments (services,
 * staff, weekly hours with breaks, time off). createWebApp({ modules: [bookingsModule(), billingModule({ basePath:
 * "/billing" }), …] }).
 */
export function bookingsModule(opts: BookingsModuleOptions = {}): WebModule {
  setBookingsConfig({ invoiceHref: opts.invoiceHref });

  const nav: NavSection[] = [
    {
      id: "bookings",
      title: "bookings.nav.section",
      feature: F.bookings,
      items: [
        { href: BOOKINGS_ROUTES.calendar, label: "bookings.nav.calendar", tabLabel: "bookings.nav.calendarTab", icon: CalendarDaysIcon, mobile: "tab", exact: true, feature: F.bookings, permission: CALENDAR_ACCESS },
        { href: BOOKINGS_ROUTES.atRisk, label: "bookings.nav.atRisk", icon: TrendingDownIcon, feature: F.bookings, permission: P.manage },
      ],
    },
  ];

  const routes: RouteDef[] = [
    { path: "", component: page(() => import("./pages/calendar")), feature: F.bookings, permission: CALENDAR_ACCESS },
    { path: "at-risk", component: page(() => import("./pages/at-risk")), feature: F.bookings, permission: P.manage },
  ];

  const settings: SettingsPage[] = [
    { path: "appointments", label: "bookings.nav.settings", icon: CalendarClockIcon, feature: F.bookings, permission: P.manage, component: page(() => import("./pages/settings")) },
  ];

  const actions: QuickAction[] = [
    { id: "bookings-new", label: "bookings.nav.new", href: BOOKINGS_ROUTES.new, icon: CalendarPlusIcon, feature: F.bookings, permission: P.desk },
  ];

  const widgets: WidgetDef[] =
    opts.widgets === false
      ? []
      : [
          { id: "bookings-today", zone: "kpi", priority: 15, feature: F.bookings, permission: CALENDAR_ACCESS, component: widget("TodayKpiWidget", () => import("./widgets/today")) },
          { id: "bookings-next", zone: "side", priority: 5, feature: F.bookings, permission: CALENDAR_ACCESS, component: widget("NextAppointmentsWidget", () => import("./widgets/today")) },
        ];

  return {
    id: "bookings",
    basePath: opts.basePath ?? "/appointments",
    features: opts.features,
    messages: bookingsMessages,
    nav,
    routes,
    actions,
    widgets,
    settings,
  };
}
