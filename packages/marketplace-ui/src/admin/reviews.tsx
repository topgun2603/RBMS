"use client";

import * as React from "react";
import { CheckIcon, ChevronDownIcon, ClipboardCheckIcon, ImageIcon, Loader2Icon, MessageSquareWarningIcon, XIcon } from "lucide-react";
import {
  AnimatePresence,
  Button,
  Card,
  ChipGroup,
  cn,
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
  motion,
  Skeleton,
  Textarea,
  toast,
} from "@srirealtime/ui";
import { absoluteUrl, describeError, ModuleLink, Page, PageHeading, QueryError, useI18n, useModuleNavigate, useQueryParams } from "@srirealtime/web";
import { ReviewPill, Thumb } from "../components/bits";
import { Pager, RowsSkeleton } from "../components/lists";
import { SubmitButton } from "../components/account";
import { money } from "../lib/logic";
import { REVIEW_PAGE, useCatalogProduct, useProductReviews, useReviewDecision } from "../lib/queries";
import type { ProductReview, ProductReviewStatus } from "../lib/types";

type Tab = Exclude<ProductReviewStatus, "withdrawn">;
const TABS: Tab[] = ["pending", "rejected", "approved"];

/** Products to review: seller products waiting to go live (approve, or reject with a reason the seller sees). */
export default function ProductReviewsPage() {
  const { t } = useI18n();
  const params = useQueryParams();
  const navigate = useModuleNavigate();
  const initial = params.get("status") as Tab | null;
  const [tab, setTab] = React.useState<Tab>(initial && TABS.includes(initial) ? initial : "pending");
  const [offset, setOffset] = React.useState(0);
  const [open, setOpen] = React.useState<string | null>(null);
  const [rejecting, setRejecting] = React.useState<ProductReview | null>(null);
  React.useEffect(() => setOffset(0), [tab]);
  const q = useProductReviews({ status: tab, offset });
  const counts = q.data?.counts;
  const items = q.data?.items ?? [];

  return (
    <Page>
      <PageHeading icon={ClipboardCheckIcon} title={t("marketplace.reviews.title")} description={t("marketplace.reviews.subtitle")} />
      <div className="mb-4 -mx-4 overflow-x-auto px-4 [scrollbar-width:none]">
        <ChipGroup<Tab>
          value={tab}
          onChange={(v) => {
            setTab(v);
            navigate(v === "pending" ? "?" : `?status=${v}`, { replace: true, scroll: false });
          }}
          size="sm"
          aria-label={t("marketplace.reviews.filter")}
          options={TABS.map((v) => ({ value: v, label: t(`marketplace.reviews.tab.${v}`), meta: counts?.[v] || undefined }))}
        />
      </div>
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <RowsSkeleton rows={4} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={ClipboardCheckIcon}
          title={t(tab === "pending" ? "marketplace.reviews.emptyTitle" : "marketplace.reviews.noneHere")}
          description={tab === "pending" ? t("marketplace.reviews.emptyBody") : undefined}
        />
      ) : (
        <div className={cn("transition-opacity", q.isPlaceholderData && "opacity-60")}>
          <motion.ul layout className="grid gap-2">
            <AnimatePresence initial={false}>
              {items.map((r) => (
                <motion.li key={r.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -24, transition: { duration: 0.18 } }}>
                  <ReviewCard review={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} onReject={() => setRejecting(r)} />
                </motion.li>
              ))}
            </AnimatePresence>
          </motion.ul>
          <Pager offset={offset} limit={REVIEW_PAGE} total={q.data.total} onChange={setOffset} />
        </div>
      )}
      <RejectDialog review={rejecting} onOpenChange={(o) => !o && setRejecting(null)} />
    </Page>
  );
}

function ReviewCard({ review: r, open, onToggle, onReject }: { review: ProductReview; open: boolean; onToggle: () => void; onReject: () => void }) {
  const { t, formatDate } = useI18n();
  const decide = useReviewDecision();
  const approving = decide.isPending && decide.variables?.decision === "approve";
  const approve = async () => {
    try {
      await decide.mutateAsync({ id: r.id, decision: "approve" });
      toast.success(t("marketplace.reviews.approved", { name: r.productName }));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <Card className="gap-0 overflow-hidden p-0" data-testid="review-card">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3 sm:p-4">
        <Thumb src={r.productImage} className="size-14" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{r.productName}</p>
          <p className="text-meta text-muted-foreground">
            <ModuleLink to={`vendors/${r.vendorId}`} className="font-medium text-foreground hover:underline">
              {r.vendorName ?? "—"}
            </ModuleLink>
            {" · "}
            {t("marketplace.reviews.submittedOn", { date: formatDate(r.submittedAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) })}
          </p>
          {r.changedAfterApproval && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5" data-testid="changed-fields">
              <span className="inline-flex h-6 items-center rounded-md bg-info/12 px-2 text-xs font-medium text-info-ink">{t("marketplace.reviews.reReview")}</span>
              {(r.changedFields ?? []).map((f) => (
                <span key={f} className="inline-flex h-6 items-center rounded-md border px-2 text-xs">
                  {t(`marketplace.reviews.field.${f}`)}
                </span>
              ))}
            </div>
          )}
          {r.status === "rejected" && r.reason && (
            <p className="mt-1 flex items-start gap-1.5 text-sm text-danger-ink">
              <MessageSquareWarningIcon className="mt-0.5 size-4 shrink-0" /> {r.reason}
            </p>
          )}
        </div>
        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
          {r.status !== "pending" && <ReviewPill status={r.status} />}
          <Button variant="ghost" size="sm" onClick={onToggle} aria-expanded={open}>
            {t("marketplace.reviews.details")} <ChevronDownIcon className={cn("transition-transform", open && "rotate-180")} />
          </Button>
          {r.status === "pending" && (
            <>
              <Button variant="outline" size="sm" onClick={onReject} disabled={decide.isPending} className="text-danger-ink">
                <XIcon /> {t("marketplace.reviews.reject")}
              </Button>
              <Button size="sm" onClick={() => void approve()} disabled={decide.isPending} data-testid="review-approve">
                {approving ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} {t("marketplace.reviews.approve")}
              </Button>
            </>
          )}
        </div>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden border-t bg-muted/20">
            <ProductDetails productId={r.productId} changed={r.changedAfterApproval ? (r.changedFields ?? []) : []} />
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

/** What the shop checks before approving: photos, description, prices, GST. */
function ProductDetails({ productId, changed }: { productId: string; changed: string[] }) {
  const { t } = useI18n();
  const q = useCatalogProduct(productId);
  if (q.isError) return <div className="p-4"><QueryError compact error={q.error} onRetry={() => void q.refetch()} /></div>;
  if (q.isPending)
    return (
      <div className="grid gap-2 p-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  const p = q.data;
  const prices = p.variants.map((v) => v.price);
  const min = prices.length ? Math.min(...prices) : 0;
  const max = prices.length ? Math.max(...prices) : 0;
  const hot = (f: string) => changed.includes(f);
  return (
    <div className="grid gap-3 p-3 sm:p-4">
      {changed.length > 0 && <p className="text-sm font-medium text-info-ink">{t("marketplace.reviews.changedNote")}</p>}
      {p.images.length ? (
        <div className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
          {p.images.map((img) => (
            // eslint-disable-next-line @next/next/no-img-element -- module packages don't use next/image
            <img key={img.url} src={absoluteUrl(img.url) ?? ""} alt="" className={cn("size-24 shrink-0 rounded-lg border object-cover", hot("images") && "ring-2 ring-info/50")} />
          ))}
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-warning-ink">
          <ImageIcon className="size-4" /> {t("marketplace.reviews.noPhotos")}
        </p>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <Fact label={t("marketplace.reviews.price")} value={min === max ? money(min) : `${money(min)} – ${money(max)}`} hot={hot("price")} />
        <Fact label={t("marketplace.reviews.variants")} value={String(p.variants.length)} hot={hot("variants")} />
        <Fact label={t("marketplace.editor.gstRate")} value={`${p.gstRate}%${p.taxInclusive ? ` · ${t("marketplace.reviews.inclusive")}` : ""}`} hot={hot("gst")} />
        <Fact label={t("marketplace.editor.hsn")} value={p.hsn ?? "—"} hot={hot("gst")} />
      </dl>
      {hot("name") && <p className="text-sm"><span className="rounded bg-info/12 px-1 font-medium">{p.name}</span></p>}
      <p className={cn("text-sm whitespace-pre-line", !p.description && "text-muted-foreground", hot("description") && "rounded-md bg-info/10 p-2")}>{p.description?.slice(0, 600) || t("marketplace.reviews.noDescription")}</p>
    </div>
  );
}

function Fact({ label, value, hot }: { label: string; value: string; hot?: boolean }) {
  return (
    <div className={cn("flex flex-col rounded-md", hot && "bg-info/10 px-2 py-1 ring-1 ring-info/30")}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

const QUICK_REASONS = ["marketplace.reviews.quick.photos", "marketplace.reviews.quick.description", "marketplace.reviews.quick.price", "marketplace.reviews.quick.gst"] as const;

function RejectDialog({ review, onOpenChange }: { review: ProductReview | null; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const decide = useReviewDecision();
  const [reason, setReason] = React.useState("");
  const [tried, setTried] = React.useState(false);
  React.useEffect(() => {
    if (review) {
      setReason("");
      setTried(false);
    }
  }, [review]);
  const error = reason.trim().length < 3 ? t("marketplace.reviews.reasonNeeded") : null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (error || !review) return;
    try {
      await decide.mutateAsync({ id: review.id, decision: "reject", reason: reason.trim() });
      toast.success(t("marketplace.reviews.rejected", { name: review.productName }));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <Dialog open={!!review} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("marketplace.common.close")}>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t("marketplace.reviews.rejectTitle", { name: review?.productName ?? "" })}</DialogTitle>
            <DialogDescription>{t(review?.changedAfterApproval ? "marketplace.reviews.rejectLiveBody" : "marketplace.reviews.rejectBody")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_REASONS.map((k) => (
              <Button key={k} type="button" variant="outline" size="sm" onClick={() => setReason((r) => (r.trim() ? `${r.trim()} ${t(k)}` : t(k)))}>
                {t(k)}
              </Button>
            ))}
          </div>
          <Field invalid={tried && !!error}>
            <FieldLabel>{t("marketplace.reviews.reason")}</FieldLabel>
            <FieldControl>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} autoFocus data-testid="reject-reason" />
            </FieldControl>
            <FieldHint>{t("marketplace.reviews.reasonHint")}</FieldHint>
            <FieldError>{tried ? error : null}</FieldError>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("marketplace.common.cancel")}
            </Button>
            <SubmitButton pending={decide.isPending} variant="destructive">
              {t("marketplace.reviews.reject")}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
