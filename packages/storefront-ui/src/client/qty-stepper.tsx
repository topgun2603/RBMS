"use client";

import { MinusIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { cn } from "@srirealtime/ui/lib/utils";
import { AnimatePresence, motion, RollingNumber } from "@srirealtime/ui/motion";
import { useStore } from "./store-context";

export function QtyStepper({
  value,
  min = 1,
  max = 99,
  onChange,
  disabled,
  size = "md",
  removable,
  className,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  /** At min, the minus button becomes a trash button that sends 0. */
  removable?: boolean;
  className?: string;
}) {
  const { t } = useStore();
  const btn = cn("flex items-center justify-center rounded-full text-foreground/80 transition-[background-color,transform] hover:bg-accent focus-ring active:scale-90 disabled:opacity-40 motion-reduce:active:scale-100", size === "sm" ? "size-8" : "size-10");
  const atMin = value <= min;
  return (
    <div className={cn("inline-flex items-center rounded-full border bg-card shadow-xs", className)} role="group" aria-label={t("product.qty")}>
      <button
        type="button"
        className={btn}
        disabled={disabled || (atMin && !removable)}
        onClick={() => onChange(atMin && removable ? 0 : value - 1)}
        aria-label={atMin && removable ? t("cart.remove") : t("product.decrease")}
      >
        <AnimatePresence initial={false} mode="wait">
          <motion.span key={atMin && removable ? "trash" : "minus"} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={{ duration: 0.12 }} className="flex">
            {atMin && removable ? <Trash2Icon className="size-4 text-danger-ink" /> : <MinusIcon className="size-4" />}
          </motion.span>
        </AnimatePresence>
      </button>
      <span className={cn("text-center font-semibold tabular-nums", size === "sm" ? "w-7 text-sm" : "w-9")} aria-live="polite">
        <RollingNumber value={value} />
      </span>
      <button type="button" className={btn} disabled={disabled || value >= max} onClick={() => onChange(value + 1)} aria-label={t("product.increase")}>
        <PlusIcon className="size-4" />
      </button>
    </div>
  );
}
