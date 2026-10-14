"use client";

import * as React from "react";
import { cn } from "@srirealtime/ui";

/** Standard page container. The enter animation is applied once by the dashboard layout. */
export function Page({ children, className, wide }: { children: React.ReactNode; className?: string; wide?: boolean }) {
  return (
    <div className={cn("mx-auto w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8", wide ? "max-w-[96rem]" : "max-w-7xl", className)}>
      {children}
    </div>
  );
}

/** Small "label: value" definition row used in detail cards. */
export function DetailRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right font-medium break-words">{children}</span>
    </div>
  );
}
