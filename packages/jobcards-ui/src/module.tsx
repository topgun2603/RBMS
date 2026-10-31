"use client";

import * as React from "react";
import { ClipboardListIcon, ClipboardPlusIcon } from "lucide-react";
import type { NavSection, QuickAction, RouteDef, WebModule, WidgetDef } from "@rbms/web";
import { JOBCARDS_FEATURES, JOBCARDS_PERMISSIONS, JOBCARDS_VIEW } from "./lib/access";
import { setJobcardsConfig } from "./lib/config";
import { jobcardsMessages } from "./lib/messages";

/** Module-relative routes (under `basePath`, default "/jobs"). */
export const JOBCARDS_ROUTES = {
  board: "",
  list: "?view=list",
  newJob: "?new=1",
  job: (id: string) => `jobs/${id}`,
} as const;

export interface JobcardsModuleOptions {
  /** Where the pages live. Default "/jobs". */
  basePath?: string;
  /** Further restrict features on top of the server (grants like "jobcards", "jobcards.*"). */
  features?: string[];
  /** App path of a bill (payment is taken there). Default `/invoices/<id>`. */
  invoiceHref?: (id: string) => string;
  /** The customer's tracking link for a job's token, e.g. `(t) => \`https://shop.example.com/track/${t}\``. Default: none. */
  trackUrl?: (token: string) => string | null;
  /** Leave out the dashboard widget. Default true. */
  widgets?: boolean;
}

const F = JOBCARDS_FEATURES;
const P = JOBCARDS_PERMISSIONS;

const page = (load: () => Promise<{ default: React.ComponentType }>) => React.lazy(load);
const widget = <K extends string>(name: K, load: () => Promise<Record<K, React.ComponentType>>) =>
  React.lazy(() => load().then((m) => ({ default: m[name] })));

/**
 * Job cards for service work (repairs, tailoring, lens orders): the job board by status with a list view, the
 * "New job" dialog with a form per template, and the job page (status stepper, details, parts and labour, totals,
 * timeline, bill, cancel, tracking link, printed job sheet), plus "ready / overdue" rows under Needs attention.
 * createWebApp({ modules: [billingModule(), jobcardsModule({ invoiceHref: (id) => `/invoices/${id}` }), …] }).
 */
export function jobcardsModule(opts: JobcardsModuleOptions = {}): WebModule {
  setJobcardsConfig({ invoiceHref: opts.invoiceHref, trackUrl: opts.trackUrl });

  const nav: NavSection[] = [
    {
      id: "jobcards",
      title: "jobcards.nav.section",
      feature: F.jobcards,
      items: [
        { href: JOBCARDS_ROUTES.board, label: "jobcards.nav.board", tabLabel: "jobcards.nav.boardTab", icon: ClipboardListIcon, mobile: "tab", exact: true, feature: F.jobcards, permission: JOBCARDS_VIEW },
      ],
    },
  ];

  const routes: RouteDef[] = [
    { path: "", component: page(() => import("./pages/board")), feature: F.jobcards, permission: JOBCARDS_VIEW },
    { path: "jobs/:id", component: page(() => import("./pages/job")), feature: F.jobcards, permission: JOBCARDS_VIEW },
  ];

  const actions: QuickAction[] = [
    { id: "jobcards-new", label: "jobcards.new.title", href: JOBCARDS_ROUTES.newJob, icon: ClipboardPlusIcon, feature: F.jobcards, permission: P.manage },
  ];

  const widgets: WidgetDef[] =
    opts.widgets === false
      ? []
      : [{ id: "jobcards-attention", zone: "attention", priority: 30, feature: F.jobcards, permission: JOBCARDS_VIEW, component: widget("JobsAttentionWidget", () => import("./widgets/attention")) }];

  return {
    id: "jobcards",
    basePath: opts.basePath ?? "/jobs",
    features: opts.features,
    messages: jobcardsMessages,
    nav,
    routes,
    actions,
    widgets,
  };
}
