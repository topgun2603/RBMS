"use client";

import { WebAppRouter } from "@srirealtime/web";
import { webApp } from "@/web-app";

/** Every path (the seller portal pages and /login) goes through the module router. */
export default function Page() {
  return <WebAppRouter app={webApp} />;
}
