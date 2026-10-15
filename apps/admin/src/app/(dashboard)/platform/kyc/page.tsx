"use client";

import * as React from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  BadgeCheckIcon,
  CheckCircle2Icon,
  CheckIcon,
  CircleDashedIcon,
  ClockIcon,
  EyeIcon,
  HistoryIcon,
  Loader2Icon,
  LockIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import {
  AnimatePresence,
  Badge,
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  StatusPill,
  Textarea,
  cn,
  motion,
  toast,
  type DataTableColumn,
  type StatusTone,
} from "@srirealtime/ui";
import { Page } from "@/components/page";
import { QueryError } from "@/components/query-state";
import { SuperAdminOnly } from "@/components/superadmin-only";
import { api } from "@/lib/api";
import { describeError, tOr, useI18n } from "@/lib/i18n";
import { useKycT } from "@/lib/kyc-messages";
import type { Paged, Tenant } from "@/lib/types";

// ---------------------------------------------------------------- types (mirror packages/kyc/src/service.ts)

type CheckType = "pan" | "gstin" | "bank_account" | "upi" | "digilocker_aadhaar" | "selfie";
type CheckStatus = "pending" | "verified" | "failed" | "manual_review";
type SubjectStatus = "none" | CheckStatus;

interface CheckDto {
  id: string;
  subjectId: string;
  type: CheckType;
  status: CheckStatus;
  provider: string;
  /** Masked by the API (e.g. `{ pan: "ABCDE****F", name }`). Never unmask. */
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  nameOnRecord: string | null;
  nameMatchScore: number | null;
  error: string | null;
  review: { decision: "approved" | "rejected"; reason: string | null; by: string | null; at: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

interface ReviewItem {
  check: CheckDto;
  subject: { id: string; tenantId: string; subjectType: "vendor" | "shop" | "user"; subjectId: string; status: SubjectStatus; verifiedName: string | null };
  comparedWith: string | null;
}

const PAGE = 50;
/** Pass mark for bank / UPI vs PAN name (packages/kyc/src/names.ts NAME_MATCH_THRESHOLD). */
const THRESHOLD = 80;
const REASON_MAX = 500;
const QUEUE_KEY = ["platform", "kyc-review"] as const;

// ---------------------------------------------------------------- page

export default function KycReviewPage() {
  return (
    <SuperAdminOnly>
      <ReviewQueue />
    </SuperAdminOnly>
  );
}

function ReviewQueue() {
  const { t, formatRelative, formatDateTime } = useI18n();
  const k = useKycT();
  const [shop, setShop] = React.useState("all");
  const [page, setPage] = React.useState(0);
  const [selected, setSelected] = React.useState<ReviewItem | null>(null);

  const tenants = useQuery({
    queryKey: ["platform", "tenants", "lookup"],
    queryFn: () => api.get<Paged<Tenant>>("/tenancy/tenants", { limit: 200 }, { tenant: null }).then((r) => r.items),
    staleTime: 5 * 60_000,
  });
  const tenantById = React.useMemo(() => new Map((tenants.data ?? []).map((tn) => [tn.id, tn])), [tenants.data]);
  const shopName = React.useCallback((id: string) => tenantById.get(id)?.name ?? `${id.slice(0, 8)}…`, [tenantById]);

  const queue = useQuery({
    queryKey: [...QUEUE_KEY, shop, page],
    queryFn: () =>
      api.get<{ items: ReviewItem[]; total: number }>(
        "/kyc/review",
        { tenantId: shop === "all" ? undefined : shop, limit: PAGE, offset: page * PAGE },
        { tenant: null },
      ),
    placeholderData: keepPreviousData,
  });

  const columns: DataTableColumn<ReviewItem>[] = [
    {
      id: "shop",
      header: k("admin.kyc.col.shop"),
      cell: (r) => {
        const tn = tenantById.get(r.subject.tenantId);
        return (
          <div className="min-w-0">
            <div className="truncate font-medium">{shopName(r.subject.tenantId)}</div>
            {tn && <div className="truncate font-mono text-xs text-muted-foreground">{tn.slug}</div>}
          </div>
        );
      },
    },
    {
      id: "subject",
      header: k("admin.kyc.col.subject"),
      hideBelow: "md",
      cell: (r) => <Badge variant="outline">{tOr(k, `admin.kyc.subject.${r.subject.subjectType}`, r.subject.subjectType)}</Badge>,
    },
    {
      id: "check",
      header: k("admin.kyc.col.check"),
      cell: (r) => <span className="whitespace-nowrap">{tOr(k, `admin.kyc.type.${r.check.type}`, r.check.type)}</span>,
    },
    { id: "match", header: k("admin.kyc.col.match"), cell: (r) => <ScorePill score={r.check.nameMatchScore} /> },
    { id: "status", header: k("admin.kyc.col.status"), hideBelow: "sm", cell: (r) => <CheckStatusPill status={r.check.status} /> },
    {
      id: "submitted",
      header: k("admin.kyc.col.submitted"),
      align: "right",
      hideBelow: "md",
      cell: (r) => (
        <span className="whitespace-nowrap text-muted-foreground" title={formatDateTime(r.check.createdAt)}>
          {formatRelative(r.check.createdAt)}
        </span>
      ),
    },
  ];

  const total = queue.data?.total;

  return (
    <Page>
      <PageHeader
        eyebrow={t("admin.nav.platform")}
        title={k("admin.kyc.title")}
        description={k("admin.kyc.subtitle")}
        actions={
          total !== undefined && total > 0 ? (
            <StatusPill tone="warning" icon={ClockIcon} size="md">
              {k("admin.kyc.waiting", { count: total })}
            </StatusPill>
          ) : undefined
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          value={shop}
          onValueChange={(v) => {
            setShop(v);
            setPage(0);
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-56" aria-label={k("admin.kyc.filter.shop")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{k("admin.kyc.filter.allShops")}</SelectItem>
            {(tenants.data ?? []).map((tn) => (
              <SelectItem key={tn.id} value={tn.id}>
                {tn.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {queue.isError ? (
        <QueryError error={queue.error} onRetry={() => void queue.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={queue.data?.items}
          loading={queue.isLoading}
          getRowId={(r) => r.check.id}
          onRowClick={setSelected}
          pagination={{ page, pageSize: PAGE, total, onPageChange: setPage }}
          labels={{
            previous: t("admin.table.previous"),
            next: t("admin.table.next"),
            range: ({ from, to, total: n }) => (n !== undefined ? t("admin.table.range", { from, to, total: n }) : t("admin.table.rangeOpen", { from, to })),
          }}
          empty={<EmptyState compact icon={BadgeCheckIcon} title={k("admin.kyc.empty")} description={k("admin.kyc.emptyHint")} />}
        />
      )}
      <CheckSheet item={selected} shopName={selected ? shopName(selected.subject.tenantId) : ""} onClose={() => setSelected(null)} />
    </Page>
  );
}

// ---------------------------------------------------------------- pills

function scoreBand(score: number): { tone: StatusTone; band: "strong" | "weak" | "poor"; icon: typeof CheckCircle2Icon; bar: string } {
  if (score >= THRESHOLD) return { tone: "success", band: "strong", icon: CheckCircle2Icon, bar: "bg-success" };
  if (score >= 60) return { tone: "warning", band: "weak", icon: AlertTriangleIcon, bar: "bg-warning" };
  return { tone: "danger", band: "poor", icon: XCircleIcon, bar: "bg-destructive" };
}

/** Name-match score: icon + number + band word, and a tiny bar. Never colour alone. */
function ScorePill({ score, large }: { score: number | null; large?: boolean }) {
  const k = useKycT();
  if (score === null || score === undefined) {
    return (
      <StatusPill tone="neutral" icon={CircleDashedIcon}>
        {k("admin.kyc.match.none")}
      </StatusPill>
    );
  }
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const b = scoreBand(s);
  const band = k(`admin.kyc.match.${b.band}`);
  return (
    <span className={cn("inline-flex items-center gap-2", large && "w-full")}>
      <span
        role="meter"
        aria-label={k("admin.kyc.match.aria")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={s}
        aria-valuetext={`${s}% ${band}`}
        className={cn("relative h-1.5 overflow-hidden rounded-full bg-muted ring-1 ring-border ring-inset", large ? "flex-1" : "hidden w-10 sm:block")}
      >
        <motion.span
          className={cn("absolute inset-y-0 left-0 rounded-full", b.bar)}
          initial={{ width: 0 }}
          animate={{ width: `${s}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
        {large && <span className="absolute inset-y-0 w-px bg-foreground/50" style={{ left: `${THRESHOLD}%` }} aria-hidden />}
      </span>
      <StatusPill tone={b.tone} icon={b.icon} size={large ? "md" : "sm"} className="tabular-nums">
        {k("admin.kyc.match.value", { score: s, band })}
      </StatusPill>
    </span>
  );
}

const STATUS_STYLE: Record<SubjectStatus, { tone: StatusTone; icon: typeof CheckIcon }> = {
  manual_review: { tone: "warning", icon: EyeIcon },
  pending: { tone: "info", icon: ClockIcon },
  verified: { tone: "success", icon: CheckCircle2Icon },
  failed: { tone: "danger", icon: XCircleIcon },
  none: { tone: "neutral", icon: CircleDashedIcon },
};

function CheckStatusPill({ status }: { status: SubjectStatus }) {
  const k = useKycT();
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.none;
  return (
    <StatusPill tone={s.tone} icon={s.icon}>
      {tOr(k, `admin.kyc.status.${status}`, status)}
    </StatusPill>
  );
}

// ---------------------------------------------------------------- detail sheet

/** "accountNumber" / "account_number" → "Account number"; well-known acronyms stay upper case. */
function humanKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/);
  const ACR = new Set(["pan", "gstin", "upi", "ifsc", "vpa", "kyc", "id", "dob", "uid"]);
  return words.map((w, i) => (ACR.has(w.toLowerCase()) ? w.toUpperCase() : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join(" ");
}

/** Names and free text read as prose; everything else (numbers, masked ids, codes) is mono. */
const isProseKey = (key: string) => /name|address|reason|message|status|bank|branch|city|state/i.test(key);

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function KeyValues({ data, emptyLabel }: { data: Record<string, unknown>; emptyLabel?: string }) {
  const entries = Object.entries(data ?? {});
  if (entries.length === 0) return emptyLabel ? <p className="text-sm text-muted-foreground">{emptyLabel}</p> : null;
  return (
    <dl className="divide-y rounded-lg border bg-card">
      {entries.map(([key, v]) => (
        <div key={key} className="flex items-start justify-between gap-4 px-3 py-2 text-sm">
          <dt className="shrink-0 text-muted-foreground">{humanKey(key)}</dt>
          <dd className={cn("min-w-0 text-right break-all", isProseKey(key) ? "font-medium" : "font-mono text-xs leading-5")}>{formatValue(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Row({ label, children, mono }: { label: React.ReactNode; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 text-right break-words", mono ? "font-mono text-xs leading-5 break-all" : "font-medium")}>{children}</span>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon?: typeof LockIcon; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {Icon && <Icon className="size-3.5" aria-hidden />}
        {title}
      </h3>
      {children}
    </section>
  );
}

function CheckSheet({ item, shopName, onClose }: { item: ReviewItem | null; shopName: string; onClose: () => void }) {
  const { t, formatDateTime } = useI18n();
  const k = useKycT();
  const [decision, setDecision] = React.useState<"approve" | "reject" | null>(null);
  // Keep the last item while the sheet animates closed.
  const [shown, setShown] = React.useState<ReviewItem | null>(item);
  React.useEffect(() => {
    if (item) setShown(item);
  }, [item]);
  const it = item ?? shown;
  const c = it?.check;
  const payout = c?.type === "bank_account" || c?.type === "upi";
  const reviewable = c?.status === "manual_review";
  const typeLabel = c ? tOr(k, `admin.kyc.type.${c.type}`, c.type) : "";

  return (
    <>
      <Sheet open={!!item} onOpenChange={(o) => !o && onClose()}>
        <SheetContent className="w-full gap-0 sm:max-w-lg" closeLabel={t("admin.common.close")}>
          {it && c && (
            <>
              <SheetHeader className="border-b pr-12">
                <SheetTitle className="flex flex-wrap items-center gap-2">
                  {k("admin.kyc.detail.title", { type: typeLabel })}
                  <CheckStatusPill status={c.status} />
                </SheetTitle>
                <SheetDescription>
                  {k("admin.kyc.detail.description", {
                    shop: shopName,
                    subject: tOr(k, `admin.kyc.subject.${it.subject.subjectType}`, it.subject.subjectType),
                  })}
                </SheetDescription>
              </SheetHeader>
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="flex-1 space-y-6 overflow-y-auto p-4"
              >
                <Section title={k("admin.kyc.detail.names")}>
                  <div className="space-y-3 rounded-lg border bg-card p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="min-w-0">
                        <div className="text-xs text-muted-foreground">{k("admin.kyc.detail.nameOnRecord")}</div>
                        <div className="font-medium break-words">{c.nameOnRecord || k("admin.kyc.detail.empty")}</div>
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs text-muted-foreground">{k("admin.kyc.detail.comparedWith")}</div>
                        <div className="font-medium break-words">{it.comparedWith || k("admin.kyc.detail.empty")}</div>
                      </div>
                    </div>
                    <Separator />
                    <div className="space-y-2">
                      <div className="text-xs text-muted-foreground">{k("admin.kyc.detail.score")}</div>
                      <ScorePill score={c.nameMatchScore} large />
                      <p className="text-xs text-muted-foreground">
                        {k(payout ? "admin.kyc.detail.scoreExplain" : "admin.kyc.detail.scoreExplainOther", { threshold: THRESHOLD })}
                      </p>
                    </div>
                  </div>
                </Section>

                <Section title={k("admin.kyc.detail.inputs")} icon={LockIcon}>
                  <KeyValues data={c.input} emptyLabel={k("admin.kyc.detail.empty")} />
                  <p className="text-xs text-muted-foreground">{k("admin.kyc.detail.masked")}</p>
                </Section>

                {c.error && (
                  <Section title={k("admin.kyc.detail.error")} icon={AlertTriangleIcon}>
                    <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm break-words text-danger-ink">{c.error}</p>
                  </Section>
                )}

                <Section title={k("admin.kyc.detail.result")}>
                  <KeyValues data={c.result} emptyLabel={k("admin.kyc.detail.noResult")} />
                </Section>

                {c.review && (
                  <Section title={k("admin.kyc.detail.review")} icon={HistoryIcon}>
                    <div className="rounded-lg border bg-card px-3 py-1.5">
                      <Row label={t("admin.common.status")}>
                        <StatusPill tone={c.review.decision === "approved" ? "success" : "danger"} icon={c.review.decision === "approved" ? CheckIcon : XIcon}>
                          {k(c.review.decision === "approved" ? "admin.kyc.detail.reviewApproved" : "admin.kyc.detail.reviewRejected")}
                        </StatusPill>
                      </Row>
                      {c.review.reason && <Row label={k("admin.kyc.detail.reviewReason")}>{c.review.reason}</Row>}
                      {c.review.by && (
                        <Row label={k("admin.kyc.detail.reviewBy")} mono>
                          {c.review.by}
                        </Row>
                      )}
                      {c.review.at && <Row label={k("admin.kyc.detail.reviewAt")}>{formatDateTime(c.review.at)}</Row>}
                    </div>
                  </Section>
                )}

                <Section title={k("admin.kyc.col.subject")}>
                  <div className="rounded-lg border bg-card px-3 py-1.5">
                    <Row label={k("admin.kyc.detail.subjectStatus")}>
                      <CheckStatusPill status={it.subject.status} />
                    </Row>
                    <Row label={k("admin.kyc.detail.subjectId")} mono>
                      {it.subject.subjectId}
                    </Row>
                    {it.subject.verifiedName && <Row label={k("admin.kyc.detail.verifiedName")}>{it.subject.verifiedName}</Row>}
                    <Row label={k("admin.kyc.detail.provider")} mono>
                      {c.provider}
                    </Row>
                    <Row label={k("admin.kyc.detail.created")}>{formatDateTime(c.createdAt)}</Row>
                    <Row label={k("admin.kyc.detail.updated")}>{formatDateTime(c.updatedAt)}</Row>
                  </div>
                </Section>
              </motion.div>
              <SheetFooter className="border-t sm:flex-row sm:justify-end">
                {reviewable ? (
                  <>
                    <Button variant="outline" onClick={() => setDecision("reject")}>
                      <XIcon /> {k("admin.kyc.reject")}
                    </Button>
                    <Button onClick={() => setDecision("approve")}>
                      <CheckIcon /> {k("admin.kyc.approve")}
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{k("admin.kyc.detail.notReviewable")}</p>
                )}
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
      {c && (
        <DecisionDialog
          mode={decision}
          checkId={c.id}
          onClose={() => setDecision(null)}
          onDone={() => {
            setDecision(null);
            onClose();
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------- approve / reject

function DecisionDialog({ mode, checkId, onClose, onDone }: { mode: "approve" | "reject" | null; checkId: string; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const k = useKycT();
  const qc = useQueryClient();
  const [reason, setReason] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  // Remember the mode while the dialog animates out.
  const [lastMode, setLastMode] = React.useState<"approve" | "reject">("approve");
  React.useEffect(() => {
    if (mode) {
      setLastMode(mode);
      setReason("");
      setTouched(false);
    }
  }, [mode]);
  const m = mode ?? lastMode;
  const reject = m === "reject";

  const submit = useMutation({
    mutationFn: () =>
      api.post(`/kyc/checks/${checkId}/${m}`, reason.trim() ? { reason: reason.trim() } : {}, { tenant: null }),
    onSuccess: () => {
      toast.success(k(reject ? "admin.kyc.rejected" : "admin.kyc.approved"));
      void qc.invalidateQueries({ queryKey: QUEUE_KEY });
      onDone();
    },
  });
  React.useEffect(() => {
    if (mode) submit.reset(); // clear a previous error when the dialog reopens
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const len = reason.trim().length;
  const fieldError =
    reason.length > REASON_MAX
      ? k("admin.kyc.reasonTooLong", { max: REASON_MAX })
      : reject && touched && len === 0
        ? k("admin.kyc.reasonRequired")
        : null;
  const canSubmit = !submit.isPending && reason.length <= REASON_MAX && (!reject || len > 0);

  return (
    <Dialog open={!!mode} onOpenChange={(o) => !o && !submit.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (canSubmit) submit.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>{k(reject ? "admin.kyc.rejectTitle" : "admin.kyc.approveTitle")}</DialogTitle>
            <DialogDescription>{k(reject ? "admin.kyc.rejectDescription" : "admin.kyc.approveDescription")}</DialogDescription>
          </DialogHeader>
          <Field invalid={!!fieldError}>
            <FieldLabel
              optional={reject ? undefined : k("admin.kyc.optional")}
              aside={
                <span className={cn("tabular-nums", reason.length > REASON_MAX && "text-destructive")}>
                  {k("admin.kyc.counter", { count: reason.length, max: REASON_MAX })}
                </span>
              }
            >
              {k("admin.kyc.reason")}
            </FieldLabel>
            <FieldControl>
              <Textarea
                value={reason}
                rows={4}
                autoFocus
                required={reject}
                onChange={(e) => setReason(e.target.value)}
                onBlur={() => setTouched(true)}
              />
            </FieldControl>
            <FieldHint>{k(reject ? "admin.kyc.reasonRejectHint" : "admin.kyc.reasonApproveHint")}</FieldHint>
            <FieldError>{fieldError}</FieldError>
          </Field>
          <AnimatePresence initial={false}>
            {submit.isError && (
              <motion.p
                key="err"
                role="alert"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-start gap-2 overflow-hidden rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-danger-ink"
              >
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                {describeError(submit.error, t)}
              </motion.p>
            )}
          </AnimatePresence>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submit.isPending}>
              {k("admin.kyc.cancel")}
            </Button>
            <Button type="submit" variant={reject ? "destructive" : "default"} disabled={submit.isPending || (reject && touched && !canSubmit)}>
              {submit.isPending ? <Loader2Icon className="animate-spin" /> : reject ? <XIcon /> : <CheckIcon />}
              {k(reject ? "admin.kyc.reject" : "admin.kyc.approve")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
