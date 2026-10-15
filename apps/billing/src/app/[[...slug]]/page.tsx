"use client";

import { WebAppRouter } from "@srirealtime/web";
import { webApp } from "@/web-app";

/** Every path (signed-in screens, /login, /settings/*, public /i/:token and /s/:token) goes through the module router. */
export default function Page() {
  return <WebAppRouter app={webApp} />;
}
