import * as React from "react";
import { cn } from "../lib/utils";
import { Skeleton } from "./skeleton";

export interface StatCardProps extends Omit<React.ComponentProps<"div">, "title"> {
  title: React.ReactNode;
  value: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  /** e.g. "+12%" — tone controls its colour. */
  trend?: React.ReactNode;
  trendTone?: "up" | "down" | "neutral";
  loading?: boolean;
  /** Extra content under the value (progress bar, sparkline...). */
  footer?: React.ReactNode;
}

function StatCard({
  title,
  value,
  description,
  icon: Icon,
  trend,
  trendTone = "neutral",
  loading,
  footer,
  className,
  ...props
}: StatCardProps) {
  return (
    <div
      data-slot="stat-card"
      className={cn("flex flex-col gap-3 rounded-xl border bg-card p-5 text-card-foreground shadow-xs", className)}
      {...props}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        {Icon && (
          <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="size-4" />
          </div>
        )}
      </div>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-3.5 w-32" />
        </div>
      ) : (
        <div className="space-y-1">
          <div className="flex items-baseline gap-2">
            <span className="font-heading text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
            {trend && (
              <span
                className={cn(
                  "text-xs font-medium",
                  trendTone === "up" && "text-success",
                  trendTone === "down" && "text-destructive",
                  trendTone === "neutral" && "text-muted-foreground",
                )}
              >
                {trend}
              </span>
            )}
          </div>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
      )}
      {footer && !loading && <div>{footer}</div>}
    </div>
  );
}

export { StatCard };
