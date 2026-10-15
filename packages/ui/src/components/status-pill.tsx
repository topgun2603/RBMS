import * as React from "react";
import { cn } from "../lib/utils";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral" | "brand";

const TONES: Record<StatusTone, string> = {
  success: "bg-success/14 text-success-ink ring-success/25",
  warning: "bg-warning/18 text-warning-ink ring-warning/30",
  danger: "bg-destructive/12 text-danger-ink ring-destructive/25",
  info: "bg-info/14 text-info-ink ring-info/25",
  neutral: "bg-muted text-muted-foreground ring-border",
  brand: "bg-primary/12 text-primary ring-primary/20",
};

export interface StatusPillProps extends React.ComponentProps<"span"> {
  tone?: StatusTone;
  /** Status is never colour alone: always pass an icon (and the children label). */
  icon?: React.ComponentType<{ className?: string }>;
  size?: "sm" | "md";
}

/** Coloured status label: tinted chip + icon + text. */
function StatusPill({ tone = "neutral", icon: Icon, size = "sm", className, children, ...props }: StatusPillProps) {
  return (
    <span
      data-slot="status-pill"
      data-tone={tone}
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 rounded-full font-medium whitespace-nowrap ring-1 ring-inset",
        size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-sm",
        TONES[tone],
        className,
      )}
      {...props}
    >
      {Icon && <Icon className={cn("shrink-0", size === "sm" ? "size-3.5" : "size-4")} aria-hidden />}
      {children}
    </span>
  );
}

export { StatusPill };
