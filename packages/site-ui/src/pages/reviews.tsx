"use client";

import * as React from "react";
import {
  BadgeCheckIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  ExternalLinkIcon,
  GlobeIcon,
  ImageIcon,
  Loader2Icon,
  MessageSquareReplyIcon,
  PackageIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  StarIcon,
  StoreIcon,
  ThumbsUpIcon,
  Trash2Icon,
  UploadIcon,
  MailQuestionIcon,
  UserIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import {
  Button,
  ChipGroup,
  cn,
  DataTable,
  DataTableToolbar,
  EmptyState,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  StatusPill,
  Textarea,
  toast,
  type DataTableColumn,
} from "@srirealtime/ui";
import {
  absoluteUrl,
  ConfirmDialog,
  describeError,
  Page,
  PageHeading,
  QueryError,
  useDebounced,
  useI18n,
  useServerTable,
  type ServerFilterDefs,
} from "@srirealtime/web";
import { Thumb } from "../components/bits";
import { AddReviewSheet } from "../components/review-add";
import { ImportReviewsSheet } from "../components/review-import";
import { ReviewsIllustration } from "../components/illustrations";
import { Stars } from "../components/stars";
import { PERMS, useCan, useIsManager } from "../lib/access";
import { sk, useProductSearch, useProductsByIds, useReviewAction, useReviewSettings, useSaveReviewSettings, type ReviewAction } from "../lib/queries";
import { AUTO_APPROVE, REVIEW_SOURCES, REVIEW_STATUSES, type AutoApprove, type ProductSummary, type Review, type ReviewSource, type ReviewStatus } from "../lib/types";

const RATINGS = ["5", "4", "3", "2", "1"] as const;
const STATUS_ICON = { pending: ClockIcon, approved: CheckIcon, rejected: XCircleIcon } as const;
const STATUS_TONE = { pending: "warning", approved: "success", rejected: "danger" } as const;
const SOURCE_ICON = { customer: UserIcon, in_store: StoreIcon, imported: GlobeIcon, invited: MailQuestionIcon } as const;

export default function ReviewsPage() {
  // useServerTable reads the search params, which needs a Suspense boundary.
  return (
    <React.Suspense fallback={null}>
      <ReviewsList />
    </React.Suspense>
  );
}

function ReviewsList() {
  const { t, formatDate, formatNumber } = useI18n();
  const canManage = useCan(PERMS.reviews);
  const act = useReviewAction();
  const [busy, setBusy] = React.useState<{ id: string; kind: ReviewAction["kind"] } | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const lastOpen = React.useRef<Review | null>(null);

  const filters = React.useMemo(
    () =>
      ({
        status: {
          kind: "options",
          label: t("site.common.status"),
          options: REVIEW_STATUSES.map((s) => ({ value: s, label: t(`site.reviews.status.${s}`), icon: STATUS_ICON[s] })),
        },
        rating: {
          kind: "options",
          label: t("site.reviews.filterRating"),
          options: RATINGS.map((r) => ({ value: r, label: t("site.reviews.stars", { count: Number(r) }), icon: StarIcon })),
        },
        source: {
          kind: "options",
          label: t("site.reviews.filterSource"),
          options: REVIEW_SOURCES.map((s) => ({ value: s, label: t(`site.reviews.source.${s}`), icon: SOURCE_ICON[s] })),
        },
        hasPhotos: {
          kind: "options",
          single: true,
          label: t("site.reviews.filterPhotos"),
          options: [
            { value: "true", label: t("site.reviews.withPhotos"), icon: ImageIcon },
            { value: "false", label: t("site.reviews.withoutPhotos") },
          ],
        },
        // From a link or the product picker (`?productId=…`); the picker shows and clears it.
        productId: { kind: "text" },
      }) satisfies ServerFilterDefs,
    [t],
  );

  const run = React.useCallback(
    async (a: ReviewAction, done?: string) => {
      setBusy({ id: a.id, kind: a.kind });
      try {
        await act.mutateAsync(a);
        if (done) toast.success(done);
        return true;
      } catch (err) {
        toast.error(describeError(err, t));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [act, t],
  );

  // Product names for the rows on screen (one lookup per page).
  const [pageProductIds, setPageProductIds] = React.useState<string[]>([]);
  const products = useProductsByIds(pageProductIds);
  const productOf = React.useCallback((id: string) => products.data?.get(id), [products.data]);

  const columns = React.useMemo<DataTableColumn<Review>[]>(
    () => [
      {
        id: "review",
        header: t("site.reviews.col.review"),
        hideable: false,
        card: "title",
        className: "min-w-[16rem] max-w-[28rem]",
        cell: (r) => (
          <div className="grid min-w-0 gap-1">
            <button
              type="button"
              onClick={() => setOpenId(r.id)}
              className="truncate rounded text-left font-medium outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {r.title || excerpt(r.body) || t("site.reviews.ratingOnly")}
            </button>
            {r.title && r.body && <p className="line-clamp-2 text-meta text-muted-foreground">{r.body}</p>}
            {r.photos.length > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <ImageIcon className="size-3.5" /> {t("site.reviews.photoCount", { count: r.photos.length })}
              </span>
            )}
          </div>
        ),
        cardCell: (r) => (
          <span className="grid min-w-0 gap-0.5">
            <Stars rating={r.rating} size="size-3.5" />
            <span className="truncate">{r.title || excerpt(r.body) || t("site.reviews.ratingOnly")}</span>
          </span>
        ),
      },
      {
        id: "product",
        header: t("site.reviews.col.product"),
        card: "subtitle",
        className: "max-w-[14rem]",
        cell: (r) => <ProductCell product={productOf(r.productId)} loading={products.isPending} />,
        cardCell: (r) => [productOf(r.productId)?.name, r.authorName].filter(Boolean).join(" · "),
      },
      {
        id: "author",
        header: t("site.reviews.col.author"),
        hideBelow: "md",
        cell: (r) => (
          <span className="grid gap-0.5">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              {r.authorName}
              {r.verified && (
                <span title={t("site.reviews.verified")} className="inline-flex">
                  <BadgeCheckIcon className="size-4 text-success" aria-hidden />
                  <span className="sr-only">{t("site.reviews.verified")}</span>
                </span>
              )}
            </span>
            <SourceTag review={r} />
          </span>
        ),
      },
      {
        id: "rating",
        header: t("site.reviews.col.rating"),
        sortable: true,
        sortDescFirst: true,
        cell: (r) => <Stars rating={r.rating} size="size-3.5" />,
      },
      {
        id: "helpful",
        header: t("site.reviews.col.helpful"),
        sortable: true,
        numeric: true,
        defaultHidden: true,
        cell: (r) => (r.helpfulCount > 0 ? formatNumber(r.helpfulCount) : "—"),
      },
      {
        id: "date",
        header: t("site.reviews.col.date"),
        sortable: true,
        sortDescFirst: true,
        card: "meta",
        cell: (r) => (
          <time dateTime={r.createdAt} className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
            {formatDate(r.createdAt, { day: "numeric", month: "short", year: "numeric" })}
          </time>
        ),
      },
      {
        id: "status",
        header: t("site.common.status"),
        card: "right",
        cell: (r) => <ReviewStatusPill status={r.status} />,
      },
      ...(canManage
        ? [
            {
              id: "actions",
              header: <span className="sr-only">{t("site.reviews.col.actions")}</span>,
              label: t("site.reviews.col.actions"),
              hideable: false,
              card: "meta",
              headerClassName: "w-36",
              cell: (r) => (
                <div className="flex items-center justify-end gap-1">
                  {r.status !== "approved" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy?.id === r.id}
                      onClick={() => void run({ kind: "approve", id: r.id }, t("site.reviews.approved"))}
                      aria-label={`${t("site.reviews.approve")}: ${r.title || r.authorName}`}
                    >
                      {busy?.id === r.id && busy.kind === "approve" ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
                      <span className="hidden lg:inline">{t("site.reviews.approve")}</span>
                    </Button>
                  )}
                  {r.status !== "rejected" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy?.id === r.id}
                      onClick={() => void run({ kind: "reject", id: r.id }, t("site.reviews.rejected"))}
                      aria-label={`${t("site.reviews.reject")}: ${r.title || r.authorName}`}
                    >
                      {busy?.id === r.id && busy.kind === "reject" ? <Loader2Icon className="animate-spin" /> : <XCircleIcon />}
                      <span className="hidden lg:inline">{t("site.reviews.reject")}</span>
                    </Button>
                  )}
                </div>
              ),
            } satisfies DataTableColumn<Review>,
          ]
        : []),
    ],
    [t, formatDate, formatNumber, canManage, busy, run, productOf, products.isPending],
  );

  const st = useServerTable<Review, typeof filters>({
    queryKey: sk.reviewList,
    path: "/reviews",
    columns,
    filters,
    defaultSort: "-date",
    search: t("site.reviews.search"),
    storageKey: "site-reviews",
    selectable: canManage,
  });

  const items = st.query.data?.items;
  React.useEffect(() => {
    const ids = [...new Set((items ?? []).map((r) => r.productId))].sort();
    setPageProductIds((cur) => (cur.join() === ids.join() ? cur : ids));
  }, [items]);

  // The sheet follows the row in the cache (approve/reject patch it); after a refetch drops it from a filtered view
  // the last copy stays on screen until the sheet is closed.
  const found = openId ? items?.find((r) => r.id === openId) : undefined;
  if (found) lastOpen.current = found;
  const open: Review | null = found ?? (openId && lastOpen.current?.id === openId ? lastOpen.current : null);

  const status = st.filters.status;
  const counts = st.facets?.status;
  const allCount = counts ? REVIEW_STATUSES.reduce((n, s) => n + (counts[s] ?? 0), 0) : undefined;
  const productId = st.filters.productId;
  const onlyStatus = status.value.length === 1 && st.table.activeFilterCount === 1 && !productId.value ? (status.value[0] as ReviewStatus) : null;
  const filtered = st.table.activeFilterCount > 0 || !!productId.value;

  const [adding, setAdding] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const bulk = async (rows: Review[], kind: "approve" | "reject", clear: () => void) => {
    const target = kind === "approve" ? "approved" : "rejected";
    const todo = rows.filter((r) => r.status !== target);
    if (todo.length === 0) return;
    setBulkBusy(true);
    const id = toast.loading(t("site.common.loading"));
    const results = await Promise.allSettled(todo.map((r) => act.mutateAsync({ kind, id: r.id })));
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length === 0) toast.success(t(kind === "approve" ? "site.reviews.bulkApproved" : "site.reviews.bulkRejected", { count: todo.length }), { id });
    else toast.warning(t("site.reviews.bulkPartial", { failed: failed.length, count: todo.length }), { id, description: describeError((failed[0] as PromiseRejectedResult).reason, t) });
    clear();
    setBulkBusy(false);
  };

  return (
    <Page width="full">
      <PageHeading
        icon={StarIcon}
        title={t("site.reviews.title")}
        description={allCount !== undefined ? t("site.reviews.count", { count: allCount }) : t("site.reviews.subtitle")}
        actions={
          <>
            {canManage && (
              <>
                <Button size="lg" onClick={() => setAdding(true)}>
                  <PlusIcon /> {t("site.reviews.add")}
                </Button>
                <Button size="lg" variant="outline" onClick={() => setImporting(true)}>
                  <UploadIcon /> {t("site.reviews.import")}
                </Button>
              </>
            )}
            <ModerationSettings />
          </>
        }
      />
      {canManage && (
        <>
          <AddReviewSheet open={adding} onOpenChange={setAdding} productId={productId.value} />
          <ImportReviewsSheet open={importing} onOpenChange={setImporting} />
        </>
      )}

      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup<ReviewStatus | "all" | "">
            size="sm"
            aria-label={t("site.common.status")}
            value={status.value.length === 0 ? "all" : status.value.length === 1 ? (status.value[0] as ReviewStatus) : ""}
            onChange={(v) => status.set(v === "all" || v === "" ? [] : [v])}
            options={[
              { value: "all", label: t("site.common.all"), meta: allCount || undefined },
              ...REVIEW_STATUSES.map((s) => {
                const Icon = STATUS_ICON[s];
                return {
                  value: s,
                  label: (
                    <>
                      <Icon className="size-4" /> {t(`site.reviews.status.${s}`)}
                    </>
                  ),
                  meta: counts ? counts[s] || undefined : undefined,
                };
              }),
            ]}
          />
        }
      >
        <ProductFilter value={productId.value} onChange={(id) => productId.set(id)} />
      </DataTableToolbar>

      <DataTable
        table={st.table}
        onRowClick={(r) => setOpenId(r.id)}
        empty={
          onlyStatus ? (
            <EmptyState className="border-0 bg-transparent" icon={STATUS_ICON[onlyStatus]} title={t(`site.reviews.empty.${onlyStatus}`)} description={t(`site.reviews.emptyHint.${onlyStatus}`)} />
          ) : filtered ? undefined : (
            <EmptyState className="border-0 bg-transparent" illustration={<ReviewsIllustration />} title={t("site.reviews.emptyTitle")} description={t("site.reviews.emptyBody")} />
          )
        }
        bulkActions={(rows, clear) => (
          <>
            <Button size="sm" variant="outline" disabled={bulkBusy || rows.every((r) => r.status === "approved")} onClick={() => void bulk(rows, "approve", clear)}>
              {bulkBusy ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
              <span className="hidden sm:inline">{t("site.reviews.approve")}</span>
            </Button>
            <Button size="sm" variant="outline" disabled={bulkBusy || rows.every((r) => r.status === "rejected")} onClick={() => void bulk(rows, "reject", clear)}>
              <XCircleIcon />
              <span className="hidden sm:inline">{t("site.reviews.reject")}</span>
            </Button>
          </>
        )}
      />

      <Sheet open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent side="right" closeLabel={t("site.reviews.close")} className="w-full gap-0 overflow-y-auto sm:max-w-lg">
          <SheetHeader className="border-b">
            <SheetTitle>{t("site.reviews.details")}</SheetTitle>
            <SheetDescription className="truncate">{open ? (productOf(open.productId)?.name ?? open.authorName) : ""}</SheetDescription>
          </SheetHeader>
          {open && (
            <ReviewDetail
              key={open.id}
              review={open}
              product={productOf(open.productId)}
              productLoading={products.isPending}
              canManage={canManage}
              run={run}
              busy={busy?.id === open.id ? busy.kind : null}
              onDeleted={() => setOpenId(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </Page>
  );
}

/** "Shared in store", "From Google", "Invited" (nothing for reviews written on the store unless `pill`). */
function SourceTag({ review: r, pill }: { review: Review; pill?: boolean }) {
  const { t } = useI18n();
  const source: ReviewSource = r.source ?? "customer";
  if (source === "customer" && !pill) return null;
  const Icon = SOURCE_ICON[source];
  const label =
    source === "imported" ? t("site.reviews.fromPlatform", { platform: t(`site.reviews.platform.${r.sourcePlatform ?? "other"}`) }) : t(`site.reviews.source.${source}`);
  if (pill) {
    return (
      <StatusPill tone="neutral" icon={Icon}>
        {label}
      </StatusPill>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground">
      <Icon className="size-3" aria-hidden /> {label}
    </span>
  );
}

const excerpt = (body: string | null) => (body ? body.replace(/\s+/g, " ").trim().slice(0, 120) : "");

function ReviewStatusPill({ status }: { status: ReviewStatus }) {
  const { t } = useI18n();
  return (
    <StatusPill tone={STATUS_TONE[status]} icon={STATUS_ICON[status]}>
      {t(`site.reviews.status.${status}`)}
    </StatusPill>
  );
}

function ProductCell({ product, loading }: { product?: ProductSummary; loading: boolean }) {
  const { t } = useI18n();
  return (
    <span className="flex min-w-0 items-center gap-2 text-sm">
      {product ? <Thumb src={product.image} className="size-8 rounded-lg" /> : <PackageIcon className="size-4 shrink-0 text-muted-foreground" />}
      {product ? (
        <span className="truncate">{product.name}</span>
      ) : loading ? (
        <Skeleton className="h-3 w-24" />
      ) : (
        <span className="text-muted-foreground">{t("site.reviews.unknownProduct")}</span>
      )}
    </span>
  );
}

/** The whole review in the side sheet: text, photos, reply, approve / reject / delete. */
function ReviewDetail({
  review: r,
  product,
  productLoading,
  canManage,
  run,
  busy,
  onDeleted,
}: {
  review: Review;
  product?: ProductSummary;
  productLoading: boolean;
  canManage: boolean;
  run: (a: ReviewAction, done?: string) => Promise<boolean>;
  busy: ReviewAction["kind"] | null;
  onDeleted: () => void;
}) {
  const { t, formatDate } = useI18n();
  const [replying, setReplying] = React.useState(false);
  const [reply, setReply] = React.useState(r.reply ?? "");
  const [deleting, setDeleting] = React.useState(false);

  return (
    <div className="grid gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Stars rating={r.rating} />
        <ReviewStatusPill status={r.status} />
        {r.verified && (
          <StatusPill tone="success" icon={BadgeCheckIcon}>
            {t("site.reviews.verified")}
          </StatusPill>
        )}
        <SourceTag review={r} pill />
      </div>
      <ProductCell product={product} loading={productLoading} />
      {r.title && <p className="font-medium">{r.title}</p>}
      {r.body && <p className="text-sm leading-relaxed whitespace-pre-line">{r.body}</p>}
      {r.photos.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t("site.reviews.photos")}>
          {r.photos.map((src, i) => (
            <li key={i}>
              <a href={absoluteUrl(src)} target="_blank" rel="noreferrer" className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t("site.reviews.photoN", { n: i + 1 })}>
                <Thumb src={src} className="size-20" />
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="flex flex-wrap items-center gap-x-2 text-meta text-muted-foreground">
        <span className="font-medium text-foreground">{r.authorName}</span>
        {r.authorCity && <span>· {r.authorCity}</span>}
        <span>· {formatDate(r.createdAt, { day: "numeric", month: "short", year: "numeric" })}</span>
        {r.source && r.source !== "customer" && <span>· {t("site.reviews.enteredByStaff")}</span>}
        {r.sourceUrl && (
          <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
            · {t("site.reviews.openSource")} <ExternalLinkIcon className="size-3" />
          </a>
        )}
        {r.helpfulCount > 0 && (
          <span className="inline-flex items-center gap-1">
            · <ThumbsUpIcon className="size-3" /> {t("site.reviews.helpful", { count: r.helpfulCount })}
          </span>
        )}
      </p>
      {r.reply && !replying && (
        <div className="rounded-xl bg-muted/50 p-3 text-sm ring-1 ring-border/60 ring-inset">
          <p className="mb-1 text-xs font-medium text-primary">{t("site.reviews.yourReply")}</p>
          <p className="whitespace-pre-line">{r.reply}</p>
        </div>
      )}
      {replying && (
        <div className="grid gap-2">
          <Textarea autoFocus rows={3} maxLength={2000} value={reply} placeholder={t("site.reviews.replyPlaceholder")} aria-label={t("site.reviews.reply")} onChange={(e) => setReply(e.target.value)} />
          <p className="text-meta text-muted-foreground">{t("site.reviews.replyHint")}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy === "reply"}
              onClick={async () => {
                const ok = await run({ kind: "reply", id: r.id, reply }, reply.trim() ? t("site.reviews.replied") : t("site.reviews.replyRemoved"));
                if (ok) setReplying(false);
              }}
            >
              {busy === "reply" && <Loader2Icon className="animate-spin" />} {t("site.reviews.postReply")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => (setReplying(false), setReply(r.reply ?? ""))}>
              {t("site.common.cancel")}
            </Button>
          </div>
        </div>
      )}
      {canManage && !replying && (
        <div className="flex flex-wrap gap-2 border-t border-border/60 pt-4">
          {r.status !== "approved" && (
            <Button size="sm" disabled={!!busy} onClick={() => void run({ kind: "approve", id: r.id }, t("site.reviews.approved"))}>
              {busy === "approve" ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} {t("site.reviews.approve")}
            </Button>
          )}
          {r.status !== "rejected" && (
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void run({ kind: "reject", id: r.id }, t("site.reviews.rejected"))}>
              {busy === "reject" ? <Loader2Icon className="animate-spin" /> : <XCircleIcon />} {t("site.reviews.reject")}
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => setReplying(true)}>
            <MessageSquareReplyIcon /> {r.reply ? t("site.reviews.editReply") : t("site.reviews.reply")}
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto text-destructive" disabled={!!busy} onClick={() => setDeleting(true)}>
            <Trash2Icon /> {t("site.common.delete")}
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t("site.reviews.deleteTitle")}
        description={t("site.reviews.deleteBody")}
        confirmLabel={t("site.common.delete")}
        onConfirm={async () => {
          const ok = await run({ kind: "delete", id: r.id }, t("site.reviews.deleted"));
          if (!ok) throw new Error("failed");
          onDeleted();
        }}
      />
    </div>
  );
}

/** Product filter (`?productId=…`): a searchable picker, then a chip with the product's name and a clear button. */
function ProductFilter({ value, onChange }: { value: string | undefined; onChange: (id: string | undefined) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const debounced = useDebounced(q.trim(), 250);
  const search = useProductSearch(debounced, open);
  const picked = useProductsByIds(value ? [value] : []);
  if (value) {
    const p = picked.data?.get(value);
    return (
      <span className="inline-flex h-9 max-w-56 items-center gap-1.5 rounded-full border border-primary bg-primary/10 pr-1 pl-2 text-xs font-medium text-primary">
        {p ? <Thumb src={p.image} className="size-5 rounded-full" /> : <PackageIcon className="size-4" />}
        <span className="truncate">{p?.name ?? (picked.isPending ? t("site.common.loading") : t("site.reviews.unknownProduct"))}</span>
        <button
          type="button"
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("site.reviews.clearProduct")}
          onClick={() => onChange(undefined)}
        >
          <XIcon className="size-3.5" />
        </button>
      </span>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9">
          <PackageIcon /> {t("site.reviews.anyProduct")} <ChevronDownIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <div className="relative mb-2">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus type="search" className="pl-9" value={q} placeholder={t("site.pickers.searchProducts")} aria-label={t("site.pickers.searchProducts")} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ul className="max-h-64 overflow-y-auto">
          {search.isPending ? (
            <li className="p-2">
              <Skeleton className="h-10 w-full" />
            </li>
          ) : (search.data?.items.length ?? 0) === 0 ? (
            <li className="px-3 py-4 text-center text-sm text-muted-foreground">{t("site.pickers.noProducts")}</li>
          ) : (
            search.data!.items.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                  onClick={() => {
                    onChange(p.id);
                    setOpen(false);
                  }}
                >
                  <Thumb src={p.image} className="size-8 rounded-lg" />
                  <span className="truncate">{p.name}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** Auto-approve setting (namespace `reviews`), in a popover next to the page title. */
function ModerationSettings() {
  const { t } = useI18n();
  const manager = useIsManager();
  const q = useReviewSettings();
  const save = useSaveReviewSettings();
  const current: AutoApprove = (q.data?.autoApprove as AutoApprove | undefined) ?? "verified";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="lg">
          <SettingsIcon /> {t("site.reviews.settings")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-[min(22rem,calc(100vw-2rem))] gap-3">
        <div>
          <p className="font-medium">{t("site.reviews.autoApprove")}</p>
          <p className="text-meta text-muted-foreground">{t("site.reviews.autoApproveHint")}</p>
        </div>
        {q.isError ? (
          <QueryError compact error={q.error} />
        ) : (
          <div role="radiogroup" aria-label={t("site.reviews.autoApprove")} className="grid gap-2">
            {AUTO_APPROVE.map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={current === v}
                disabled={!manager || save.isPending || q.isPending}
                onClick={async () => {
                  try {
                    await save.mutateAsync({ autoApprove: v });
                    toast.success(t("site.reviews.settingsSaved"));
                  } catch (err) {
                    toast.error(describeError(err, t));
                  }
                }}
                className={cn(
                  "grid gap-0.5 rounded-xl border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
                  current === v ? "border-primary bg-primary/10" : "hover:bg-accent/50",
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  {current === v && <CheckIcon className="size-4 text-primary" />}
                  {t(`site.reviews.auto.${v}`)}
                </span>
                <span className="text-xs text-muted-foreground">{t(`site.reviews.autoHint.${v}`)}</span>
              </button>
            ))}
          </div>
        )}
        {!manager && <p className="text-meta text-muted-foreground">{t("site.common.readOnlySettings")}</p>}
      </PopoverContent>
    </Popover>
  );
}
