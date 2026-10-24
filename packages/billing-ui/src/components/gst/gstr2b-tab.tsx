"use client";

import * as React from "react";
import {
  AlertTriangleIcon,
  BanIcon,
  CheckCircle2Icon,
  CircleHelpIcon,
  FileSpreadsheetIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
  UploadCloudIcon,
  XIcon,
} from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  ChipGroup,
  cn,
  EmptyState,
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
  type StatusTone,
} from "@srirealtime/ui";
import { ConfirmDialog, describeError, QueryError, useI18n } from "@srirealtime/web";
import { money } from "../../lib/format";
import {
  G,
  MATCH_STATUSES,
  monthOfPeriod,
  taxTotal,
  useAct2b,
  useDelete2b,
  useImport2b,
  useRematch2b,
  useRows2b,
  useSuppliers2b,
  useSummary2b,
  type MatchStatus,
  type Row2b,
  type Summary2b,
} from "../../lib/gst";
import { FileButton, PeriodPicker, Section, ViewOnlyNote, useCanManage, useGstText, usePeriodLabel } from "./shared";

const PAGE = 50;
const TONE: Record<MatchStatus, StatusTone> = { matched: "success", fuzzy: "warning", amount_mismatch: "danger", missing_in_books: "danger", accepted: "info", ignored: "neutral" };
const ICON: Record<MatchStatus, React.ComponentType<{ className?: string }>> = {
  matched: CheckCircle2Icon,
  fuzzy: CircleHelpIcon,
  amount_mismatch: AlertTriangleIcon,
  missing_in_books: AlertTriangleIcon,
  accepted: CheckCircle2Icon,
  ignored: BanIcon,
};
type View = "rows" | "suppliers" | "risk";

export function MatchPill({ status }: { status: MatchStatus }) {
  const { t } = useI18n();
  return (
    <StatusPill tone={TONE[status]} icon={ICON[status]}>
      {t(`billing.gst.b2.status.${status}`)}
    </StatusPill>
  );
}

export function Gstr2bTab({ period, onPeriod }: { period: string; onPeriod: (p: string) => void }) {
  const { t } = useI18n();
  const month = monthOfPeriod(period);
  const summary = useSummary2b(month);
  const s = summary.data;
  return (
    <div className="grid grid-cols-1 gap-5">
      <Card className="px-card">
        <div className="flex flex-wrap items-end gap-3">
          <PeriodPicker value={month} onChange={onPeriod} kind="month" id="b2-month" />
        </div>
        <p className="text-meta text-muted-foreground">{t("billing.gst.b2.intro")}</p>
      </Card>
      {summary.isError && !s ? (
        <QueryError error={summary.error} onRetry={() => void summary.refetch()} />
      ) : !s ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : s.month !== month ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : !s.imported ? (
        <UploadCard month={month} />
      ) : (
        <Imported month={month} s={s} />
      )}
    </div>
  );
}

/** Drag a file here or choose one. Nothing is sent to the GST portal. */
function UploadCard({ month, compact }: { month: string; compact?: boolean }) {
  const { t } = useI18n();
  const label = usePeriodLabel();
  const canManage = useCanManage();
  const imp = useImport2b();
  const input = React.useRef<HTMLInputElement>(null);
  const [over, setOver] = React.useState(false);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.(json|xlsx)$/i.test(file.name)) {
      toast.error(t("billing.gst.b2.badFile"));
      return;
    }
    try {
      const r = await imp.mutateAsync({ file, month });
      toast.success(t("billing.gst.b2.imported", { count: r.rows }));
      if (r.warnings?.length) toast.warning(r.warnings.slice(0, 3).join(" · "));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  if (!canManage) {
    return (
      <div className="grid grid-cols-1 gap-3">
        <EmptyState icon={FileSpreadsheetIcon} title={t("billing.gst.b2.noneTitle", { month: label(month) })} description={t("billing.gst.b2.noneBody")} />
        <ViewOnlyNote />
      </div>
    );
  }
  return (
    <Card className="px-card">
      <div
        className={cn("flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-10 text-center transition-colors", over ? "border-primary bg-primary/5" : "border-border", compact && "py-6")}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void upload(e.dataTransfer.files[0]);
        }}
      >
        <span className="icon-chip size-12 text-primary">{imp.isPending ? <RefreshCwIcon className="size-5 animate-spin" /> : <UploadCloudIcon className="size-5" />}</span>
        <div className="space-y-1">
          <p className="font-heading text-base font-semibold">{t(compact ? "billing.gst.b2.uploadAgain" : "billing.gst.b2.uploadTitle", { month: label(month) })}</p>
          <p className="mx-auto max-w-lg text-sm text-muted-foreground">{t("billing.gst.b2.uploadBody")}</p>
        </div>
        <input
          ref={input}
          type="file"
          accept=".json,.xlsx,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          aria-label={t("billing.gst.b2.chooseFile")}
          onChange={(e) => {
            void upload(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button type="button" disabled={imp.isPending} onClick={() => input.current?.click()}>
          <FileSpreadsheetIcon />
          {t("billing.gst.b2.chooseFile")}
        </Button>
        <p className="text-meta text-muted-foreground">{t("billing.gst.b2.privacy")}</p>
      </div>
      {!compact && (
        <ol className="mt-4 grid list-decimal gap-1 pl-5 text-sm text-muted-foreground">
          <li>{t("billing.gst.b2.step1")}</li>
          <li>{t("billing.gst.b2.step2")}</li>
          <li>{t("billing.gst.b2.step3")}</li>
        </ol>
      )}
    </Card>
  );
}

function Imported({ month, s }: { month: string; s: Summary2b }) {
  const { t, formatDate } = useI18n();
  const text = useGstText();
  const canManage = useCanManage();
  const rematch = useRematch2b();
  const del = useDelete2b();
  const [view, setView] = React.useState<View>("rows");
  const [status, setStatus] = React.useState("all");
  const [supplier, setSupplier] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [offset, setOffset] = React.useState(0);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [uploadAgain, setUploadAgain] = React.useState(false);
  const deferred = React.useDeferredValue(search.trim());
  React.useEffect(() => setOffset(0), [month, status, supplier, deferred]);
  React.useEffect(() => {
    setStatus("all");
    setSupplier(null);
    setView("rows");
  }, [month]);

  const c = s.counts ?? {};
  const rowsQuery = useRows2b(month, { status: status === "all" ? undefined : status, supplier: supplier ?? undefined, q: deferred || undefined, limit: PAGE, offset }, view === "rows");
  const suppliers = useSuppliers2b(month, view === "suppliers");
  const facets = rowsQuery.data?.facets.status;
  const review = (c.fuzzy ?? 0) + (c.amount_mismatch ?? 0);

  const doRematch = async () => {
    try {
      await rematch.mutateAsync(month);
      toast.success(t("billing.gst.b2.rematched"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <div className="grid grid-cols-1 gap-5">
      <Card className="px-card">
        <div className="flex flex-wrap items-center gap-3">
          <span className="icon-chip size-10 text-primary">
            <FileSpreadsheetIcon className="size-5" />
          </span>
          <div className="min-w-0 flex-1 basis-60">
            <p className="font-medium">{s.import?.filename ?? t("billing.gst.b2.fileUnknown")}</p>
            <p className="text-meta text-muted-foreground">
              {t("billing.gst.b2.importInfo", {
                rows: s.import?.rowCount ?? 0,
                date: s.import?.importedAt ? formatDate(s.import.importedAt, { day: "numeric", month: "short", year: "numeric" }) : "",
              })}
              {s.import?.generatedOn ? ` · ${t("billing.gst.b2.generated", { date: s.import.generatedOn })}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <FileButton path={`${G}/gstr2b/${month}/export.csv`} params={{ kind: "rows" }} fileName={`GSTR2B_rows_${month}.csv`} label={t("billing.gst.b2.csvRows")} />
            <FileButton path={`${G}/gstr2b/${month}/export.csv`} params={{ kind: "suppliers" }} fileName={`GSTR2B_suppliers_${month}.csv`} label={t("billing.gst.b2.csvSuppliers")} />
            {canManage && (
              <>
                <Button type="button" variant="outline" className="h-11 sm:h-9" disabled={rematch.isPending} onClick={() => void doRematch()}>
                  <RefreshCwIcon className={rematch.isPending ? "animate-spin" : undefined} />
                  {t("billing.gst.b2.rematch")}
                </Button>
                <Button type="button" variant="outline" className="h-11 sm:h-9" aria-expanded={uploadAgain} onClick={() => setUploadAgain((v) => !v)}>
                  <UploadCloudIcon />
                  {t("billing.gst.b2.replace")}
                </Button>
                <Button type="button" variant="ghost" className="h-11 text-destructive sm:h-9" onClick={() => setConfirmDelete(true)}>
                  <Trash2Icon />
                  {t("billing.gst.b2.deleteImport")}
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>
      {uploadAgain && canManage && <UploadCard month={month} compact />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard title={t("billing.gst.b2.tileMatched")} value={(c.matched ?? 0) + (c.accepted ?? 0)} description={t("billing.gst.b2.tileMatchedHint")} icon={CheckCircle2Icon} />
        <StatCard title={t("billing.gst.b2.tileReview")} value={review} description={t("billing.gst.b2.tileReviewHint")} icon={CircleHelpIcon} iconClassName={review ? "text-warning-ink" : undefined} />
        <StatCard title={t("billing.gst.b2.tileMissingBooks")} value={c.missing_in_books ?? 0} description={t("billing.gst.b2.tileMissingBooksHint")} icon={AlertTriangleIcon} iconClassName={c.missing_in_books ? "text-danger-ink" : undefined} />
        <StatCard
          title={t("billing.gst.b2.tileMissing2b")}
          value={c.missing_in_2b ?? 0}
          description={t("billing.gst.b2.tileMissing2bHint", { amount: money(s.itcAtRisk ?? 0) })}
          icon={AlertTriangleIcon}
          iconClassName={c.missing_in_2b ? "text-danger-ink" : undefined}
        />
      </div>
      <p className="text-sm text-muted-foreground">{t("billing.gst.b2.totals", { tax2b: money(s.tax2b ?? 0), taxBooks: money(s.taxBooks ?? 0) })}</p>

      <ChipGroup
        aria-label={t("billing.gst.b2.viewLabel")}
        value={view}
        onChange={setView}
        options={[
          { value: "rows", label: t("billing.gst.b2.viewRows"), meta: s.import?.rowCount },
          { value: "suppliers", label: t("billing.gst.b2.viewSuppliers") },
          { value: "risk", label: t("billing.gst.b2.viewRisk"), meta: c.missing_in_2b ?? 0 },
        ]}
      />

      {view === "rows" && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="relative min-w-48 flex-1 sm:max-w-xs">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label={t("billing.gst.b2.search")} className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("billing.gst.b2.search")} />
            </div>
            {supplier && (
              <Button type="button" variant="secondary" size="sm" className="h-11 sm:h-9" onClick={() => setSupplier(null)}>
                {t("billing.gst.b2.supplierFilter", { gstin: supplier })}
                <XIcon />
              </Button>
            )}
          </div>
          <ChipGroup
            aria-label={t("billing.gst.b2.statusFilter")}
            value={status}
            onChange={setStatus}
            size="sm"
            options={[
              { value: "all", label: t("billing.gst.itc.statusAll"), meta: facets ? Object.values(facets).reduce((a, b) => a + b, 0) : undefined },
              ...MATCH_STATUSES.map((m) => ({ value: m, label: t(`billing.gst.b2.status.${m}`), meta: facets?.[m] ?? 0 })),
            ]}
          />
          {rowsQuery.isError && !rowsQuery.data ? (
            <QueryError error={rowsQuery.error} onRetry={() => void rowsQuery.refetch()} />
          ) : !rowsQuery.data ? (
            <Skeleton className="h-64 rounded-2xl" />
          ) : rowsQuery.data.items.length === 0 ? (
            <EmptyState icon={SearchIcon} title={t("billing.gst.b2.noRows")} description={t("billing.gst.b2.noRowsBody")} />
          ) : (
            <Section title={t("billing.gst.b2.rowsTitle", { count: rowsQuery.data.total })} flush>
              <div className={rowsQuery.isFetching ? "opacity-60 transition-opacity" : undefined}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("billing.gst.b2.colSupplier")}</TableHead>
                      <TableHead>{t("billing.gst.b2.colDoc")}</TableHead>
                      <TableHead numeric>{t("billing.gst.b2.colTax")}</TableHead>
                      <TableHead>{t("billing.gst.b2.colStatus")}</TableHead>
                      <TableHead className="min-w-56">{t("billing.gst.b2.colBooks")}</TableHead>
                      <TableHead className="w-52">
                        <span className="sr-only">{t("billing.gst.actions")}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rowsQuery.data.items.map((r) => (
                      <RowLine key={r.id} r={r} canManage={canManage} onSupplier={() => setSupplier(r.supplierGstin)} />
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 pt-3 text-sm sm:px-2">
                <span className="text-muted-foreground">{t("billing.gst.itc.showing", { from: offset + 1, to: Math.min(offset + PAGE, rowsQuery.data.total), total: rowsQuery.data.total })}</span>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" className="h-11 sm:h-9" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                    {t("billing.gst.prev")}
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-11 sm:h-9" disabled={offset + PAGE >= rowsQuery.data.total} onClick={() => setOffset(offset + PAGE)}>
                    {t("billing.gst.next")}
                  </Button>
                </div>
              </div>
            </Section>
          )}
        </>
      )}

      {view === "suppliers" &&
        (suppliers.isError && !suppliers.data ? (
          <QueryError error={suppliers.error} onRetry={() => void suppliers.refetch()} />
        ) : !suppliers.data ? (
          <Skeleton className="h-64 rounded-2xl" />
        ) : (
          <Section title={t("billing.gst.b2.suppliersTitle")} hint={t("billing.gst.b2.suppliersHint")} flush>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("billing.gst.b2.colSupplier")}</TableHead>
                  <TableHead numeric>{t("billing.gst.b2.colDocs")}</TableHead>
                  <TableHead numeric>{t("billing.gst.b2.col2b")}</TableHead>
                  <TableHead numeric>{t("billing.gst.b2.colBooksTax")}</TableHead>
                  <TableHead numeric>{t("billing.gst.b2.colDiff")}</TableHead>
                  <TableHead numeric>{t("billing.gst.b2.colOpen")}</TableHead>
                  <TableHead className="w-32">
                    <span className="sr-only">{t("billing.gst.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliers.data.map((x) => (
                  <TableRow key={x.gstin}>
                    <TableCell className="max-w-56 whitespace-normal">
                      {x.name ?? x.gstin}
                      <span className="block text-meta text-muted-foreground">{x.gstin}</span>
                    </TableCell>
                    <TableCell numeric>{x.docs}</TableCell>
                    <TableCell numeric>{money(x.tax2b)}</TableCell>
                    <TableCell numeric>{money(x.taxBooks)}</TableCell>
                    <TableCell numeric className={x.diff !== 0 ? "font-semibold text-danger-ink" : undefined}>
                      {money(x.diff)}
                    </TableCell>
                    <TableCell numeric>{x.open}</TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-11 sm:h-9"
                        onClick={() => {
                          setSupplier(x.gstin);
                          setView("rows");
                        }}
                      >
                        {t("billing.gst.b2.seeInvoices")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>
        ))}

      {view === "risk" && (
        <Section title={t("billing.gst.b2.riskTitle")} hint={t("billing.gst.b2.riskHint")} flush={!!s.missingIn2b?.length}>
          {!s.missingIn2b?.length ? (
            <p className="flex items-center gap-2 rounded-xl bg-success/10 p-4 text-sm text-success-ink">
              <CheckCircle2Icon className="size-4 shrink-0" />
              {t("billing.gst.b2.riskNone")}
            </p>
          ) : (
            <>
              <Alert variant="warning" className="mb-3 mx-4 w-auto sm:mx-2">
                <AlertTriangleIcon />
                <AlertTitle>{t("billing.gst.b2.riskAlert", { amount: money(s.itcAtRisk ?? 0) })}</AlertTitle>
                <AlertDescription>{t("billing.gst.b2.riskAdvice")}</AlertDescription>
              </Alert>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("billing.gst.itc.colDoc")}</TableHead>
                    <TableHead>{t("billing.gst.itc.colSupplier")}</TableHead>
                    <TableHead numeric>{t("billing.gst.itc.colTax")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.missingIn2b.map((m) => (
                    <TableRow key={m.docId}>
                      <TableCell className="whitespace-normal">
                        <span className="font-medium">{m.number}</span>
                        <span className="block text-meta text-muted-foreground">
                          {t(`billing.gst.doc.${m.docType}`)} · {text.dateText(m.date)}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-56 whitespace-normal">
                        {m.party}
                        <span className="block text-meta text-muted-foreground">{m.gstin ?? ""}</span>
                      </TableCell>
                      <TableCell numeric>{money(taxTotal(m.tax))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </Section>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("billing.gst.b2.deleteTitle")}
        description={t("billing.gst.b2.deleteBody")}
        confirmLabel={t("billing.gst.b2.deleteImport")}
        onConfirm={async () => {
          try {
            await del.mutateAsync(month);
            toast.success(t("billing.gst.b2.deleted"));
            setConfirmDelete(false);
          } catch (err) {
            toast.error(describeError(err, t));
          }
        }}
      />
    </div>
  );
}

const MONEY_FIELDS = new Set(["taxable", "igst", "cgst", "sgst", "cess", "docValue", "total"]);

function RowLine({ r, canManage, onSupplier }: { r: Row2b; canManage: boolean; onSupplier: () => void }) {
  const { t } = useI18n();
  const text = useGstText();
  const act = useAct2b();
  const status: MatchStatus = r.action === "accept" ? "accepted" : r.action === "ignore" ? "ignored" : r.status;
  const run = async (action: "accept" | "ignore" | "reopen") => {
    try {
      await act.mutateAsync({ id: r.id, action });
      toast.success(t(`billing.gst.b2.done.${action}`));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const diffs = Object.entries(r.diff ?? {});
  const show = (field: string, v: unknown) => (typeof v === "number" && MONEY_FIELDS.has(field) ? money(v) : v == null ? "-" : String(v));
  return (
    <TableRow>
      <TableCell className="max-w-56 whitespace-normal">
        <button type="button" className="text-left font-medium underline-offset-2 hover:underline focus-visible:underline" onClick={onSupplier} aria-label={t("billing.gst.b2.onlySupplier", { name: r.supplierName ?? r.supplierGstin })}>
          {r.supplierName ?? r.supplierGstin}
        </button>
        <span className="block text-meta text-muted-foreground">{r.supplierGstin}</span>
      </TableCell>
      <TableCell className="whitespace-normal">
        <span className="font-medium">{r.docNumber}</span>
        <span className="block text-meta text-muted-foreground">
          {t(`billing.gst.b2.kind.${r.docKind}`)}
          {r.docDate ? ` · ${text.dateText(r.docDate)}` : ""}
        </span>
        {!r.itcAvailable && <StatusPill tone="warning">{t("billing.gst.b2.noCredit")}</StatusPill>}
        {r.reverseCharge && <StatusPill tone="info">{t("billing.gst.itc.rcmBadge")}</StatusPill>}
      </TableCell>
      <TableCell numeric>
        {money(taxTotal(r.tax))}
        <span className="block text-meta text-muted-foreground">{t("billing.gst.b2.onValue", { amount: money(r.taxable) })}</span>
      </TableCell>
      <TableCell>
        <MatchPill status={status} />
      </TableCell>
      <TableCell className="whitespace-normal text-sm">
        {r.match ? (
          <>
            <span>{t("billing.gst.b2.matchedWith", { number: r.match.number ?? "", amount: money(taxTotal(r.match.tax)) })}</span>
            {diffs.length > 0 && (
              <ul className="mt-1 grid gap-0.5 text-meta text-danger-ink">
                {diffs.map(([f, v]) => {
                  const pair = Array.isArray(v) ? v : [v, null];
                  return (
                    <li key={f}>
                      {t.has(`billing.gst.b2.diff.${f}`) ? t(`billing.gst.b2.diff.${f}`) : f}: {t("billing.gst.b2.diffPair", { gst: show(f, pair[0]), books: show(f, pair[1]) })}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">{status === "missing_in_books" ? t("billing.gst.b2.notInBooks") : ""}</span>
        )}
      </TableCell>
      <TableCell>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {r.action ? (
              <Button type="button" variant="outline" size="sm" className="h-11 sm:h-9" disabled={act.isPending} onClick={() => void run("reopen")}>
                {t("billing.gst.b2.reopen")}
              </Button>
            ) : status !== "matched" ? (
              <>
                <Button type="button" size="sm" className="h-11 sm:h-9" disabled={act.isPending} onClick={() => void run("accept")}>
                  {t("billing.gst.b2.accept")}
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-11 sm:h-9" disabled={act.isPending} onClick={() => void run("ignore")}>
                  {t("billing.gst.b2.ignore")}
                </Button>
              </>
            ) : null}
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
