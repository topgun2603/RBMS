"use client";

import * as React from "react";
import { ScanBarcodeIcon } from "lucide-react";
import type { RouteDef, WebModule } from "@srirealtime/web";
import { POS_FEATURES, POS_PERMISSIONS } from "./lib/access";
import { posMessages } from "./lib/messages";

export interface PosModuleOptions {
  /** Where the host mounts the counter. Default "/pos". */
  basePath?: string;
  /** Further restrict features on top of the server (grants like "invoices", "invoices.*"). */
  features?: string[];
}

const page = (load: () => Promise<{ default: React.ComponentType }>) => React.lazy(load);

/**
 * The point-of-sale counter. One immersive route (the module root) that covers the app shell with its own compact
 * top bar. Feature `invoices`, permission `invoices.create`.
 */
export function posModule(opts: PosModuleOptions = {}): WebModule {
  const gate = { feature: POS_FEATURES.invoices, permission: POS_PERMISSIONS.create } as const;
  const routes: RouteDef[] = [{ path: "", component: page(() => import("./pages/pos")), immersive: true, ...gate }];
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
    actions: [{ id: "pos-counter", label: "pos.nav.open", href: "", icon: ScanBarcodeIcon, ...gate }],
  };
}
