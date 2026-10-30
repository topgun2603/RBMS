"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRightIcon, MessageCircleIcon, SearchIcon, ThumbsDownIcon, ThumbsUpIcon, TicketIcon, InboxIcon, XIcon } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@rbms/ui/components/accordion";
import { Button } from "@rbms/ui/components/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@rbms/ui/components/field";
import { cn } from "@rbms/ui/lib/utils";
import { AnimatePresence, motion, useReducedMotionSafe } from "@rbms/ui/motion";
import { countArticles, filterFaq } from "../lib/help";
import { featureOn, STORE_FEATURES } from "../lib/features";
import { Markdown } from "../lib/markdown";
import type { ChatOrderContext, FaqGroup } from "../types";
import { Empty } from "../components/bits";
import { call } from "./api";
import { openChat } from "./chat-bus";
import { useStore } from "./store-context";

const VOTES_KEY = "sr_faq_votes";

function readVotes(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(VOTES_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

/** "Was this helpful?" — one vote per article per browser (the API doesn't deduplicate). */
export function HelpfulVote({ slug, className }: { slug: string; className?: string }) {
  const { t } = useStore();
  const reduced = useReducedMotionSafe();
  const [voted, setVoted] = React.useState<boolean | null>(null);
  React.useEffect(() => setVoted(readVotes()[slug] ?? null), [slug]);
  const vote = (helpful: boolean) => {
    if (voted !== null) return;
    setVoted(helpful);
    try {
      localStorage.setItem(VOTES_KEY, JSON.stringify({ ...readVotes(), [slug]: helpful }));
    } catch {
      /* storage off */
    }
    call(`/support/public/faq/${encodeURIComponent(slug)}/helpful`, { body: { helpful }, auth: false }).catch(() => undefined);
  };
  return (
    <div className={cn("flex flex-wrap items-center gap-2 text-sm", className)} data-testid="faq-helpful">
      <AnimatePresence mode="wait" initial={false}>
        {voted === null ? (
          <motion.div key="ask" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -6 }} className="flex items-center gap-2">
            <span className="text-muted-foreground">{t("help.wasHelpful")}</span>
            {([true, false] as const).map((h) => (
              <motion.button
                key={String(h)}
                type="button"
                whileTap={{ scale: 0.88 }}
                whileHover={reduced ? undefined : { y: -2 }}
                onClick={() => vote(h)}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border bg-card px-3 font-medium hover:border-primary/40 hover:text-primary focus-ring"
              >
                {h ? <ThumbsUpIcon className="size-4" /> : <ThumbsDownIcon className="size-4" />}
                {h ? t("help.yes") : t("help.no")}
              </motion.button>
            ))}
          </motion.div>
        ) : (
          <motion.p key="thanks" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex items-center gap-2 font-medium text-success-ink" role="status">
            {voted ? <ThumbsUpIcon className="size-4" /> : <ThumbsDownIcon className="size-4" />}
            {t("help.thanks")}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Searchable FAQ: categories with accordion answers (server-rendered first, so crawlable), filtered instantly as the
 * shopper types; the query is mirrored to `?q=` (shareable, SSR'd on reload).
 */
export function FaqBrowser({ groups, bodies, initialQuery }: { groups: FaqGroup[]; bodies: Record<string, string>; initialQuery: string }) {
  const { t } = useStore();
  const reduced = useReducedMotionSafe();
  const [q, setQ] = React.useState(initialQuery);
  const shown = React.useMemo(() => filterFaq(groups, q, bodies), [groups, q, bodies]);
  const count = countArticles(shown);

  React.useEffect(() => {
    const id = setTimeout(() => {
      const url = new URL(window.location.href);
      if (q.trim()) url.searchParams.set("q", q.trim());
      else url.searchParams.delete("q");
      window.history.replaceState(window.history.state, "", url.toString());
    }, 300);
    return () => clearTimeout(id);
  }, [q]);

  return (
    <div className="grid gap-8">
      <form role="search" onSubmit={(e) => e.preventDefault()} className="mx-auto w-full max-w-2xl">
        <label htmlFor="help-search" className="sr-only">
          {t("help.search")}
        </label>
        <InputGroup size="lg" className="h-13 rounded-full bg-card px-2 shadow-[var(--elevation-1)]">
          <InputGroupAddon className="ps-2">
            <SearchIcon className="size-5 text-primary" />
          </InputGroupAddon>
          <InputGroupInput id="help-search" type="text" inputMode="search" enterKeyHint="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("help.searchPlaceholder")} className="text-base" autoComplete="off" data-testid="help-search" />
          {q && (
            <button type="button" onClick={() => setQ("")} aria-label={t("help.clearSearch")} className="me-1 flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-accent">
              <XIcon className="size-4" />
            </button>
          )}
        </InputGroup>
        <AnimatePresence initial={false}>
          {q.trim() && (
            <motion.p key="count" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-3 text-center text-sm text-muted-foreground" role="status" data-testid="help-count">
              {t("help.searchResults", { count, q: q.trim() })}
            </motion.p>
          )}
        </AnimatePresence>
      </form>

      {!groups.length ? (
        <Empty icon={<InboxIcon />} title={t("help.noArticles")} body={t("help.noArticlesBody")} />
      ) : !shown.length ? (
        <Empty icon={<SearchIcon />} title={t("help.searchResults", { count: 0, q: q.trim() })} body={t("help.noResultsBody")} />
      ) : (
        <>
          {!q.trim() && shown.length > 1 && (
            <nav aria-label={t("help.title")} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:flex-wrap sm:justify-center sm:px-0">
              {shown.map((g) => (
                <a key={g.category?.id ?? "general"} href={`#cat-${g.category?.slug ?? "general"}`} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border bg-card px-4 text-sm font-medium hover:border-primary/40 hover:text-primary focus-ring">
                  {g.category?.name ?? t("help.general")}
                  <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">{g.articles.length}</span>
                </a>
              ))}
            </nav>
          )}
          <div className="grid gap-10">
            <AnimatePresence initial={false} mode="popLayout">
              {shown.map((g) => (
                <motion.section
                  key={g.category?.id ?? "general"}
                  layout={reduced ? false : "position"}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  id={`cat-${g.category?.slug ?? "general"}`}
                  className="scroll-mt-28"
                  aria-labelledby={`cat-h-${g.category?.slug ?? "general"}`}
                >
                  <div className="mb-4 flex items-baseline justify-between gap-3">
                    <h2 id={`cat-h-${g.category?.slug ?? "general"}`} className="font-display text-h3 font-semibold">
                      {g.category?.name ?? t("help.general")}
                    </h2>
                    <span className="text-sm text-muted-foreground">{t("help.articles", { count: g.articles.length })}</span>
                  </div>
                  {g.category?.description && <p className="-mt-2 mb-4 text-sm text-muted-foreground">{g.category.description}</p>}
                  <Accordion type="multiple" defaultValue={q.trim() ? g.articles.map((a) => a.slug) : []} key={q.trim() ? "q" : "all"} className="rounded-2xl border bg-card px-4 shadow-xs">
                    {g.articles.map((a) => (
                      <AccordionItem key={a.slug} value={a.slug} data-testid="faq-item" className="[&_[data-slot=accordion-content][data-state=closed]]:hidden">
                        <AccordionTrigger className="py-4 text-start text-base font-semibold hover:no-underline">{a.title}</AccordionTrigger>
                        <AccordionContent className="pb-5" forceMount>
                          {bodies[a.slug] ? <Markdown source={bodies[a.slug]} className="text-[15px] leading-relaxed text-foreground/80" /> : <p className="text-[15px] text-foreground/80">{a.excerpt}</p>}
                          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                            <HelpfulVote slug={a.slug} />
                            <Link href={`/help/${encodeURIComponent(a.slug)}`} className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
                              {t("help.readMore")} <ArrowRightIcon className="size-3.5" />
                            </Link>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </motion.section>
              ))}
            </AnimatePresence>
          </div>
        </>
      )}
    </div>
  );
}

/** "Still need help?" — raise a ticket / my tickets (support), chat (chat). */
export function HelpActions({ className }: { className?: string }) {
  const { t, shell } = useStore();
  const tickets = featureOn(shell.features, STORE_FEATURES.support);
  const chat = featureOn(shell.features, STORE_FEATURES.chat);
  if (!tickets && !chat) return null;
  return (
    <section className={cn("kolam overflow-hidden rounded-3xl border bg-tint-1 p-6 sm:p-8", className)} aria-labelledby="help-still">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="help-still" className="font-display text-h3 font-semibold">
            {t("help.stillNeed")}
          </h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{t("help.stillNeedBody")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tickets && (
            <>
              <Button asChild size="lg" className="rounded-full">
                <Link href="/help/new" data-testid="help-raise">
                  <TicketIcon />
                  {t("help.raise")}
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-full">
                <Link href="/help/tickets">{t("help.myTickets")}</Link>
              </Button>
            </>
          )}
          {chat && (
            <Button size="lg" variant="outline" className="rounded-full" onClick={() => openChat()}>
              <MessageCircleIcon />
              {t("help.chat")}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

/** "Chat about this order" (order pages); renders nothing when chat is off. */
export function ChatAboutOrder({ order, className }: { order: ChatOrderContext; className?: string }) {
  const { t, shell } = useStore();
  if (!featureOn(shell.features, STORE_FEATURES.chat)) return null;
  return (
    <Button variant="outline" className={cn("rounded-full", className)} onClick={() => openChat({ order })} data-testid="chat-about-order">
      <MessageCircleIcon />
      {t("chat.chatAboutOrder")}
    </Button>
  );
}
