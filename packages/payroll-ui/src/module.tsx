"use client";

import * as React from "react";
import { CalendarCheckIcon, CalendarDaysIcon, CalendarRangeIcon, HandCoinsIcon, KeyRoundIcon, LandmarkIcon, UserRoundIcon, UsersIcon, WalletIcon } from "lucide-react";
import type { NavSection, QuickAction, RouteDef, SettingsPage, WebModule } from "@srirealtime/web";
import { DESK_ACCESS, PAYROLL_FEATURES, PAYROLL_PERMISSIONS } from "./lib/access";
import { payrollMessages } from "./lib/messages";

/** Module-relative routes (under `basePath`, default "/staff"). */
export const PAYROLL_ROUTES = {
  today: "",
  sheet: "sheet",
  leave: "leave",
  people: "people",
  addPerson: "people?add=1",
  runs: "payroll",
  run: (id: string) => `payroll/${id}`,
  advances: "advances",
  dues: "dues",
  me: "me",
  kiosk: "kiosk",
} as const;

export interface PayrollModuleOptions {
  /** Where the pages live. Default "/staff". */
  basePath?: string;
  /** Further restrict features on top of the server (grants like "payroll", "payroll.*"). */
  features?: string[];
}

const F = PAYROLL_FEATURES;
const P = PAYROLL_PERMISSIONS;

const page = (load: () => Promise<{ default: React.ComponentType }>) => React.lazy(load);

/**
 * Staff attendance, leave and payroll (@srirealtime/payroll): the day board with one-tap marks, the month sheet with
 * corrections, leave requests and balances, staff records with salary structures, the monthly payroll with payslips and
 * the bank sheet, advances, statutory dues, "My attendance" for every staff member, the PIN check-in screen, and
 * Settings → Staff and payroll. createWebApp({ modules: [billingModule(), payrollModule(), …] }).
 */
export function payrollModule(opts: PayrollModuleOptions = {}): WebModule {
  const nav: NavSection[] = [
    {
      id: "payroll",
      title: "payroll.nav.section",
      feature: F.payroll,
      items: [
        { href: PAYROLL_ROUTES.today, label: "payroll.nav.attendance", icon: CalendarCheckIcon, exact: true, feature: F.payroll, permission: DESK_ACCESS },
        { href: PAYROLL_ROUTES.sheet, label: "payroll.nav.sheet", icon: CalendarRangeIcon, feature: F.payroll, permission: DESK_ACCESS },
        { href: PAYROLL_ROUTES.leave, label: "payroll.nav.leave", icon: CalendarDaysIcon, feature: F.payroll, permission: DESK_ACCESS },
        { href: PAYROLL_ROUTES.people, label: "payroll.nav.people", icon: UsersIcon, feature: F.payroll, permission: DESK_ACCESS },
        { href: PAYROLL_ROUTES.runs, label: "payroll.nav.payroll", icon: WalletIcon, feature: F.salary, permission: P.manage },
        { href: PAYROLL_ROUTES.advances, label: "payroll.nav.advances", icon: HandCoinsIcon, feature: F.salary, permission: P.manage },
        { href: PAYROLL_ROUTES.dues, label: "payroll.nav.dues", icon: LandmarkIcon, feature: F.salary, permission: P.manage },
        { href: PAYROLL_ROUTES.me, label: "payroll.nav.me", icon: UserRoundIcon, feature: F.payroll },
      ],
    },
  ];

  // Static segments before ":id".
  const routes: RouteDef[] = [
    { path: "", component: page(() => import("./pages/today")), feature: F.payroll, permission: DESK_ACCESS },
    { path: "sheet", component: page(() => import("./pages/sheet")), feature: F.payroll, permission: DESK_ACCESS },
    { path: "leave", component: page(() => import("./pages/leave")), feature: F.payroll, permission: DESK_ACCESS },
    { path: "people", component: page(() => import("./pages/people")), feature: F.payroll, permission: DESK_ACCESS },
    { path: "kiosk", component: page(() => import("./pages/kiosk")), feature: F.payroll, permission: DESK_ACCESS, immersive: true },
    { path: "me", component: page(() => import("./pages/me")), feature: F.payroll },
    { path: "advances", component: page(() => import("./pages/advances")), feature: F.salary, permission: P.manage },
    { path: "dues", component: page(() => import("./pages/dues")), feature: F.salary, permission: P.manage },
    { path: "payroll", component: page(() => import("./pages/runs")), feature: F.salary, permission: P.manage },
    { path: "payroll/:id", component: page(() => import("./pages/run")), feature: F.salary, permission: P.manage },
  ];

  const settings: SettingsPage[] = [
    { path: "payroll", label: "payroll.nav.settings", icon: UsersIcon, feature: F.payroll, permission: P.manage, component: page(() => import("./pages/settings")) },
  ];

  const actions: QuickAction[] = [
    { id: "payroll-kiosk", label: "payroll.nav.kiosk", href: PAYROLL_ROUTES.kiosk, icon: KeyRoundIcon, feature: F.payroll, permission: DESK_ACCESS },
    { id: "payroll-attendance", label: "payroll.nav.markAttendance", href: PAYROLL_ROUTES.today, icon: CalendarCheckIcon, feature: F.payroll, permission: DESK_ACCESS },
  ];

  return {
    id: "payroll",
    basePath: opts.basePath ?? "/staff",
    features: opts.features,
    messages: payrollMessages,
    nav,
    routes,
    actions,
    settings,
  };
}
