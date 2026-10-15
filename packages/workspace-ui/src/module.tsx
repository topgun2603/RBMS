"use client";

import * as React from "react";
import { FileUpIcon, HistoryIcon, ListChecksIcon, UsersRoundIcon } from "lucide-react";
import type { SettingsPage, WebModule, WidgetDef } from "@srirealtime/web";
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
} as const;

/** Settings paths the module claims under the app's /settings. */
export const WORKSPACE_SETTINGS_PATHS = { team: "team", audit: "audit", import: "import", setup: "setup" } as const;

export interface WorkspaceModuleOptions {
  /** Where module-relative links resolve. Everything lives under /settings, so the default "/" is right for any app. */
  basePath?: string;
  /** Further restrict features on top of the server (grants like "staff", "audit"). */
  features?: string[];
  /** Leave out the dashboard "Get set up" card (the checklist page stays). Default true. */
  onboardingWidget?: boolean;
}

const page = (load: () => Promise<{ default: React.ComponentType }>) => React.lazy(load);

/**
 * Team & roles, audit log, import/export and the setup checklist for any app. Mount it after the app's own modules:
 * createWebApp({ modules: [billingModule(), workspaceModule()] }). Pages appear under Settings, gated by permission
 * (staff.manage, audit.view, importexport.run; Gated.permission); the server enforces them too.
 */
export function workspaceModule(opts: WorkspaceModuleOptions = {}): WebModule {
  const P = WORKSPACE_SETTINGS_PATHS;
  const settings: SettingsPage[] = [
    { path: P.setup, label: "workspace.nav.setup", icon: ListChecksIcon, feature: F.onboarding, roles: ["owner", "admin"], component: page(() => import("./pages/setup")) },
    { path: P.team, label: "workspace.nav.team", icon: UsersRoundIcon, feature: F.staff, permission: WORKSPACE_PERMISSIONS.staff, component: page(() => import("./pages/team")) },
    { path: P.audit, label: "workspace.nav.audit", icon: HistoryIcon, feature: F.audit, permission: WORKSPACE_PERMISSIONS.audit, permissionExplicit: true, component: page(() => import("./pages/audit")) },
    { path: P.import, label: "workspace.nav.import", icon: FileUpIcon, feature: F.importexport, permission: WORKSPACE_PERMISSIONS.importexport, component: page(() => import("./pages/import")) },
  ];

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
