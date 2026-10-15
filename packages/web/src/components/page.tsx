"use client";

import * as React from "react";
import { ArrowLeftIcon } from "lucide-react";
import { cn, controlHeight, type ControlSize } from "@srirealtime/ui";
import { ModuleLink } from "../app/navigation";

/** Standard page container. The enter animation is applied once by the app frame. */
export function Page({ children, className, wide }: { children: React.ReactNode; className?: string; wide?: boolean }) {
  return (
    <div className={cn("mx-auto w-full px-4 py-5 sm:px-6 lg:px-8 lg:py-8", wide ? "max-w-[96rem]" : "max-w-7xl", className)}>
      {children}
    </div>
  );
}

/**
 * Page title row: tinted icon chip, title, description and actions (stacked on phones).
 * `back` renders a small "← Section" link above the title; its href is relative to the current module.
 */
export function PageHeading({
  title,
  description,
  icon: Icon,
  actions,
  back,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
  className?: string;
}) {
  return (
    <div className={cn("mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)} data-print-hide>
      <div className="min-w-0 space-y-2">
        {back && (
          <ModuleLink
            to={back.href}
            className="-ml-1 inline-flex items-center gap-1 rounded-md px-1 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeftIcon className="size-3.5" /> {back.label}
          </ModuleLink>
        )}
        <div className="flex items-center gap-3">
          {Icon && (
            <span className="icon-chip size-10 rounded-xl text-primary">
              <Icon className="size-5" />
            </span>
          )}
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold tracking-tight">{title}</h1>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
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

/** Search field with icon used above lists. */
export function SearchField({
  value,
  onChange,
  placeholder,
  className,
  size = "lg",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
  /** Shared control scale; list-page toolbars use "lg" — give filter selects next to it the same size. */
  size?: ControlSize;
}) {
  return (
    <div className={cn("relative", className)}>
      <svg
        viewBox="0 0 24 24"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        aria-hidden
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(controlHeight(size), "w-full rounded-xl border border-input bg-card pr-3 pl-9 text-base shadow-xs outline-none transition-[box-shadow,border-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 sm:text-sm")}
      />
    </div>
  );
}
