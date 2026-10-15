"use client";

import { StarIcon } from "lucide-react";
import { cn } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";

/** Read-only 1–5 star rating (the number is also given as text for screen readers). */
export function Stars({ rating, className, size = "size-4" }: { rating: number; className?: string; size?: string }) {
  const { t } = useI18n();
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} role="img" aria-label={t("site.reviews.ratingOf", { n: rating })}>
      {[1, 2, 3, 4, 5].map((i) => (
        <StarIcon key={i} className={cn(size, i <= rating ? "fill-warning text-warning" : "fill-muted text-muted-foreground/40")} aria-hidden />
      ))}
    </span>
  );
}
