"use client";

import * as React from "react";
import {
  BadgeCheckIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  Loader2Icon,
  MessageSquareReplyIcon,
  PackageIcon,
  SearchIcon,
  SettingsIcon,
  StarIcon,
  ThumbsUpIcon,
  Trash2Icon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import {
  Button,
  Card,
  ChipGroup,
  cn,
  EmptyState,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  Stagger,
  StaggerItem,
  StatusPill,
  Textarea,
  toast,
} from "@srirealtime/ui";
import { absoluteUrl, ConfirmDialog, describeError, Page, PageHeading, QueryError, useDebounced, useI18n } from "@srirealtime/web";
import { Thumb } from "../components/bits";
import { ReviewsIllustration } from "../components/illustrations";
import { Stars } from "../components/stars";
import { PERMS, useCan, useIsManager } from "../lib/access";
import {
  useProductSearch,
  useProductsByIds,
  useReviewAction,
  useReviewCounts,
  useReviews,
  useReviewSettings,
  useSaveReviewSettings,
  type ReviewAction,
} from "../lib/queries";
import { AUTO_APPROVE, type AutoApprove, type ProductSummary, type Review, type ReviewStatus } from "../lib/types";

type RatingFilter = "all" | "5" | "4" | "3" | "2" | "1";

export default function ReviewsPage() {
  const { t } = useI18n();
  const can = useCan(PERMS.reviews);
  const [status, setStatus] = React.useState<ReviewStatus>("pending");
  const [rating, setRating] = React.useState<RatingFilter>("all");
  const [product, setProduct] = React.useState<ProductSummary | null>(null);
  const filters = { status, rating: rating === "all" ? undefined : Number(rating), productId: product?.id };
  const list = useReviews(filters);
  const counts = useReviewCounts();
  const items = React.useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;
  const products = useProductsByIds(items.map((r) => r.productId));
  const filtered = rating !== "all" || !!product;

  return (
    <Page className="max-w-4xl">
      <PageHeading icon={StarIcon} title={t("site.reviews.title")} description={t("site.reviews.subtitle")} actions={<ModerationSettings />} />

      <div className="mb-4 grid gap-3">
        <ChipGroup<ReviewStatus>
          value={status}
          onChange={setStatus}
          aria-label={t("site.common.status")}
          options={(["pending", "approved", "rejected"] as const).map((s) => ({
            value: s,
            label: (
              <>
                {s === "pending" ? <ClockIcon className="size-4" /> : s === "approved" ? <CheckIcon className="size-4" /> : <XCircleIcon className="size-4" />}
                {t(`site.reviews.status.${s}`)}
              </>
            ),
            meta: counts.data?.[s],
          }))}
        />
        <div className="flex flex-wrap items-center gap-2">
          <ChipGroup<RatingFilter>
            size="sm"
            value={rating}
            onChange={setRating}
            aria-label={t("site.reviews.filterRating")}
            options={[
              { value: "all", label: t("site.reviews.allRatings") },
              ...(["5", "4", "3", "2", "1"] as const).map((r) => ({ value: r, label: <>{r} <StarIcon className="size-3 fill-current" /></> })),
            ]}
          />
          <ProductFilter value={product} onChange={setProduct} />
        </div>
      </div>

      {list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <div className="grid gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Card key={i} className="gap-3 p-4">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-40" />
            </Card>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          illustration={filtered ? undefined : <ReviewsIllustration />}
          icon={StarIcon}
          title={filtered ? t("site.common.noMatch") : t(`site.reviews.empty.${status}`)}
          description={filtered ? undefined : t(`site.reviews.emptyHint.${status}`)}
        />
      ) : (
        <>
          <p className="mb-2 text-xs text-muted-foreground">{t("site.reviews.showing", { n: items.length, total })}</p>
          <Stagger className={cn("grid gap-3 transition-opacity", list.isPlaceholderData && "opacity-60")}>
            {items.map((r) => (
              <StaggerItem key={r.id}>
                <ReviewCard review={r} product={products.data?.get(r.productId)} productLoading={products.isPending} canManage={can} />
              </StaggerItem>
            ))}
          </Stagger>
          {list.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" size="lg" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                {list.isFetchingNextPage && <Loader2Icon className="animate-spin" />} {t("site.common.loadMore")}
              </Button>
            </div>
          )}
        </>
      )}
    </Page>
  );
}

function ReviewCard({ review: r, product, productLoading, canManage }: { review: Review; product?: ProductSummary; productLoading: boolean; canManage: boolean }) {
  const { t, formatDate } = useI18n();
  const act = useReviewAction();
  const [replying, setReplying] = React.useState(false);
  const [reply, setReply] = React.useState(r.reply ?? "");
  const [deleting, setDeleting] = React.useState(false);
  const [busy, setBusy] = React.useState<ReviewAction["kind"] | null>(null);

  const run = async (a: ReviewAction, done: string) => {
    setBusy(a.kind);
    try {
      await act.mutateAsync(a);
      toast.success(done);
      return true;
    } catch (err) {
      toast.error(describeError(err, t));
      return false;
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Stars rating={r.rating} />
            {r.verified && (
              <StatusPill tone="success" icon={BadgeCheckIcon}>
                {t("site.reviews.verified")}
              </StatusPill>
            )}
            {r.status === "rejected" && (
              <StatusPill tone="danger" icon={XCircleIcon}>
                {t("site.reviews.status.rejected")}
              </StatusPill>
            )}
            {r.status === "pending" && (
              <StatusPill tone="warning" icon={ClockIcon}>
                {t("site.reviews.status.pending")}
              </StatusPill>
            )}
          </div>
          {r.title && <p className="font-medium">{r.title}</p>}
        </div>
        <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {product ? <Thumb src={product.image} className="size-8 rounded-lg" /> : <PackageIcon className="size-4" />}
          {product ? <span className="max-w-48 truncate">{product.name}</span> : productLoading ? <Skeleton className="h-3 w-24" /> : <span>{t("site.reviews.unknownProduct")}</span>}
        </span>
      </div>
      {r.body && <p className="text-sm leading-relaxed whitespace-pre-line">{r.body}</p>}
      {r.photos.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t("site.reviews.photos")}>
          {r.photos.map((src, i) => (
            <li key={i}>
              <a href={absoluteUrl(src)} target="_blank" rel="noreferrer" className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t("site.reviews.photoN", { n: i + 1 })}>
                <Thumb src={src} className="size-16" />
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{r.authorName}</span>
        <span>· {formatDate(r.createdAt, { day: "numeric", month: "short", year: "numeric" })}</span>
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
          <p className="text-xs text-muted-foreground">{t("site.reviews.replyHint")}</p>
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
        <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
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
        }}
      />
    </Card>
  );
}

function ProductFilter({ value, onChange }: { value: ProductSummary | null; onChange: (p: ProductSummary | null) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const debounced = useDebounced(q.trim(), 250);
  const search = useProductSearch(debounced, open);
  if (value)
    return (
      <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-primary bg-primary/10 pr-1 pl-2 text-xs font-medium text-primary">
        <Thumb src={value.image} className="size-5 rounded-full" />
        <span className="max-w-40 truncate">{value.name}</span>
        <button type="button" className="inline-flex size-6 items-center justify-center rounded-full outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring" aria-label={t("site.reviews.clearProduct")} onClick={() => onChange(null)}>
          <XIcon className="size-3.5" />
        </button>
      </span>
    );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-full">
          <PackageIcon /> {t("site.reviews.anyProduct")} <ChevronDownIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
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
                    onChange(p);
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
          <p className="text-xs text-muted-foreground">{t("site.reviews.autoApproveHint")}</p>
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
        {!manager && <p className="text-xs text-muted-foreground">{t("site.common.readOnlySettings")}</p>}
      </PopoverContent>
    </Popover>
  );
}
