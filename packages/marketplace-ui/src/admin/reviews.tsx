"use client";

import * as React from "react";
import { CheckIcon, ClipboardCheckIcon, ImageIcon, Loader2Icon, MessageSquareWarningIcon, XIcon } from "lucide-react";
import {
  Button,
  ChipGroup,
  cn,
  DataTable,
  DataTableToolbar,
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Textarea,
  toast,
  type DataTableColumn,
} from "@rbms/ui";
import { absoluteUrl, describeError, ModuleLink, Page, PageHeading, QueryError, useI18n, useQueryParams, useServerTable, type ServerFilterDefs } from "@rbms/web";
import { ReviewPill, Thumb } from "../components/bits";
import { SubmitButton } from "../components/account";
import { money } from "../lib/logic";
import { mk, MP, useCatalogProduct, useReviewDecision, useSellerOptions } from "../lib/queries";
import { PRODUCT_REVIEW_STATUSES, REVIEW_KINDS, type ProductReview, type ProductReviewStatus } from "../lib/types";

type Pill = "all" | Exclude<ProductReviewStatus, "withdrawn">;
const PILLS: Exclude<Pill, "all">[] = ["pending", "rejected", "approved"];

/** Products to review: seller products waiting to go live (approve, or reject with a reason the seller sees). */
export default function ProductReviewsPage() {
  // useServerTable reads the search params, which needs a Suspense boundary.
  return (
    <React.Suspense fallback={null}>
      <ReviewsList />
    </React.Suspense>
  );
}

function ReviewsList() {
  const { t, formatDate } = useI18n();
  const params = useQueryParams();
  const [open, setOpen] = React.useState<ProductReview | null>(null);
  const [rejecting, setRejecting] = React.useState<ProductReview | null>(null);
  const sellers = useSellerOptions();
  const sellerOptions = sellers.data;

  const filters = React.useMemo(
    () =>
      ({
        status: {
          kind: "options",
          label: t("marketplace.reviews.filterStatus"),
          options: PRODUCT_REVIEW_STATUSES.map((s) => ({ value: s, label: t(`marketplace.review.status.${s}`) })),
        },
        kind: {
          kind: "options",
          label: t("marketplace.reviews.filterKind"),
          options: REVIEW_KINDS.map((k) => ({ value: k, label: t(`marketplace.reviews.kind.${k}`) })),
        },
        vendorId: { kind: "options", label: t("marketplace.reviews.filterSeller"), options: sellerOptions ?? [], dynamic: true },
      }) satisfies ServerFilterDefs,
    [t, sellerOptions],
  );

  const columns = React.useMemo<DataTableColumn<ProductReview>[]>(
    () => [
      {
        id: "product",
        header: t("marketplace.reviews.col.product"),
        sortable: true,
        hideable: false,
        card: "title",
        className: "max-w-[24rem]",
        cell: (r) => (
          <div className="flex min-w-0 items-center gap-3">
            <Thumb src={r.productImage} className="size-11" />
            <div className="min-w-0">
              <p className="truncate font-medium">{r.productName}</p>
              {r.changedAfterApproval && (r.changedFields?.length ?? 0) > 0 && (
                <p className="truncate text-xs text-muted-foreground" data-testid="changed-fields">
                  {(r.changedFields ?? []).map((f) => t(`marketplace.reviews.field.${f}`)).join(" · ")}
                </p>
              )}
              {r.status === "rejected" && r.reason && (
                <p className="flex items-center gap-1 truncate text-xs text-danger-ink">
                  <MessageSquareWarningIcon className="size-3.5 shrink-0" /> <span className="truncate">{r.reason}</span>
                </p>
              )}
            </div>
          </div>
        ),
        cardCell: (r) => r.productName,
      },
      {
        id: "seller",
        header: t("marketplace.reviews.col.seller"),
        card: "subtitle",
        cell: (r) => (
          <ModuleLink to={`vendors/${r.vendorId}`} className="font-medium hover:text-primary hover:underline">
            {r.vendorName ?? "—"}
          </ModuleLink>
        ),
        cardCell: (r) => `${r.vendorName ?? "—"} · ${formatDate(r.submittedAt, { day: "numeric", month: "short" })}`,
      },
      {
        id: "kind",
        header: t("marketplace.reviews.col.kind"),
        card: "meta",
        cell: (r) =>
          r.changedAfterApproval ? (
            <span className="inline-flex h-6 items-center rounded-md bg-info/12 px-2 text-xs font-medium whitespace-nowrap text-info-ink">{t("marketplace.reviews.kind.changed")}</span>
          ) : (
            <span className="inline-flex h-6 items-center rounded-md border px-2 text-xs whitespace-nowrap">{t("marketplace.reviews.kind.new")}</span>
          ),
      },
      {
        id: "submitted",
        header: t("marketplace.reviews.col.submitted"),
        sortable: true,
        hideBelow: "md",
        cell: (r) => (
          <span className="whitespace-nowrap tabular-nums text-muted-foreground">
            {formatDate(r.submittedAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
          </span>
        ),
      },
      { id: "status", header: t("marketplace.reviews.col.status"), sortable: true, card: "right", cell: (r) => <ReviewPill status={r.status} /> },
      {
        id: "actions",
        header: <span className="sr-only">{t("marketplace.reviews.col.actions")}</span>,
        label: t("marketplace.reviews.col.actions"),
        hideable: false,
        align: "right",
        card: "meta",
        cell: (r) => <ReviewActions review={r} onReject={() => setRejecting(r)} compact />,
      },
    ],
    [t, formatDate],
  );

  const st = useServerTable<ProductReview, typeof filters>({
    queryKey: [...mk.all, "reviews", "table"],
    path: `${MP}/product-reviews`,
    columns,
    filters,
    defaultSort: "submitted",
    search: t("marketplace.reviews.search"),
    storageKey: "marketplace-reviews",
  });

  // The queue opens on waiting products (as the dashboard's "Needs attention" link expects); "All" clears it.
  const status = st.filters.status;
  const opened = React.useRef(false);
  React.useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (!params?.has("status")) status.set(["pending"]);
  }, [params, status]);

  const counts = st.facets?.status;
  const all = counts ? Object.values(counts).reduce((n, c) => n + c, 0) : undefined;
  const pill = status.value.length === 0 ? "all" : status.value.length === 1 ? status.value[0]! : "";
  const onlyPending = status.value.length === 1 && status.value[0] === "pending" && st.table.activeFilterCount === 1;

  return (
    <Page width="full">
      <PageHeading icon={ClipboardCheckIcon} title={t("marketplace.reviews.title")} description={t("marketplace.reviews.subtitle")} />
      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup
            size="sm"
            aria-label={t("marketplace.reviews.filter")}
            value={pill}
            onChange={(v) => status.set(v === "all" || v === "" ? [] : [v])}
            options={[
              ...PILLS.map((v) => ({ value: v as string, label: t(`marketplace.reviews.tab.${v}`), meta: counts ? counts[v] || undefined : undefined })),
              { value: "all", label: t("marketplace.reviews.all"), meta: all || undefined },
            ]}
          />
        }
      />
      <DataTable
        table={st.table}
        onRowClick={setOpen}
        empty={
          onlyPending ? (
            <EmptyState className="border-0 bg-transparent" icon={ClipboardCheckIcon} title={t("marketplace.reviews.emptyTitle")} description={t("marketplace.reviews.emptyBody")} />
          ) : undefined
        }
      />
      <ReviewSheet review={open} onClose={() => setOpen(null)} onReject={(r) => setRejecting(r)} />
      <RejectDialog review={rejecting} onOpenChange={(o) => !o && setRejecting(null)} />
    </Page>
  );
}

/** Approve / ask for changes on a waiting review (nothing for decided ones). */
function ReviewActions({ review: r, onReject, onDone, compact }: { review: ProductReview; onReject: () => void; onDone?: () => void; compact?: boolean }) {
  const { t } = useI18n();
  const decide = useReviewDecision();
  if (r.status !== "pending") return null;
  const approving = decide.isPending && decide.variables?.decision === "approve";
  const approve = async () => {
    try {
      await decide.mutateAsync({ id: r.id, decision: "approve" });
      toast.success(t("marketplace.reviews.approved", { name: r.productName }));
      onDone?.();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <div className="flex items-center justify-end gap-2">
      <Button variant="outline" size="sm" onClick={onReject} disabled={decide.isPending} className="text-danger-ink" aria-label={t("marketplace.reviews.reject")}>
        <XIcon /> {compact ? null : t("marketplace.reviews.reject")}
      </Button>
      <Button size="sm" onClick={() => void approve()} disabled={decide.isPending} data-testid="review-approve">
        {approving ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} {t("marketplace.reviews.approve")}
      </Button>
    </div>
  );
}

/** A review's details in a side sheet: photos, prices, GST, description, with the decision buttons. */
function ReviewSheet({ review, onClose, onReject }: { review: ProductReview | null; onClose: () => void; onReject: (r: ProductReview) => void }) {
  const { t, formatDate } = useI18n();
  // Keep the last review on screen while the sheet slides out.
  const [last, setLast] = React.useState<ProductReview | null>(review);
  React.useEffect(() => {
    if (review) setLast(review);
  }, [review]);
  const r = review ?? last;
  return (
    <Sheet open={!!review} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl" closeLabel={t("marketplace.common.close")}>
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="truncate">{r?.productName ?? " "}</SheetTitle>
          <SheetDescription>
            {r
              ? `${r.vendorName ?? "—"} · ${t("marketplace.reviews.submittedOn", { date: formatDate(r.submittedAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) })}`
              : " "}
          </SheetDescription>
        </SheetHeader>
        {r && (
          <motion.div key={r.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="flex-1 overflow-y-auto">
            <div className="flex flex-wrap items-center gap-1.5 px-4 pt-4 sm:px-5">
              <ReviewPill status={r.status} />
              {r.changedAfterApproval && (
                <>
                  <span className="inline-flex h-6 items-center rounded-md bg-info/12 px-2 text-xs font-medium text-info-ink">{t("marketplace.reviews.reReview")}</span>
                  {(r.changedFields ?? []).map((f) => (
                    <span key={f} className="inline-flex h-6 items-center rounded-md border px-2 text-xs">
                      {t(`marketplace.reviews.field.${f}`)}
                    </span>
                  ))}
                </>
              )}
            </div>
            {r.status === "rejected" && r.reason && (
              <p className="mx-4 mt-3 flex items-start gap-1.5 text-sm text-danger-ink sm:mx-5">
                <MessageSquareWarningIcon className="mt-0.5 size-4 shrink-0" /> {r.reason}
              </p>
            )}
            <ProductDetails productId={r.productId} changed={r.changedAfterApproval ? (r.changedFields ?? []) : []} />
          </motion.div>
        )}
        {r?.status === "pending" && review && (
          <SheetFooter className="border-t px-5 py-3">
            <ReviewActions review={r} onReject={() => onReject(r)} onDone={onClose} />
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
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
