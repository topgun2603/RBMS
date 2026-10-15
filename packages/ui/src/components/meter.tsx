import * as React from "react";
import { cn } from "../lib/utils";

export interface MeterProps extends Omit<React.ComponentProps<"div">, "children"> {
  value: number;
  max: number;
  /** Fraction (0–1) above which the fill switches to the warning colour. Default 0.8. */
  warnAt?: number;
  /** Accessible name, e.g. "Credit used". */
  label: string;
  /** Human text for assistive tech, e.g. "₹8,000 of ₹10,000". */
  valueText?: string;
}

/** Horizontal meter (role="meter"): fill = value / max, warn colour past `warnAt`, danger past 100%. */
function Meter({ value, max, warnAt = 0.8, label, valueText, className, ...props }: MeterProps) {
  const ratio = max > 0 ? value / max : 0;
  const pct = Math.max(0, Math.min(100, ratio * 100));
  const tone = ratio > 1 ? "bg-destructive" : ratio > warnAt ? "bg-warning" : "bg-primary";
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.max(0, Math.min(value, max))}
      aria-valuetext={valueText}
      data-slot="meter"
      className={cn("relative h-2.5 w-full overflow-hidden rounded-full bg-muted ring-1 ring-border ring-inset", className)}
      {...props}
    >
      <div className={cn("h-full rounded-full transition-[width] duration-500 ease-out", tone)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export { Meter };
