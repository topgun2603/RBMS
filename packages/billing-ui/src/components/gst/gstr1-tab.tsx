"use client";

import * as React from "react";
import { CheckCircle2Icon, FileJson2Icon, Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@srirealtime/ui";
import { apiDownload, ConfirmDialog, describeError, QueryError, useI18n } from "@srirealtime/web";
import { StateSelect } from "../state-select";
import { MoneyInput } from "../money-input";
import { GST_RATES, money, rupeesToPaise, stateLabel } from "../../lib/format";
import {
  docRangeCount,
  G,
  gstr1Params,
  monthOfPeriod,
  monthsOfPeriod,
  quarterOfPeriod,
  useAddAdvance,
  useAdvances,
  useDeleteAdvance,
  useGstr1,
  type GstConfig,
} from "../../lib/gst";
import { FileButton, PeriodPicker, Section, SeverityPill, useCanManage, useGstText, usePeriodLabel } from "./shared";

const TABLES = ["b2b", "b2cl", "b2cs", "cdnr", "cdnur", "exp", "nil", "at", "txpd", "docs", "voided"] as const;

export function Gstr1Tab({ config, period, onPeriod }: { config: GstConfig; period: string; onPeriod: (p: string) => void }) {
  const { t } = useI18n();
  const text = useGstText();
  const quarterly = config.qrmp;
  const key = quarterly ? quarterOfPeriod(period) : monthOfPeriod(period);
  const q = useGstr1(key);
  const [confirm, setConfirm] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const res = q.data;
  const errors = res?.issues.filter((i) => i.severity === "error") ?? [];
  const warnings = res?.issues.filter((i) => i.severity === "warning") ?? [];

  const download = async () => {
    if (!res) return;
    setBusy(true);
    try {
      await apiDownload(`${G}/gstr1.json`, gstr1Params(key), res.filename);
      toast.success(t("billing.gst.g1.downloaded"));
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const counts = (n: (typeof TABLES)[number]): number => (n === "docs" ? (res ? docRangeCount(res.json) : 0) : (res?.counts[n] ?? 0));

  return (
    <div className="grid gap-5">
      <Card className="px-card">
        <div className="flex flex-wrap items-end gap-3">
          <PeriodPicker value={key} onChange={onPeriod} kind={quarterly ? "quarter" : "month"} id="g1-period" />
          <div className="ml-auto flex flex-wrap gap-2">
            <FileButton
              path={`${G}/gstr1/issues.csv`}
              params={gstr1Params(key)}
              fileName={`GSTR1_issues_${key}.csv`}
              label={t("billing.gst.g1.issuesCsv")}
              disabled={!res || res.issues.length === 0}
            />
            <Button
              type="button"
              className="h-11 sm:h-9"
              disabled={!res || busy || q.isFetching}
              onClick={() => (errors.length > 0 ? setConfirm(true) : void download())}
            >
              {busy ? <Loader2Icon className="animate-spin" /> : <FileJson2Icon />}
              {t("billing.gst.g1.download")}
            </Button>
          </div>
        </div>
        <p className="text-meta text-muted-foreground">
          {t("billing.gst.g1.intro", { period: text.label(key) })} {quarterly ? t("billing.gst.g1.quarterNote") : ""}
        </p>
      </Card>

      {q.isError && !res ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : !res ? (
        <div className="grid gap-3" aria-busy>
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
          <p className="text-meta text-muted-foreground">{t("billing.gst.g1.building")}</p>
        </div>
      ) : (
        <div className={q.isFetching ? "grid gap-5 opacity-60 transition-opacity" : "grid gap-5"}>
          {!res.applicable && (
            <Alert>
              <AlertTitle>{t("billing.gst.g1.compositionTitle")}</AlertTitle>
              <AlertDescription>{t("billing.gst.g1.compositionBody")}</AlertDescription>
            </Alert>
          )}

          <Section title={t("billing.gst.g1.tablesTitle")} hint={t("billing.gst.g1.tablesHint")}>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {TABLES.map((n) => (
                <li key={n} className="rounded-xl border p-3">
                  <p className="text-2xl font-semibold tabular-nums">{counts(n)}</p>
                  <p className="text-sm font-medium">{t(`billing.gst.g1.table.${n}`)}</p>
                  <p className="text-meta text-muted-foreground">{t(`billing.gst.g1.tableHelp.${n}`)}</p>
                </li>
              ))}
            </ul>
            {(res.counts.cancelled ?? 0) > 0 && <p className="mt-3 text-meta text-muted-foreground">{t("billing.gst.g1.cancelled", { count: res.counts.cancelled ?? 0 })}</p>}
            {Object.keys(res.tables.nil).length > 0 && (
              <div className="mt-4">
                <p className="mb-1 text-sm font-medium">{t("billing.gst.g1.nilTitle")}</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("billing.gst.g1.nilType")}</TableHead>
                      <TableHead numeric>{t("billing.gst.g1.nilNil")}</TableHead>
                      <TableHead numeric>{t("billing.gst.g1.nilExempt")}</TableHead>
                      <TableHead numeric>{t("billing.gst.g1.nilNonGst")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(res.tables.nil).map(([type, v]) => (
                      <TableRow key={type}>
                        <TableCell>{t(`billing.gst.g1.nilKind.${type}`)}</TableCell>
                        <TableCell numeric>{money(v.nil)}</TableCell>
                        <TableCell numeric>{money(v.exempt)}</TableCell>
                        <TableCell numeric>{money(v.nongst)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Section>

          <Section
            title={t("billing.gst.g1.checkTitle")}
            hint={t("billing.gst.g1.checkHint")}
            flush={res.issues.length > 0}
          >
            {res.issues.length === 0 ? (
              <p className="flex items-center gap-2 rounded-xl bg-success/10 p-4 text-sm text-success-ink">
                <CheckCircle2Icon className="size-4 shrink-0" />
                {t("billing.gst.g1.allGood")}
              </p>
            ) : (
              <>
                <p className="px-4 pb-2 text-sm sm:px-2">{t("billing.gst.g1.issueCount", { errors: errors.length, warnings: warnings.length })}</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("billing.gst.g1.colSeverity")}</TableHead>
                      <TableHead>{t("billing.gst.g1.colProblem")}</TableHead>
                      <TableHead>{t("billing.gst.g1.colDoc")}</TableHead>
                      <TableHead>{t("billing.gst.g1.colDetail")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...errors, ...warnings].slice(0, 300).map((i, idx) => (
                      <TableRow key={`${i.code}-${i.docId ?? i.number ?? idx}-${idx}`}>
                        <TableCell>
                          <SeverityPill severity={i.severity} />
                        </TableCell>
                        <TableCell className="min-w-56 whitespace-normal">{text.g1Problem(i.code)}</TableCell>
                        <TableCell className="whitespace-normal">{i.number ?? ""}</TableCell>
                        <TableCell className="min-w-32 whitespace-normal text-muted-foreground">{i.detail ?? ""}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {res.issues.length > 300 && <p className="px-4 pt-2 text-meta text-muted-foreground sm:px-2">{t("billing.gst.g1.more", { count: res.issues.length - 300 })}</p>}
              </>
            )}
          </Section>

          {res.warnings.length > 0 && (
            <Section title={t("billing.gst.g1.otherWarnings")}>
              <ul className="grid list-disc gap-1 pl-5 text-sm">
                {res.warnings.slice(0, 20).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </Section>
          )}

          <AdvancesCard months={monthsOfPeriod(key)} />
        </div>
      )}

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        destructive={false}
        title={t("billing.gst.g1.confirmTitle", { count: errors.length })}
        description={t("billing.gst.g1.confirmBody")}
        confirmLabel={t("billing.gst.g1.confirmGo")}
        onConfirm={async () => {
          await download();
          setConfirm(false);
        }}
      />
    </div>
  );
}

/** Table 11: advances received and later adjusted, typed in (the bills do not carry them). */
function AdvancesCard({ months }: { months: string[] }) {
  const { t } = useI18n();
  const label = usePeriodLabel();
  const canManage = useCanManage();
  const list = useAdvances("");
  const add = useAddAdvance();
  const del = useDeleteAdvance();
  const [open, setOpen] = React.useState(false);
  const [kind, setKind] = React.useState<"received" | "adjusted">("received");
  const [month, setMonth] = React.useState(months[0]!);
  const [pos, setPos] = React.useState("");
  const [rate, setRate] = React.useState("18");
  const [amount, setAmount] = React.useState("");
  const [note, setNote] = React.useState("");
  React.useEffect(() => {
    if (!months.includes(month)) setMonth(months[0]!);
  }, [months, month]);

  const rows = (list.data ?? []).filter((a) => months.includes(a.month));
  const paise = rupeesToPaise(amount);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paise || paise <= 0 || !pos) return;
    try {
      await add.mutateAsync({ month, kind, pos, rate: Number(rate), amount: paise, note: note.trim() || null });
      toast.success(t("billing.gst.g1.adv.added"));
      setAmount("");
      setNote("");
      setOpen(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const remove = async (id: string) => {
    try {
      await del.mutateAsync(id);
      toast.success(t("billing.gst.g1.adv.removed"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Section
      title={t("billing.gst.g1.adv.title")}
      hint={t("billing.gst.g1.adv.hint")}
      flush={rows.length > 0}
      actions={
        canManage && (
          <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            <PlusIcon />
            {t("billing.gst.g1.adv.add")}
          </Button>
        )
      }
    >
      {open && canManage && (
        <form onSubmit={submit} className="mb-4 grid gap-3 rounded-xl border p-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="adv-kind">{t("billing.gst.g1.adv.kind")}</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger id="adv-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="received">{t("billing.gst.g1.adv.received")}</SelectItem>
                <SelectItem value="adjusted">{t("billing.gst.g1.adv.adjusted")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="adv-month">{t("billing.gst.month")}</Label>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger id="adv-month" className="w-full">
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
            <Label htmlFor="adv-pos">{t("billing.gst.g1.adv.pos")}</Label>
            <StateSelect id="adv-pos" value={pos} onChange={setPos} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="adv-rate">{t("billing.gst.g1.adv.rate")}</Label>
            <Select value={rate} onValueChange={setRate}>
              <SelectTrigger id="adv-rate" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GST_RATES.map((r) => (
                  <SelectItem key={r} value={String(r)}>
                    {r}%
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="adv-amount">{t("billing.gst.g1.adv.amount")}</Label>
            <MoneyInput id="adv-amount" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="adv-note">{t("billing.gst.note")}</Label>
            <Input id="adv-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
            <Button type="submit" disabled={add.isPending || !pos || !paise}>
              {t("billing.gst.save")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("billing.common.cancel")}
            </Button>
          </div>
          <p className="text-meta text-muted-foreground sm:col-span-2 lg:col-span-3">{t("billing.gst.g1.adv.help")}</p>
        </form>
      )}
      {rows.length === 0 ? (
        <EmptyState compact title={t("billing.gst.g1.adv.empty")} description={t("billing.gst.g1.adv.emptyBody")} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("billing.gst.g1.adv.kind")}</TableHead>
              <TableHead>{t("billing.gst.month")}</TableHead>
              <TableHead>{t("billing.gst.g1.adv.pos")}</TableHead>
              <TableHead numeric>{t("billing.gst.g1.adv.rate")}</TableHead>
              <TableHead numeric>{t("billing.gst.g1.adv.amount")}</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">{t("billing.gst.actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => (
              <TableRow key={a.id}>
                <TableCell>{t(a.kind === "received" ? "billing.gst.g1.adv.received" : "billing.gst.g1.adv.adjusted")}</TableCell>
                <TableCell>{label(a.month)}</TableCell>
                <TableCell>{stateLabel(a.pos)}</TableCell>
                <TableCell numeric>{a.rate}%</TableCell>
                <TableCell numeric>{money(a.amount)}</TableCell>
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

