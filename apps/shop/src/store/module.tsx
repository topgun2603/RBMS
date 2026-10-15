"use client";

import * as React from "react";
import { LayoutDashboardIcon, ShoppingBagIcon } from "lucide-react";
import type { WebModule } from "@srirealtime/web";
import { storeMessages } from "./messages";

/**
 * A tiny local module for the demo store admin: a welcome card on the dashboard and the placeholder Orders page
 * (products live in @srirealtime/commerce-ui; orders will move there too, mounted the same way billing is).
 */
export function storeModule(opts: { basePath?: string } = {}): WebModule {
  return {
    id: "store",
    basePath: opts.basePath ?? "/",
    messages: storeMessages,
    nav: [
      {
        id: "store",
        title: "store.nav.title",
        items: [
          { href: "", label: "store.nav.dashboard", tabLabel: "store.nav.home", icon: LayoutDashboardIcon, mobile: "tab" },
          { href: "orders", label: "store.nav.orders", icon: ShoppingBagIcon },
        ],
      },
    ],
    routes: [
      { path: "orders", component: React.lazy(() => import("./pages").then((m) => ({ default: m.OrdersPage }))) },
    ],
    widgets: [{ id: "welcome", size: "lg", component: React.lazy(() => import("./pages").then((m) => ({ default: m.WelcomeWidget }))) }],
  };
}
