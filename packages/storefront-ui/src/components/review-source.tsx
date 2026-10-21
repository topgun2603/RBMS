import { BadgeCheckIcon, ExternalLinkIcon, GlobeIcon, MailIcon, StoreIcon } from "lucide-react";
import { cn } from "@srirealtime/ui/lib/utils";
import type { Translator } from "../lib/messages";
import type { Review } from "../types";

/**
 * Where a review came from, said plainly: "Shared in store", "From Google", "Sent on the shop's request". Nothing
 * for reviews shoppers wrote on this store. Imported reviews link to the original when the shop gave its address.
 */
export function ReviewSource({ review: r, t, className }: { review: Pick<Review, "source" | "sourcePlatform" | "sourceUrl">; t: Translator; className?: string }) {
  const source = r.source ?? "customer";
  if (source === "customer") return null;
  const platform = t(`reviews.platform.${r.sourcePlatform ?? "other"}`);
  const Icon = source === "in_store" ? StoreIcon : source === "invited" ? MailIcon : GlobeIcon;
  const label = source === "imported" ? t("reviews.source.imported", { platform }) : t(`reviews.source.${source}`);
  const hint = source === "imported" ? t("reviews.source.importedHint", { platform }) : t(`reviews.source.${source}Hint`);
  const cls = cn("inline-flex items-center gap-1 text-muted-foreground", className);
  if (source === "imported" && r.sourceUrl && /^https?:\/\//i.test(r.sourceUrl)) {
    return (
      <a href={r.sourceUrl} target="_blank" rel="nofollow noopener noreferrer" title={hint} className={cn(cls, "underline-offset-2 hover:underline focus-ring")}>
        <Icon className="size-3.5" aria-hidden />
        {label}
        <ExternalLinkIcon className="size-3" aria-hidden />
      </a>
    );
  }
  return (
    <span title={hint} className={cls}>
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}

/** "Verified buyer": only for reviews tied to a delivered order of the product. */
export function VerifiedBadge({ t, label, className }: { t: Translator; label?: string; className?: string }) {
  return (
    <span title={t("reviews.verifiedHint")} className={cn("inline-flex items-center gap-1 text-success-ink", className)}>
      <BadgeCheckIcon className="size-3.5" aria-hidden />
      {label ?? t("reviews.verified")}
    </span>
  );
}
