"use client";

import { WebAppRouter } from "@srirealtime/web";
import { webApp } from "@/web-app";

/**
 * The module router, mounted once from the root layout. Layouts survive client navigation while the catch-all page is
 * remounted on every path change, so the providers (query cache, features, i18n) and the shell must live here.
 */
export function AppRoot() {
  return <WebAppRouter app={webApp} />;
}
