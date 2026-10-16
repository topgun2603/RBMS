"use client";

import * as React from "react";
import { CheckCircle2Icon, DownloadIcon, FileTextIcon, Loader2Icon, ReceiptIcon, XCircleIcon } from "lucide-react";
import { Button, cn, EmptyState, motion, Skeleton, StatusPill, toast, useReducedMotionSafe } from "@srirealtime/ui";
import { describeError, formatPaise, QueryError, useI18n, type PlatformInvoice } from "@srirealtime/web";
import { downloadInvoicePdf, usePlatformInvoices } from "../../lib/subscriptions";
import { SectionCard } from "./section-card";

/** Srirealtime's GST invoices for the plan: number, date, period, total (GST split) and the PDF. */
export function PlatformInvoices({ planName }: { planName: (id: string) => string }) {
  const { t, formatDate } = useI18n();
  const reduced = useReducedMotionSafe();
  const invoices = usePlatformInvoices();
  const [downloading, setDownloading] = React.useState<string | null>(null);
  const d = (iso: string | null) => (iso ? formatDate(iso, { day: "numeric", month: "short", year: "numeric" }) : "—");

  const download = async (inv: PlatformInvoice) => {
    setDownloading(inv.id);
    try {
      await downloadInvoicePdf(inv);
      toast.success(t("workspace.common.downloaded"));
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <SectionCard icon={ReceiptIcon} title={t("workspace.plan.invoices.title")} description={t("workspace.plan.invoices.subtitle")}>
      {invoices.isError ? (
        <QueryError compact error={invoices.error} onRetry={() => void invoices.refetch()} />
      ) : invoices.isPending ? (
        <div className="grid gap-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      ) : invoices.data.length === 0 ? (
        <EmptyState compact icon={FileTextIcon} title={t("workspace.plan.invoices.empty")} description={t("workspace.plan.invoices.emptyHint")} />
      ) : (
        <ul className="divide-y rounded-xl border">
          {invoices.data.map((inv, i) => {
            const gst = inv.cgstPaise + inv.sgstPaise + inv.igstPaise;
            const isVoid = inv.status === "void";
            return (
              <motion.li
                key={inv.id}
                initial={reduced ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: reduced ? 0 : i * 0.03 }}
                className="flex items-center gap-3 px-3 py-2.5 sm:px-4"
              >
                <span className="icon-chip hidden size-9 shrink-0 rounded-xl text-primary sm:flex">
                  <FileTextIcon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className={cn("font-mono text-sm font-medium", isVoid && "line-through opacity-70")}>{inv.number}</span>
                    <StatusPill tone={isVoid ? "neutral" : "success"} icon={isVoid ? XCircleIcon : CheckCircle2Icon}>
                      {t(isVoid ? "workspace.plan.invoices.void" : "workspace.plan.invoices.paid")}
                    </StatusPill>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {planName(inv.planId)} · {t("workspace.plan.invoices.period", { from: d(inv.periodStart ?? inv.createdAt), to: d(inv.periodEnd) })}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-semibold tabular-nums">{formatPaise(inv.totalPaise)}</div>
                  <div className="hidden text-xs text-muted-foreground tabular-nums sm:block">{t("workspace.plan.invoices.gst", { amount: formatPaise(gst) })}</div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => void download(inv)}
                  disabled={downloading === inv.id}
                  aria-label={t("workspace.plan.invoices.download", { number: inv.number })}
                >
                  {downloading === inv.id ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
                  <span className="hidden sm:inline">{t("workspace.plan.invoices.pdf")}</span>
                </Button>
              </motion.li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
