"use client";

import { ToggleGroup, ToggleGroupItem } from "@srirealtime/ui/components/toggle-group";
import { motion } from "@srirealtime/ui/motion";
import { cn } from "@srirealtime/ui/lib/utils";
import type { Interval } from "@/lib/plans";
import { useSite } from "./site-context";

/** Monthly / yearly segmented switch with a sliding pill and the yearly saving. */
export function IntervalToggle({ value, onChange, savePct, id = "iv" }: { value: Interval; onChange: (v: Interval) => void; savePct: number; id?: string }) {
  const { t } = useSite();
  const items: { v: Interval; label: string }[] = [
    { v: "monthly", label: t("pricing.monthly") },
    { v: "yearly", label: t("pricing.yearly") },
  ];
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as Interval)}
      className="rounded-full border bg-card p-1 shadow-sm"
      aria-label={`${t("pricing.monthly")} / ${t("pricing.yearly")}`}
      data-testid="interval-toggle"
    >
      {items.map((it) => (
        <ToggleGroupItem
          key={it.v}
          value={it.v}
          size="default"
          data-testid={`interval-${it.v}`}
          className={cn("relative rounded-full px-4 hover:bg-transparent data-[state=on]:bg-transparent", value === it.v ? "text-primary-foreground hover:text-primary-foreground data-[state=on]:text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {value === it.v && <motion.span layoutId={`interval-pill-${id}`} className="absolute inset-0 rounded-full bg-primary shadow-sm" transition={{ type: "spring", stiffness: 480, damping: 34 }} />}
          <span className="relative flex items-center gap-2">
            {it.label}
            {it.v === "yearly" && savePct > 0 && (
              <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-bold", value === "yearly" ? "bg-white/20" : "bg-success/15 text-success")}>{t("pricing.save", { pct: savePct })}</span>
            )}
          </span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
