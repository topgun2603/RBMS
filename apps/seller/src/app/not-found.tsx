"use client";

import { WebAppRouter } from "@srirealtime/web";
import { webApp } from "@/web-app";

/** The catch-all route handles every path; anything that still lands here gets the router's own not-found screen. */
export default function NotFound() {
  return <WebAppRouter app={webApp} />;
}
