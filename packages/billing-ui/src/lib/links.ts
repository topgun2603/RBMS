"use client";

import * as React from "react";
import { useModuleHref } from "@srirealtime/web";

/**
 * Absolute URL of one of this module's public pages ("i/<token>", "s/<token>") wherever the host mounted the module
 * (raja.localhost:3001/i/… for apps/billing, anbu.localhost:3002/billing/i/… for apps/shop). Used only when the API
 * doesn't return a `url` of its own.
 */
export function usePublicUrl(): (path: string) => string {
  const href = useModuleHref();
  return React.useCallback((p: string) => `${typeof window === "undefined" ? "" : window.location.origin}${href(p)}`, [href]);
}
