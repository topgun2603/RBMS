import * as React from "react";
import { cn } from "../lib/utils";

export interface EmptyStateProps extends Omit<React.ComponentProps<"div">, "title"> {
  icon?: React.ComponentType<{ className?: string }>;
  /** A small inline SVG drawing; shown instead of the icon when given. */
  illustration?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** Compact variant for use inside tables and cards. */
  compact?: boolean;
}

function EmptyState({ icon: Icon, illustration, title, description, action, compact, className, ...props }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact
          ? "gap-2 px-4 py-8"
          : "gap-3 rounded-2xl border border-dashed border-border bg-card/60 px-6 py-12 [background-image:radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklch,var(--primary)_6%,transparent),transparent)]",
        className,
      )}
      {...props}
    >
      {illustration ? (
        <div className={cn("text-primary", compact ? "mb-0" : "mb-1")} aria-hidden>
          {illustration}
        </div>
      ) : (
        Icon && (
          <div className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary ring-8 ring-primary/5">
            <Icon className="size-5" />
          </div>
        )
      )}
      <div className="space-y-1">
        <p className="font-heading text-base font-semibold">{title}</p>
        {description && <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export { EmptyState };
