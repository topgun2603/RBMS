"use client";

import { LayoutDashboardIcon } from "lucide-react";
import type { WebModule } from "@srirealtime/web";
import { storeMessages } from "./messages";

/**
 * A tiny local module for the demo store admin: the Dashboard nav entry. The dashboard itself (greeting, quick actions,
 * KPIs, needs attention...) is built by the kit from the mounted UI modules' widgets and actions.
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
  };
}
