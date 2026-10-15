"use client";

import * as React from "react";
import { motion, useReducedMotionSafe } from "@srirealtime/ui/motion";

let hydrated = false;

/**
 * Route transition for the app's template.tsx: each client navigation fades the new page in with a small lift.
 * The very first (server-rendered) page is never hidden — no opacity:0 in the HTML, so LCP and crawlers are untouched.
 */
export function StorePageTransition({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotionSafe();
  const [animate] = React.useState(() => hydrated && !reduced);
  React.useEffect(() => {
    hydrated = true;
  }, []);
  return (
    <motion.div initial={animate ? { opacity: 0, y: 12 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}>
      {children}
    </motion.div>
  );
}
