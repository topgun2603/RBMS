"use client";

import * as React from "react";
import { cn } from "../lib/utils";

export interface ChipOption<T extends string> {
  value: T;
  label: React.ReactNode;
  /** Optional count/badge after the label. */
  meta?: React.ReactNode;
}

export interface ChipGroupProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: ChipOption<T>[];
  "aria-label": string;
  className?: string;
  size?: "sm" | "md";
}

/** Single-select pill chips (role="radiogroup"); scrolls horizontally on small screens. */
function ChipGroup<T extends string>({ value, onChange, options, className, size = "md", ...props }: ChipGroupProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={props["aria-label"]}
      className={cn("-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]", className)}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border font-medium whitespace-nowrap transition-[color,background-color,border-color,transform] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.97] motion-reduce:active:scale-100",
              size === "sm" ? "h-9 px-3 text-xs" : "h-10 px-3.5 text-sm",
              on
                ? "border-primary bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {o.label}
            {o.meta !== undefined && o.meta !== null && (
              <span className={cn("rounded-full px-1.5 text-[0.6875rem] tabular-nums", on ? "bg-primary-foreground/20" : "bg-muted")}>
                {o.meta}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export { ChipGroup };
