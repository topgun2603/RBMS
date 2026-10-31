"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2Icon, MessageSquareReplyIcon, StarIcon, ThumbsUpIcon } from "lucide-react";
import { Button } from "@rbms/ui/components/button";
import { toast } from "@rbms/ui/components/sonner";
import { cn } from "@rbms/ui/lib/utils";
import { AnimatePresence, motion, useInView, useReducedMotionSafe } from "@rbms/ui/motion";
import { formatDate } from "../lib/format";
import type { Review, ReviewList } from "../types";
import { Stars } from "../components/bits";
import { ReviewSource, VerifiedBadge } from "../components/review-source";
import { call, errorMessage } from "./api";
import { useStore } from "./store-context";

/** "photos" filters to reviews with photos (newest first); the rest are sort orders. */
const SORTS = ["recent", "rating-desc", "rating-asc", "photos", "helpful"] as const;
const sortQuery = (s: (typeof SORTS)[number]) => (s === "photos" ? { sort: "recent", photos: "true" } : { sort: s });
const PAGE = 5;

/** Summary + list (server-rendered first page) + sort/load more + write/edit for signed-in shoppers. */
export function ReviewsSection({ productId, productSlug, initial }: { productId: string; productSlug: string; initial: ReviewList }) {
  const { t, locale, auth } = useStore();
  const [data, setData] = React.useState(initial);
  const [sort, setSort] = React.useState<(typeof SORTS)[number]>("recent");
  const [loading, setLoading] = React.useState(false);
  const [mine, setMine] = React.useState<Review | null>(null);
  const [writing, setWriting] = React.useState(false);
  const [voted, setVoted] = React.useState<Set<string>>(new Set());
  const { summary } = data;

  const load = React.useCallback(
    async (s: (typeof SORTS)[number], offset: number) => {
      setLoading(true);
      try {
        const r = await call<ReviewList>(`/reviews/public/products/${productId}/reviews`, { query: { ...sortQuery(s), limit: PAGE, offset }, auth: false });
        setData((d) => (offset === 0 ? r : { ...r, items: [...d.items, ...r.items] }));
      } catch (err) {
        toast.error(errorMessage(err, t));
      } finally {
        setLoading(false);
      }
    },
    [productId, t],
  );

  React.useEffect(() => {
    if (!auth.token) return setMine(null);
    call<{ review: Review | null }>(`/reviews/public/products/${productId}/reviews/mine`)
      .then((r) => setMine(r.review))
      .catch(() => undefined);
  }, [auth.token, productId]);

  // A review request link (`?review=1#reviews`) opens the form for signed-in shoppers.
  const askedToReview = React.useRef(false);
  React.useEffect(() => {
    if (askedToReview.current || typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("review") !== "1") return;
    askedToReview.current = true;
    if (auth.token) setWriting(true);
    document.getElementById("reviews")?.scrollIntoView({ block: "start" });
  }, [auth.token]);

  const max = Math.max(1, ...Object.values(summary.distribution ?? {}));

  return (
    <section id="reviews" aria-labelledby="reviews-h" className="scroll-mt-24">
      <h2 id="reviews-h" className="font-display text-h2 font-semibold">
        {t("reviews.title")}
      </h2>
      <div className="mt-6 grid gap-8 lg:grid-cols-[300px_1fr] lg:gap-12">
        <div className="grid content-start gap-5">
          <div className="flex items-center gap-4">
            <span className="font-display text-6xl font-semibold tabular-nums">{summary.count ? summary.average.toFixed(1) : "–"}</span>
            <div>
              <Stars value={summary.average} t={t} size="md" />
              <p className="mt-1 text-sm text-muted-foreground">{summary.count ? t("reviews.basedOn", { count: summary.count }) : t("reviews.count", { count: 0 })}</p>
            </div>
          </div>
          {summary.count > 0 && (
            <ul className="grid gap-1.5">
              {[5, 4, 3, 2, 1].map((n) => {
                const c = summary.distribution?.[String(n)] ?? 0;
                return (
                  <li key={n} className="flex items-center gap-2 text-xs">
                    <span className="flex w-6 items-center gap-0.5 tabular-nums">
                      {n}
                      <StarIcon className="size-3 fill-amber-400 text-amber-400" aria-hidden />
                    </span>
                    <RatingBar ratio={c / max} delay={(5 - n) * 0.08} />
                    <span className="w-6 text-right text-muted-foreground tabular-nums">{c}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {auth.token ? (
            <Button variant="outline" className="rounded-full" onClick={() => setWriting((w) => !w)}>
              {mine ? t("reviews.edit") : t("reviews.write")}
            </Button>
          ) : (
            <Button asChild variant="outline" className="rounded-full">
              <Link href={`/account?next=${encodeURIComponent(`/p/${productSlug}#reviews`)}`}>{t("reviews.signIn")}</Link>
            </Button>
          )}
          {mine && mine.status === "pending" && <p className="text-xs text-muted-foreground">{t("reviews.pending")}</p>}
        </div>

        <div className="min-w-0">
          {writing && (
            <ReviewForm
              productId={productId}
              existing={mine}
              onDone={(r) => {
                setMine(r);
                setWriting(false);
                void load(sort, 0);
              }}
            />
          )}
          {(data.items.length > 0 || sort !== "recent") && (
            <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label={t("reviews.title")}>
              {SORTS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setSort(s);
                    void load(s, 0);
                  }}
                  aria-pressed={sort === s}
                  className={cn("h-8 rounded-full border px-3 text-xs font-semibold", sort === s ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent")}
                >
                  {t(`reviews.sort.${s}`)}
                </button>
              ))}
            </div>
          )}
          {data.items.length === 0 ? (
            <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">{sort === "photos" ? t("reviews.count", { count: 0 }) : t("reviews.none")}</p>
          ) : (
            <ul className="divide-y">
              <AnimatePresence initial={false}>
              {data.items.map((r, i) => (
                <motion.li key={r.id} layout="position" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: { delay: (i % 5) * 0.05 } }} exit={{ opacity: 0 }} className="py-5 first:pt-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Stars value={r.rating} t={t} />
                    {r.title && <p className="font-semibold">{r.title}</p>}
                  </div>
                  {r.body && <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-foreground/85">{r.body}</p>}
                  {r.photos?.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {r.photos.slice(0, 5).map((p, i) => (
                        <li key={i}>
                          <a href={p} target="_blank" rel="noopener noreferrer" className="block size-20 overflow-hidden rounded-lg bg-muted focus-ring sm:size-24">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p} alt={t("reviews.photo", { n: i + 1, name: r.authorName })} className="size-full object-cover transition-transform hover:scale-105" loading="lazy" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/80">{r.authorCity ? t("reviews.from", { name: r.authorName, city: r.authorCity }) : r.authorName}</span>
                    {r.verified && <VerifiedBadge t={t} />}
                    <ReviewSource review={r} t={t} />
                    <span>{formatDate(r.createdAt, locale)}</span>
                    <button
                      type="button"
                      disabled={!auth.token || voted.has(r.id)}
                      title={auth.token ? t("reviews.markHelpful") : t("reviews.signIn")}
                      onClick={async () => {
                        try {
                          await call(`/reviews/public/reviews/${r.id}/helpful`, { method: "POST" });
                          setVoted((v) => new Set(v).add(r.id));
                          setData((d) => ({ ...d, items: d.items.map((x) => (x.id === r.id ? { ...x, helpfulCount: x.helpfulCount + 1 } : x)) }));
                        } catch (err) {
                          toast.error(errorMessage(err, t));
                        }
                      }}
                      className="ms-auto inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-accent disabled:opacity-60"
                    >
                      <ThumbsUpIcon className="size-3.5" />
                      {t("reviews.helpful", { count: r.helpfulCount })}
                    </button>
                  </div>
                  {r.reply && (
                    <div className="mt-3 rounded-xl bg-muted/60 p-3 text-sm">
                      <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                        <MessageSquareReplyIcon className="size-3.5" />
                        {t("reviews.reply")}
                      </p>
                      {r.reply}
                    </div>
                  )}
                </motion.li>
              ))}
              </AnimatePresence>
            </ul>
          )}
          {data.items.length < data.total && (
            <Button variant="ghost" className="mt-4 rounded-full" disabled={loading} onClick={() => load(sort, data.items.length)}>
              {loading && <Loader2Icon className="animate-spin" />}
              {t("reviews.more")}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Distribution bar that grows from the left when the summary scrolls into view. Server HTML shows the final width;
 * after hydration an off-screen bar resets to empty and grows once seen (scaleX only).
 */
function RatingBar({ ratio, delay }: { ratio: number; delay: number }) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduced = useReducedMotionSafe();
  const [armed, setArmed] = React.useState(false);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.getBoundingClientRect().top > window.innerHeight) setArmed(true);
  }, []);
  const target = reduced || !armed || inView ? ratio : 0;
  return (
    <span ref={ref} className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
      <motion.span
        className="block h-full origin-left rounded-full bg-gradient-to-r from-amber-400 to-amber-500"
        initial={false}
        animate={{ scaleX: target }}
        transition={armed && inView && !reduced ? { duration: 0.8, delay, ease: [0.16, 1, 0.3, 1] } : { duration: 0 }}
      />
    </span>
  );
}

function ReviewForm({ productId, existing, onDone }: { productId: string; existing: Review | null; onDone: (r: Review) => void }) {
  const { t } = useStore();
  const [rating, setRating] = React.useState(existing?.rating ?? 0);
  const [hover, setHover] = React.useState(0);
  const [title, setTitle] = React.useState(existing?.title ?? "");
  const [body, setBody] = React.useState(existing?.body ?? "");
  const [busy, setBusy] = React.useState(false);
  const id = React.useId();
  return (
    <form
      className="mb-8 grid gap-4 rounded-2xl border bg-card p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!rating) return;
        setBusy(true);
        try {
          const r = await call<Review | { review: Review }>(`/reviews/public/products/${productId}/reviews`, { body: { rating, title: title.trim() || undefined, body: body.trim() || undefined } });
          const review = "review" in r ? r.review : r;
          toast.success(t("reviews.thanks"), review.status === "pending" ? { description: t("reviews.pending") } : undefined);
          onDone(review);
        } catch (err) {
          toast.error(errorMessage(err, t));
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{t("reviews.yourRating")}</legend>
        <div className="flex gap-1" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" onClick={() => setRating(n)} onMouseEnter={() => setHover(n)} aria-label={t("reviews.stars", { n })} aria-pressed={rating === n} className="rounded-md p-0.5">
              <StarIcon className={cn("size-8 transition-colors", n <= (hover || rating) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")} />
            </button>
          ))}
        </div>
      </fieldset>
      <div className="grid content-start gap-1.5">
        <label htmlFor={`${id}-t`} className="text-sm font-medium">
          {t("reviews.titleField")} <span className="text-muted-foreground">({t("common.optional")})</span>
        </label>
        <input id={`${id}-t`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className="h-11 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-[3px] focus:ring-ring/30" />
      </div>
      <div className="grid content-start gap-1.5">
        <label htmlFor={`${id}-b`} className="text-sm font-medium">
          {t("reviews.bodyField")}
        </label>
        <textarea id={`${id}-b`} value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={3000} className="rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-[3px] focus:ring-ring/30" />
      </div>
      <Button type="submit" disabled={!rating || busy} className="justify-self-start rounded-full px-6">
        {busy && <Loader2Icon className="animate-spin" />}
        {t("reviews.submit")}
      </Button>
    </form>
  );
}
