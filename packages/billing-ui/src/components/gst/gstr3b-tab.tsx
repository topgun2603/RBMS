"use client";

import * as React from "react";
import { FileJson2Icon, FileSearchIcon, Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@srirealtime/ui";
import { apiDownload, describeError, ModuleLink, QueryError, useI18n } from "@srirealtime/web";
import { MoneyInput } from "../money-input";
import { money, rupeesToPaise } from "../../lib/format";
import {
  ADJUSTMENT_KINDS,
  G,
  monthOfPeriod,
  monthsOfPeriod,
  quarterOfPeriod,
  taxTotal,
  useAddAdjustment,
  useAdjustments,
  useDeleteAdjustment,
  useGstr3b,
  useGstr3bCell,
  type AdjustmentKind,
  type CellId,
  type Gstr3b,
  type GstConfig,
  type Tax,
} from "../../lib/gst";
import { Amt, FileButton, PeriodPicker, Section, useCanManage, useGstText, usePeriodLabel } from "./shared";

const HEADS = ["igst", "cgst", "sgst", "cess"] as const;
const GROUPS: { id: string; cells: CellId[] }[] = [
  { id: "outward", cells: ["3.1a", "3.1b", "3.1c", "3.1d", "3.1e"] },
  { id: "unreg", cells: ["3.2"] },
  { id: "itc", cells: ["4A1", "4A2", "4A3", "4A4", "4A5", "4B1", "4B2", "4D1", "4D2"] },
  { id: "inward", cells: ["5.exempt.inter", "5.exempt.intra", "5.nongst.inter", "5.nongst.intra", "5.1.interest", "5.1.latefee"] },
];

export function Gstr3bTab({ config, period, onPeriod }: { config: GstConfig; period: string; onPeriod: (p: string) => void }) {
  const { t } = useI18n();
  const text = useGstText();
  const quarterly = config.qrmp;
  const key = quarterly ? quarterOfPeriod(period) : monthOfPeriod(period);
  const q = useGstr3b(key);
  const [cell, setCell] = React.useState<CellId | null>(null);
  const [busy, setBusy] = React.useState(false);
  const r = q.data;

  const downloadJson = async () => {
    if (!r) return;
    setBusy(true);
    try {
      await apiDownload(`${G}/gstr3b.json`, { period: key }, r.filename);
      toast.success(t("billing.gst.g3.downloaded"));
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-5">
      <Card className="px-card">
        <div className="flex flex-wrap items-end gap-3">
          <PeriodPicker value={key} onChange={onPeriod} kind={quarterly ? "quarter" : "month"} id="g3-period" />
          <div className="ml-auto flex flex-wrap gap-2">
            <FileButton path={`${G}/gstr3b.csv`} params={{ period: key }} fileName={`GSTR3B_${key}.csv`} label={t("billing.gst.g3.csv")} disabled={!r} />
            <Button type="button" className="h-11 sm:h-9" disabled={!r || busy || q.isFetching} onClick={() => void downloadJson()}>
              {busy ? <Loader2Icon className="animate-spin" /> : <FileJson2Icon />}
              {t("billing.gst.g3.download")}
            </Button>
          </div>
        </div>
        <p className="text-meta text-muted-foreground">{t("billing.gst.g3.intro", { period: text.label(key) })}</p>
      </Card>

      {q.isError && !r ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : !r ? (
        <div className="grid gap-3" aria-busy>
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      ) : (
        <div className={q.isFetching ? "grid grid-cols-1 gap-5 opacity-60 transition-opacity" : "grid grid-cols-1 gap-5"}>
          {r.warnings.map((w) => (
            <Alert key={w} variant={w === "composition" ? "default" : "warning"}>
              <AlertDescription>{t(`billing.gst.g3.warn.${w}`)}</AlertDescription>
            </Alert>
          ))}

          <PayableSummary r={r} />

          {GROUPS.map((g) => (
            <Section key={g.id} title={t(`billing.gst.g3.group.${g.id}`)} hint={t(`billing.gst.g3.groupHint.${g.id}`)} flush>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-56">{t("billing.gst.g3.colRow")}</TableHead>
                    <TableHead numeric>{t("billing.gst.g3.colTaxable")}</TableHead>
                    <TableHead numeric>IGST</TableHead>
                    <TableHead numeric>CGST</TableHead>
                    <TableHead numeric>SGST</TableHead>
                    <TableHead numeric>{t("billing.gst.g3.colCess")}</TableHead>
                    <TableHead className="w-28">
                      <span className="sr-only">{t("billing.gst.g3.documents")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.cells.map((id) => {
                    const c = r.cells[id];
                    return (
                      <TableRow key={id}>
                        <TableCell className="whitespace-normal">{text.cell(id)}</TableCell>
                        <TableCell numeric>
                          <Amt v={c.taxable} />
                        </TableCell>
                        <TableCell numeric>
                          <Amt v={c.igst} />
                        </TableCell>
                        <TableCell numeric>
                          <Amt v={c.cgst} />
                        </TableCell>
                        <TableCell numeric>
                          <Amt v={c.sgst} />
                        </TableCell>
                        <TableCell numeric>
                          <Amt v={c.cess} />
                        </TableCell>
                        <TableCell>
                          <Button type="button" variant="ghost" size="sm" className="h-11 sm:h-9" aria-label={t("billing.gst.g3.documentsFor", { row: text.cell(id) })} onClick={() => setCell(id)}>
                            <FileSearchIcon />
                            {t("billing.gst.g3.documents")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {g.id === "unreg" && r.unregByPos.length > 0 && (
                    <>
                      {r.unregByPos.map((u) => (
                        <TableRow key={u.pos} className="text-muted-foreground">
                          <TableCell className="pl-8">{t("billing.gst.g3.pos", { pos: u.pos })}</TableCell>
                          <TableCell numeric>{money(u.taxable)}</TableCell>
                          <TableCell numeric>{money(u.igst)}</TableCell>
                          <TableCell colSpan={4} />
                        </TableRow>
                      ))}
                    </>
                  )}
                </TableBody>
                {g.id === "itc" && (
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-semibold">{t("billing.gst.g3.itcNet")}</TableCell>
                      <TableCell />
                      {HEADS.map((h) => (
                        <TableCell key={h} numeric className="font-semibold">
                          {money(r.itcNet[h])}
                        </TableCell>
                      ))}
                      <TableCell />
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </Section>
          ))}

          {r.ledger && <LedgerCompare ledger={r.ledger} />}

          <AdjustmentsCard months={monthsOfPeriod(key)} />
        </div>
      )}

      <CellDialog period={key} cell={cell} onClose={() => setCell(null)} />
    </div>
  );
}

/** What to pay, in plain words. */
function PayableSummary({ r }: { r: Gstr3b }) {
  const { t } = useI18n();
  const credit = (h: keyof Tax) => HEADS.reduce((s, c) => s + r.setOff.used[h][c], 0);
  const out = taxTotal(r.outputTax);
  const rcm = taxTotal(r.rcmTax);
  const net = taxTotal(r.itcNet);
  const cash = (h: keyof Tax) => r.setOff.cash[h];
  const extras = r.cashPayable - taxTotal(r.setOff.cash) - rcm;
  return (
    <Section title={t("billing.gst.g3.payTitle")} hint={t("billing.gst.g3.payHint")} className="border-primary/30">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_18rem]">
        <ul className="grid gap-2 text-sm">
          <li className="flex justify-between gap-3">
            <span>{t("billing.gst.g3.payOutput")}</span>
            <b className="tabular-nums">{money(out)}</b>
          </li>
          <li className="flex justify-between gap-3">
            <span>{t("billing.gst.g3.payCredit")}</span>
            <b className="tabular-nums">{money(net)}</b>
          </li>
          <li className="flex justify-between gap-3">
            <span>{t("billing.gst.g3.payUsed")}</span>
            <b className="tabular-nums">{money(HEADS.reduce((s, h) => s + credit(h), 0))}</b>
          </li>
          <li className="flex justify-between gap-3">
            <span>{t("billing.gst.g3.payOutputCash")}</span>
            <b className="tabular-nums">{money(taxTotal(r.setOff.cash))}</b>
          </li>
          <li className="flex justify-between gap-3">
            <span>{t("billing.gst.g3.payRcm")}</span>
            <b className="tabular-nums">{money(rcm)}</b>
          </li>
          {extras !== 0 && (
            <li className="flex justify-between gap-3">
              <span>{t("billing.gst.g3.payExtras")}</span>
              <b className="tabular-nums">{money(extras)}</b>
            </li>
          )}
          <li className="flex justify-between gap-3">
            <span>{t("billing.gst.g3.payCarry")}</span>
            <b className="tabular-nums">{money(taxTotal(r.setOff.carry))}</b>
          </li>
        </ul>
        <div className="rounded-xl bg-primary/10 p-4 text-center">
          <p className="text-sm text-muted-foreground">{t("billing.gst.g3.cashPayable")}</p>
          <p className="text-3xl font-semibold tabular-nums">{money(r.cashPayable)}</p>
          <p className="mt-1 text-meta text-muted-foreground">{t("billing.gst.g3.cashNote")}</p>
        </div>
      </div>
      <div className="mt-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("billing.gst.g3.head")}</TableHead>
              <TableHead numeric>{t("billing.gst.g3.toPay")}</TableHead>
              <TableHead numeric>{t("billing.gst.g3.byCredit")}</TableHead>
              <TableHead numeric>{t("billing.gst.g3.inCash")}</TableHead>
              <TableHead numeric>{t("billing.gst.g3.rcmCash")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {HEADS.map((h) => (
              <TableRow key={h}>
                <TableCell className="font-medium uppercase">{h}</TableCell>
                <TableCell numeric>
                  <Amt v={r.outputTax[h]} />
                </TableCell>
                <TableCell numeric>
                  <Amt v={credit(h)} />
                </TableCell>
                <TableCell numeric>
                  <Amt v={cash(h)} />
                </TableCell>
                <TableCell numeric>
                  <Amt v={r.rcmTax[h]} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Section>
  );
}

function LedgerCompare({ ledger }: { ledger: NonNullable<Gstr3b["ledger"]> }) {
  const { t } = useI18n();
  const heads = ["cgst", "sgst", "igst", "cess"] as const;
  const same = heads.every((h) => ledger.outputDiff[h] === 0 && ledger.itcDiff[h] === 0);
  const block = (title: string, books: Tax, ret: Tax, diff: Tax) => (
    <div>
      <p className="mb-1 text-sm font-medium">{title}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("billing.gst.g3.head")}</TableHead>
            <TableHead numeric>{t("billing.gst.g3.ledgerBooks")}</TableHead>
            <TableHead numeric>{t("billing.gst.g3.ledgerReturn")}</TableHead>
            <TableHead numeric>{t("billing.gst.g3.ledgerDiff")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {heads.map((h) => (
            <TableRow key={h}>
              <TableCell className="font-medium uppercase">{h}</TableCell>
              <TableCell numeric>
                <Amt v={books[h]} />
              </TableCell>
              <TableCell numeric>
                <Amt v={ret[h]} />
              </TableCell>
              <TableCell numeric className={diff[h] !== 0 ? "font-semibold text-danger-ink" : undefined}>
                <Amt v={diff[h]} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
  return (
    <Section
      title={t("billing.gst.g3.ledgerTitle")}
      hint={t("billing.gst.g3.ledgerHint")}
      actions={<StatusPill tone={same ? "success" : "warning"}>{t(same ? "billing.gst.g3.ledgerSame" : "billing.gst.g3.ledgerDiffers")}</StatusPill>}
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {block(t("billing.gst.g3.ledgerOutput"), ledger.books.output, ledger.returnOutput, ledger.outputDiff)}
        {block(t("billing.gst.g3.ledgerInput"), ledger.books.input, ledger.returnItc, ledger.itcDiff)}
      </div>
      {!same && (
        <p className="mt-3 text-meta text-muted-foreground">
          {t("billing.gst.g3.ledgerWhy")}{" "}
          <ModuleLink to="accounting/gst" className="underline underline-offset-2">
            {t("billing.gst.g3.ledgerOpen")}
          </ModuleLink>
        </p>
      )}
    </Section>
  );
}

/** The documents behind one row of the return. */
function CellDialog({ period, cell, onClose }: { period: string; cell: CellId | null; onClose: () => void }) {
  const { t } = useI18n();
  const text = useGstText();
  const q = useGstr3bCell(period, cell);
  const href = (type: string, id: string) => (type === "invoice" ? `invoices/${id}` : type === "credit_note" ? `credit-notes/${id}` : type === "purchase" ? `purchases/${id}` : null);
  return (
    <Dialog open={!!cell} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-4xl" closeLabel={t("billing.common.close")}>
        <DialogHeader>
          <DialogTitle>{cell ? text.cell(cell) : ""}</DialogTitle>
          <DialogDescription>{t("billing.gst.g3.drillBody", { period: text.label(period) })}</DialogDescription>
        </DialogHeader>
        {q.isError ? (
          <QueryError error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data ? (
          <Skeleton className="h-48 rounded-xl" />
        ) : q.data.items.length === 0 ? (
          <EmptyState compact title={t("billing.gst.g3.drillEmpty")} />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("billing.gst.g3.drillType")}</TableHead>
                  <TableHead>{t("billing.gst.g3.drillNumber")}</TableHead>
                  <TableHead>{t("billing.gst.g3.drillDate")}</TableHead>
                  <TableHead>{t("billing.gst.g3.drillParty")}</TableHead>
                  <TableHead numeric>{t("billing.gst.g3.colTaxable")}</TableHead>
                  <TableHead numeric>IGST</TableHead>
                  <TableHead numeric>CGST</TableHead>
                  <TableHead numeric>SGST</TableHead>
                  <TableHead numeric>{t("billing.gst.g3.colCess")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data.items.map((c, i) => {
                  const to = href(c.docType, c.docId);
                  return (
                    <TableRow key={`${c.docId}-${i}`}>
                      <TableCell>{t(`billing.gst.doc.${c.docType}`)}</TableCell>
                      <TableCell>
                        {to ? (
                          <ModuleLink to={to} className="font-medium text-primary underline-offset-2 hover:underline">
                            {c.number}
                          </ModuleLink>
                        ) : (
                          c.number
                        )}
                      </TableCell>
                      <TableCell>{c.date ? text.dateText(c.date) : ""}</TableCell>
                      <TableCell className="max-w-48 truncate" title={c.party}>
                        {c.party}
                        {c.note ? <span className="block text-meta text-muted-foreground">{c.note}</span> : null}
                      </TableCell>
                      <TableCell numeric>{money(c.taxable)}</TableCell>
                      <TableCell numeric>
                        <Amt v={c.igst} />
                      </TableCell>
                      <TableCell numeric>
                        <Amt v={c.cgst} />
                      </TableCell>
                      <TableCell numeric>
                        <Amt v={c.sgst} />
                      </TableCell>
                      <TableCell numeric>
                        <Amt v={c.cess} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4} className="font-semibold">
                    {t("billing.gst.g3.drillTotal")}
                  </TableCell>
                  <TableCell numeric className="font-semibold">
                    {money(q.data.total.taxable)}
                  </TableCell>
                  <TableCell numeric className="font-semibold">
                    {money(q.data.total.igst)}
                  </TableCell>
                  <TableCell numeric className="font-semibold">
                    {money(q.data.total.cgst)}
                  </TableCell>
                  <TableCell numeric className="font-semibold">
                    {money(q.data.total.sgst)}
                  </TableCell>
                  <TableCell numeric className="font-semibold">
                    {money(q.data.total.cess)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
            {q.data.truncated && <p className="text-meta text-muted-foreground">{t("billing.gst.g3.drillMore", { count: q.data.items.length })}</p>}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Figures the bills do not carry (typed in for the month). */
function AdjustmentsCard({ months }: { months: string[] }) {
  const { t } = useI18n();
  const label = usePeriodLabel();
  const canManage = useCanManage();
  const list = useAdjustments("");
  const add = useAddAdjustment();
  const del = useDeleteAdjustment();
  const [open, setOpen] = React.useState(false);
  const [month, setMonth] = React.useState(months[0]!);
  const [kind, setKind] = React.useState<AdjustmentKind>("itc_other");
  const [v, setV] = React.useState({ taxable: "", igst: "", cgst: "", sgst: "", cess: "" });
  const [note, setNote] = React.useState("");
  React.useEffect(() => {
    if (!months.includes(month)) setMonth(months[0]!);
  }, [months, month]);

  const rows = (list.data ?? []).filter((a) => months.includes(a.month));
  const n = (s: string) => rupeesToPaise(s) ?? 0;
  const empty = !(n(v.taxable) || n(v.igst) || n(v.cgst) || n(v.sgst) || n(v.cess));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (empty) return;
    try {
      await add.mutateAsync({ month, kind, taxable: n(v.taxable), igst: n(v.igst), cgst: n(v.cgst), sgst: n(v.sgst), cess: n(v.cess), note: note.trim() || null });
      toast.success(t("billing.gst.adj.added"));
      setV({ taxable: "", igst: "", cgst: "", sgst: "", cess: "" });
      setNote("");
      setOpen(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const remove = async (id: string) => {
    try {
      await del.mutateAsync(id);
      toast.success(t("billing.gst.adj.removed"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const fields = ["taxable", "igst", "cgst", "sgst", "cess"] as const;
  const fieldLabel = (f: (typeof fields)[number]) => (f === "taxable" ? t("billing.gst.g3.colTaxable") : f === "cess" ? t("billing.gst.g3.colCess") : f.toUpperCase());

  return (
    <Section
      title={t("billing.gst.adj.title")}
      hint={t("billing.gst.adj.hint")}
      flush={rows.length > 0}
      actions={
        canManage && (
          <Button type="button" variant="outline" className="h-11 sm:h-9" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
            <PlusIcon />
            {t("billing.gst.adj.add")}
          </Button>
        )
      }
    >
      {open && canManage && (
        <form onSubmit={submit} className="mb-4 grid gap-3 rounded-xl border p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="adj-month">{t("billing.gst.month")}</Label>
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger id="adj-month" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {months.map((m) => (
                    <SelectItem key={m} value={m}>
                      {label(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="adj-kind">{t("billing.gst.adj.kind")}</Label>
              <Select value={kind} onValueChange={(x) => setKind(x as AdjustmentKind)}>
                <SelectTrigger id="adj-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ADJUSTMENT_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(`billing.gst.adj.kinds.${k}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-meta text-muted-foreground">{t(`billing.gst.adj.help.${kind}`)}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {fields.map((f) => (
              <div key={f} className="grid gap-1.5">
                <Label htmlFor={`adj-${f}`}>{fieldLabel(f)}</Label>
                <MoneyInput id={`adj-${f}`} value={v[f]} onChange={(e) => setV((s) => ({ ...s, [f]: e.target.value }))} />
              </div>
            ))}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="adj-note">{t("billing.gst.note")}</Label>
            <Input id="adj-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={add.isPending || empty}>
              {t("billing.gst.save")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("billing.common.cancel")}
            </Button>
          </div>
        </form>
      )}
      {rows.length === 0 ? (
        <EmptyState compact title={t("billing.gst.adj.empty")} description={t("billing.gst.adj.emptyBody")} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("billing.gst.month")}</TableHead>
              <TableHead>{t("billing.gst.adj.kind")}</TableHead>
              <TableHead numeric>{t("billing.gst.g3.colTaxable")}</TableHead>
              <TableHead numeric>IGST</TableHead>
              <TableHead numeric>CGST</TableHead>
              <TableHead numeric>SGST</TableHead>
              <TableHead numeric>{t("billing.gst.g3.colCess")}</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">{t("billing.gst.actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => (
              <TableRow key={a.id}>
                <TableCell>{label(a.month)}</TableCell>
                <TableCell className="min-w-48 whitespace-normal">
                  {t(`billing.gst.adj.kinds.${a.kind}`)}
                  {a.note ? <span className="block text-meta text-muted-foreground">{a.note}</span> : null}
                </TableCell>
                <TableCell numeric>
                  <Amt v={a.taxable} />
                </TableCell>
                <TableCell numeric>
                  <Amt v={a.igst} />
                </TableCell>
                <TableCell numeric>
                  <Amt v={a.cgst} />
                </TableCell>
                <TableCell numeric>
                  <Amt v={a.sgst} />
                </TableCell>
                <TableCell numeric>
                  <Amt v={a.cess} />
                </TableCell>
                <TableCell>
                  {canManage && (
                    <Button type="button" variant="ghost" size="icon" aria-label={t("billing.gst.remove")} disabled={del.isPending} onClick={() => void remove(a.id)}>
                      <Trash2Icon />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}
