"use client";

import * as React from "react";
import { ArchiveIcon, CheckCircle2Icon, ImageIcon, PencilLineIcon } from "lucide-react";
import { cn, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, StatusPill } from "@srirealtime/ui";
import { absoluteUrl, useI18n } from "@srirealtime/web";
import { PRODUCT_GST_RATES, type ProductStatus } from "../lib/types";

const STATUS_META: Record<ProductStatus, { tone: "success" | "warning" | "neutral"; icon: React.ComponentType<{ className?: string }> }> = {
  active: { tone: "success", icon: CheckCircle2Icon },
  draft: { tone: "warning", icon: PencilLineIcon },
  archived: { tone: "neutral", icon: ArchiveIcon },
};

export function ProductStatusPill({ status, className }: { status: ProductStatus; className?: string }) {
  const { t } = useI18n();
  const m = STATUS_META[status];
  return (
    <StatusPill tone={m.tone} icon={m.icon} className={className}>
      {t(`commerce.status.${status}`)}
    </StatusPill>
  );
}

/** Square product image (or a tinted placeholder). */
export function ProductThumb({ src, alt, className }: { src: string | null | undefined; alt: string; className?: string }) {
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
        className={cn("pl-7 text-right tabular-nums", className)}
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

/** GST slab picker (0/5/12/18/28). Value is the rate as a string ("18"). */
export function GstRateSelect({
  id,
  value,
  onChange,
  className,
  disabled,
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const rates: number[] = [...PRODUCT_GST_RATES];
  // Keep a legacy rate (e.g. 3% gold) selectable when a product already has it.
  if (value && !rates.includes(Number(value))) rates.push(Number(value));
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className={className} aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {rates
          .sort((a, b) => a - b)
          .map((r) => (
            <SelectItem key={r} value={String(r)}>
              GST {r}%
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}

/** Card section with a tinted icon chip, title and hint; `id` makes it a jump target. */
export function Section({
  id,
  icon: Icon,
  title,
  description,
  action,
  children,
  tone = "text-primary",
  className,
}: {
  id?: string;
  icon: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  tone?: string;
  className?: string;
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
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

/** Small "Optional" marker after a label. */
export function Optional() {
  const { t } = useI18n();
  return <span className="ml-1 text-xs font-normal text-muted-foreground">({t("commerce.common.optional")})</span>;
}
