"use client";

import * as React from "react";
import { CheckCircle2Icon, ImageIcon, Loader2Icon, LockIcon, PencilLineIcon, SaveIcon, Undo2Icon } from "lucide-react";
import { Button, cn, Input, Label, StatusPill } from "@srirealtime/ui";
import { absoluteUrl, useI18n } from "@srirealtime/web";
import type { ContentStatus } from "../lib/types";

/** Card section with a tinted icon chip, title and hint (same look as commerce-ui). */
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
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 px-4 py-4 sm:px-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Optional() {
  const { t } = useI18n();
  return <span className="ml-1 text-xs font-normal text-muted-foreground">({t("site.common.optional")})</span>;
}

/** Inline field error, translated from a reason code ("required", "url", "tooLong" …) or a full key. */
export function FieldError({ code, id }: { code?: string | null; id?: string }) {
  const { t } = useI18n();
  if (!code) return null;
  const key = code.startsWith("site.") ? code : `site.validation.${code}`;
  return (
    <p id={id} className="text-xs text-destructive" role="alert">
      {t.has(key) ? t(key) : t("site.validation.invalid")}
    </p>
  );
}

/** Label + input + error in one, for the many small text fields in the editors. */
export function TextField({
  id,
  label,
  value,
  onChange,
  error,
  optional,
  hint,
  placeholder,
  disabled,
  maxLength,
  className,
  inputClassName,
  type = "text",
  inputMode,
}: {
  id: string;
  label: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  optional?: boolean;
  hint?: React.ReactNode;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  className?: string;
  inputClassName?: string;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {optional && <Optional />}
      </Label>
      <Input
        id={id}
        type={type}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
        className={cn("h-11", inputClassName)}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      <FieldError code={error} id={`${id}-err`} />
    </div>
  );
}

/** Square image (or a tinted placeholder). */
export function Thumb({ src, alt = "", className }: { src: string | null | undefined; alt?: string; className?: string }) {
  const [broken, setBroken] = React.useState(false);
  const url = absoluteUrl(src ?? null);
  React.useEffect(() => setBroken(false), [url]);
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

/** ₹ amount typed in rupees. */
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
        className={cn("pl-7 tabular-nums", className)}
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

export function ContentStatusPill({ status, className }: { status: ContentStatus; className?: string }) {
  const { t } = useI18n();
  return status === "published" ? (
    <StatusPill tone="success" icon={CheckCircle2Icon} className={className}>
      {t("site.status.published")}
    </StatusPill>
  ) : (
    <StatusPill tone="warning" icon={PencilLineIcon} className={className}>
      {t("site.status.draft")}
    </StatusPill>
  );
}

/** "You can view this, but only … can change it" banner. */
export function ReadOnlyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 flex items-center gap-2 rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground ring-1 ring-border ring-inset">
      <LockIcon className="size-4 shrink-0" /> {children}
    </p>
  );
}

/**
 * Sticky save bar (phones: above the bottom edge, safe-area aware). `extra` sits before the save button
 * (e.g. Publish). Rendered at the bottom of an editor form.
 */
export function SaveBar({
  dirty,
  saving,
  status,
  onDiscard,
  saveLabel,
  extra,
  disabled,
  className,
}: {
  dirty: boolean;
  saving: boolean;
  /** Status text when nothing is unsaved. */
  status?: React.ReactNode;
  onDiscard?: () => void;
  saveLabel?: string;
  extra?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div
      className={cn(
        "sticky bottom-0 z-40 -mx-4 border-t border-border/70 bg-card/90 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_-12px_oklch(0_0_0/0.18)] backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8",
        className,
      )}
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2">
        <p className={cn("flex min-w-0 flex-1 items-center gap-2 truncate text-sm", dirty ? "font-medium" : "text-muted-foreground")} aria-live="polite">
          <span className={cn("size-2 shrink-0 rounded-full", dirty ? "bg-warning" : "bg-success")} aria-hidden />
          <span className="truncate">{dirty ? t("site.editor.unsaved") : (status ?? t("site.editor.allSaved"))}</span>
        </p>
        {dirty && onDiscard && (
          <Button type="button" variant="ghost" size="lg" onClick={onDiscard} disabled={saving}>
            <Undo2Icon /> <span className="hidden sm:inline">{t("site.editor.discard")}</span>
          </Button>
        )}
        {extra}
        <Button type="submit" size="lg" variant={extra ? "outline" : "default"} disabled={disabled || saving || !dirty} className="min-w-28">
          {saving ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
          {saveLabel ?? t("site.editor.save")}
        </Button>
      </div>
    </div>
  );
}
