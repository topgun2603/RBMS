"use client";

import * as React from "react";
import { Loader2Icon, PrinterIcon, SparklesIcon } from "lucide-react";
import { Button, Input } from "@rbms/ui";
import { AiDraftBanner, Page, PageHeading, api, describeError, useI18n } from "@rbms/web";
import type { PrepResult } from "../lib/ai";

const isoPlus = (n: number) => new Date(Date.now() + 330 * 60_000 + n * 86_400_000).toISOString().slice(0, 10);

export default function PrepPage() {
  const { t, locale } = useI18n();
  const [day, setDay] = React.useState<"tomorrow" | "today">("tomorrow");
  const [rain, setRain] = React.useState(false);
  const [rainPct, setRainPct] = React.useState("-10");
  const [festPct, setFestPct] = React.useState("0");
  const [lang, setLang] = React.useState<"ta" | "en">(locale === "ta" ? "ta" : "ta");
  const [data, setData] = React.useState<PrepResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      setData(await api.post<PrepResult>("/ai/restaurant/prep", { date: isoPlus(day === "today" ? 0 : 1), rain, rainPct: Number(rainPct) || -10, festivalPct: Number(festPct) || 0, lang, note: true }));
    } catch (e) {
      setError(describeError(e, t));
    } finally {
      setBusy(false);
    }
  };
  const f = data?.forecast;
  return (
    <Page>
      <PageHeading title={t("restaurant.ai.prep.title")} description={t("restaurant.ai.prep.description")} />
      <div className="grid gap-4">
        <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4 print:hidden">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">{t("restaurant.ai.prep.for")}</span>
            <select className="h-9 rounded-md border bg-background px-2" value={day} onChange={(e) => setDay(e.target.value as "today" | "tomorrow")}>
              <option value="tomorrow">{t("restaurant.ai.prep.tomorrow")}</option>
              <option value="today">{t("restaurant.ai.prep.today")}</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={rain} onChange={(e) => setRain(e.target.checked)} /> {t("restaurant.ai.prep.rain")}</label>
          {rain && <label className="flex items-center gap-1 text-sm">{t("restaurant.ai.prep.rainPct")} <Input className="w-20" inputMode="numeric" value={rainPct} onChange={(e) => setRainPct(e.target.value.replace(/[^0-9-]/g, ""))} />%</label>}
          <label className="flex items-center gap-1 text-sm">{t("restaurant.ai.prep.festPct")} <Input className="w-20" inputMode="numeric" value={festPct} onChange={(e) => setFestPct(e.target.value.replace(/\D/g, ""))} />%</label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">{t("restaurant.ai.prep.noteLang")}</span>
            <select className="h-9 rounded-md border bg-background px-2" value={lang} onChange={(e) => setLang(e.target.value as "ta" | "en")}>
              <option value="ta">தமிழ்</option>
              <option value="en">English</option>
            </select>
          </label>
          <Button onClick={make} disabled={busy}>{busy ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />} {t("restaurant.ai.prep.make")}</Button>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {data && f && (
          <div className="grid gap-4" data-testid="prep-result">
            {data.runId && <div className="print:hidden"><AiDraftBanner runId={data.runId} credits={data.credits} /></div>}
            <section className="rounded-lg border bg-card p-4">
              <h2 className="font-semibold">{t("restaurant.ai.prep.kitchenNote")} — {f.forDate}</h2>
              <p className="mt-1 text-base" data-testid="prep-note">{data.note}</p>
              {f.festival && <p className="mt-1 text-sm text-muted-foreground">{t("restaurant.ai.prep.festival", { name: locale === "ta" ? f.festival.nameTa : f.festival.name, factor: f.festivalFactor, source: t(`restaurant.ai.prep.festSource.${f.festivalSource}`) })}</p>}
              {f.rainFactor !== 1 && <p className="text-sm text-muted-foreground">{t("restaurant.ai.prep.rainApplied", { pct: Math.round((f.rainFactor - 1) * 100) })}</p>}
            </section>
            {f.dishes.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("restaurant.ai.prep.empty")}</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border bg-card">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="text-left text-meta text-muted-foreground"><tr>{["dish", "prep", "usual", "lastWeek", "days"].map((c) => <th key={c} className="p-2">{t(`restaurant.ai.prep.col.${c}`)}</th>)}</tr></thead>
                  <tbody>
                    {f.dishes.map((d) => (
                      <tr key={d.itemId} className="border-t">
                        <td className="p-2 font-medium">{d.name}{d.low && <span className="ml-1 text-amber-700">*</span>}</td>
                        <td className="p-2 text-base font-semibold">{d.prep}</td>
                        <td className="p-2">{Math.round(d.base * 10) / 10}</td>
                        <td className="p-2">{d.lastWeek ?? "—"}</td>
                        <td className="p-2">{d.kept}/{d.samples}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.totals.length > 0 && (
              <section className="rounded-lg border bg-card p-4">
                <h2 className="font-semibold">{t("restaurant.ai.prep.ingredients")}</h2>
                <ul className="mt-1 grid gap-0.5 text-sm sm:grid-cols-2">{data.totals.map((x) => <li key={x.ingredient}>{x.ingredient}: <strong>{x.qty} {x.unit}</strong></li>)}</ul>
                {data.withoutRecipe.length > 0 && <p className="mt-2 text-meta text-muted-foreground">{t("restaurant.ai.prep.noRecipe", { count: data.withoutRecipe.length })}</p>}
              </section>
            )}
            <div className="print:hidden">
              <Button variant="outline" onClick={() => window.print()}><PrinterIcon /> {t("restaurant.ai.prep.print")}</Button>
              <p className="mt-2 text-meta text-muted-foreground">{t("restaurant.ai.prep.footer", { weeks: data.weeksChecked })}</p>
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}
