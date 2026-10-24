"use client";

import * as React from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@srirealtime/ui";
import { describeError, QueryError, useI18n } from "@srirealtime/web";
import { MoneyInput } from "../money-input";
import { money, rupeesToPaise, todayIST } from "../../lib/format";
import {
  fyLabel,
  fyOptions,
  G,
  PAYMENT_METHODS,
  quarterOfPeriod,
  taxTotal,
  useAddPayment,
  useCmp08,
  useDeletePayment,
  useGstr4,
  usePayments,
  type GstConfig,
} from "../../lib/gst";
import { Amt, FileButton, PeriodPicker, Section, useCanManage, useGstText } from "./shared";

const LIMIT_GOODS = 150_00_000_00;
const LIMIT_SERVICES = 50_00_000_00;

export function CompositionTab({ config, period, onPeriod }: { config: GstConfig; period: string; onPeriod: (p: string) => void }) {
  const { t } = useI18n();
  const text = useGstText();
  const quarter = quarterOfPeriod(period);
  const q = useCmp08(quarter);
  const c = q.data;
  const limit = config.compositionType === "services" ? LIMIT_SERVICES : LIMIT_GOODS;

  return (
    <div className="grid gap-5">
      <Card className="px-card">
        <div className="flex flex-wrap items-end gap-3">
          <PeriodPicker value={quarter} onChange={onPeriod} kind="quarter" id="cmp-quarter" />
          <div className="ml-auto">
            <FileButton path={`${G}/cmp08.csv`} params={{ quarter }} fileName={`CMP08_${quarter}.csv`} label={t("billing.gst.csv")} disabled={!c} />
          </div>
        </div>
        <p className="text-meta text-muted-foreground">{t("billing.gst.cmp.intro", { type: t(`billing.gst.type.${config.compositionType}`), rate: c?.rate ?? 0 })}</p>
      </Card>

      {q.isError && !c ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : !c ? (
        <Skeleton className="h-72 rounded-2xl" />
      ) : (
        <div className={q.isFetching ? "grid gap-5 opacity-60 transition-opacity" : "grid gap-5"}>
          {c.interStateTurnover > 0 && (
            <Alert variant="warning">
              <AlertDescription>{text.issue({ code: "composition_inter_state", params: { amount: c.interStateTurnover } })}</AlertDescription>
            </Alert>
          )}
          {c.taxCharged.count > 0 && (
            <Alert variant="warning">
              <AlertDescription>{text.issue({ code: "composition_tax_charged", count: c.taxCharged.count })}</AlertDescription>
            </Alert>
          )}
          {c.turnover > limit && (
            <Alert variant="warning">
              <AlertDescription>{text.issue({ code: "composition_limit", params: { amount: c.turnover } })}</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard title={t("billing.gst.cmp.turnover")} value={money(c.turnover)} description={t("billing.gst.cmp.turnoverHint", { invoices: c.invoices, notes: c.creditNotes })} />
            <StatCard title={t("billing.gst.cmp.tax")} value={money(c.tax.total)} description={t("billing.gst.cmp.taxHint", { rate: c.rate })} />
            <StatCard title={t("billing.gst.cmp.paid")} value={money(c.paid)} />
            <StatCard title={t("billing.gst.cmp.balance")} value={money(c.balance + taxTotal(c.rcm.tax))} description={t("billing.gst.cmp.balanceHint")} iconClassName={c.balance > 0 ? "text-warning-ink" : undefined} />
          </div>

          <Section title={t("billing.gst.cmp.summaryTitle", { quarter: text.label(quarter) })} hint={t("billing.gst.cmp.summaryHint")} flush>
            <Table>
              <TableBody>
                <TableRow>
                  <TableCell>{t("billing.gst.cmp.rowTurnover")}</TableCell>
                  <TableCell numeric>{money(c.turnover)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>{t("billing.gst.cmp.rowInter")}</TableCell>
                  <TableCell numeric>
                    <Amt v={c.interStateTurnover} />
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>{t("billing.gst.cmp.rowRate")}</TableCell>
                  <TableCell numeric>{c.rate}%</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>{t("billing.gst.cmp.rowCentral")}</TableCell>
                  <TableCell numeric>{money(c.tax.cgst)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>{t("billing.gst.cmp.rowState")}</TableCell>
                  <TableCell numeric>{money(c.tax.sgst)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>{t("billing.gst.cmp.rowRcm")}</TableCell>
                  <TableCell numeric>
                    <Amt v={taxTotal(c.rcm.tax)} />
                    {c.rcm.taxable > 0 && <span className="block text-meta text-muted-foreground">{t("billing.gst.cmp.rcmOn", { amount: money(c.rcm.taxable) })}</span>}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>{t("billing.gst.cmp.rowPaid")}</TableCell>
                  <TableCell numeric>
                    <Amt v={c.paid} />
                  </TableCell>
                </TableRow>
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">{t("billing.gst.cmp.rowBalance")}</TableCell>
                  <TableCell numeric className="font-semibold">
                    {money(c.balance)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </Section>

          <PaymentsCard quarter={quarter} suggest={{ cgst: Math.max(c.tax.cgst - Math.floor(c.paid / 2), 0), sgst: Math.max(c.tax.sgst - Math.ceil(c.paid / 2), 0) }} />
        </div>
      )}

      <Gstr4Card />
    </div>
  );
}

function PaymentsCard({ quarter, suggest }: { quarter: string; suggest: { cgst: number; sgst: number } }) {
  const { t } = useI18n();
  const text = useGstText();
  const canManage = useCanManage();
  const list = usePayments({ kind: "composition" });
  const add = useAddPayment();
  const del = useDeletePayment();
  const [open, setOpen] = React.useState(false);
  const [paidOn, setPaidOn] = React.useState(todayIST());
  const [v, setV] = React.useState({ cgst: "", sgst: "", interest: "", lateFee: "" });
  const [method, setMethod] = React.useState("bank");
  const [challan, setChallan] = React.useState("");
  const rows = (list.data ?? []).filter((p) => p.period === quarter);

  const openForm = () => {
    setV({ cgst: suggest.cgst ? String(suggest.cgst / 100) : "", sgst: suggest.sgst ? String(suggest.sgst / 100) : "", interest: "", lateFee: "" });
    setPaidOn(todayIST());
    setOpen(true);
  };
  const n = (s: string) => rupeesToPaise(s) ?? 0;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await add.mutateAsync({ kind: "composition", period: quarter, paidOn, cgst: n(v.cgst), sgst: n(v.sgst), interest: n(v.interest), lateFee: n(v.lateFee), method, challan: challan.trim() || null });
      toast.success(t("billing.gst.pay.added"));
      setChallan("");
      setOpen(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const remove = async (id: string) => {
    try {
      await del.mutateAsync(id);
      toast.success(t("billing.gst.pay.removed"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const fields = [
    ["cgst", t("billing.gst.cmp.rowCentral")],
    ["sgst", t("billing.gst.cmp.rowState")],
    ["interest", t("billing.gst.pay.interest")],
    ["lateFee", t("billing.gst.pay.lateFee")],
  ] as const;

  return (
    <Section
      title={t("billing.gst.pay.title", { quarter: text.label(quarter) })}
      hint={t("billing.gst.pay.hint")}
      flush={rows.length > 0}
      actions={
        canManage && (
          <Button type="button" variant="outline" className="h-11 sm:h-9" aria-expanded={open} onClick={() => (open ? setOpen(false) : openForm())}>
            <PlusIcon />
            {t("billing.gst.pay.add")}
          </Button>
        )
      }
    >
      {open && canManage && (
        <form onSubmit={submit} className="mb-4 grid gap-3 rounded-xl border p-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="pay-date">{t("billing.gst.pay.paidOn")}</Label>
              <Input id="pay-date" type="date" required max={todayIST()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pay-method">{t("billing.gst.pay.method")}</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger id="pay-method" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {t(`billing.gst.pay.methods.${m}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pay-challan">{t("billing.gst.pay.challan")}</Label>
              <Input id="pay-challan" maxLength={60} value={challan} onChange={(e) => setChallan(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {fields.map(([f, label]) => (
              <div key={f} className="grid gap-1.5">
                <Label htmlFor={`pay-${f}`}>{label}</Label>
                <MoneyInput id={`pay-${f}`} value={v[f]} onChange={(e) => setV((s) => ({ ...s, [f]: e.target.value }))} />
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={add.isPending || !(n(v.cgst) || n(v.sgst) || n(v.interest) || n(v.lateFee))}>
              {t("billing.gst.save")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("billing.common.cancel")}
            </Button>
          </div>
        </form>
      )}
      {rows.length === 0 ? (
        <EmptyState compact title={t("billing.gst.pay.empty")} description={t("billing.gst.pay.emptyBody")} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("billing.gst.pay.paidOn")}</TableHead>
              <TableHead>{t("billing.gst.pay.method")}</TableHead>
              <TableHead>{t("billing.gst.pay.challan")}</TableHead>
              <TableHead numeric>{t("billing.gst.pay.tax")}</TableHead>
              <TableHead numeric>{t("billing.gst.pay.extra")}</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">{t("billing.gst.actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell>{text.dateText(p.paidOn)}</TableCell>
                <TableCell>{t(`billing.gst.pay.methods.${p.method}`)}</TableCell>
                <TableCell>{p.challan ?? ""}</TableCell>
                <TableCell numeric>{money(p.igst + p.cgst + p.sgst + p.cess)}</TableCell>
                <TableCell numeric>
                  <Amt v={p.interest + p.lateFee} />
                </TableCell>
                <TableCell>
                  {canManage && (
                    <Button type="button" variant="ghost" size="icon" aria-label={t("billing.gst.remove")} disabled={del.isPending} onClick={() => void remove(p.id)}>
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

/** The yearly return of a composition shop. */
function Gstr4Card() {
  const { t } = useI18n();
  const text = useGstText();
  const years = React.useMemo(() => fyOptions(todayIST(), 5), []);
  const [fy, setFy] = React.useState(years[0]!);
  const q = useGstr4(fy);
  const d = q.data;
  return (
    <Section
      title={t("billing.gst.g4.title")}
      hint={t("billing.gst.g4.hint")}
      flush={!!d}
      actions={
        <div className="grid gap-1.5">
          <Label htmlFor="g4-fy">{t("billing.gst.g4.year")}</Label>
          <Select value={String(fy)} onValueChange={(v) => setFy(Number(v))}>
            <SelectTrigger id="g4-fy" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {t("billing.gst.fyLabel", { fy: fyLabel(y) })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
    >
      {q.isError && !d ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : !d ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : (
        <div className={q.isFetching ? "opacity-60 transition-opacity" : undefined}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("billing.gst.quarter")}</TableHead>
                <TableHead numeric>{t("billing.gst.cmp.turnover")}</TableHead>
                <TableHead numeric>{t("billing.gst.cmp.tax")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.quarters.map((x) => (
                <TableRow key={x.quarter}>
                  <TableCell>{text.label(x.quarter)}</TableCell>
                  <TableCell numeric>
                    <Amt v={x.turnover} />
                  </TableCell>
                  <TableCell numeric>
                    <Amt v={x.tax.total} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-semibold">{t("billing.gst.g4.year")}</TableCell>
                <TableCell numeric className="font-semibold">
                  {money(d.turnover)}
                </TableCell>
                <TableCell numeric className="font-semibold">
                  {money(d.tax)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
          <div className="px-4 pt-4 sm:px-2">
            <p className="mb-1 text-sm font-medium">{t("billing.gst.g4.inwardTitle")}</p>
            <Table>
              <TableBody>
                {(["registered", "rcmRegistered", "rcmUnregistered", "imports"] as const).map((k) => (
                  <TableRow key={k}>
                    <TableCell className="whitespace-normal">{t(`billing.gst.g4.inward.${k}`)}</TableCell>
                    <TableCell numeric>
                      <Amt v={d.inward[k]} />
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-semibold">{t("billing.gst.g4.paid")}</TableCell>
                  <TableCell numeric className="font-semibold">
                    {money(d.paid)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <p className="mt-3 text-meta text-muted-foreground">{t("billing.gst.g4.note")}</p>
          </div>
        </div>
      )}
    </Section>
  );
}
