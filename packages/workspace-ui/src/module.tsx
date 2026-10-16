"use client";

import * as React from "react";
import { FileUpIcon, HistoryIcon, ListChecksIcon, UsersRoundIcon, WalletIcon } from "lucide-react";
import { PLAN_SETTINGS_PATH, SUBSCRIPTIONS_PERMISSION, type SettingsPage, type WebModule, type WidgetDef } from "@srirealtime/web";
import { workspaceMessages } from "./lib/messages";

/** Feature keys the workspace UI uses (declared by @srirealtime/staff, audit, importexport and onboarding). */
export const WORKSPACE_FEATURES = {
  staff: "staff",
  audit: "audit",
  importexport: "importexport",
  onboarding: "onboarding",
} as const;

const F = WORKSPACE_FEATURES;

/** Permission each settings page needs (declared by @srirealtime/staff, audit and importexport). Owners/admins hold all. */
export const WORKSPACE_PERMISSIONS = {
  staff: "staff.manage",
  audit: "audit.view",
  importexport: "importexport.run",
  subscriptions: SUBSCRIPTIONS_PERMISSION,
} as const;

/** Settings paths the module claims under the app's /settings. */
export const WORKSPACE_SETTINGS_PATHS = { team: "team", audit: "audit", import: "import", setup: "setup", plan: PLAN_SETTINGS_PATH } as const;

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
    { path: P.team, label: "workspace.nav.team", icon: UsersRoundIcon, feature: F.staff, permission: WORKSPACE_PERMISSIONS.staff, component: page(() => import("./pages/team")) },
    { path: P.audit, label: "workspace.nav.audit", icon: HistoryIcon, feature: F.audit, permission: WORKSPACE_PERMISSIONS.audit, permissionExplicit: true, component: page(() => import("./pages/audit")) },
    { path: P.import, label: "workspace.nav.import", icon: FileUpIcon, feature: F.importexport, permission: WORKSPACE_PERMISSIONS.importexport, component: page(() => import("./pages/import")) },
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
            size: "lg",
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
