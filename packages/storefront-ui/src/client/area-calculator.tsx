"use client";

import * as React from "react";
import { Button } from "@rbms/ui/components/button";
import { areaOfBoxes, boxesForArea, parseCoverage } from "@rbms/gst";
import { useStore } from "./store-context";

/** The product attribute that holds the box coverage ("Coverage per box (sq ft)": 15.5). Tiles, flooring, panels. */
const COVERAGE_KEY = /coverage|கவரேஜ்/i;

/**
 * Box coverage in sq ft from a product's attributes, or null when it isn't sold by the box. The attribute's name says
 * the unit ("Coverage per box (sq m)") when its value is a bare number.
 */
export function coverageOf(attributes: Record<string, unknown> | null | undefined): number | null {
  for (const [k, v] of Object.entries(attributes ?? {})) {
    if (!COVERAGE_KEY.test(k) || (typeof v !== "string" && typeof v !== "number")) continue;
    const unit = /sq\.?\s?m\b|sqm|m2|m²|சதுர மீ/i.test(k) ? "sqm" : "sqft";
    const text = String(v);
    const c = /[a-z]/i.test(text) ? parseCoverage(text, "sqft") : parseCoverage(`${text} ${unit}`, "sqft");
    if (c) return c;
  }
  return null;
}

/**
 * "How many boxes do I need?": the shopper types the room's area (sq ft or sq m) and a wastage allowance, and gets
 * whole boxes to put in the cart. The cart still holds boxes; this only works out the quantity.
 */
export function AreaCalculator({ coverage, max = 99, onUse }: { coverage: number; max?: number; onUse: (boxes: number) => void }) {
  const { t } = useStore();
  const [area, setArea] = React.useState("");
  const [unit, setUnit] = React.useState<"sqft" | "sqm">("sqft");
  const [wastage, setWastage] = React.useState("10");
  const n = Number(area);
  const w = Number(wastage);
  const result = n > 0 && w >= 0 && w <= 100 ? boxesForArea({ area: n, areaUnit: unit, coverage, coverageUnit: "sqft", wastagePct: w }) : null;
  return (
    <div className="grid gap-3 rounded-lg border p-3" data-testid="area-calculator">
      <p className="text-sm font-semibold">{t("area.title")}</p>
      <p className="text-xs text-muted-foreground">{t("area.coverage", { sqft: coverage, sqm: areaOfBoxes(1, coverage, "sqft", "sqm") })}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs">
          {t("area.room")}
          <input className="h-9 w-28 rounded-md border bg-background px-2 text-sm" inputMode="decimal" value={area} onChange={(e) => setArea(e.target.value)} />
        </label>
        <label className="grid gap-1 text-xs">
          {t("area.unit")}
          <select className="h-9 rounded-md border bg-background px-2 text-sm" value={unit} onChange={(e) => setUnit(e.target.value as "sqft" | "sqm")}>
            <option value="sqft">{t("area.sqft")}</option>
            <option value="sqm">{t("area.sqm")}</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs">
          {t("area.wastage")}
          <input className="h-9 w-20 rounded-md border bg-background px-2 text-sm" inputMode="decimal" value={wastage} onChange={(e) => setWastage(e.target.value)} />
        </label>
      </div>
      {result && (
        <div className="flex flex-wrap items-center gap-3" role="status">
          <p className="text-sm">{t("area.result", { boxes: result.boxes, covered: result.covered, unit: t(`area.${unit}`) })}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => onUse(Math.min(max, result.boxes))}>
            {t("area.use", { boxes: Math.min(max, result.boxes) })}
          </Button>
        </div>
      )}
    </div>
  );
}
