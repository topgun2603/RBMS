"use client";

import * as React from "react";
import { Loader2Icon, HammerIcon, XIcon } from "lucide-react";
import { Alert, AlertDescription, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, Textarea } from "@rbms/ui";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { AiDraftBanner } from "../ai-draft";
import { MicButton, postTrades, rupeesText, useTradesError, useTradesHelper, type Run } from "./shared";

interface Line {
  itemId: string;
  name: string;
  qty: number;
  unit: string;
  rate: number;
  gstRate: number;
  hsn: string | null;
  amount: number;
  why: string;
  stockQty: number | null;
}
interface Result extends Run {
  draft: { lines: Line[]; notInCatalogue: { need: string; qty: string }[]; assumptions: string[]; subtotal: number; total: number; dropped: number; suspicious: boolean };
  disclaimer: string;
}

export const QUOTE_CREDITS = "40 - 80";

/**
 * "Build from a description" on the quotations list: describe the job, get material lines from the shop's own catalogue (rough
 * quantities, prices from the items, what is not stocked listed apart). Creating saves a DRAFT quotation through the normal
 * quotation route; the owner opens it, edits and sends it as usual.
 */
export function HardwareQuoteButton({ onCreated, className }: { onCreated: (quotation: { id: string; number: string }) => void; className?: string }) {
  const { t, locale } = useI18n();
  const { show } = useTradesHelper("hardware-quote", "quotations.manage");
  const errText = useTradesError();
  const [open, setOpen] = React.useState(false);
  const [desc, setDesc] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [res, setRes] = React.useState<Result | null>(null);
  const [lines, setLines] = React.useState<Line[]>([]);
  const [customer, setCustomer] = React.useState("");
  if (!show) return null;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await postTrades<Result>("quote-draft", { description: desc.trim(), language: locale === "ta" ? "ta" : "en" });
      setRes(r);
      setLines(r.draft.lines);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const setQty = (id: string, v: string) => {
    const q = Number(v);
    setLines((p) => p.map((l) => (l.itemId === id ? { ...l, qty: Number.isFinite(q) && q >= 0 ? q : l.qty, amount: Math.round((Number.isFinite(q) && q >= 0 ? q : l.qty) * l.rate) } : l)));
  };
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const total = lines.reduce((s, l) => s + Math.round(l.amount * (1 + l.gstRate / 100)), 0);

  const create = async () => {
    if (!res) return;
    setSaving(true);
    setError(null);
    try {
      const notes = [t("web.aiTrades.quote.notesHead"), ...res.draft.assumptions.map((a) => `- ${a}`), res.draft.notInCatalogue.length ? `${t("web.aiTrades.quote.notStocked")}: ${res.draft.notInCatalogue.map((n) => n.need).join(", ")}` : ""]
        .filter(Boolean)
        .join("\n")
        .slice(0, 1900);
      const q = await api.post<{ id: string; number: string }>("/quotations", {
        customer: { name: customer.trim() },
        lines: lines.filter((l) => l.qty > 0).map((l) => ({ description: l.name, qty: l.qty, unit: l.unit, rate: l.rate, gstRate: l.gstRate, hsn: l.hsn ?? undefined, itemId: l.itemId })),
        notes,
      });
      setOpen(false);
      onCreated(q);
    } catch (e) {
      setError(errText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button type="button" variant="outline" className={className} onClick={() => setOpen(true)}>
        <HammerIcon /> {t("web.aiTrades.quote.button")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && !saving && setOpen(o)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("web.aiTrades.quote.title")}</DialogTitle>
            <DialogDescription>{t("web.aiTrades.quote.intro")}</DialogDescription>
          </DialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="hq-desc">{t("web.aiTrades.quote.describe")}</Label>
              <MicButton onText={(s) => setDesc((p) => `${p} ${s}`.trim())} />
            </div>
            <Textarea id="hq-desc" rows={3} maxLength={800} value={desc} placeholder={t("web.aiTrades.quote.example")} onChange={(e) => setDesc(e.target.value)} />
            <p className="text-meta text-muted-foreground">{t("web.aiTrades.quote.credits", { range: QUOTE_CREDITS })}</p>
          </div>
          {res && (
            <div className="grid gap-4">
              <AiDraftBanner runId={res.runId} credits={res.credits} mock={res.provider === "mock"} />
              {res.draft.suspicious && <p className="text-sm text-amber-700 dark:text-amber-400">{t("web.aiTrades.injection")}</p>}
              <Alert>
                <AlertDescription>{res.disclaimer}</AlertDescription>
              </Alert>
              {res.draft.assumptions.length > 0 && (
                <section className="grid gap-1">
                  <h3 className="text-sm font-semibold">{t("web.aiTrades.quote.assumptions")}</h3>
                  <ul className="list-disc space-y-0.5 pl-5 text-sm">
                    {res.draft.assumptions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </section>
              )}
              <section className="grid gap-2">
                <h3 className="text-sm font-semibold">{t("web.aiTrades.quote.lines")}</h3>
                {lines.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("web.aiTrades.quote.noLines")}</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full min-w-[34rem] text-sm">
                      <thead className="bg-muted/50 text-left text-meta text-muted-foreground">
                        <tr>
                          <th className="p-2 font-medium">{t("web.aiTrades.quote.item")}</th>
                          <th className="p-2 font-medium">{t("web.aiTrades.quote.qty")}</th>
                          <th className="p-2 text-right font-medium">{t("web.aiTrades.quote.rate")}</th>
                          <th className="p-2 text-right font-medium">{t("web.aiTrades.quote.amount")}</th>
                          <th className="w-8 p-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((l) => (
                          <tr key={`${res.runId}-${l.itemId}`} className="border-t align-top">
                            <td className="p-2">
                              <div className="font-medium">{l.name}</div>
                              {l.why && <div className="text-meta text-muted-foreground">{l.why}</div>}
                              {l.stockQty !== null && l.stockQty <= 0 && <div className="text-meta text-destructive">{t("web.aiTrades.quote.outOfStock")}</div>}
                            </td>
                            <td className="p-2">
                              <div className="flex items-center gap-1">
                                <Input aria-label={`${t("web.aiTrades.quote.qty")} ${l.name}`} className="h-8 w-20 tabular-nums" inputMode="decimal" defaultValue={String(l.qty)} onChange={(e) => setQty(l.itemId, e.target.value)} />
                                <span className="text-meta text-muted-foreground">{l.unit}</span>
                              </div>
                            </td>
                            <td className="p-2 text-right tabular-nums">{rupeesText(l.rate)}</td>
                            <td className="p-2 text-right tabular-nums">{rupeesText(l.amount)}</td>
                            <td className="p-1">
                              <Button type="button" size="icon-sm" variant="ghost" aria-label={t("web.aiTrades.quote.remove")} onClick={() => setLines((p) => p.filter((x) => x.itemId !== l.itemId))}>
                                <XIcon />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t text-sm">
                        <tr>
                          <td className="p-2 font-medium" colSpan={3}>
                            {t("web.aiTrades.quote.subtotal")}
                          </td>
                          <td className="p-2 text-right tabular-nums">{rupeesText(subtotal)}</td>
                          <td />
                        </tr>
                        <tr>
                          <td className="p-2 font-medium" colSpan={3}>
                            {t("web.aiTrades.quote.totalGst")}
                          </td>
                          <td className="p-2 text-right font-semibold tabular-nums">{rupeesText(total)}</td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </section>
              {res.draft.notInCatalogue.length > 0 && (
                <section className="grid gap-1 rounded-md border border-dashed p-3">
                  <h3 className="text-sm font-semibold">{t("web.aiTrades.quote.notStocked")}</h3>
                  <ul className="list-disc space-y-0.5 pl-5 text-sm">
                    {res.draft.notInCatalogue.map((n) => (
                      <li key={n.need}>
                        {n.need}
                        {n.qty ? ` (${n.qty})` : ""}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <div className="grid gap-1">
                <Label htmlFor="hq-customer">{t("web.aiTrades.quote.customer")}</Label>
                <Input id="hq-customer" maxLength={120} value={customer} onChange={(e) => setCustomer(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy || saving}>
              {t("web.common.close")}
            </Button>
            <Button type="button" variant={res ? "outline" : "default"} disabled={busy || saving || desc.trim().length < 8} onClick={run}>
              {busy && <Loader2Icon className="animate-spin" />} {res ? t("web.aiTrades.again") : t("web.aiTrades.quote.run")}
            </Button>
            {res && (
              <Button type="button" disabled={saving || busy || !customer.trim() || lines.filter((l) => l.qty > 0).length === 0} onClick={create}>
                {saving && <Loader2Icon className="animate-spin" />} {t("web.aiTrades.quote.create")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
