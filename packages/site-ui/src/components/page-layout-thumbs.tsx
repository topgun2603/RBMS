"use client";

import * as React from "react";
import { cn } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import { LAYOUT_OPTIONS, type LayoutTheme } from "@srirealtime/branding/theme";

/*
 * Settings → Appearance → Page layout: a wireframe of each page layout (standard, category rail, side menu, magazine)
 * and of the phone tab bar, drawn in the admin's own colours (currentColor = primary), so the choice reads at a glance.
 */

type PageLayout = LayoutTheme["pageLayout"];

/** A tiny store page in the given layout. */
export function PageLayoutSketch({ layout, className }: { layout: PageLayout; className?: string }) {
  const paper = "var(--muted)";
  const line = "var(--border)";
  const accent = "currentColor";
  const bar = (x: number, y: number, w: number, h = 3, fill = line, o = 1) => <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={fill} opacity={o} />;
  const tiles = (x: number, y: number, cols: number, w: number, h: number, gap = 3, rows = 1, feature = false) =>
    Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => {
        if (feature && r < 2 && c < 2) return c === 0 && r === 0 ? <rect key={`${r}${c}`} x={x} y={y} width={w * 2 + gap} height={h * 2 + gap} rx="2" fill={accent} opacity="0.3" /> : null;
        return <rect key={`${r}${c}`} x={x + c * (w + gap)} y={y + r * (h + gap)} width={w} height={h} rx="2" fill={paper} stroke={line} strokeWidth="0.6" />;
      }),
    ).flat();
  return (
    <svg viewBox="0 0 120 80" className={className} aria-hidden>
      <rect x="0.5" y="0.5" width="119" height="79" rx="5" fill="var(--background)" stroke={line} />
      {layout === "sidebar" ? (
        <>
          <rect x="0.5" y="0.5" width="26" height="79" rx="5" fill={paper} />
          <rect x="5" y="6" width="10" height="6" rx="2" fill={accent} />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <React.Fragment key={i}>{bar(5, 18 + i * 8, i === 1 ? 16 : 13, 3, i === 1 ? accent : line, i === 1 ? 0.8 : 1)}</React.Fragment>
          ))}
          <rect x="5" y="68" width="16" height="6" rx="3" fill={accent} opacity="0.85" />
          <rect x="31" y="6" width="84" height="22" rx="3" fill={accent} opacity="0.18" />
          {tiles(31, 33, 4, 18.75, 18)}
          {tiles(31, 56, 4, 18.75, 18)}
        </>
      ) : (
        <>
          <rect x="0.5" y="0.5" width="119" height="11" rx="5" fill={paper} />
          <rect x="5" y="3" width="12" height="5" rx="2" fill={accent} />
          {bar(60, 4.5, 24, 2.5)}
          {bar(90, 4.5, 24, 2.5)}
          {layout === "rail" && (
            <>
              <rect x="4" y="15" width="24" height="61" rx="3" fill={paper} />
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <g key={i}>
                  <rect x="7" y={19 + i * 9.5} width="5" height="5" rx="1.5" fill={accent} opacity={i === 2 ? 0.9 : 0.3} />
                  {bar(14, 20.2 + i * 9.5, 11, 2.5, i === 2 ? accent : line)}
                </g>
              ))}
              <rect x="32" y="15" width="84" height="24" rx="3" fill={accent} opacity="0.18" />
              {tiles(32, 43, 4, 18.75, 15)}
              {tiles(32, 61, 4, 18.75, 15)}
            </>
          )}
          {layout === "standard" && (
            <>
              <rect x="4" y="15" width="112" height="26" rx="3" fill={accent} opacity="0.18" />
              {bar(10, 23, 40, 4, accent, 0.7)}
              {tiles(4, 45, 5, 20.2, 14)}
              {tiles(4, 62, 5, 20.2, 14)}
            </>
          )}
          {layout === "magazine" && (
            <>
              <rect x="4" y="15" width="56" height="1" fill={accent} opacity="0.5" />
              <text x="4" y="22" fontSize="5" fontWeight="700" fill={accent}>
                01
              </text>
              {bar(4, 25, 70, 7, accent, 0.75)}
              {tiles(4, 37, 4, 26, 18, 3.3, 2, true)}
            </>
          )}
        </>
      )}
    </svg>
  );
}

/** A phone with or without the bottom tab bar. */
export function MobileNavSketch({ tabs, className }: { tabs: boolean; className?: string }) {
  const paper = "var(--muted)";
  const line = "var(--border)";
  return (
    <svg viewBox="0 0 50 80" className={className} aria-hidden>
      <rect x="1" y="1" width="48" height="78" rx="7" fill="var(--background)" stroke={line} />
      <rect x="1" y="1" width="48" height="10" rx="7" fill={paper} />
      <rect x="5" y="4" width="10" height="4" rx="2" fill="currentColor" />
      {!tabs && [0, 1, 2].map((i) => <rect key={i} x={38} y={4 + i * 1.6} width="7" height="0.9" rx="0.45" fill="currentColor" />)}
      <rect x="5" y="14" width="40" height="18" rx="3" fill="currentColor" opacity="0.18" />
      {[0, 1].map((r) => [0, 1].map((c) => <rect key={`${r}${c}`} x={5 + c * 21} y={35 + r * 18} width="19" height="15" rx="2" fill={paper} stroke={line} strokeWidth="0.6" />))}
      {tabs && (
        <>
          <rect x="1" y="68" width="48" height="11" rx="0" fill={paper} />
          <rect x="1" y="68" width="48" height="0.7" fill={line} />
          {[0, 1, 2, 3, 4].map((i) => (
            <circle key={i} cx={7 + i * 9} cy="73.5" r="2" fill="currentColor" opacity={i === 0 ? 1 : 0.35} />
          ))}
        </>
      )}
    </svg>
  );
}

/** The page-layout picker: one card per layout with its sketch, name and a line on when to use it. */
export function PageLayoutPicker({ value, onChange, disabled }: { value: PageLayout; onChange: (v: PageLayout) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const id = React.useId();
  return (
    <div className="grid content-start gap-2">
      <span id={id} className="text-sm font-medium">
        {t("site.appearance.opt.pageLayout.label")}
      </span>
      <div role="radiogroup" aria-labelledby={id} className="grid grid-cols-2 gap-3 2xl:grid-cols-4" data-testid="page-layout-picker">
        {LAYOUT_OPTIONS.pageLayout.map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            disabled={disabled}
            onClick={() => onChange(v)}
            className={cn(
              "grid content-start gap-1.5 rounded-xl border bg-card p-2 text-left text-primary outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
              value === v ? "border-primary ring-2 ring-primary/30" : "hover:border-primary/50",
            )}
          >
            <PageLayoutSketch layout={v} className="h-auto w-full" />
            <span className="text-sm font-semibold text-foreground">{t(`site.appearance.opt.pageLayout.${v}`)}</span>
            <span className="text-meta leading-snug text-muted-foreground">{t(`site.appearance.opt.pageLayout.hint.${v}`)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
