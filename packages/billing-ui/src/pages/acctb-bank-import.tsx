"use client";

import * as React from "react";
import { AlertTriangleIcon, CheckCircle2Icon, FileUpIcon, RefreshCwIcon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@rbms/ui";
import { describeError, ModuleLink, useI18n } from "@rbms/web";
import { AccountingPage, Panel } from "../components/accounting/parts";
import { BankAccountSelect, Figure, Signed, useBankAccountParam } from "../components/accounting/part-b";
import { BANK_FIELDS, useBankAccounts, useImportStatement, usePreviewImport, type ColumnMapping, type ImportPreview, type ImportResult } from "../lib/accounting-b";
import { money } from "../lib/format";

const NONE = "-1";

/** Import a bank statement: choose the file, check the columns and the lines, then import (repeating it adds nothing). */
export default function AccountingBankImportPage() {
  const { t, formatDate } = useI18n();
  const accounts = useBankAccounts();
  const [accountId, setAccountId] = useBankAccountParam(accounts.data);
  const [file, setFile] = React.useState<File | null>(null);
  const [mapping, setMapping] = React.useState<ColumnMapping | undefined>(undefined);
  const [headerRow, setHeaderRow] = React.useState<number | undefined>(undefined);
  const [dateOrder, setDateOrder] = React.useState<"dmy" | "mdy">("dmy");
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [done, setDone] = React.useState<ImportResult | null>(null);
  const read = usePreviewImport();
  const save = useImportStatement();

  const run = async (opts: { mapping?: ColumnMapping; headerRow?: number } = {}) => {
    if (!file || !accountId) return;
    try {
      const p = await read.mutateAsync({ accountId, file, mapping: opts.mapping ?? mapping, headerRow: opts.headerRow ?? headerRow, dateOrder });
      setPreview(p);
      setMapping(p.mapping);
      setHeaderRow(p.headerRow);
      setDone(null);
    } catch (err) {
      setPreview(null);
      toast.error(describeError(err, t));
    }
  };
  const doImport = async () => {
    if (!file || !accountId) return;
    try {
      const r = await save.mutateAsync({ accountId, file, mapping, headerRow, dateOrder });
      setDone(r);
      toast.success(t("billing.acctb.import.done", { added: r.added, duplicates: r.duplicates }));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const d = (s: string | null) => (s ? formatDate(s, { day: "numeric", month: "short", year: "numeric" }) : "-");
  const setField = (field: string, v: string) => {
    const next = { ...(mapping ?? {}) } as Record<string, number>;
    if (v === NONE) next[field] = -1;
    else next[field] = Number(v);
    setMapping(next as ColumnMapping);
  };

  return (
    <AccountingPage title={t("billing.acctb.import.title")} description={t("billing.acctb.import.subtitle")} icon={FileUpIcon} needsSetup={false}>
      <Card className="mb-section">
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-[auto_1fr_auto] md:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="imp-acc">{t("billing.acctb.bankAccount")}</Label>
            <BankAccountSelect id="imp-acc" value={accountId} onChange={setAccountId} accounts={accounts.data ?? []} />
          </div>
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor="imp-file">{t("billing.acctb.import.file")}</Label>
            <Input
              id="imp-file"
              type="file"
              accept=".csv,.txt,.tsv,.xlsx,.xls,.htm,.html"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
                setMapping(undefined);
                setHeaderRow(undefined);
                setDone(null);
              }}
            />
            <p className="text-meta text-muted-foreground">{t("billing.acctb.import.fileHint")}</p>
          </div>
          <Button size="lg" onClick={() => void run({})} disabled={!file || !accountId || read.isPending}>
            {read.isPending ? t("billing.acctb.import.reading") : t("billing.acctb.import.read")}
          </Button>
        </CardContent>
      </Card>

      {preview && (
        <div className="grid grid-cols-1 gap-section">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Figure label={t("billing.acctb.import.layout")}>{t(`billing.acctb.layout.${preview.layout}`)}</Figure>
            <Figure label={t("billing.acctb.import.period")} hint={preview.reversed ? t("billing.acctb.import.reversed") : undefined}>
              <span className="text-sm sm:text-base">
                {d(preview.from)} - {d(preview.to)}
              </span>
            </Figure>
            <Figure label={t("billing.acctb.import.newLines")} tone={preview.counts.new ? "success" : undefined}>
              {preview.counts.new}
            </Figure>
            <Figure label={t("billing.acctb.import.already")} hint={t("billing.acctb.import.alreadyHint")}>
              {preview.counts.duplicates}
            </Figure>
          </div>

          {preview.warnings.map((w) => (
            <Alert key={w}>
              <AlertTriangleIcon />
              <AlertTitle>{t("billing.acctb.import.check")}</AlertTitle>
              <AlertDescription>{w}</AlertDescription>
            </Alert>
          ))}

          <Card>
            <CardContent className="grid gap-4">
              <div>
                <p className="font-medium">{t("billing.acctb.import.columns")}</p>
                <p className="text-meta text-muted-foreground">{t("billing.acctb.import.columnsHint")}</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {BANK_FIELDS.map((f) => {
                  const v = mapping?.[f];
                  return (
                    <div key={f} className="grid gap-1.5">
                      <Label htmlFor={`map-${f}`}>{t(`billing.acctb.field.${f}`)}</Label>
                      <Select value={v === undefined || v < 0 ? NONE : String(v)} onValueChange={(x) => setField(f, x)}>
                        <SelectTrigger id={`map-${f}`} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>{t("billing.acctb.import.notInFile")}</SelectItem>
                          {preview.headers.map((h, i) => (
                            <SelectItem key={i} value={String(i)}>
                              {h || t("billing.acctb.import.column", { n: i + 1 })}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_12rem_auto_1fr] sm:items-end">
                <div className="grid gap-1.5">
                  <Label htmlFor="imp-head">{t("billing.acctb.import.headerRow")}</Label>
                  <Input id="imp-head" type="number" min={1} value={headerRow === undefined ? "" : headerRow + 1} onChange={(e) => setHeaderRow(e.target.value ? Math.max(0, Number(e.target.value) - 1) : undefined)} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="imp-order">{t("billing.acctb.import.dateOrder")}</Label>
                  <Select value={dateOrder} onValueChange={(v) => setDateOrder(v as "dmy" | "mdy")}>
                    <SelectTrigger id="imp-order" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dmy">{t("billing.acctb.import.dmy")}</SelectItem>
                      <SelectItem value="mdy">{t("billing.acctb.import.mdy")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="outline" onClick={() => void run({ mapping, headerRow })} disabled={read.isPending}>
                  <RefreshCwIcon /> {t("billing.acctb.import.readAgain")}
                </Button>
              </div>
              <details className="rounded-xl border p-3">
                <summary className="cursor-pointer text-sm font-medium">{t("billing.acctb.import.sample")}</summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="text-xs">
                    <tbody>
                      {preview.sample.map((r, i) => (
                        <tr key={i} className={i === preview.headerRow ? "bg-primary/10 font-semibold" : undefined}>
                          <td className="pr-2 text-muted-foreground">{i + 1}</td>
                          {r.map((c, j) => (
                            <td key={j} className="max-w-48 truncate border-l px-2 py-1">
                              {c}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </CardContent>
          </Card>

          {preview.errors.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangleIcon />
              <AlertTitle>{t("billing.acctb.import.errors", { count: preview.counts.errors })}</AlertTitle>
              <AlertDescription>
                <ul className="mt-1 list-disc pl-4">
                  {preview.errors.slice(0, 10).map((e) => (
                    <li key={e.row}>{t("billing.acctb.import.errorRow", { row: e.row, message: e.message })}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-2">
              <p className="font-medium">{t("billing.acctb.import.linesFound", { count: preview.counts.lines })}</p>
              {preview.closingBalance !== null && <p className="text-meta text-muted-foreground">{t("billing.acctb.import.closing", { amount: money(preview.closingBalance) })}</p>}
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("billing.accounting.date")}</TableHead>
                    <TableHead>{t("billing.acctb.field.narration")}</TableHead>
                    <TableHead>{t("billing.acctb.field.reference")}</TableHead>
                    <TableHead className="text-right">{t("billing.accounting.amount")}</TableHead>
                    <TableHead className="text-right">{t("billing.acctb.field.balance")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.lines.map((l) => (
                    <TableRow key={`${l.row}-${l.date}`} className={l.duplicate ? "opacity-60" : undefined}>
                      <TableCell className="whitespace-nowrap">{d(l.date)}</TableCell>
                      <TableCell className="max-w-80 truncate">{l.narration}</TableCell>
                      <TableCell className="font-mono text-xs">{l.reference ?? ""}</TableCell>
                      <TableCell className="text-right">
                        <Signed v={l.amount} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{l.balance === null ? "" : money(l.balance)}</TableCell>
                      <TableCell>{l.duplicate && <StatusPill tone="neutral">{t("billing.acctb.import.dup")}</StatusPill>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Panel>

          {done ? (
            <Alert>
              <CheckCircle2Icon />
              <AlertTitle>{t("billing.acctb.import.done", { added: done.added, duplicates: done.duplicates })}</AlertTitle>
              <AlertDescription>
                <Button size="sm" className="mt-2" asChild>
                  <ModuleLink to={`accounting/bank/reconcile?accountId=${accountId}`}>{t("billing.acctb.import.goMatch")}</ModuleLink>
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-3">
              <p className="text-meta text-muted-foreground">{t("billing.acctb.import.safe")}</p>
              <Button size="lg" onClick={doImport} disabled={save.isPending || preview.counts.new === 0}>
                {t("billing.acctb.import.importN", { count: preview.counts.new })}
              </Button>
            </div>
          )}
        </div>
      )}
    </AccountingPage>
  );
}
