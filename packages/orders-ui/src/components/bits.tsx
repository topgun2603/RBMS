"use client";

import * as React from "react";
import { CheckIcon, CopyIcon, ImageIcon } from "lucide-react";
import { AnimatePresence, Button, cn, Input, motion, toast } from "@srirealtime/ui";
import { absoluteUrl, useI18n } from "@srirealtime/web";

/** Card section with a tinted icon chip, title and hint (same look as the catalogue screens). */
export function Section({
  id,
  icon: Icon,
  title,
  description,
  action,
  children,
  tone = "text-primary",
  className,
  bodyClassName,
}: {
  id?: string;
  icon: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  tone?: string;
  className?: string;
  bodyClassName?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn("min-w-0 scroll-mt-24 rounded-2xl border border-card-ring bg-card text-card-foreground shadow-elevated", className)}
    >
      <header className="flex items-start gap-3 border-b border-border/60 px-4 py-3.5 sm:px-5">
        <span className={cn("icon-chip size-9 rounded-xl", tone)}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="font-heading text-base font-semibold tracking-tight">
            {title}
          </h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-1">{action}</div>}
      </header>
      <div className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 px-4 py-4 sm:px-5", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Square product image (or a tinted placeholder). */
export function Thumb({ src, alt, className }: { src: string | null | undefined; alt: string; className?: string }) {
  const [broken, setBroken] = React.useState(false);
  const url = absoluteUrl(src ?? null);
  return (
    <span className={cn("relative inline-flex size-12 shrink-0 overflow-hidden rounded-xl bg-muted ring-1 ring-border ring-inset", className)}>
      {url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element -- UI modules don't use next/image
        <img src={url} alt={alt} loading="lazy" className="size-full object-cover" onError={() => setBroken(true)} />
      ) : (
        <span className="icon-chip size-full rounded-none text-primary" aria-hidden>
          <ImageIcon className="size-1/2 max-h-5 max-w-5 opacity-80" />
        </span>
      )}
    </span>
  );
}

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
        className={cn("h-11 pl-7 text-right tabular-nums", className)}
        onChange={(e) => {
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

/** Small "(optional)" marker after a label. */
export function Optional() {
  const { t } = useI18n();
  return <span className="ml-1 text-xs font-normal text-muted-foreground">({t("orders.common.optional")})</span>;
}

/** Copies `value`; the icon morphs into a check for 2 s. */
export function CopyButton({
  value,
  label,
  copiedMessage,
  variant = "outline",
  size = "icon",
  showLabel,
  className,
}: {
  value: string;
  label?: string;
  copiedMessage?: string;
  variant?: "outline" | "ghost" | "secondary" | "default";
  size?: "icon" | "icon-lg" | "icon-sm" | "sm" | "default" | "lg";
  showLabel?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = React.useState(false);
  const text = label ?? t("orders.common.copy");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(copiedMessage ?? t("orders.common.copied"));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("orders.common.copyFailed"));
    }
  };
  return (
    <Button type="button" variant={variant} size={size} className={className} onClick={() => void copy()} aria-label={showLabel ? undefined : text}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={copied ? "y" : "n"}
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.5, opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="inline-flex"
        >
          {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
        </motion.span>
      </AnimatePresence>
      {showLabel && text}
    </Button>
  );
}

/** "Label ……… value" row for totals. */
export function TotalRow({
  label,
  value,
  strong,
  muted,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  strong?: boolean;
  muted?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 text-sm", strong && "text-base font-semibold", muted && "text-muted-foreground", className)}>
      <span className="min-w-0">{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}

/** Field wrapper for plain (non-react-hook-form) inputs: label, control, hint or error. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  optional,
  children,
  className,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string | null;
  optional?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid min-w-0 gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
        {optional && <Optional />}
      </label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** A read-only notice ("You can view these settings; only owners can change them"). */
export function ReadOnlyNote({ children, icon: Icon }: { children: React.ReactNode; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <p className="mb-4 flex items-center gap-2 rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground ring-1 ring-border ring-inset">
      <Icon className="size-4 shrink-0" /> {children}
    </p>
  );
}
