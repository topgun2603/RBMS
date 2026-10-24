"use client";

import * as React from "react";
import { ImageUpIcon, Loader2Icon } from "lucide-react";
import { Button, Input, toast } from "@srirealtime/ui";
import { AiDraftBanner, Page, PageHeading, describeError, useI18n } from "@srirealtime/web";
import { MAX_PAGES, MENU_SCAN_CREDITS, ScanFileError, createMenu, prepareScan, scanErrorKind, useScanMenu, type DraftDish, type MenuDraft } from "../lib/ai";

interface Row {
  dish: DraftDish;
  on: boolean;
  name: string;
  category: string;
  mark: "veg" | "egg" | "nonveg" | "unknown";
  portions: { label: string; price: string }[];
}

const toRows = (d: MenuDraft): Row[] =>
  d.dishes.map((dish) => ({ dish, on: dish.select, name: dish.name, category: dish.category ?? "", mark: dish.mark, portions: dish.portions.map((p) => ({ label: p.label, price: p.price === null ? "" : String(p.price / 100) })) }));

export default function MenuImportPage() {
  const { t } = useI18n();
  const scan = useScanMenu();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [draft, setDraft] = React.useState<MenuDraft | null>(null);
  const [run, setRun] = React.useState<{ runId: string; credits: number; mock: boolean } | null>(null);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<{ created: number; duplicate: number; failed: number } | null>(null);

  const onFiles = async (files: File[]) => {
    setError(null);
    setDone(null);
    try {
      const r = await scan.mutateAsync(await prepareScan(files));
      setDraft(r.draft);
      setRun({ runId: r.runId, credits: r.credits, mock: r.provider === "mock" });
      setRows(toRows(r.draft));
    } catch (e) {
      if (e instanceof ScanFileError) setError(t(`restaurant.ai.file.${e.kind}`, { max: MAX_PAGES }));
      else {
        const kind = scanErrorKind(e);
        setError(kind === "other" ? describeError(e, t) : t(`restaurant.ai.err.${kind}`));
      }
    }
  };

  const patch = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const ready = rows.filter((r) => r.on && r.name.trim() && r.portions.length > 0 && r.portions.every((p) => Number(p.price) >= 1));

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await createMenu(
        ready.map((r) => ({
          name: r.name.trim(),
          nameTa: r.dish.nameTa,
          category: r.category.trim() || null,
          description: r.dish.description,
          veg: r.mark === "veg" ? true : r.mark === "unknown" ? null : false,
          egg: r.mark === "egg",
          portions: r.portions.map((p) => ({ label: p.label.trim(), price: Math.round(Number(p.price) * 100) })),
        })),
      );
      const failed = res.results.filter((x) => x.status === "failed").length;
      setDone({ created: res.created, duplicate: res.results.filter((x) => x.status === "duplicate").length, failed });
      const made = new Set(res.results.filter((x) => x.status === "created").map((x) => x.name));
      setRows((rs) => rs.filter((r) => !made.has(r.name.trim())));
      toast.success(t("restaurant.ai.menu.created", { count: res.created }));
    } catch (e) {
      setError(describeError(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <PageHeading title={t("restaurant.ai.menu.title")} description={t("restaurant.ai.menu.description")} />
      <div className="grid gap-4">
        <div className="grid gap-3 rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-center gap-3">
            <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple className="hidden" data-testid="menu-file" onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) void onFiles(f); }} />
            <Button onClick={() => fileRef.current?.click()} disabled={scan.isPending}>
              {scan.isPending ? <Loader2Icon className="animate-spin" /> : <ImageUpIcon />} {t("restaurant.ai.menu.choose")}
            </Button>
            <span className="text-meta text-muted-foreground">{t("restaurant.ai.menu.credits", { credits: MENU_SCAN_CREDITS, max: MAX_PAGES })}</span>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>

        {draft && run && (
          <>
            <AiDraftBanner runId={run.runId} credits={run.credits} mock={run.mock} />
            <p className="text-sm text-muted-foreground">{t("restaurant.ai.menu.defaults", { hsn: draft.defaults.hsn, gst: draft.defaults.gstRate, source: t(`restaurant.ai.menu.source.${draft.defaults.source}`) })}</p>
            {draft.flags.length > 0 && (
              <ul className="grid gap-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                {draft.flags.map((f, i) => <li key={i}>{t(`restaurant.ai.flag.${f.code}`, f.params ?? {})}</li>)}
              </ul>
            )}
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full min-w-[760px] text-sm" data-testid="menu-table">
                <thead className="text-left text-meta text-muted-foreground">
                  <tr><th className="p-2">{t("restaurant.ai.menu.col.add")}</th><th className="p-2">{t("restaurant.ai.menu.col.dish")}</th><th className="p-2">{t("restaurant.ai.menu.col.category")}</th><th className="p-2">{t("restaurant.ai.menu.col.mark")}</th><th className="p-2">{t("restaurant.ai.menu.col.portions")}</th></tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.dish.n} className="border-t align-top">
                      <td className="p-2"><input type="checkbox" className="size-4" checked={r.on} aria-label={t("restaurant.ai.menu.col.add")} onChange={(e) => patch(i, { on: e.target.checked })} /></td>
                      <td className="p-2">
                        <Input value={r.name} onChange={(e) => patch(i, { name: e.target.value })} aria-label={t("restaurant.ai.menu.col.dish")} />
                        {r.dish.nameTa && <div className="mt-1 text-meta text-muted-foreground">{r.dish.nameTa}</div>}
                        {r.dish.duplicateOf && <div className="mt-1 text-meta text-amber-700">{t("restaurant.ai.menu.duplicate", { name: r.dish.duplicateOf.name })}</div>}
                        {r.dish.why === "price_missing" && <div className="mt-1 text-meta text-amber-700">{t("restaurant.ai.menu.priceMissing")}</div>}
                        {r.dish.confidence === "low" && <div className="mt-1 text-meta text-amber-700">{t("restaurant.ai.menu.lowConf")}</div>}
                      </td>
                      <td className="p-2"><Input value={r.category} onChange={(e) => patch(i, { category: e.target.value })} aria-label={t("restaurant.ai.menu.col.category")} />{r.dish.newCategory && r.category && <div className="mt-1 text-meta text-muted-foreground">{t("restaurant.ai.menu.newCategory")}</div>}</td>
                      <td className="p-2">
                        <select className="h-9 rounded-md border bg-background px-2" value={r.mark} aria-label={t("restaurant.ai.menu.col.mark")} onChange={(e) => patch(i, { mark: e.target.value as Row["mark"] })}>
                          {(["veg", "egg", "nonveg", "unknown"] as const).map((m) => <option key={m} value={m}>{t(`restaurant.ai.menu.mark.${m}`)}</option>)}
                        </select>
                      </td>
                      <td className="p-2">
                        <div className="grid gap-1">
                          {r.portions.map((p, k) => (
                            <div key={k} className="flex items-center gap-1">
                              {r.portions.length > 1 && <Input className="w-24" value={p.label} aria-label={t("restaurant.ai.menu.portion")} onChange={(e) => patch(i, { portions: r.portions.map((x, j) => (j === k ? { ...x, label: e.target.value } : x)) })} />}
                              <span>₹</span>
                              <Input className="w-24" inputMode="decimal" value={p.price} aria-label={t("restaurant.ai.menu.price")} onChange={(e) => patch(i, { portions: r.portions.map((x, j) => (j === k ? { ...x, price: e.target.value.replace(/[^0-9.]/g, "") } : x)) })} />
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={create} disabled={busy || ready.length === 0}>{busy && <Loader2Icon className="animate-spin" />} {t("restaurant.ai.menu.create", { count: ready.length })}</Button>
              <span className="text-meta text-muted-foreground">{t("restaurant.ai.menu.pricesNote")}</span>
            </div>
          </>
        )}
        {done && <p role="status" className="text-sm" data-testid="menu-result">{t("restaurant.ai.menu.result", done)}</p>}
      </div>
    </Page>
  );
}
