"use client";

import * as React from "react";
import { LayoutDashboardIcon } from "lucide-react";
import type { WebModule } from "@srirealtime/web";
import { storeMessages } from "./messages";

/**
 * A tiny local module for the demo store admin: the Dashboard nav entry and a welcome card. Everything else comes from
 * the mounted UI modules (orders-ui, commerce-ui, site-ui, billing-ui, workspace-ui).
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
        ],
      },
    ],
    routes: [],
    widgets: [{ id: "welcome", size: "lg", component: React.lazy(() => import("./pages").then((m) => ({ default: m.WelcomeWidget }))) }],
  };
}
