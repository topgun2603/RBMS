"use client";

import * as React from "react";
import { ActivityIcon, FileUpIcon, HistoryIcon, ListChecksIcon, MessageSquareTextIcon, ShieldCheckIcon, SparklesIcon, StoreIcon, UsersRoundIcon, WalletIcon, WandSparklesIcon } from "lucide-react";
import { PLAN_SETTINGS_PATH, SUBSCRIPTIONS_PERMISSION, type SettingsPage, type WebModule, type WidgetDef } from "@srirealtime/web";
import { workspaceMessages } from "./lib/messages";

/** Feature keys the workspace UI uses (declared by @srirealtime/staff, audit, importexport and onboarding). */
export const WORKSPACE_FEATURES = {
  staff: "staff",
  audit: "audit",
  importexport: "importexport",
  onboarding: "onboarding",
  /** AI assistance (@srirealtime/ai). */
  ai: "ai",
} as const;

const F = WORKSPACE_FEATURES;

/** Permission each settings page needs (declared by @srirealtime/staff, audit and importexport). Owners/admins hold all. */
export const WORKSPACE_PERMISSIONS = {
  staff: "staff.manage",
  audit: "audit.view",
  importexport: "importexport.run",
  subscriptions: SUBSCRIPTIONS_PERMISSION,
  ai: "ai.manage",
  /** Counter insights (AI Phase 5 part A): the Manager template holds it; owners and admins hold everything. */
  counter: "reports.manage",
  /** Customers' data requests, retention and the breach register (@srirealtime/consent). */
  privacy: "privacy.manage",
} as const;

/** Settings paths the module claims under the app's /settings. */
export const WORKSPACE_SETTINGS_PATHS = { team: "team", audit: "audit", import: "import", setup: "setup", messages: "messages", ai: "ai", studio: "studio", counter: "counter", privacy: "privacy", shopSetup: "shop-setup", plan: PLAN_SETTINGS_PATH } as const;

export interface WorkspaceModuleOptions {
  /** Where module-relative links resolve. Everything lives under /settings, so the default "/" is right for any app. */
  basePath?: string;
  /** Further restrict features on top of the server (grants like "staff", "audit"). */
  features?: string[];
  /** Leave out the dashboard "Get set up" card (the checklist page stays). Default true. */
  onboardingWidget?: boolean;
  /** Leave out Settings → Plan & billing (e.g. a vendor portal whose users don't pay the platform). Default true. */
  planBilling?: boolean;
}

const page = (load: () => Promise<{ default: React.ComponentType }>) => React.lazy(load);

/**
 * Team & roles, audit log, import/export, the setup checklist and Plan & billing for any app. Mount it after the app's own modules:
 * createWebApp({ modules: [billingModule(), workspaceModule()] }). Pages appear under Settings, gated by permission
 * (staff.manage, audit.view, importexport.run, subscriptions.manage; Gated.permission); the server enforces them too.
 */
export function workspaceModule(opts: WorkspaceModuleOptions = {}): WebModule {
  const P = WORKSPACE_SETTINGS_PATHS;
  const settings: SettingsPage[] = [
    { path: P.setup, label: "workspace.nav.setup", icon: ListChecksIcon, feature: F.onboarding, roles: ["owner", "admin"], component: page(() => import("./pages/setup")) },
    // Shop setup assistant: five questions, then the trade, product groups, look and home page to apply (docs/ai.md, Phase 7 part A). Owner only.
    { path: P.shopSetup, label: "workspace.nav.shopSetup", icon: StoreIcon, feature: F.ai, roles: ["owner"], component: page(() => import("./pages/shop-setup")) },
    { path: P.team, label: "workspace.nav.team", icon: UsersRoundIcon, feature: F.staff, permission: WORKSPACE_PERMISSIONS.staff, component: page(() => import("./pages/team")) },
    { path: P.audit, label: "workspace.nav.audit", icon: HistoryIcon, feature: F.audit, permission: WORKSPACE_PERMISSIONS.audit, permissionExplicit: true, component: page(() => import("./pages/audit")) },
    { path: P.import, label: "workspace.nav.import", icon: FileUpIcon, feature: F.importexport, permission: WORKSPACE_PERMISSIONS.importexport, component: page(() => import("./pages/import")) },
    // Customer messages (WhatsApp / SMS to the shop's customers): owners/admins; the page lists only the events of features that are on.
    { path: P.messages, label: "workspace.nav.messages", icon: MessageSquareTextIcon, roles: ["owner", "admin"], component: page(() => import("./pages/messages")) },
    // AI assistance: the owner's opt-in, helpers, credits and recent uses (docs/ai.md); needs the `ai` feature and `ai.manage`.
    { path: P.ai, label: "workspace.nav.ai", icon: SparklesIcon, feature: F.ai, permission: WORKSPACE_PERMISSIONS.ai, component: page(() => import("./pages/ai")) },
    // Counter insights: unusual-activity alerts, weekly team notes, shift plan (docs/ai.md, Phase 5 part A); owners and managers (`reports.manage`).
    { path: P.counter, label: "workspace.nav.counter", icon: ActivityIcon, feature: F.ai, permission: [WORKSPACE_PERMISSIONS.counter, WORKSPACE_PERMISSIONS.staff], permissionExplicit: true, component: page(() => import("./pages/counter")) },
    // Privacy & data (DPDP, docs/privacy-dpdp.md): the notice, customers' data requests, retention rules, breach register.
    { path: P.privacy, label: "workspace.nav.privacy", icon: ShieldCheckIcon, permission: WORKSPACE_PERMISSIONS.privacy, component: page(() => import("./pages/privacy")) },
    // Studio assistant: ask for a change to how the shop looks or works (docs/ai.md, Phase 4 part A); needs `ai` and `ai.manage`.
    { path: P.studio, label: "workspace.nav.studio", icon: WandSparklesIcon, feature: F.ai, permission: WORKSPACE_PERMISSIONS.ai, component: page(() => import("./pages/studio")) },
  ];
  // Plan & billing (the platform's subscription, not a shop feature): owners/admins via subscriptions.manage.
  if (opts.planBilling !== false) {
    settings.push({ path: P.plan, label: "workspace.nav.plan", icon: WalletIcon, permission: WORKSPACE_PERMISSIONS.subscriptions, component: page(() => import("./pages/plan")) });
  }

  const widgets: WidgetDef[] =
    opts.onboardingWidget === false
      ? []
      : [
          {
            id: "get-set-up",
            zone: "setup",
            feature: F.onboarding,
            roles: ["owner", "admin"],
            component: React.lazy(() => import("./widgets/onboarding").then((m) => ({ default: m.OnboardingWidget }))),
          },
        ];

  return {
    id: "workspace",
    basePath: opts.basePath ?? "/",
    features: opts.features,
    messages: workspaceMessages,
    nav: [],
    routes: [],
    widgets,
    settings,
  };
}
