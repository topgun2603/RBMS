"use client";

import * as React from "react";
import { BookOpenCheckIcon, LockIcon, PlayIcon, SearchCheckIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle, Button, Card, CardContent, EmptyState, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, toast } from "@rbms/ui";
import { ConfirmDialog, describeError, ModuleLink, Page, PageHeading, QueryError, useI18n } from "@rbms/web";
import { DownloadCsvButton } from "../reports/report-ui";
import { ACC, ACC_POST, ACC_VIEW, accountingPdfPath, sideAmount, useAccountingBranches, useAccountingOverview, useBackfill, type Account } from "../../lib/accounting";
import { useHasPermission } from "../../lib/access";
import { money } from "../../lib/format";
import { usePdf } from "../../lib/pdf";

/** A balance as "₹1,234.00 Dr" / "Cr" (net is debit-positive). */
export function Balance({ net, className }: { net: number; className?: string }) {
  const { t } = useI18n();
  const s = sideAmount(net);
  return (
    <span className={className}>
      <span className="tabular-nums">{money(s.amount)}</span>
      {s.side && (
        <abbr title={t(s.side === "dr" ? "billing.accounting.debit" : "billing.accounting.credit")} className="ml-1 text-xs text-muted-foreground no-underline">
          {s.side === "dr" ? t("billing.accounting.drShort") : t("billing.accounting.crShort")}
        </abbr>
      )}
    </span>
  );
}

/** A plain amount, blank when zero. */
export const Amt = ({ v, bold }: { v: number; bold?: boolean }) =>
  v === 0 ? <span className="text-muted-foreground">-</span> : <span className={bold ? "font-semibold tabular-nums" : "tabular-nums"}>{money(v)}</span>;

/** The page frame: permission check, heading, and the "set up your books" banner while posting is off. */
export function AccountingPage({
  title,
  description,
  icon,
  actions,
  needsSetup = true,
  children,
}: {
  title: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  actions?: React.ReactNode;
  /** Show the setup banner when the books are not switched on yet (default). */
  needsSetup?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const allowed = useHasPermission(ACC_VIEW);
  const overview = useAccountingOverview(allowed);
  if (!allowed) {
    return (
      <Page>
        <PageHeading icon={icon} title={title} description={description} />
        <EmptyState icon={LockIcon} title={t("billing.accounting.noAccessTitle")} description={t("billing.accounting.noAccessBody")} />
      </Page>
    );
  }
  return (
    <Page>
      <PageHeading icon={icon} title={title} description={description} actions={actions} />
      {needsSetup && overview.data && !overview.data.autoPost && <SetupBanner />}
      {overview.data?.lockedThrough && (
        <p className="mb-4 flex items-center gap-1.5 text-meta text-muted-foreground" data-print-hide>
          <LockIcon className="size-3.5" aria-hidden /> {t("billing.accounting.lockedThrough", { date: overview.data.lockedThrough })}
        </p>
      )}
      {overview.isError && !overview.data ? <QueryError error={overview.error} onRetry={() => void overview.refetch()} /> : children}
    </Page>
  );
}

/** Shown until the history has been posted: preview first, then post. */
export function SetupBanner() {
  const { t } = useI18n();
  const canPost = useHasPermission(ACC_POST);
  const run = useBackfill();
  const [preview, setPreview] = React.useState<{ posted: number } | null>(null);
  const [confirmPost, setConfirmPost] = React.useState(false);
  const doPreview = async () => {
    try {
      const r = await run.mutateAsync({ dryRun: true });
      setPreview({ posted: r.posted });
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const doPost = async () => {
    try {
      const r = await run.mutateAsync({});
      toast.success(t("billing.accounting.setup.done", { count: r.posted }));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <Alert className="mb-section" data-print-hide>
      <BookOpenCheckIcon />
      <AlertTitle>{t("billing.accounting.setup.title")}</AlertTitle>
      <AlertDescription>
        <p>{t("billing.accounting.setup.body")}</p>
        {preview && <p className="mt-2 font-medium text-foreground">{t("billing.accounting.setup.preview", { count: preview.posted })}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {canPost ? (
            <>
              <Button size="sm" variant="outline" onClick={doPreview} disabled={run.isPending}>
                <SearchCheckIcon /> {t("billing.accounting.setup.previewButton")}
              </Button>
              <Button size="sm" onClick={() => setConfirmPost(true)} disabled={run.isPending}>
                <PlayIcon /> {t("billing.accounting.setup.postButton")}
              </Button>
            </>
          ) : (
            <span className="text-meta">{t("billing.accounting.setup.askAccountant")}</span>
          )}
          <Button size="sm" variant="ghost" asChild>
            <ModuleLink to="accounting/how-it-works">{t("billing.accounting.nav.howItWorks")}</ModuleLink>
          </Button>
        </div>
      </AlertDescription>
      <ConfirmDialog
        open={confirmPost}
        onOpenChange={setConfirmPost}
        destructive={false}
        title={t("billing.accounting.setup.confirmTitle")}
        description={t("billing.accounting.setup.confirmBody")}
        confirmLabel={t("billing.accounting.setup.postButton")}
        onConfirm={doPost}
      />
    </Alert>
  );
}

/** Date range (two inputs) with CSV and PDF downloads of the same report. */
export function ReportBar({
  report,
  params,
  from,
  to,
  onFrom,
  onTo,
  single,
  children,
}: {
  report: string;
  params: Record<string, string | undefined>;
  from?: string;
  to: string;
  onFrom?: (v: string) => void;
  onTo: (v: string) => void;
  /** Only one date ("as on"). */
  single?: boolean;
  children?: React.ReactNode;
}) {
  const { t } = useI18n();
  const pdf = usePdf();
  const query = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== "")) as Record<string, string>;
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3" data-print-hide>
      {!single && from !== undefined && onFrom && (
        <div className="grid gap-1.5">
          <Label htmlFor={`${report}-from`}>{t("billing.range.from")}</Label>
          <Input id={`${report}-from`} type="date" className="w-40" value={from} max={to} onChange={(e) => e.target.value && onFrom(e.target.value)} />
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor={`${report}-to`}>{single ? t("billing.accounting.asOn") : t("billing.range.to")}</Label>
        <Input id={`${report}-to`} type="date" className="w-40" value={to} onChange={(e) => e.target.value && onTo(e.target.value)} />
      </div>
      {children}
      <div className="ml-auto flex flex-wrap gap-2">
        <DownloadCsvButton path={`${ACC}/reports/${report}`} params={query} fileName={`${report}-${to}.csv`} />
        <Button
          type="button"
          variant="outline"
          className="h-11 sm:h-9"
          disabled={pdf.busy === report}
          onClick={() => void pdf.run(report, accountingPdfPath(report), { query, mode: "download", fallbackName: `${report}.pdf` })}
        >
          {pdf.busy === report ? t("billing.common.downloading") : t("billing.accounting.downloadPdf")}
        </Button>
      </div>
    </div>
  );
}

/** Pick an account (grouped by type) with the account code in front. */
/**
 * Branch filter of the reports: "" = the whole shop, "none" = head office / unassigned, else a branch id. Shown only
 * when the shop has branches.
 */
export function BranchSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const branches = useAccountingBranches();
  const list = branches.data ?? [];
  if (!list.some((b) => b.id !== null)) return null;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="accounting-branch">{t("billing.accounting.branch.label")}</Label>
      <Select value={value || "all"} onValueChange={(v) => onChange(v === "all" ? "" : v)}>
        <SelectTrigger id="accounting-branch" className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("billing.accounting.branch.all")}</SelectItem>
          {list.map((b) => (
            <SelectItem key={b.id ?? "none"} value={b.id ?? "none"}>
              {b.id === null ? t("billing.accounting.branch.unassigned") : b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Whether the shop has branches (the branch filter and the branch-by-branch profit and loss are shown). */
export function useHasBranches() {
  const branches = useAccountingBranches();
  return (branches.data ?? []).some((b) => b.id !== null);
}

export function AccountSelect({
  value,
  onChange,
  accounts,
  placeholder,
  filter,
  id,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (id: string) => void;
  accounts: Account[];
  placeholder?: string;
  filter?: (a: Account) => boolean;
  id?: string;
  "aria-label"?: string;
}) {
  const { t } = useI18n();
  const list = accounts.filter((a) => a.active && (filter ? filter(a) : true));
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} aria-label={ariaLabel} className="w-full">
        <SelectValue placeholder={placeholder ?? t("billing.accounting.pickAccount")} />
      </SelectTrigger>
      <SelectContent>
        {list.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.code} · {a.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function TableSkeleton() {
  return <Skeleton className="h-64 rounded-2xl" />;
}

export function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardContent className="px-0 sm:px-2">{children}</CardContent>
    </Card>
  );
}
