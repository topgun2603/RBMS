"use client";

import * as React from "react";
import { cn } from "@srirealtime/ui/lib/utils";
import { useStore } from "./store-context";

export type ShoeFit = "men" | "women" | "kids";

type Row = [uk: string, eu: string, us: string, footCm: string];

/**
 * Shoe sizes by foot length. UK and Indian (IND) sizes are the same scale (Indian shops label them "UK/IND"). Foot
 * length follows the UK size step (one size = ⅓ inch ≈ 0.85 cm; UK 7 ≈ 25.4 cm); EU from the Paris point; US is UK + 1
 * for men and children and UK + 2 for women. Approximate, as every last differs a little.
 */
const SHOE_CHARTS: Record<ShoeFit, Row[]> = {
  men: [
    ["5", "38", "6", "23.7"],
    ["6", "39", "7", "24.6"],
    ["7", "40.5", "8", "25.4"],
    ["8", "42", "9", "26.2"],
    ["9", "43", "10", "27.1"],
    ["10", "44.5", "11", "27.9"],
    ["11", "46", "12", "28.8"],
    ["12", "47", "13", "29.6"],
  ],
  women: [
    ["3", "35.5", "5", "22.0"],
    ["4", "37", "6", "22.9"],
    ["5", "38", "7", "23.7"],
    ["6", "39", "8", "24.6"],
    ["7", "40.5", "9", "25.4"],
    ["8", "42", "10", "26.2"],
    ["9", "43", "11", "27.1"],
  ],
  kids: [
    ["8C", "25", "9C", "15.2"],
    ["9C", "27", "10C", "16.1"],
    ["10C", "28", "11C", "16.9"],
    ["11C", "29", "12C", "17.8"],
    ["12C", "30", "13C", "18.6"],
    ["13C", "32", "1Y", "19.5"],
    ["1", "33", "2Y", "20.3"],
    ["2", "34", "3Y", "21.2"],
    ["3", "35.5", "4Y", "22.0"],
  ],
};

const FITS: ShoeFit[] = ["men", "women", "kids"];
const COLS = ["uk", "ind", "eu", "us", "foot"] as const;

/** The footwear size chart: Men / Women / Kids tabs over UK · IND · EU · US · foot length (cm), with how to measure. */
export function ShoeSizeChart({ initial = "men", guideHref }: { initial?: ShoeFit; guideHref?: string }) {
  const { t } = useStore();
  const [fit, setFit] = React.useState<ShoeFit>(initial);
  const id = React.useId();
  const rows = SHOE_CHARTS[fit];
  return (
    <div className="grid min-w-0 gap-4 text-sm" data-testid="shoe-size-chart">
      <p className="text-muted-foreground">{t("size.shoe.note")}</p>
      <div role="tablist" aria-label={t("size.title")} className="grid w-full grid-cols-3 gap-1 rounded-full border bg-card p-1 sm:w-max">
        {FITS.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            id={`${id}-${f}`}
            aria-selected={f === fit}
            aria-controls={`${id}-panel`}
            onClick={() => setFit(f)}
            className={cn(
              "h-9 min-w-0 rounded-full px-1 text-xs font-semibold whitespace-nowrap transition-colors focus-ring sm:px-4 sm:text-sm",
              f === fit ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`size.shoe.${f}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${fit}`} className="overflow-x-auto rounded-2xl border">
        <table className="w-full text-center tabular-nums">
          <thead className="bg-tint-2 text-xs font-semibold tracking-wide uppercase">
            <tr>
              {COLS.map((c) => (
                <th key={c} scope="col" className="px-2 py-2.5 sm:px-3">
                  {t(`size.col.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([uk, eu, us, cm]) => (
              <tr key={uk} className="border-t odd:bg-muted/30">
                <th scope="row" className="px-2 py-2 font-semibold sm:px-3">
                  {uk}
                </th>
                <td className="px-2 py-2 sm:px-3">{uk}</td>
                <td className="px-2 py-2 sm:px-3">{eu}</td>
                <td className="px-2 py-2 sm:px-3">{us}</td>
                <td className="px-2 py-2 font-semibold sm:px-3">{cm}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="grid gap-1.5 text-muted-foreground">
        {fit === "kids" && <li>{t("size.shoe.kidsNote")}</li>}
        <li>
          <span className="font-semibold text-foreground">{t("size.col.foot")}:</span> {t("size.shoe.howFoot")}
        </li>
        <li>{t("size.shoe.room")}</li>
      </ul>
      {guideHref && (
        <a href={guideHref} className="text-sm font-semibold text-primary underline-offset-4 hover:underline focus-ring">
          {t("size.fullGuide")} →
        </a>
      )}
    </div>
  );
}
