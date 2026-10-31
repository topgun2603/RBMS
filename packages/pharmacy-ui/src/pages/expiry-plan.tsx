"use client";

import * as React from "react";
import { Loader2Icon, PrinterIcon, SparklesIcon } from "lucide-react";
import { Button, Input } from "@rbms/ui";
import { AiDraftBanner, Page, PageHeading, describeError, useI18n } from "@rbms/web";
import { usePlan, type PlanAction, type PlanResult } from "../lib/ai";

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const TONE: Record<PlanAction, string> = {
  write_off: "bg-red-100 text-red-900",
  return: "bg-blue-100 text-blue-900",
  discount: "bg-amber-100 text-amber-900",
  move_front: "bg-sky-100 text-sky-900",
  sell_first: "bg-emerald-100 text-emerald-900",
};

export default function ExpiryPlanPage() {
  const { t, locale } = useI18n();
  const plan = usePlan();
  const [within, setWithin] = React.useState("90");
  const [returnDays, setReturnDays] = React.useState("");
  const [data, setData] = React.useState<PlanResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const lang = locale === "ta" ? "ta" : "en";

  const make = async () => {
    setError(null);
    try {
      setData(await plan.mutateAsync({ within: Math.min(365, Math.max(7, Number(within) || 90)), returnMinDays: returnDays === "" ? null : Number(returnDays), lang, explain: true }));
    } catch (e) {
      setError(describeError(e, t));
    }
  };

  return (
    <Page>
      <PageHeading title={t("pharmacy.ai.plan.title")} description={t("pharmacy.ai.plan.description")} />
      <div className="grid gap-4">
        <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4 print:hidden">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">{t("pharmacy.ai.plan.within")}</span>
            <Input className="w-28" inputMode="numeric" value={within} onChange={(e) => setWithin(e.target.value.replace(/\D/g, ""))} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">{t("pharmacy.ai.plan.returnDays")}</span>
            <Input className="w-28" inputMode="numeric" value={returnDays} placeholder={t("pharmacy.ai.plan.unknown")} onChange={(e) => setReturnDays(e.target.value.replace(/\D/g, ""))} />
          </label>
          <Button onClick={make} disabled={plan.isPending}>
            {plan.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />} {t("pharmacy.ai.plan.make")}
          </Button>
          <span className="text-meta text-muted-foreground">{t("pharmacy.ai.plan.credits")}</span>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {data && (
          <>
            {data.runId && <AiDraftBanner runId={data.runId} credits={data.credits} />}
            {data.aiNote && <p className="text-sm text-muted-foreground">{t("pharmacy.ai.plan.noAi")}</p>}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {([["batches", String(data.totals.batches)], ["units", String(data.totals.qty)], ["value", rupees(data.totals.value)], ["atRisk", rupees(data.totals.atRiskValue)]] as const).map(([k, v]) => (
                <div key={k} className="rounded-lg border bg-card p-3">
                  <div className="text-meta text-muted-foreground">{t(`pharmacy.ai.plan.t.${k}`)}</div>
                  <div className="text-lg font-semibold">{v}</div>
                </div>
              ))}
            </div>
            {data.groups.length === 0 && <p className="text-sm text-muted-foreground">{t("pharmacy.ai.plan.empty")}</p>}
            {data.groups.map((g) => (
              <section key={g.action} className="rounded-lg border bg-card p-4" data-testid={`plan-group-${g.action}`}>
                <h2 className="flex flex-wrap items-center gap-2 font-semibold">
                  <span className={`rounded px-2 py-0.5 text-sm ${TONE[g.action]}`}>{t(`pharmacy.ai.plan.action.${g.action}`)}</span>
                  <span className="text-sm font-normal text-muted-foreground">{g.batches} · {rupees(g.value)}</span>
                </h2>
                <p className="mt-1 text-sm">{g.reason}</p>
              </section>
            ))}
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="text-left text-meta text-muted-foreground">
                  <tr>{["item", "batch", "expiry", "qty", "value", "perDay", "daysOfStock", "action"].map((c) => <th key={c} className="p-2">{t(`pharmacy.ai.plan.col.${c}`)}</th>)}</tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.batchId} className="border-t">
                      <td className="p-2 font-medium">{r.itemName}</td>
                      <td className="p-2">{r.batchNo}</td>
                      <td className="p-2">{r.expiry} <span className="text-muted-foreground">({r.expired ? t("pharmacy.ai.plan.expired") : t("pharmacy.ai.plan.daysLeft", { days: r.daysLeft })})</span></td>
                      <td className="p-2">{r.qty}</td>
                      <td className="p-2">{rupees(r.value)}</td>
                      <td className="p-2">{r.dailyRate}</td>
                      <td className="p-2">{r.daysOfStock ?? "—"}</td>
                      <td className="p-2"><span className={`rounded px-1.5 py-0.5 ${TONE[r.action]}`}>{t(`pharmacy.ai.plan.action.${r.action}`)}</span>{r.suggestDiscountPct ? <span className="ml-1 text-muted-foreground">{t("pharmacy.ai.plan.discountUpTo", { pct: r.suggestDiscountPct, max: r.maxDiscountPct ?? r.suggestDiscountPct })}</span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.returnList.length > 0 && (
              <section className="rounded-lg border bg-card p-4" data-testid="return-list">
                <div className="flex items-center justify-between print:hidden">
                  <h2 className="font-semibold">{t("pharmacy.ai.plan.returnList")}</h2>
                  <Button variant="outline" onClick={() => window.print()}><PrinterIcon /> {t("pharmacy.ai.plan.print")}</Button>
                </div>
                <h2 className="hidden font-semibold print:block">{t("pharmacy.ai.plan.returnList")} — {data.today}</h2>
                <p className="text-meta text-muted-foreground print:hidden">{t("pharmacy.ai.plan.returnHint")}</p>
                {data.returnList.map((s) => (
                  <div key={s.supplier} className="mt-3">
                    <div className="font-medium">{s.supplier || t("pharmacy.ai.plan.noSupplier")} · {rupees(s.value)}</div>
                    <ul className="text-sm">{s.rows.map((r) => <li key={r.batchId}>{r.itemName} · {t("pharmacy.ai.plan.col.batch")} {r.batchNo} · {r.expiry} · {r.atRiskQty}</li>)}</ul>
                  </div>
                ))}
              </section>
            )}
            <p className="text-meta text-muted-foreground print:hidden">{t("pharmacy.ai.plan.footer")}</p>
          </>
        )}
      </div>
    </Page>
  );
}
