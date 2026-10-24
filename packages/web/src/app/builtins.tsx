"use client";

import * as React from "react";
import { KeyRoundIcon, ShieldCheckIcon, ToggleRightIcon } from "lucide-react";
import type { SettingsPage } from "./types";

/** Settings pages every app gets from the kit. */
export const BUILT_IN_SETTINGS: SettingsPage[] = [
  {
    path: "features",
    label: "web.features.nav",
    icon: ToggleRightIcon,
    component: React.lazy(() => import("./features-page")),
  },
  // Owners and admins choose how staff and customers sign in (docs/firebase-auth.md, "Sign-in options per shop").
  {
    path: "sign-in",
    label: "web.signin.nav",
    icon: KeyRoundIcon,
    roles: ["owner", "admin"],
    component: React.lazy(() => import("./sign-in-settings-page")),
  },
  // Everyone: their own two-factor sign-in (owners / admins also set the shop-wide requirement there).
  {
    path: "security",
    label: "web.security.nav",
    icon: ShieldCheckIcon,
    component: React.lazy(() => import("./security-page")),
  },
];
