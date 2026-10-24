"use client";

import * as React from "react";
import { AlertTriangleIcon, Loader2Icon } from "lucide-react";
import { useI18n } from "@srirealtime/web";
import { useCheckBill, type CheckResult } from "../lib/ai";

/**
 * Duplicate-salt and interaction warnings for the medicines on a bill (advisory only: the pharmacist decides). Warnings come
 * from code and a short reference table; the AI only explains a found pair in simple words. Never blocks a sale.
 */
export function InteractionPanel({ itemIds, locale }: { itemIds: string[]; locale: "en" | "ta" }) {
  const { t } = useI18n();
  const check = useCheckBill();
  const [result, setResult] = React.useState<CheckResult | null>(null);
  const key = [...new Set(itemIds)].sort().join(",");
  const run = check.mutateAsync;
  React.useEffect(() => {
    const ids = key ? key.split(",") : [];
    if (ids.length < 2) return setResult(null);
    let live = true;
    const h = setTimeout(() => void run({ itemIds: ids, lang: locale, explain: true }).then((r) => live && setResult(r)).catch(() => live && setResult(null)), 400);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [key, locale, run]);

  if (!key.includes(",")) return null;
  const found = result && (result.duplicates.length > 0 || result.interactions.length > 0);
  return (
    <section className="grid gap-2 rounded-lg border bg-card p-4" aria-live="polite" data-testid="interaction-panel">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        {check.isPending ? <Loader2Icon className="size-4 animate-spin" /> : <AlertTriangleIcon className="size-4" />} {t("pharmacy.ai.check.title")}
      </h2>
      {result && !found && <p className="text-sm text-muted-foreground">{t("pharmacy.ai.check.none")}</p>}
      {result?.duplicates.map((d) => (
        <p key={d.ingredient} className="rounded-md bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <strong>{t("pharmacy.ai.check.duplicate")}:</strong> {d.ingredient} — {d.items.map((i) => i.name).join(" + ")}
        </p>
      ))}
      {result?.interactions.map((p) => (
        <div key={`${p.id}${p.a.id}${p.b.id}`} className={`rounded-md p-2 text-sm ${p.severity === "major" ? "bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100" : "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100"}`}>
          <strong>{t(`pharmacy.ai.check.${p.severity}`)}:</strong> {p.a.name} + {p.b.name}
          <div>{p.text}</div>
        </div>
      ))}
      {result && result.unchecked.length > 0 && <p className="text-meta text-muted-foreground">{t("pharmacy.ai.check.unchecked", { names: result.unchecked.map((u) => u.name).join(", ") })}</p>}
      <p className="text-meta text-muted-foreground">{result ? result.advisory[locale] : t("pharmacy.ai.check.advisory")}</p>
    </section>
  );
}
