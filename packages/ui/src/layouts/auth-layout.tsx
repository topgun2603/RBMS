import * as React from "react";
import { cn } from "../lib/utils";

export interface AuthLayoutProps {
  /** Brand logo (img or svg) shown above the card. */
  logo?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Small links under the card (terms, privacy, language switcher...). */
  footer?: React.ReactNode;
  /** Top-right corner controls, e.g. locale and theme toggles. */
  corner?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** Centered single-card layout for sign-in, onboarding and workspace selection. */
function AuthLayout({ logo, title, description, footer, corner, children, className }: AuthLayoutProps) {
  return (
    <div
      data-slot="auth-layout"
      className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-page px-4 py-10"
    >
      {/* Brand-tinted backdrop: derives from --primary so tenant branding shows through. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-0 bg-[radial-gradient(60rem_30rem_at_50%_-10%,color-mix(in_oklch,var(--primary)_14%,transparent),transparent)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)] bg-[size:48px_48px] opacity-40"
      />
      {corner && <div className="absolute top-4 right-4 z-10 flex items-center gap-1">{corner}</div>}
      <div className={cn("relative z-10 flex w-full max-w-sm flex-col items-center gap-6", className)}>
        {logo && <div className="flex items-center justify-center">{logo}</div>}
        <div className="w-full rounded-2xl border border-card-ring bg-card/95 p-6 text-card-foreground shadow-raised backdrop-blur sm:p-8">
          {(title || description) && (
            <div className="mb-6 space-y-1.5 text-center">
              {title && <h1 className="font-heading text-xl font-semibold tracking-tight">{title}</h1>}
              {description && <p className="text-sm text-muted-foreground">{description}</p>}
            </div>
          )}
          {children}
        </div>
        {footer && <div className="text-center text-xs text-muted-foreground">{footer}</div>}
      </div>
    </div>
  );
}

export { AuthLayout };
