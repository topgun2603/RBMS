"use client";

import * as React from "react";
import { ArrowLeftIcon, BanknoteIcon, CheckCircle2Icon, FileDownIcon, FileSpreadsheetIcon, LandmarkIcon, Loader2Icon, LockIcon, RefreshCwIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldError,
  FieldLabel,
  Input,
  Skeleton,
  StatCard,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@rbms/ui";
import { ConfirmDialog, describeError, ModuleLink, Page, PageHeading, useI18n, useModuleNavigate, useRouteParams } from "@rbms/web";
import { InlineError, RunPill, WarningPills } from "../components/bits";
import { LineDialog } from "../components/line-dialog";
import { PayDialog } from "../components/pay-dialog";
import { hours, money, monthName } from "../lib/format";
import { FILES, useRun, useRunActions } from "../lib/queries";
import type { RunLine } from "../lib/types";

/** One month's payroll: totals, every person's line, then make final, pay, download the register, bank sheet and payslips. */
export default function RunPage() {
  const { id } = useRouteParams<{ id: string }>();
  const { t, locale } = useI18n();
  const navigate = useModuleNavigate();
  const run = useRun(id);
  const a = useRunActions(id);
  const [line, setLine] = React.useState<RunLine | null>(null);
  const [paying, setPaying] = React.useState<RunLine[] | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [finalizing, setFinalizing] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const r = run.data;

  if (run.isError) return <Page><InlineError title={describeError(run.error, t)} /></Page>;
  if (!r) return <Page><Skeleton className="h-96" /></Page>;

  const draft = r.status === "draft";
  const final = r.status === "finalized";
  const unpaid = r.lines.filter((l) => !l.payment && l.net > 0);
  const tot = r.totals;
  const fail = (err: unknown) => toast.error(describeError(err, t));
  const dl = (p: Promise<void>) => p.catch(fail);

  return (
    <Page width="full">
      <PageHeading
        title={t("payroll.run.title", { month: monthName(r.month, locale) })}
        description={<RunPill status={r.status} />}
        actions={
          <>
            <Button asChild variant="ghost">
              <ModuleLink to="payroll">
                <ArrowLeftIcon /> {t("payroll.nav.payroll")}
              </ModuleLink>
            </Button>
            {draft && (
              <>
                <Button variant="outline" disabled={a.refresh.isPending} onClick={() => a.refresh.mutateAsync().then(() => toast.success(t("payroll.run.refreshed")), fail)}>
                  {a.refresh.isPending ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} {t("payroll.run.refresh")}
                </Button>
                <Button onClick={() => setFinalizing(true)}>
                  <CheckCircle2Icon /> {t("payroll.run.finalize")}
                </Button>
              </>
            )}
            {final && unpaid.length > 0 && (
              <Button onClick={() => setPaying(selected.size ? unpaid.filter((l) => selected.has(l.id)) : unpaid)}>
                <BanknoteIcon /> {selected.size ? t("payroll.run.paySelected", { count: selected.size }) : t("payroll.run.payAll", { count: unpaid.length })}
              </Button>
            )}
            {r.status !== "cancelled" && (
              <Button variant="ghost" className="text-destructive" onClick={() => setCancelling(true)}>
                <Trash2Icon /> {draft ? t("payroll.run.delete") : t("payroll.run.cancel")}
              </Button>
            )}
          </>
        }
      />
      {r.status === "cancelled" && (
        <Alert>
          <LockIcon />
          <AlertTitle>{t("payroll.run.cancelledTitle")}</AlertTitle>
          <AlertDescription>{r.cancelReason}</AlertDescription>
        </Alert>
      )}
      {draft && (
        <Alert>
          <RefreshCwIcon />
          <AlertTitle>{t("payroll.run.draftTitle")}</AlertTitle>
          <AlertDescription>{t("payroll.run.draftBody")}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title={t("payroll.col.gross")} value={money(tot?.gross)} description={t("payroll.run.staffN", { count: tot?.staff ?? 0 })} />
        <StatCard title={t("payroll.col.deductions")} value={money(tot?.deductions)} description={t("payroll.run.dedBreakdown", { pf: money(tot?.pfEmployee), esi: money(tot?.esiEmployee), pt: money(tot?.pt) })} />
        <StatCard title={t("payroll.col.net")} value={money(tot?.net)} description={final ? t("payroll.run.paidAmount", { amount: money(r.paid.amount) }) : undefined} />
        <StatCard title={t("payroll.run.cost")} value={money(tot?.employerCost)} description={t("payroll.run.costHint", { pf: money(tot?.pfEmployer), esi: money(tot?.esiEmployer) })} />
      </div>
      {final && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => dl(FILES.registerCsv(r))}>
            <FileSpreadsheetIcon /> {t("payroll.run.register")}
          </Button>
          <Button variant="outline" onClick={() => dl(FILES.bankSheetCsv(r))}>
            <LandmarkIcon /> {t("payroll.run.bankSheet")}
          </Button>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            {final && <TableHead className="w-8" />}
            <TableHead>{t("payroll.col.name")}</TableHead>
            <TableHead numeric>{t("payroll.col.paidDays")}</TableHead>
            <TableHead numeric>{t("payroll.col.lop")}</TableHead>
            <TableHead numeric>{t("payroll.col.otHours")}</TableHead>
            <TableHead numeric>{t("payroll.col.gross")}</TableHead>
            <TableHead numeric>{t("payroll.col.deductions")}</TableHead>
            <TableHead numeric>{t("payroll.col.net")}</TableHead>
            <TableHead>{t("payroll.col.payment")}</TableHead>
            {final && <TableHead className="text-right">{t("payroll.run.payslip")}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {r.lines.map((l) => (
            <TableRow key={l.id} className="cursor-pointer" onClick={() => setLine(l)}>
              {final && (
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {!l.payment && l.net > 0 && (
                    <Checkbox
                      aria-label={t("payroll.run.select", { name: l.snapshot.name })}
                      checked={selected.has(l.id)}
                      onCheckedChange={(v) =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (v) n.add(l.id);
                          else n.delete(l.id);
                          return n;
                        })
                      }
                    />
                  )}
                </TableCell>
              )}
              <TableCell>
                <span className="grid gap-0.5">
                  <span className="font-medium">{l.snapshot.name}</span>
                  <span className="text-meta text-muted-foreground">
                    {l.snapshot.code} · {t(`payroll.payType.${l.snapshot.payType}`)}
                  </span>
                  <WarningPills warnings={l.warnings} />
                </span>
              </TableCell>
              <TableCell numeric>{l.paidDays}</TableCell>
              <TableCell numeric>{l.days.lopDays || "—"}</TableCell>
              <TableCell numeric>{l.days.overtimeMinutes ? hours(l.days.overtimeMinutes) : "—"}</TableCell>
              <TableCell numeric>{money(l.gross)}</TableCell>
              <TableCell numeric>{money(l.totalDeductions)}</TableCell>
              <TableCell numeric className="font-semibold">
                {money(l.net)}
              </TableCell>
              <TableCell onClick={(e) => e.stopPropagation()}>
                {l.payment ? (
                  <span className="inline-flex items-center gap-1">
                    <StatusPill tone="success">{t("payroll.run.paidVia", { method: t(`payroll.method.${l.payment.method}`) })}</StatusPill>
                    <Button size="icon" variant="ghost" className="size-7" aria-label={t("payroll.run.undoPay")} onClick={() => a.unpay.mutateAsync(l.payment!.id).then(() => toast.success(t("payroll.run.unpaid")), fail)}>
                      <Undo2Icon />
                    </Button>
                  </span>
                ) : final ? (
                  <span className="text-muted-foreground">{t(`payroll.method.${l.snapshot.payMethod}`)}</span>
                ) : (
                  "—"
                )}
              </TableCell>
              {final && (
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <span className="inline-flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => dl(FILES.payslip(l.id, "en", `payslip-${l.snapshot.code}-${r.month}.pdf`))}>
                      <FileDownIcon /> EN
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => dl(FILES.payslip(l.id, "ta", `payslip-${l.snapshot.code}-${r.month}-ta.pdf`))}>
                      <FileDownIcon /> தமிழ்
                    </Button>
                  </span>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <LineDialog runId={r.id} line={line ? (r.lines.find((x) => x.id === line.id) ?? null) : null} draft={draft} onOpenChange={(o) => !o && setLine(null)} />
      <PayDialog
        runId={r.id}
        lines={paying}
        onOpenChange={(o) => {
          if (!o) {
            setPaying(null);
            setSelected(new Set());
          }
        }}
      />
      <ConfirmDialog
        open={finalizing}
        onOpenChange={setFinalizing}
        title={t("payroll.run.finalizeTitle", { month: monthName(r.month, locale) })}
        description={t("payroll.run.finalizeBody", { amount: money(tot?.net) })}
        confirmLabel={t("payroll.run.finalize")}
        onConfirm={async () => {
          try {
            await a.finalize.mutateAsync();
            toast.success(t("payroll.run.finalized"));
            setFinalizing(false);
          } catch (err) {
            fail(err);
          }
        }}
      />
      <CancelRunDialog
        open={cancelling}
        draft={draft}
        onOpenChange={setCancelling}
        onConfirm={async (reason) => {
          const res = await a.cancel.mutateAsync(reason);
          toast.success(res.deleted ? t("payroll.run.deleted") : t("payroll.run.cancelled"));
          setCancelling(false);
          if (res.deleted) navigate("payroll");
        }}
      />
    </Page>
  );
}

function CancelRunDialog({ open, draft, onOpenChange, onConfirm }: { open: boolean; draft: boolean; onOpenChange: (o: boolean) => void; onConfirm: (reason: string | null) => Promise<void> }) {
  const { t } = useI18n();
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
    }
  }, [open]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft && reason.trim().length < 2) return setError(t("payroll.mark.reasonRequired"));
    setBusy(true);
    try {
      await onConfirm(draft ? null : reason.trim());
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("payroll.common.close")} className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{draft ? t("payroll.run.deleteTitle") : t("payroll.run.cancelTitle")}</DialogTitle>
            <DialogDescription>{draft ? t("payroll.run.deleteBody") : t("payroll.run.cancelBody")}</DialogDescription>
          </DialogHeader>
          {error && <InlineError title={error} />}
          {!draft && (
            <Field>
              <FieldLabel>{t("payroll.mark.reason")}</FieldLabel>
              <FieldControl>
                <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
              </FieldControl>
              <FieldError />
            </Field>
          )}
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={busy}>
              {busy && <Loader2Icon className="animate-spin" />}
              {draft ? t("payroll.run.delete") : t("payroll.run.cancel")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
