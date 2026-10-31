"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { motion, useReducedMotionSafe } from "@rbms/ui/motion";

let hydrated = false;

/**
 * Route transition around the page in StoreLayout: each client navigation fades the new page in with a small lift.
 * The very first (server-rendered) page is never hidden — no opacity:0 in the HTML, so LCP and crawlers are untouched.
 * Keyed by the path, so it re-mounts per page the way a template.tsx would (a root template.tsx makes Next 15.5 log a
 * "unique key" warning from OuterLayoutRouter on every page in development).
 */
export function StorePageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <PageFade key={pathname}>
      {children}
    </PageFade>
  );
}

function PageFade({ children }: { children: React.ReactNode }) {
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
