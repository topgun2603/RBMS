"use client";

import * as React from "react";
import { ModuleLink, useI18n } from "@srirealtime/web";
import { AnimatedNumber, cn, Skeleton } from "@srirealtime/ui";
import { Sparkline } from "./sparkline";
import { compactINR, money, pctChange } from "../../lib/format";

export interface StatTileProps {
  label: React.ReactNode;
  /** Paise for money tiles, a plain count otherwise. */
  value: number | null | undefined;
  /** "percent": value is a percentage (2.5 = 2.5 %); its delta is shown in percentage points. */
  kind?: "money" | "count" | "percent";
  /** Previous-period value for the ▲/▼ delta (null = no comparison base). */
  previous?: number | null;
  /** "vs last month" (default) — the period the delta compares against. */
  deltaLabel?: string;
  /** Whether a rise is good news (sales) or bad news (dues). Default "up". */
  goodWhen?: "up" | "down";
  hint?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  /** Text colour for the icon chip, e.g. "text-primary", "text-success". */
  iconTone?: string;
  sparkline?: number[];
  href?: string;
  loading?: boolean;
  className?: string;
  /** Visual variant: card (default) or on the hero band (inherits colour). */
  variant?: "card" | "hero";
}

/** Single-number tile: label, auto-compact value (₹12.9K, ₹4.2L), delta with ▲/▼ + text, optional sparkline. */
export function StatTile({
  label,
  value,
  kind = "money",
  previous,
  deltaLabel,
  goodWhen = "up",
  hint,
  icon: Icon,
  iconTone = "text-primary",
  sparkline,
  href,
  loading,
  className,
  variant = "card",
}: StatTileProps) {
  const { t, formatNumber } = useI18n();
  const v = value ?? 0;
  const fmt = (n: number) =>
    kind === "money" ? compactINR(n) : kind === "percent" ? `${formatNumber(Math.round(n * 10) / 10)}%` : formatNumber(Math.round(n));
  const exact = kind === "money" ? money(v) : kind === "percent" ? `${formatNumber(v)}%` : formatNumber(v);
  // Rates compare in percentage points; everything else in percent.
  const pct = previous === undefined || previous === null ? null : kind === "percent" ? Math.round((v - previous) * 100) / 100 : pctChange(v, previous);
  const hero = variant === "hero";

  const body = (
    <div
      className={cn(
        "group flex h-full flex-col gap-2 rounded-2xl p-4 transition-[transform,box-shadow] duration-200",
        hero
          ? "bg-white/10 ring-1 ring-white/15 backdrop-blur-sm ring-inset"
          : "border border-card-ring bg-card shadow-elevated",
        href && "hover:-translate-y-0.5 hover:shadow-raised motion-reduce:hover:translate-y-0",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className={cn("text-xs font-medium sm:text-sm", hero ? "opacity-85" : "text-muted-foreground")}>{label}</p>
        {Icon && (
          <span className={cn("icon-chip size-8", hero ? "text-current" : iconTone)}>
            <Icon className="size-4" />
          </span>
        )}
      </div>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className={cn("h-7 w-24", hero && "bg-white/20")} />
          <Skeleton className={cn("h-3 w-20", hero && "bg-white/15")} />
        </div>
      ) : (
        <>
          <div className="flex items-end justify-between gap-2">
            <p className="font-heading text-2xl font-bold tracking-tight tabular-nums sm:text-[1.65rem]">
              <AnimatedNumber value={v} from={0} duration={0.9} format={fmt} aria-hidden />
              <span className="sr-only">{exact}</span>
            </p>
            {sparkline && sparkline.length > 1 && (
              <Sparkline values={sparkline} className={hero ? "text-current opacity-90" : "text-primary"} />
            )}
          </div>
          {(pct !== null || hint) && (
            <p className={cn("flex flex-wrap items-center gap-x-1.5 text-xs", hero ? "opacity-90" : "text-muted-foreground")}>
              {pct !== null && <Delta pct={pct} points={kind === "percent"} goodWhen={goodWhen} hero={hero} label={deltaLabel ?? t("site.charts.vsPrevious")} />}
              {hint && <span>{hint}</span>}
            </p>
          )}
        </>
      )}
    </div>
  );

  return href ? (
    <ModuleLink to={href} className="block h-full rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {body}
    </ModuleLink>
  ) : (
    body
  );
}

function Delta({ pct, points, goodWhen, hero, label }: { pct: number; points?: boolean; goodWhen: "up" | "down"; hero: boolean; label: string }) {
  const { t } = useI18n();
  const flat = Math.abs(pct) < (points ? 0.05 : 0.5);
  const up = pct > 0;
  const good = flat ? null : up === (goodWhen === "up");
  const n = Math.abs(pct) >= 100 ? Math.round(Math.abs(pct)) : Math.round(Math.abs(pct) * 10) / 10;
  const text = flat ? t("site.charts.noChange") : t(points ? (up ? "site.charts.upPts" : "site.charts.downPts") : up ? "site.charts.up" : "site.charts.down", { pct: n });
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 font-semibold",
          !hero && good === true && "text-success-ink",
          !hero && good === false && "text-danger-ink",
          hero && "rounded-full bg-white/15 px-1.5 py-px",
        )}
      >
        <span aria-hidden>{flat ? "•" : up ? "▲" : "▼"}</span>
        {text}
      </span>
      <span>{label}</span>
    </span>
  );
}
