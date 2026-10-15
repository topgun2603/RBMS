import type * as React from "react";
import type { Messages } from "@srirealtime/i18n/client";
import type { FeatureReq } from "../lib/features";
import type { TenantStrategy } from "../lib/tenant";

/** Icon component (lucide-react icons fit). */
export type IconType = React.ComponentType<{ className?: string }>;

/** Anything that may only show for some features / roles. */
export interface Gated {
  /** Feature key(s) this belongs to; all must be on (docs/features.md). */
  feature?: FeatureReq;
  /** Shop roles that may see it (owner/admin/staff). Empty = every member. */
  roles?: readonly string[];
}

export interface NavItem extends Gated {
  /** Relative to the module's basePath ("" = the module's root, "invoices", "invoices?status=overdue"). */
  href: string;
  /** Message key. */
  label: string;
  icon?: IconType;
  /** Phone bottom bar: "tab" puts it in the bar (first three across modules), "more" (default) in the More sheet. */
  mobile?: "tab" | "more";
  /** Shorter label for the phone bottom bar (message key; default `label`). */
  tabLabel?: string;
  /** Only active on an exact path match (default: true for the module root). */
  exact?: boolean;
}

export interface NavSection extends Gated {
  id: string;
  /** Message key. */
  title: string;
  items: NavItem[];
}

export interface RouteDef extends Gated {
  /** Relative pattern: "invoices", "invoices/:id", "" (module root). */
  path: string;
  /** Usually React.lazy(() => import("./pages/x")). Reads params with useRouteParams(). */
  component: React.ComponentType;
  /** The page has its own sticky bottom action bar: the phone tab bar steps aside. */
  immersive?: boolean;
}

export interface WidgetDef extends Gated {
  id: string;
  /** Dashboard grid width: sm = one column, md = two, lg = full row (three columns on desktop). */
  size: "sm" | "md" | "lg";
  /** Two rows tall on desktop (e.g. a long list next to two small cards). */
  rowSpan?: 1 | 2;
  component: React.ComponentType;
}

export interface QuickAction extends Gated {
  id: string;
  /** Message key. */
  label: string;
  /** Relative to the module's basePath. */
  href: string;
  icon?: IconType;
  /** The app's main action: top-bar button on desktop, the raised centre button of the phone bottom bar. First one wins. */
  primary?: boolean;
}

export interface SettingsPage extends Gated {
  /** Under the app's /settings: "" = /settings itself, "payments" = /settings/payments. */
  path: string;
  /** Message key. */
  label: string;
  icon?: IconType;
  component: React.ComponentType;
}

/** A UI module: everything a feature area contributes to an app (docs/web-modules.md). */
export interface WebModule {
  id: string;
  /** Where the host mounted it ("/" or "/billing"). Set by the module factory from its options. */
  basePath?: string;
  /** Further restriction on top of the server's features (grants: "invoices", "invoices.*"). */
  features?: readonly string[];
  messages: { en: Messages; ta: Messages };
  nav: NavSection[];
  routes: RouteDef[];
  /** No login needed: "i/:token", "s/:token". Rendered without the shell. */
  publicRoutes?: RouteDef[];
  widgets?: WidgetDef[];
  actions?: QuickAction[];
  settings?: SettingsPage[];
}

export interface WebAppOptions {
  /** App profile id ("BL", "EC"); informational on the client, the server decides features by the shop's appId. */
  appId: string;
  /** Product name for the title bar and fallbacks ("Billing", "Store"). */
  name?: string;
  tenant: TenantStrategy;
  modules: WebModule[];
  /** "dashboard": "/" renders the widgets of every mounted module. */
  home?: "dashboard";
  /** Shop roles that may sign in to this app (default owner, admin, staff). */
  roles?: readonly string[];
  /** Extra message bundles (app-specific strings). */
  messages?: { en: Messages; ta: Messages };
}

/** A module after createWebApp: basePath normalised ("/" or "/billing", never a trailing slash). */
export interface MountedModule extends WebModule {
  basePath: string;
}

export interface WebApp {
  appId: string;
  name: string;
  tenant: TenantStrategy;
  modules: MountedModule[];
  home: "dashboard" | null;
  roles: readonly string[];
  loginPath: string;
  settingsPath: string;
  bundles: { en: Messages; ta: Messages }[];
  namespaces: string[];
}
