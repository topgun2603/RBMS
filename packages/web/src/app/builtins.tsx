"use client";

import * as React from "react";
import { ToggleRightIcon } from "lucide-react";
import type { SettingsPage } from "./types";

/** Settings pages every app gets from the kit. */
export const BUILT_IN_SETTINGS: SettingsPage[] = [
  {
    path: "features",
    label: "web.features.nav",
    icon: ToggleRightIcon,
    component: React.lazy(() => import("./features-page")),
  },
];
