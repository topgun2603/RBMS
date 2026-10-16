import * as React from "react";
import { cn } from "../lib/utils";

/*
 * Card spacing comes from the layout scale in globals.css, so every card on every screen shares it:
 *   padding  `p-card`        16px phone · 20px sm · 24px lg
 *   gap      `gap-card-gap`  16px · 20px lg (header → content → footer)
 * Don't pass px-4/py-5-style overrides for ordinary cards; reserve overrides for list cards (`gap-0 py-1`, rows bring
 * their own padding) and media cards (`py-0 overflow-hidden`).
 */

/** Elevated surface: rounded-2xl, soft layered shadow and a 1px hairline ring (no shadow in print). */
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "flex flex-col gap-card-gap rounded-2xl border border-card-ring bg-card py-card text-card-foreground shadow-elevated print:shadow-none",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-card has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-action]:gap-x-4 [.border-b]:pb-card",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-title" className={cn("font-heading leading-snug font-semibold tracking-tight", className)} {...props} />;
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-description" className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("px-card", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-footer" className={cn("flex items-center px-card [.border-t]:pt-card", className)} {...props} />;
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };
