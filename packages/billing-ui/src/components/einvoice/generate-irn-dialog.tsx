"use client";

import * as React from "react";
import { ApiError, describeError, useI18n } from "@srirealtime/web";
import { AlertTriangleIcon, CheckCircle2Icon, CircleAlertIcon, Loader2Icon, ShieldCheckIcon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  AnimatePresence,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  motion,
  Skeleton,
  toast,
  useReducedMotionSafe,
} from "@srirealtime/ui";
import { splitIssues, type EInvoiceIssue, type GenerateIrnResult } from "../../lib/einvoice";
import { useEInvoiceAction, useEInvoicePreview } from "../../lib/queries-growth";

/** Preview (NIC rules) → list errors (block) and warnings (allow) → generate the IRN. */
export function GenerateIrnDialog({ invoiceId, open, onOpenChange }: { invoiceId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const preview = useEInvoicePreview();
  const action = useEInvoiceAction(invoiceId);
  const [error, setError] = React.useState<{ message: string; issues: EInvoiceIssue[] } | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setError(null);
    preview.reset();
    preview.mutate(invoiceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run when opened
  }, [open, invoiceId]);

  const { errors, warnings } = splitIssues(preview.data?.issues);
  const blocked = errors.length > 0;
  const busy = action.isPending;

  const generate = async () => {
    setError(null);
    try {
      const r = (await action.mutateAsync({ kind: "irn" })) as GenerateIrnResult;
      toast.success(r.alreadyGenerated ? t("billing.einvoice.alreadyGenerated") : t("billing.einvoice.generated"));
      onOpenChange(false);
    } catch (err) {
      const issues = err instanceof ApiError ? ((err.details as { issues?: EInvoiceIssue[] } | undefined)?.issues ?? []) : [];
      setError({ message: describeError(err, t), issues });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("billing.einvoice.preview.title")}</DialogTitle>
          <DialogDescription>{t("billing.einvoice.statusNoneHint")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3" aria-live="polite">
          {preview.isPending ? (
            <div className="grid gap-2" role="status">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" /> {t("billing.einvoice.preview.checking")}
              </p>
              <Skeleton className="h-14 rounded-lg" />
              <Skeleton className="h-10 rounded-lg" />
            </div>
          ) : preview.isError ? (
            <Alert variant="destructive">
              <AlertTriangleIcon />
              <AlertTitle>{t("billing.einvoice.preview.failed")}</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                <span>{describeError(preview.error, t)}</span>
                <Button variant="outline" size="sm" onClick={() => preview.mutate(invoiceId)}>
                  {t("billing.common.retry")}
                </Button>
              </AlertDescription>
            </Alert>
          ) : preview.data ? (
            <>
              {!blocked && warnings.length === 0 && (
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-3 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success-ink">
                  <ShieldCheckIcon className="mt-0.5 size-4 shrink-0" />
                  <p>{t("billing.einvoice.preview.ok")}</p>
                </motion.div>
              )}
              {blocked && (
                <IssueList tone="error" title={t("billing.einvoice.preview.errorsTitle", { count: errors.length })} issues={errors} footer={t("billing.einvoice.preview.blocked")} />
              )}
              {warnings.length > 0 && <IssueList tone="warning" title={t("billing.einvoice.preview.warningsTitle", { count: warnings.length })} issues={warnings} />}
            </>
          ) : null}

          <AnimatePresence initial={false}>
            {error && (
              <motion.div key="err" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <Alert variant="destructive">
                  <AlertTriangleIcon />
                  <AlertTitle>{error.message}</AlertTitle>
                  {error.issues.length > 1 && (
                    <AlertDescription>
                      <ul className="list-disc pl-4">
                        {error.issues.slice(1, 6).map((i) => (
                          <li key={`${i.path}-${i.code}`}>{i.message}</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  )}
                </Alert>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("billing.common.close")}
          </Button>
          {!blocked && preview.data && (
            <Button onClick={() => void generate()} disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : <CheckCircle2Icon />}
              {busy
                ? t("billing.einvoice.generating")
                : warnings.length
                  ? t("billing.einvoice.preview.continueAnyway")
                  : t("billing.einvoice.preview.continue")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IssueList({ tone, title, issues, footer }: { tone: "error" | "warning"; title: string; issues: EInvoiceIssue[]; footer?: string }) {
  const reduced = useReducedMotionSafe();
  const error = tone === "error";
  return (
    <section
      className={
        error
          ? "grid gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3"
          : "grid gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3"
      }
    >
      <h3 className={error ? "flex items-center gap-2 text-sm font-semibold text-danger-ink" : "flex items-center gap-2 text-sm font-semibold text-warning-ink"}>
        {error ? <CircleAlertIcon className="size-4" /> : <AlertTriangleIcon className="size-4" />}
        {title}
      </h3>
      <ul className="grid gap-1.5">
        {issues.map((i, n) => (
          <motion.li
            key={`${i.path}-${i.code}-${n}`}
            initial={reduced ? false : { opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: reduced ? 0 : n * 0.03 }}
            className="text-sm"
          >
            <p>{i.message}</p>
            <p className="font-mono text-[0.6875rem] text-muted-foreground">{i.path}</p>
          </motion.li>
        ))}
      </ul>
      {footer && <p className="text-meta text-muted-foreground">{footer}</p>}
    </section>
  );
}
