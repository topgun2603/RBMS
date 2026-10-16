"use client";

import * as React from "react";
import { ArrowRightIcon, ChevronRightIcon, CircleAlertIcon } from "lucide-react";
import { AnimatedNumber, Button, Card, CardAction, CardContent, CardHeader, CardTitle, cn, Skeleton } from "@srirealtime/ui";
import { useI18n } from "../lib/i18n";
import { ModuleLink } from "./navigation";
import type { IconType } from "./types";

/*
 * Building blocks that dashboard widgets render (docs/web-modules.md → Dashboard). A widget declares its `zone`; the
 * dashboard lays the zones out, and these parts give every module's tiles, rows and cards the same shape.
 */

/** A link target: `to` is module-relative (resolved against the widget's module), `href` is app-absolute. */
export interface LinkTarget {
  to?: string;
  href?: string;
}

function Target({ to, href, className, children, ...rest }: LinkTarget & { className?: string; children: React.ReactNode; "aria-label"?: string; title?: string }) {
  if (href !== undefined)
    return (
      <ModuleLink href={href} className={className} {...rest}>
        {children}
      </ModuleLink>
    );
  if (to !== undefined)
    return (
      <ModuleLink to={to} className={className} {...rest}>
        {children}
      </ModuleLink>
    );
  return <div className={className}>{children}</div>;
}

// ---------------------------------------------------------------- sparkline

/** Tiny decorative trend line (the tile carries the numbers as text): 2px round stroke, faint area, last point marked. */
export function Sparkline({ values, width = 88, height = 30, className }: { values: number[]; width?: number; height?: number; className?: string }) {
  const gid = React.useId().replace(/:/g, "");
  if (values.length < 2) return null;
  const pad = 3;
  const max = Math.max(...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);
  const line = `M${values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" L")}`;
  const area = `${line} L${x(values.length - 1).toFixed(1)},${height - pad} L${x(0).toFixed(1)},${height - pad} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn("shrink-0 overflow-visible", className)} aria-hidden>
      <defs>
        <linearGradient id={`ks-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.2} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#ks-${gid})`} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1] ?? 0)} r={2.5} fill="currentColor" />
    </svg>
  );
}

// ---------------------------------------------------------------- KPI tiles

/** Set by the dashboard per KPI slot: the first tile is the one accent tile of the page. */
export const KpiSlotContext = React.createContext<{ accent: boolean }>({ accent: false });

export interface KpiTileProps extends LinkTarget {
  label: string;
  value: number | null | undefined;
  /** Formats the (rolling) value; default: grouped integer. */
  format?: (n: number) => string;
  /** Full value for screen readers and the tooltip (e.g. ₹1,12,224.00 while the tile shows ₹1.1L). */
  exact?: string;
  hint?: React.ReactNode;
  /** Change vs the previous period in percent; null/undefined hides it. */
  delta?: number | null;
  deltaLabel?: string;
  /** Whether a rise is good news (sales) or bad news (dues). Default "up". */
  goodWhen?: "up" | "down";
  spark?: number[];
  icon?: IconType;
  loading?: boolean;
  /** Load failed: shows a dash and the retry link. */
  error?: boolean;
  onRetry?: () => void;
}

/** One headline number of the KPI strip: label, rolling value, delta or hint, optional sparkline; equal height. */
export function KpiTile({ label, value, format, exact, hint, delta, deltaLabel, goodWhen = "up", spark, icon: Icon, loading, error, onRetry, to, href }: KpiTileProps) {
  const { t, formatNumber } = useI18n();
  const { accent } = React.useContext(KpiSlotContext);
  const fmt = format ?? ((n: number) => formatNumber(Math.round(n)));
  const v = value ?? 0;
  const linked = !loading && !error && (to !== undefined || href !== undefined);

  // The shared Card supplies the padding and radius, so the tiles follow the kit's spacing scale.
  const body = (
    <Card
      className={cn(
        "relative isolate h-full min-h-32 justify-between overflow-hidden transition-[transform,box-shadow] duration-200 sm:min-h-36",
        accent && "hero-band border-transparent bg-primary text-primary-foreground shadow-raised",
        linked && "group-hover:-translate-y-0.5 group-hover:shadow-raised motion-reduce:group-hover:translate-y-0",
      )}
    >
      {accent && <div className="hero-dots pointer-events-none absolute inset-0 -z-10" aria-hidden />}
      <CardHeader>
        <p className={cn("text-xs leading-snug font-medium sm:text-sm", accent ? "opacity-85" : "text-muted-foreground")}>{label}</p>
        {Icon && (
          <CardAction>
            <span className={cn("icon-chip size-8", accent ? "text-current" : "text-primary")}>
              <Icon className="size-4" />
            </span>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className={cn("h-8 w-24", accent && "bg-white/20")} />
            <Skeleton className={cn("h-3 w-20", accent && "bg-white/15")} />
          </div>
        ) : error ? (
          <div className="space-y-1">
            <p className="font-heading text-2xl font-bold">—</p>
            {onRetry && (
              <button type="button" onClick={onRetry} className={cn("text-xs underline underline-offset-2", accent ? "opacity-90" : "text-muted-foreground")}>
                {t("web.common.retry")}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            <div className="flex items-end justify-between gap-2">
              <p className="min-w-0 truncate font-heading text-2xl font-bold tracking-tight tabular-nums sm:text-3xl" title={exact}>
                <AnimatedNumber value={v} from={0} duration={0.9} format={fmt} aria-hidden />
                <span className="sr-only">{exact ?? fmt(v)}</span>
              </p>
              {spark && spark.length > 1 && <Sparkline values={spark} className={cn("mb-1 hidden min-[400px]:block", accent ? "text-current opacity-90" : "text-primary")} />}
            </div>
            {(delta != null || hint) && (
              <p className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs", accent ? "opacity-90" : "text-muted-foreground")}>
                {delta != null && <Delta pct={delta} goodWhen={goodWhen} accent={accent} label={deltaLabel} />}
                {hint && <span className="line-clamp-2">{hint}</span>}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (!linked) return body;
  return (
    <Target to={to} href={href} className="group block h-full rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {body}
    </Target>
  );
}

function Delta({ pct, goodWhen, accent, label }: { pct: number; goodWhen: "up" | "down"; accent: boolean; label?: string }) {
  const { t } = useI18n();
  const flat = Math.abs(pct) < 0.5;
  const up = pct > 0;
  const good = flat ? null : up === (goodWhen === "up");
  const n = Math.abs(pct) >= 100 ? Math.round(Math.abs(pct)) : Math.round(Math.abs(pct) * 10) / 10;
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 font-semibold",
          !accent && good === true && "text-success-ink",
          !accent && good === false && "text-danger-ink",
          accent && "rounded-full bg-white/15 px-1.5 py-px",
        )}
      >
        <span aria-hidden>{flat ? "•" : up ? "▲" : "▼"}</span>
        {flat ? t("web.dashboard.deltaFlat") : t(up ? "web.dashboard.deltaUp" : "web.dashboard.deltaDown", { pct: n })}
      </span>
      {label && <span>{label}</span>}
    </span>
  );
}

/** Placeholder tile while a KPI widget's code loads. */
export function KpiTileSkeleton() {
  return (
    <Card className="h-full min-h-32 justify-between sm:min-h-36">
      <CardHeader>
        <Skeleton className="h-4 w-24" />
      </CardHeader>
      <CardContent className="space-y-2">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-3 w-20" />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- attention items

export type AttentionTone = "danger" | "warning" | "info" | "neutral";
const TONE_RANK: Record<AttentionTone, number> = { danger: 0, warning: 1, info: 2, neutral: 3 };
const TONE_CLASS: Record<AttentionTone, string> = {
  danger: "text-danger-ink",
  warning: "text-warning-ink",
  info: "text-info-ink",
  neutral: "text-primary",
};

interface AttentionEntry {
  state: "pending" | "ready" | "error";
  count: number;
}

/** What the "Needs attention" card knows about its rows: whether any are still loading and how many show. */
export class AttentionStore {
  private entries = new Map<string, AttentionEntry>();
  private listeners = new Set<() => void>();
  private version = 0;

  set(key: string, entry: AttentionEntry) {
    const prev = this.entries.get(key);
    if (prev && prev.state === entry.state && prev.count === entry.count) return;
    this.entries.set(key, entry);
    this.emit();
  }
  delete(key: string) {
    if (this.entries.delete(key)) this.emit();
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  summary() {
    let pending = 0;
    let shown = 0;
    for (const e of this.entries.values()) {
      if (e.state === "pending") pending++;
      else if (e.state === "error" || e.count > 0) shown++;
    }
    return { pending, shown };
  }
  private emit() {
    this.version++;
    for (const fn of this.listeners) fn();
  }
}

export const AttentionContext = React.createContext<AttentionStore | null>(null);

/** Reports "still loading" to the attention card while it is mounted (the dashboard's Suspense fallback). */
export function AttentionPending() {
  const store = React.useContext(AttentionContext);
  const key = React.useId();
  React.useEffect(() => {
    store?.set(key, { state: "pending", count: 0 });
    return () => store?.delete(key);
  }, [store, key]);
  return null;
}

export interface AttentionItemProps extends LinkTarget {
  /** How many things wait; the row hides itself at zero. */
  count: number | null | undefined;
  /** Translated label without the number ("Orders to confirm"); the count sits on the right. */
  label: string;
  icon?: IconType;
  /** Urgency: danger first, then warning, info, neutral; bigger counts first within a tone. */
  tone?: AttentionTone;
  loading?: boolean;
  /** The count could not be loaded: the row shows a muted note instead of hiding. */
  error?: boolean;
}

/** One row of the "Needs attention" card. Render several from one widget if the module has several kinds of to-dos. */
export function AttentionItem({ count, label, icon: Icon = CircleAlertIcon, tone = "info", loading, error, to, href }: AttentionItemProps) {
  const { t } = useI18n();
  const store = React.useContext(AttentionContext);
  const key = React.useId();
  const n = Math.max(0, Math.round(count ?? 0));
  const state: AttentionEntry["state"] = loading ? "pending" : error ? "error" : "ready";

  React.useEffect(() => {
    store?.set(key, { state, count: n });
  }, [store, key, state, n]);
  React.useEffect(() => () => store?.delete(key), [store, key]);

  if (loading || (!error && n === 0)) return null;
  const rank = error ? 4 * 100_000 : TONE_RANK[tone] * 100_000 + (99_999 - Math.min(n, 99_999));

  return (
    <li style={{ order: rank }} className="min-w-0">
      <Target
        to={to}
        href={href}
        aria-label={error ? `${label}: ${t("web.dashboard.attentionError")}` : `${label}: ${n}`}
        className="group flex min-h-12 items-center gap-3 rounded-xl px-2.5 py-2 outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className={cn("icon-chip size-9 rounded-xl", error ? "text-muted-foreground" : TONE_CLASS[tone])}>
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-sm leading-snug font-medium">{label}</span>
          {error && <span className="block text-xs text-muted-foreground">{t("web.dashboard.attentionError")}</span>}
        </span>
        {!error && (
          <AnimatedNumber
            value={n}
            from={0}
            aria-hidden
            className={cn("font-heading text-lg font-bold tabular-nums", tone === "danger" ? "text-danger-ink" : tone === "warning" ? "text-warning-ink" : "text-foreground")}
          />
        )}
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Target>
    </li>
  );
}

// ---------------------------------------------------------------- insight cards

export interface InsightCardProps extends LinkTarget {
  icon?: IconType;
  title: string;
  /** Text of the header link (shown from `sm` up; the arrow alone on phones). */
  linkLabel?: string;
  /** The card's one number (already formatted, or a rolling <AnimatedNumber>). */
  value?: React.ReactNode;
  caption?: React.ReactNode;
  loading?: boolean;
  children?: React.ReactNode;
  className?: string;
}

/** Compact card of the "More insights" grid: icon + title + link, one number with a caption, optional detail. */
export function InsightCard({ icon: Icon, title, linkLabel, value, caption, loading, children, className, to, href }: InsightCardProps) {
  const { t } = useI18n();
  const linked = to !== undefined || href !== undefined;
  return (
    <Card className={cn("h-full", className)}>
      <CardHeader className="flex min-h-9 flex-row items-center justify-between gap-2">
        <CardTitle className="flex min-w-0 items-center gap-2.5 text-sm font-semibold">
          {Icon && (
            <span className="icon-chip size-8 text-primary">
              <Icon className="size-4" />
            </span>
          )}
          <span className="line-clamp-2 leading-snug">{title}</span>
        </CardTitle>
        {linked && (
          <Button asChild variant="ghost" size="sm" className="shrink-0 text-muted-foreground">
            <Target to={to} href={href} aria-label={linkLabel ?? t("web.dashboard.open", { name: title })}>
              {linkLabel && <span className="hidden xl:inline">{linkLabel}</span>}
              <ArrowRightIcon />
            </Target>
          </Button>
        )}
      </CardHeader>
      <CardContent className="grid content-start gap-2">
        {loading ? (
          <>
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-3.5 w-40" />
          </>
        ) : (
          <>
            {value !== undefined && <div className="font-heading text-2xl font-bold tracking-tight tabular-nums">{value}</div>}
            {caption && <p className="text-xs text-muted-foreground">{caption}</p>}
            {children}
          </>
        )}
      </CardContent>
    </Card>
  );
}
