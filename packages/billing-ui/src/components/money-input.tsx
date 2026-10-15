"use client";

import * as React from "react";
import { cn, Input } from "@srirealtime/ui";

/** ₹ amount typed in rupees ("1250.50"). The value stays a string; convert with rupeesToPaise. */
export function MoneyInput({ className, onChange, ...props }: Omit<React.ComponentProps<typeof Input>, "type">) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden>
        ₹
      </span>
      <Input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={cn("pl-7 text-right tabular-nums", className)}
        onChange={(e) => {
          // Keep digits and one dot, max 2 decimals.
          const v = e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
          const m = /^(\d*)(\.?\d{0,2})/.exec(v);
          e.target.value = m ? m[1]! + m[2]! : "";
          onChange?.(e);
        }}
        {...props}
      />
    </div>
  );
}
