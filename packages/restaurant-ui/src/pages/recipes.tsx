"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon, PlusIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { Button, Input, toast } from "@rbms/ui";
import { AiDraftBanner, Page, PageHeading, api, describeError, useI18n } from "@rbms/web";
import type { DishCostRow, RecipeDetail, RecipeDraft } from "../lib/ai";

const rupees = (paise: number | null) => (paise === null ? "—" : `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
const UNITS = ["g", "kg", "ml", "l", "tsp", "tbsp", "cup", "pcs"];
const PRICE_UNITS = ["kg", "g", "l", "ml", "pcs", "dozen"];

interface EditLine {
  name: string;
  qty: string;
  unit: string;
  priceUnit: string;
  price: string;
}

export default function RecipesPage() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["dining", "recipes"], queryFn: () => api.get<{ target: number; items: DishCostRow[] }>("/dining/recipes") });
  const ingredients = useQuery({ queryKey: ["dining", "ingredients"], queryFn: () => api.get<{ items: { id: string; name: string; unit: string; price: number | null }[] }>("/dining/recipes/ingredients") });
  const [open, setOpen] = React.useState<DishCostRow | null>(null);
  const [filter, setFilter] = React.useState("");
  const [summary, setSummary] = React.useState<{ text: string; runId: string | null; credits: number } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [target, setTarget] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (list.data) setTarget(String(list.data.target));
  }, [list.data]);

  const items = (list.data?.items ?? []).filter((x) => !filter || `${x.name} ${x.portion}`.toLowerCase().includes(filter.toLowerCase()));
  const refresh = () => qc.invalidateQueries({ queryKey: ["dining"] });

  const saveTarget = async () => {
    const n = Number(target);
    if (!(n >= 5 && n <= 90)) return;
    await api.put("/settings/kitchen/tenant", { targetFoodCostPct: n });
    await refresh();
    toast.success(t("restaurant.ai.cost.targetSaved"));
  };

  const makeSummary = async () => {
    setBusy(true);
    setError(null);
    try {
      setSummary(await api.post("/ai/restaurant/food-cost-summary", { lang: locale === "ta" ? "ta" : "en" }));
    } catch (e) {
      setError(describeError(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <PageHeading title={t("restaurant.ai.cost.title")} description={t("restaurant.ai.cost.description")} />
      <div className="grid gap-4">
        <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">{t("restaurant.ai.cost.target")}</span>
            <span className="flex items-center gap-2"><Input className="w-20" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value.replace(/[^0-9.]/g, ""))} /> %</span>
          </label>
          <Button variant="outline" onClick={saveTarget}>{t("restaurant.ai.cost.saveTarget")}</Button>
          <Button onClick={makeSummary} disabled={busy}>{busy ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />} {t("restaurant.ai.cost.summary")}</Button>
          <Input className="max-w-xs" placeholder={t("restaurant.ai.cost.search")} value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {summary && (
          <div className="grid gap-2">
            {summary.runId && <AiDraftBanner runId={summary.runId} credits={summary.credits} />}
            <p className="rounded-lg border bg-card p-3 text-sm" data-testid="cost-summary">{summary.text}</p>
          </div>
        )}
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[640px] text-sm" data-testid="cost-table">
            <thead className="text-left text-meta text-muted-foreground">
              <tr>{["dish", "price", "cost", "pct", "recipe"].map((c) => <th key={c} className="p-2">{t(`restaurant.ai.cost.col.${c}`)}</th>)}</tr>
            </thead>
            <tbody>
              {items.map((x) => (
                <tr key={x.itemId} className="cursor-pointer border-t hover:bg-muted/50" onClick={() => setOpen(x)}>
                  <td className="p-2 font-medium">{x.name}{x.portion ? ` – ${x.portion}` : ""}</td>
                  <td className="p-2">{rupees(x.rate)}</td>
                  <td className="p-2">{x.hasRecipe ? rupees(x.cost) : "—"}{x.incomplete && <span className="ml-1 text-amber-700">*</span>}</td>
                  <td className="p-2">{x.foodCostPct === null ? "—" : <span className={x.overTarget ? "rounded bg-red-100 px-1.5 text-red-900" : ""}>{x.foodCostPct}%</span>}</td>
                  <td className="p-2"><Button size="sm" variant="outline" onClick={() => setOpen(x)}>{x.hasRecipe ? t("restaurant.ai.cost.edit") : t("restaurant.ai.cost.add")}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-meta text-muted-foreground">{t("restaurant.ai.cost.footer")}</p>
      </div>
      {open && <Editor dish={open} known={ingredients.data?.items ?? []} onClose={() => setOpen(null)} onSaved={() => { void refresh(); setOpen(null); }} />}
    </Page>
  );
}

function Editor({ dish, known, onClose, onSaved }: { dish: DishCostRow; known: { id: string; name: string; unit: string; price: number | null }[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [lines, setLines] = React.useState<EditLine[]>([]);
  const [source, setSource] = React.useState<"manual" | "ai">("manual");
  const [detail, setDetail] = React.useState<RecipeDetail | null>(null);
  const [draft, setDraft] = React.useState<RecipeDraft | null>(null);
  const [busy, setBusy] = React.useState<"" | "draft" | "save">("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void api.get<RecipeDetail>(`/dining/recipes/${dish.itemId}`).then((d) => {
      setDetail(d);
      setLines((d.recipe?.lines ?? []).map((l) => ({ name: l.name, qty: String(l.qty), unit: l.unit, priceUnit: l.ingredient.unit, price: l.ingredient.price === null ? "" : String(l.ingredient.price / 100) })));
      setSource((d.recipe?.source as "manual" | "ai") ?? "manual");
    });
  }, [dish.itemId]);

  const priceFor = (name: string) => known.find((k) => k.name.toLowerCase() === name.trim().toLowerCase());
  const setLine = (i: number, p: Partial<EditLine>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));

  const aiDraft = async () => {
    setBusy("draft");
    setError(null);
    try {
      const r = await api.post<{ draft: RecipeDraft }>("/ai/restaurant/recipe-draft", { itemId: dish.itemId });
      setDraft(r.draft);
      if (r.draft.ingredients.length) {
        setLines(r.draft.ingredients.map((i) => {
          const k = priceFor(i.name);
          return { name: i.name, qty: String(i.qty), unit: i.unit, priceUnit: k?.unit ?? (["g", "kg"].includes(i.unit) ? "kg" : ["ml", "l", "tsp", "tbsp", "cup"].includes(i.unit) ? "l" : "pcs"), price: k?.price != null ? String(k.price / 100) : "" };
        }));
        setSource("ai");
      }
    } catch (e) {
      setError(describeError(e, t));
    } finally {
      setBusy("");
    }
  };

  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      const valid = lines.filter((l) => l.name.trim() && Number(l.qty) > 0);
      for (const l of valid) {
        if (l.price !== "") await api.put("/dining/recipes/ingredients", { name: l.name.trim(), unit: l.priceUnit, price: Math.round(Number(l.price) * 100) });
      }
      const res = await api.put<RecipeDetail>(`/dining/recipes/${dish.itemId}`, { source, lines: valid.map((l) => ({ name: l.name.trim(), qty: Number(l.qty), unit: l.unit })) });
      setDetail(res);
      toast.success(t("restaurant.ai.cost.saved"));
      onSaved();
    } catch (e) {
      setError(describeError(e, t));
    } finally {
      setBusy("");
    }
  };

  const remove = async () => {
    await api.delete(`/dining/recipes/${dish.itemId}`);
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true" aria-label={dish.name}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-xl bg-background p-4 shadow-xl sm:rounded-xl">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">{dish.name}{dish.portion ? ` – ${dish.portion}` : ""}</h2>
            <p className="text-sm text-muted-foreground">{t("restaurant.ai.cost.sellingPrice", { price: rupees(dish.rate) })}</p>
          </div>
          <Button variant="ghost" onClick={onClose}>{t("restaurant.common.close")}</Button>
        </div>
        {draft && draft.runId && <div className="mt-2"><AiDraftBanner runId={draft.runId} credits={draft.credits} /></div>}
        {draft && !draft.recognised && <p className="mt-2 text-sm text-amber-700">{t("restaurant.ai.cost.notRecognised")}</p>}
        {draft && draft.ingredients.length > 0 && <p className="mt-2 text-sm text-muted-foreground">{t("restaurant.ai.cost.guideOnly")}</p>}
        <div className="mt-3 grid gap-2">
          {lines.map((l, i) => {
            const costed = detail?.cost?.lines[i];
            return (
              <div key={i} className="grid grid-cols-2 items-center gap-2 rounded-md border p-2 sm:grid-cols-[1.5fr_5rem_5rem_5rem_6rem_auto]" data-testid="recipe-line">
                <Input list="ingredient-names" className="col-span-2 sm:col-span-1" value={l.name} placeholder={t("restaurant.ai.cost.ingredient")} onChange={(e) => { const k = priceFor(e.target.value); setLine(i, { name: e.target.value, ...(k ? { priceUnit: k.unit, price: k.price != null ? String(k.price / 100) : l.price } : {}) }); }} />
                <Input inputMode="decimal" value={l.qty} aria-label={t("restaurant.ai.cost.qty")} onChange={(e) => setLine(i, { qty: e.target.value.replace(/[^0-9.]/g, "") })} />
                <select className="h-9 rounded-md border bg-background px-1" value={l.unit} aria-label={t("restaurant.ai.cost.unit")} onChange={(e) => setLine(i, { unit: e.target.value })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select>
                <select className="h-9 rounded-md border bg-background px-1" value={l.priceUnit} aria-label={t("restaurant.ai.cost.priceUnit")} onChange={(e) => setLine(i, { priceUnit: e.target.value })}>{PRICE_UNITS.map((u) => <option key={u} value={u}>{t("restaurant.ai.cost.per", { unit: u })}</option>)}</select>
                <Input inputMode="decimal" value={l.price} placeholder="₹" aria-label={t("restaurant.ai.cost.price")} onChange={(e) => setLine(i, { price: e.target.value.replace(/[^0-9.]/g, "") })} />
                <Button variant="ghost" size="icon" aria-label={t("restaurant.common.remove")} onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}><Trash2Icon /></Button>
                {costed && <span className="col-span-2 text-meta text-muted-foreground sm:col-span-6">{costed.problem ? t(`restaurant.ai.cost.problem.${costed.problem}`) : rupees(costed.cost)}</span>}
              </div>
            );
          })}
          <datalist id="ingredient-names">{known.map((k) => <option key={k.id} value={k.name} />)}</datalist>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setLines((ls) => [...ls, { name: "", qty: "", unit: "g", priceUnit: "kg", price: "" }])}><PlusIcon /> {t("restaurant.ai.cost.addLine")}</Button>
            <Button variant="outline" onClick={aiDraft} disabled={busy === "draft"}>{busy === "draft" ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />} {t("restaurant.ai.cost.draft")}</Button>
          </div>
        </div>
        {detail?.cost && (
          <div className="mt-3 rounded-md bg-muted p-3 text-sm" data-testid="cost-result">
            {t("restaurant.ai.cost.result", { cost: rupees(detail.cost.cost), pct: detail.cost.foodCostPct ?? 0, target: detail.cost.targetPct, margin: rupees(detail.cost.margin) })}
            {detail.cost.incomplete && <div className="text-amber-700">{t("restaurant.ai.cost.incomplete")}</div>}
          </div>
        )}
        {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={save} disabled={busy === "save"}>{busy === "save" && <Loader2Icon className="animate-spin" />} {t("restaurant.ai.cost.saveRecipe")}</Button>
          {dish.hasRecipe && <Button variant="outline" onClick={remove}>{t("restaurant.ai.cost.removeRecipe")}</Button>}
        </div>
      </div>
    </div>
  );
}
