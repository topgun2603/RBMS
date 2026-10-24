"use client";

import * as React from "react";
import { MonitorSmartphoneIcon, ScanBarcodeIcon } from "lucide-react";
import type { RouteDef, SettingsPage, WebModule } from "@srirealtime/web";
import { POS_FEATURES, POS_PERMISSIONS } from "./lib/access";
import { posMessages } from "./lib/messages";

export interface PosModuleOptions {
  /** Where the host mounts the counter. Default "/pos". */
  basePath?: string;
  /** Further restrict features on top of the server (grants like "invoices", "invoices.*"). */
  features?: string[];
}

/** Terminal mode (pairing, PIN lock, the counter or the weighing station on a paired device), module-relative. */
export const POS_TERMINAL_PATH = "terminal";
/** Settings pages the module claims under the app's /settings. */
export const POS_SETTINGS_PATHS = { terminals: "pos-terminals" } as const;

const page = (load: () => Promise<{ default: React.ComponentType }>) => React.lazy(load);

/**
 * The point-of-sale counter. One immersive route (the module root) that covers the app shell with its own compact
 * top bar. Feature `invoices`, permission `invoices.create`.
 */
export function posModule(opts: PosModuleOptions = {}): WebModule {
  const gate = { feature: POS_FEATURES.invoices, permission: POS_PERMISSIONS.create } as const;
  const routes: RouteDef[] = [{ path: "", component: page(() => import("./pages/pos")), immersive: true, ...gate }];
  // A paired device has no staff sign-in: terminal mode is public and gates itself (GET /pos/device features, PIN).
  const publicRoutes: RouteDef[] = [{ path: POS_TERMINAL_PATH, component: page(() => import("./pages/terminal")) }];
  const settings: SettingsPage[] = [
    {
      path: POS_SETTINGS_PATHS.terminals,
      label: "pos.nav.terminals",
      icon: MonitorSmartphoneIcon,
      feature: POS_FEATURES.terminals,
      permission: POS_PERMISSIONS.devices,
      component: page(() => import("./pages/terminals")),
    },
  ];
  return {
    id: "pos",
    basePath: opts.basePath ?? "/pos",
    features: opts.features,
    messages: posMessages,
    nav: [
      {
        id: "pos",
        title: "pos.nav.section",
        ...gate,
        items: [{ href: "", label: "pos.nav.counter", tabLabel: "pos.nav.counterShort", icon: ScanBarcodeIcon, mobile: "more", exact: true, ...gate }],
      },
    ],
    routes,
    publicRoutes,
    settings,
    actions: [{ id: "pos-counter", label: "pos.nav.open", href: "", icon: ScanBarcodeIcon, ...gate }],
  };
}
